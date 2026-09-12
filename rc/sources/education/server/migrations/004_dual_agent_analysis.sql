BEGIN;

ALTER TABLE agent_conversations
  DROP CONSTRAINT IF EXISTS agent_conversations_purpose_check;

ALTER TABLE agent_conversations
  ADD CONSTRAINT agent_conversations_purpose_check
  CHECK (purpose IN ('REPORT_FOLLOWUP', 'ASSESSMENT_ANALYSIS', 'REPORT_ANALYSIS'));

DROP INDEX IF EXISTS agent_conversations_one_active_report_idx;

CREATE UNIQUE INDEX IF NOT EXISTS agent_conversations_one_active_report_purpose_idx
  ON agent_conversations(user_id, report_id, purpose)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS agent_conversations_purpose_idx
  ON agent_conversations(purpose, status, created_at);

COMMIT;
