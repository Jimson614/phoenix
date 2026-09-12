PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  auth_provider TEXT NOT NULL CHECK (auth_provider IN ('local_demo')),
  provider_subject TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (auth_provider, provider_subject)
);

CREATE TABLE IF NOT EXISTS demo_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS families (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS questionnaire_submissions (
  id TEXT PRIMARY KEY,
  client_submission_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  questionnaire_type TEXT NOT NULL CHECK (questionnaire_type IN ('education')),
  answers_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('wechat_miniprogram')),
  client_submitted_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  UNIQUE (user_id, client_submission_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  family_id TEXT,
  occurred_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON demo_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_families_user ON families(user_id);
CREATE INDEX IF NOT EXISTS idx_students_family ON students(family_id);
CREATE INDEX IF NOT EXISTS idx_submissions_family ON questionnaire_submissions(family_id, received_at);
CREATE INDEX IF NOT EXISTS idx_submissions_student ON questionnaire_submissions(student_id, received_at);
CREATE INDEX IF NOT EXISTS idx_audit_family ON audit_log(family_id, occurred_at);
