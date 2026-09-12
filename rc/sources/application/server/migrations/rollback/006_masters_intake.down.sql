BEGIN;

-- Run only against an isolated database after stopping the masters worker.
-- The migration is additive; this rollback removes Application Compass data
-- and tables while leaving all legacy Education Compass tables untouched.
DROP TABLE IF EXISTS masters_report_jobs CASCADE;
DROP TABLE IF EXISTS masters_reports CASCADE;
DROP TABLE IF EXISTS masters_consultation_assignments CASCADE;
DROP TABLE IF EXISTS masters_consultation_snapshots CASCADE;
DROP TABLE IF EXISTS masters_consultation_documents CASCADE;
DROP TABLE IF EXISTS masters_consultation_consents CASCADE;
DROP TABLE IF EXISTS masters_idempotency_records CASCADE;
DROP TABLE IF EXISTS masters_audit_logs CASCADE;
DROP TABLE IF EXISTS masters_staff CASCADE;
DROP TABLE IF EXISTS masters_consultations CASCADE;

COMMIT;
