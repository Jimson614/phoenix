BEGIN;

CREATE TABLE IF NOT EXISTS integration_links (
  id text PRIMARY KEY,
  provider text NOT NULL CHECK (provider = 'feishu_bitable'),
  table_id text NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN (
    'family_profile', 'student_profile', 'assessment_session', 'report_job',
    'order_payment', 'feedback', 'advisor_request'
  )),
  entity_id text NOT NULL,
  external_record_id text,
  payload_digest text,
  status text NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'SYNCED', 'FAILED', 'BLOCKED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_token text,
  operation_token text,
  operation_digest text,
  operation_body text,
  last_error_code text,
  next_attempt_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (provider, table_id, entity_type, entity_id),
  UNIQUE (provider, table_id, external_record_id)
);

CREATE INDEX IF NOT EXISTS integration_links_retry_idx
  ON integration_links(provider, status, next_attempt_at, updated_at);

COMMIT;
