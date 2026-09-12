BEGIN;

CREATE TABLE IF NOT EXISTS agent_consents (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id text NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  report_id text NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope = 'ai_education_agent'),
  consent_version text NOT NULL CHECK (consent_version = 'ai_agent_guardian_v1'),
  guardian_confirmed boolean NOT NULL CHECK (guardian_confirmed),
  actor_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_role text NOT NULL CHECK (actor_role = 'family_user'),
  terms_version text NOT NULL CHECK (char_length(terms_version) BETWEEN 1 AND 100),
  terms_summary text NOT NULL CHECK (char_length(terms_summary) BETWEEN 1 AND 1000),
  terms_digest text NOT NULL CHECK (char_length(terms_digest) BETWEEN 16 AND 256),
  agreed_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS agent_consents_owner_report_idx
  ON agent_consents(user_id, report_id, agreed_at DESC);

CREATE TABLE IF NOT EXISTS agent_conversations (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id text NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  report_id text NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  consent_id text NOT NULL UNIQUE REFERENCES agent_consents(id) ON DELETE RESTRICT,
  purpose text NOT NULL CHECK (purpose = 'REPORT_FOLLOWUP'),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'CLOSED', 'EXPIRED')),
  prompt_version text NOT NULL CHECK (char_length(prompt_version) BETWEEN 1 AND 100),
  creation_key_digest text NOT NULL CHECK (char_length(creation_key_digest) BETWEEN 16 AND 256),
  creation_input_digest text NOT NULL CHECK (char_length(creation_input_digest) BETWEEN 16 AND 256),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  closed_at timestamptz,
  UNIQUE (user_id, report_id, creation_key_digest),
  CHECK (expires_at > created_at),
  CHECK ((status = 'ACTIVE' AND closed_at IS NULL) OR status <> 'ACTIVE')
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_conversations_one_active_report_idx
  ON agent_conversations(user_id, report_id)
  WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS agent_conversations_owner_idx
  ON agent_conversations(user_id, report_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_conversations_expiry_idx
  ON agent_conversations(status, expires_at);

CREATE TABLE IF NOT EXISTS agent_messages (
  id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('USER', 'ASSISTANT')),
  content_envelope jsonb,
  safety_state text NOT NULL CHECK (safety_state IN ('ALLOWED', 'BLOCKED', 'ESCALATE')),
  created_at timestamptz NOT NULL,
  purged_at timestamptz,
  CHECK (content_envelope IS NOT NULL OR safety_state <> 'ALLOWED' OR purged_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS agent_messages_conversation_idx
  ON agent_messages(conversation_id, created_at, id);

CREATE TABLE IF NOT EXISTS agent_runs (
  id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_id text NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  user_message_id text UNIQUE REFERENCES agent_messages(id) ON DELETE SET NULL,
  assistant_message_id text UNIQUE REFERENCES agent_messages(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'CANCELLED')),
  idempotency_key_digest text NOT NULL CHECK (char_length(idempotency_key_digest) BETWEEN 16 AND 256),
  input_digest text NOT NULL CHECK (char_length(input_digest) BETWEEN 16 AND 256),
  request_envelope jsonb,
  report_version text NOT NULL CHECK (char_length(report_version) BETWEEN 1 AND 512),
  context_digest text NOT NULL CHECK (char_length(context_digest) BETWEEN 16 AND 256),
  provider text NOT NULL CHECK (provider IN ('openai', 'mock')),
  model text NOT NULL CHECK (char_length(model) BETWEEN 1 AND 200),
  prompt_version text NOT NULL CHECK (char_length(prompt_version) BETWEEN 1 AND 100),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_token text,
  lease_owner text,
  lease_expires_at timestamptz,
  fence_version integer NOT NULL DEFAULT 0 CHECK (fence_version >= 0),
  next_attempt_at timestamptz NOT NULL,
  error_code text,
  input_tokens integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  purged_at timestamptz,
  UNIQUE (conversation_id, idempotency_key_digest),
  CHECK (
    (status = 'QUEUED' AND request_envelope IS NOT NULL AND lease_token IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL)
    OR (status = 'RUNNING' AND request_envelope IS NOT NULL AND lease_token IS NOT NULL AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR status IN ('SUCCEEDED', 'FAILED', 'BLOCKED', 'CANCELLED')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_one_pending_conversation_idx
  ON agent_runs(conversation_id)
  WHERE status IN ('QUEUED', 'RUNNING');
CREATE INDEX IF NOT EXISTS agent_runs_claim_idx
  ON agent_runs(status, next_attempt_at, lease_expires_at, created_at);
CREATE INDEX IF NOT EXISTS agent_runs_report_quota_idx
  ON agent_runs(user_id, report_id, status, created_at);
CREATE INDEX IF NOT EXISTS agent_runs_user_active_idx
  ON agent_runs(user_id, status, created_at);

CREATE TABLE IF NOT EXISTS agent_worker_heartbeats (
  id text PRIMARY KEY,
  build_version text NOT NULL CHECK (char_length(build_version) BETWEEN 1 AND 100),
  status text NOT NULL CHECK (status IN ('STARTING', 'HEALTHY', 'STOPPING', 'STOPPED', 'ERROR')),
  active_runs integer NOT NULL DEFAULT 0 CHECK (active_runs >= 0),
  last_error_code text,
  started_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS agent_worker_heartbeats_expiry_idx
  ON agent_worker_heartbeats(expires_at);

COMMIT;
