BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('family_user', 'admin')),
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS wechat_identities (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  openid text NOT NULL UNIQUE,
  unionid text,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS wechat_identities_user_idx ON wechat_identities(user_id);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_expiry_idx ON sessions(user_id, expires_at);

CREATE TABLE IF NOT EXISTS families (
  id text PRIMARY KEY,
  user_id text NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  family_name text NOT NULL,
  parent_name text NOT NULL,
  phone text NOT NULL,
  location text NOT NULL DEFAULT '',
  goal text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS students (
  id text PRIMARY KEY,
  family_id text NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name text NOT NULL,
  age integer CHECK (age IS NULL OR age BETWEEN 3 AND 100),
  gender text,
  school text,
  education_system text,
  grade text,
  interest text,
  goal text,
  student_version text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS students_family_idx ON students(family_id);

CREATE TABLE IF NOT EXISTS guardian_consents (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id text NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  consent_version text NOT NULL,
  scope text NOT NULL CHECK (scope = 'education_compass_report'),
  guardian_confirmed boolean NOT NULL CHECK (guardian_confirmed),
  agreed_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS guardian_consents_owner_idx ON guardian_consents(user_id, student_id, agreed_at DESC);

CREATE TABLE IF NOT EXISTS assessments (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id text NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  consent_id text NOT NULL REFERENCES guardian_consents(id),
  questionnaire_version text NOT NULL,
  student_version text NOT NULL,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('DRAFT', 'PREVIEW_READY')),
  completeness_score integer NOT NULL CHECK (completeness_score BETWEEN 0 AND 100),
  missing_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  report_id text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  submitted_at timestamptz
);
CREATE INDEX IF NOT EXISTS assessments_owner_idx ON assessments(user_id, student_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reports (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id text NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  assessment_id text NOT NULL UNIQUE REFERENCES assessments(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('LOCKED', 'GENERATING', 'READY', 'FAILED')),
  delivery_status text NOT NULL CHECK (delivery_status IN ('LOCKED', 'DELIVERED')),
  preview jsonb NOT NULL,
  modules jsonb,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  data_as_of date NOT NULL,
  disclaimer text NOT NULL,
  confidence text NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
  versions jsonb NOT NULL,
  qa_passed boolean NOT NULL DEFAULT false,
  source_catalog_verified boolean NOT NULL DEFAULT false,
  source_catalog_version text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
ALTER TABLE assessments DROP CONSTRAINT IF EXISTS assessments_report_fk;
ALTER TABLE assessments ADD CONSTRAINT assessments_report_fk FOREIGN KEY (report_id) REFERENCES reports(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS reports_owner_idx ON reports(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS products (
  id text PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  amount_fen integer NOT NULL CHECK (amount_fen > 0),
  currency text NOT NULL CHECK (currency = 'CNY'),
  scope text NOT NULL CHECK (scope IN ('SINGLE_REPORT', 'MEMBERSHIP')),
  active boolean NOT NULL,
  created_at timestamptz NOT NULL
);

INSERT INTO products (id, code, name, amount_fen, currency, scope, active, created_at)
VALUES
  ('COMPASS_REPORT_SINGLE_39_9', 'COMPASS_REPORT_SINGLE_39_9', 'Phoenix Education Compass 单次完整报告', 3990, 'CNY', 'SINGLE_REPORT', true, now()),
  ('PHOENIX_MEMBER_199', 'PHOENIX_MEMBER_199', 'Phoenix Family OS 年度会员', 19900, 'CNY', 'MEMBERSHIP', false, now())
ON CONFLICT (id) DO UPDATE SET
  amount_fen = EXCLUDED.amount_fen,
  currency = EXCLUDED.currency,
  scope = EXCLUDED.scope;

CREATE TABLE IF NOT EXISTS orders (
  id text PRIMARY KEY,
  out_trade_no text NOT NULL UNIQUE CHECK (char_length(out_trade_no) BETWEEN 6 AND 32),
  user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  family_id text NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  student_id text NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  assessment_id text NOT NULL REFERENCES assessments(id) ON DELETE RESTRICT,
  report_id text NOT NULL REFERENCES reports(id) ON DELETE RESTRICT,
  product_code text NOT NULL REFERENCES products(code) ON DELETE RESTRICT,
  amount_fen integer NOT NULL CHECK (amount_fen > 0),
  currency text NOT NULL CHECK (currency = 'CNY'),
  status text NOT NULL CHECK (status IN ('CREATED', 'PENDING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDING', 'REFUNDED')),
  idempotency_key text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('mock', 'wechat')),
  provider_prepay_id text,
  payment_params jsonb,
  provider_transaction_id text UNIQUE,
  last_provider_query_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  paid_at timestamptz,
  refunded_at timestamptz,
  UNIQUE (user_id, idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS orders_one_active_purchase_idx
  ON orders(user_id, assessment_id, product_code)
  WHERE status IN ('CREATED', 'PENDING', 'PAID', 'REFUNDING');
CREATE INDEX IF NOT EXISTS orders_owner_created_idx ON orders(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS entitlements (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  order_id text NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  report_id text NOT NULL REFERENCES reports(id) ON DELETE RESTRICT,
  product_code text NOT NULL REFERENCES products(code) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  granted_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS entitlements_access_idx ON entitlements(user_id, report_id, status);

CREATE TABLE IF NOT EXISTS payment_events (
  id text PRIMARY KEY,
  provider_event_id text NOT NULL UNIQUE,
  event_kind text NOT NULL CHECK (event_kind IN ('TRANSACTION', 'REFUND', 'QUERY_RECONCILIATION')),
  out_trade_no text NOT NULL,
  body_digest text NOT NULL,
  verified boolean NOT NULL CHECK (verified),
  processed_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS payment_events_order_idx ON payment_events(out_trade_no);

CREATE TABLE IF NOT EXISTS refunds (
  id text PRIMARY KEY,
  out_refund_no text NOT NULL UNIQUE CHECK (char_length(out_refund_no) BETWEEN 6 AND 32),
  order_id text NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  requested_by text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 80),
  amount_fen integer NOT NULL CHECK (amount_fen > 0),
  currency text NOT NULL CHECK (currency = 'CNY'),
  status text NOT NULL CHECK (status IN ('PROCESSING', 'SUCCESS', 'CLOSED', 'ABNORMAL')),
  provider_refund_id text UNIQUE,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  succeeded_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS refunds_request_idempotency_idx ON refunds(requested_by, idempotency_key);

CREATE TABLE IF NOT EXISTS report_jobs (
  id text PRIMARY KEY,
  order_id text UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  report_id text NOT NULL UNIQUE REFERENCES reports(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  attempts integer NOT NULL CHECK (attempts > 0),
  last_error text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS report_feedback (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_id text NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  comment text NOT NULL DEFAULT '',
  advisor_contact_requested boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS report_feedback_report_idx ON report_feedback(report_id, created_at DESC);

CREATE TABLE IF NOT EXISTS timeline_events (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id text NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  description text NOT NULL,
  report_id text REFERENCES reports(id) ON DELETE SET NULL,
  order_id text REFERENCES orders(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS timeline_events_owner_idx ON timeline_events(user_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS advisor_requests (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id text NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  preferred_time text NOT NULL,
  topic text NOT NULL,
  note text,
  report_id text REFERENCES reports(id) ON DELETE SET NULL,
  student_id text REFERENCES students(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'CONTACTED', 'CLOSED')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS advisor_requests_owner_idx ON advisor_requests(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id text PRIMARY KEY,
  actor_user_id text REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs(entity_type, entity_id, created_at DESC);

COMMIT;
