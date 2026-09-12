BEGIN;

-- Application Compass / Hong Kong masters consultation.  This migration is
-- additive and intentionally does not alter the legacy Education Compass
-- tables.  Adult applicants use users.id as the authoritative identity;
-- linked_student_id is only an optional mapping for existing profiles.

CREATE TABLE IF NOT EXISTS masters_consultations (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  linked_student_id text REFERENCES students(id) ON DELETE SET NULL,
  application_season text NOT NULL CHECK (char_length(application_season) BETWEEN 1 AND 20),
  channel text NOT NULL DEFAULT '' CHECK (char_length(channel) <= 100),
  path text NOT NULL DEFAULT '' CHECK (char_length(path) <= 100),
  status text NOT NULL CHECK (status IN ('DRAFT', 'SUBMITTED', 'NEEDS_INFO', 'IN_REVIEW', 'CLOSED', 'WITHDRAWN')),
  profile jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(profile) = 'object'),
  profile_version integer NOT NULL DEFAULT 1 CHECK (profile_version >= 1),
  accuracy_confirmed boolean NOT NULL DEFAULT false,
  service_consent_id text,
  confirmed_snapshot_id text,
  submitted_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK ((status = 'WITHDRAWN') = (withdrawn_at IS NOT NULL)),
  UNIQUE (user_id, application_season),
  UNIQUE (id, user_id)
);
CREATE INDEX IF NOT EXISTS masters_consultations_owner_idx
  ON masters_consultations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS masters_consultations_status_idx
  ON masters_consultations(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS masters_staff (
  id text PRIMARY KEY,
  user_id text NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('founder', 'advisor', 'assignment_manager')),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  granted_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS masters_staff_role_idx ON masters_staff(role, status);

CREATE TABLE IF NOT EXISTS masters_consultation_consents (
  id text PRIMARY KEY,
  consultation_id text NOT NULL REFERENCES masters_consultations(id) ON DELETE RESTRICT,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  copy_version text NOT NULL CHECK (char_length(copy_version) BETWEEN 1 AND 100),
  copy_text_hash text NOT NULL CHECK (copy_text_hash ~ '^[0-9A-Fa-f]{64}$'),
  locale text NOT NULL CHECK (locale = 'zh-CN'),
  accepted boolean NOT NULL CHECK (accepted),
  granted_at timestamptz NOT NULL,
  withdrawn_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (withdrawn_at IS NULL OR withdrawn_at >= granted_at),
  FOREIGN KEY (consultation_id, user_id) REFERENCES masters_consultations(id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS masters_consents_one_active_idx
  ON masters_consultation_consents(consultation_id) WHERE withdrawn_at IS NULL;
CREATE INDEX IF NOT EXISTS masters_consents_owner_idx
  ON masters_consultation_consents(user_id, consultation_id, granted_at DESC);
ALTER TABLE masters_consultations
  ADD CONSTRAINT masters_consultations_consent_fk
  FOREIGN KEY (service_consent_id) REFERENCES masters_consultation_consents(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS masters_consultation_documents (
  id text PRIMARY KEY,
  consultation_id text NOT NULL REFERENCES masters_consultations(id) ON DELETE RESTRICT,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('RESUME', 'TRANSCRIPT', 'LANGUAGE', 'ENROLLMENT', 'GRADUATION', 'DEGREE', 'SUPPLEMENTAL')),
  storage_key text NOT NULL UNIQUE CHECK (storage_key !~* '^(https?:|data:|file:)'),
  original_name text NOT NULL CHECK (char_length(original_name) BETWEEN 1 AND 255),
  description text CHECK (description IS NULL OR char_length(description) <= 2000),
  mime_type text NOT NULL CHECK (mime_type IN ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png')),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9A-Fa-f]{64}$'),
  profile_version integer NOT NULL CHECK (profile_version >= 1),
  upload_status text NOT NULL CHECK (upload_status IN ('UPLOADED', 'FAILED', 'REMOVED')),
  extraction_status text NOT NULL CHECK (extraction_status IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'NEEDS_CONFIRMATION', 'MANUAL_REVIEW', 'FAILED')),
  extraction jsonb CHECK (extraction IS NULL OR jsonb_typeof(extraction) = 'object'),
  uploaded_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  removed_at timestamptz,
  CHECK ((upload_status = 'REMOVED') = (removed_at IS NOT NULL)),
  UNIQUE (consultation_id, id)
);
CREATE INDEX IF NOT EXISTS masters_documents_consultation_type_idx
  ON masters_consultation_documents(consultation_id, type, uploaded_at DESC)
  WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS masters_documents_owner_idx
  ON masters_consultation_documents(user_id, consultation_id, uploaded_at DESC);
ALTER TABLE masters_consultation_documents
  ADD CONSTRAINT masters_documents_consultation_owner_fk
  FOREIGN KEY (consultation_id, user_id) REFERENCES masters_consultations(id, user_id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS masters_consultation_snapshots (
  id text PRIMARY KEY,
  consultation_id text NOT NULL REFERENCES masters_consultations(id) ON DELETE RESTRICT,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_version integer NOT NULL CHECK (profile_version >= 1),
  profile jsonb NOT NULL CHECK (jsonb_typeof(profile) = 'object'),
  document_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(document_ids) = 'array'),
  accuracy_confirmed boolean NOT NULL CHECK (accuracy_confirmed),
  confirmed_by text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  confirmed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (consultation_id, profile_version),
  UNIQUE (consultation_id, id),
  FOREIGN KEY (consultation_id, user_id) REFERENCES masters_consultations(id, user_id)
);
CREATE INDEX IF NOT EXISTS masters_snapshots_owner_idx
  ON masters_consultation_snapshots(user_id, consultation_id, profile_version DESC);
ALTER TABLE masters_consultations
  ADD CONSTRAINT masters_consultations_snapshot_fk
  FOREIGN KEY (confirmed_snapshot_id) REFERENCES masters_consultation_snapshots(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS masters_consultation_assignments (
  id text PRIMARY KEY,
  consultation_id text NOT NULL REFERENCES masters_consultations(id) ON DELETE RESTRICT,
  advisor_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_by text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'ENDED')),
  assigned_at timestamptz NOT NULL,
  ended_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK ((status = 'ENDED') = (ended_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS masters_assignments_one_active_idx
  ON masters_consultation_assignments(consultation_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS masters_assignments_advisor_idx
  ON masters_consultation_assignments(advisor_user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS masters_reports (
  id text PRIMARY KEY,
  consultation_id text NOT NULL REFERENCES masters_consultations(id) ON DELETE RESTRICT,
  snapshot_id text NOT NULL REFERENCES masters_consultation_snapshots(id) ON DELETE RESTRICT,
  source_profile_version integer NOT NULL CHECK (source_profile_version >= 1),
  version integer NOT NULL CHECK (version >= 1),
  status text NOT NULL CHECK (status IN ('NOT_STARTED', 'QUEUED', 'RUNNING', 'NEEDS_REVIEW', 'APPROVED', 'RELEASED', 'FAILED', 'STALE')),
  template_version text NOT NULL CHECK (char_length(template_version) BETWEEN 1 AND 100),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  edited_by text REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by text REFERENCES users(id) ON DELETE SET NULL,
  approved_by text REFERENCES users(id) ON DELETE SET NULL,
  released_by text REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  approved_at timestamptz,
  released_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (consultation_id, version),
  UNIQUE (consultation_id, id),
  FOREIGN KEY (consultation_id, snapshot_id) REFERENCES masters_consultation_snapshots(consultation_id, id)
);
CREATE INDEX IF NOT EXISTS masters_reports_current_idx
  ON masters_reports(consultation_id, status, version DESC);
CREATE INDEX IF NOT EXISTS masters_reports_owner_idx
  ON masters_reports(consultation_id, released_at DESC)
  WHERE status = 'RELEASED';

CREATE TABLE IF NOT EXISTS masters_report_jobs (
  id text PRIMARY KEY,
  consultation_id text NOT NULL REFERENCES masters_consultations(id) ON DELETE RESTRICT,
  snapshot_id text NOT NULL REFERENCES masters_consultation_snapshots(id) ON DELETE RESTRICT,
  source_profile_version integer NOT NULL CHECK (source_profile_version >= 1),
  report_id text NOT NULL UNIQUE REFERENCES masters_reports(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('QUEUED', 'RUNNING', 'NEEDS_REVIEW', 'FAILED', 'STALE')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  lease_token text,
  lease_owner text,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz NOT NULL,
  last_error text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE (consultation_id, snapshot_id),
  FOREIGN KEY (consultation_id, snapshot_id) REFERENCES masters_consultation_snapshots(consultation_id, id),
  FOREIGN KEY (consultation_id, report_id) REFERENCES masters_reports(consultation_id, id)
);
CREATE INDEX IF NOT EXISTS masters_report_jobs_claim_idx
  ON masters_report_jobs(status, next_attempt_at, updated_at);
CREATE INDEX IF NOT EXISTS masters_report_jobs_consultation_idx
  ON masters_report_jobs(consultation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS masters_audit_logs (
  id text PRIMARY KEY,
  consultation_id text REFERENCES masters_consultations(id) ON DELETE SET NULL,
  actor_user_id text REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 100),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS masters_audit_entity_idx
  ON masters_audit_logs(consultation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS masters_idempotency_records (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  domain text NOT NULL CHECK (domain IN ('CREATE', 'CONSENT', 'CONFIRM', 'SUBMIT', 'DOCUMENT_ADD', 'ASSIGN', 'ENQUEUE_REPORT')),
  key_digest text NOT NULL CHECK (key_digest ~ '^[0-9A-Fa-f]{64}$'),
  input_digest text NOT NULL CHECK (input_digest ~ '^[0-9A-Fa-f]{64}$'),
  status text NOT NULL CHECK (status IN ('IN_PROGRESS', 'COMPLETED')),
  resource_type text,
  resource_id text,
  response_status integer CHECK (response_status IS NULL OR response_status BETWEEN 100 AND 599),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  CHECK ((status = 'COMPLETED' AND resource_type IS NOT NULL AND resource_id IS NOT NULL AND completed_at IS NOT NULL) OR status = 'IN_PROGRESS'),
  UNIQUE (user_id, domain, key_digest)
);
CREATE INDEX IF NOT EXISTS masters_idempotency_resource_idx
  ON masters_idempotency_records(resource_type, resource_id)
  WHERE resource_id IS NOT NULL;

COMMIT;
