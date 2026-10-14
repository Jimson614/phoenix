-- 011: a family can delete one child's profile.
--
-- Numbered after 010, which is reserved for the masters intake migration (decided 2026-10-12);
-- the runner applies files by name and records each one, so the gap is harmless.
--
-- A child without purchased reports is deleted outright. A child with purchased reports keeps
-- its row, marked deleted, because reports.student_id is NOT NULL and the family decided
-- (2026-10-14) that purchased reports and their orders stay available in the order history.
-- A deleted child no longer appears in the family's lists and cannot start a questionnaire.

ALTER TABLE students ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS students_family_active_idx
  ON students(family_id, created_at)
  WHERE deleted_at IS NULL;
