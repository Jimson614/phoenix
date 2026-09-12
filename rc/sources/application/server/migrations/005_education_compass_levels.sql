BEGIN;

-- Phoenix Education Compass V0.5.0 is an additive evolution of the V0.4.1
-- schema. Existing rows and legacy write paths remain valid; new code must set
-- the V0.5 fields explicitly. The migration runner owns repeat detection and
-- checksum verification, so this file must remain immutable after deployment.

-- ---------------------------------------------------------------------------
-- Profiles: preserve one Family/Student profile while allowing honest,
-- provisional records without invented names, phone numbers, schools or goals.
-- Existing rows are explicitly marked as legacy-complete.
-- ---------------------------------------------------------------------------

ALTER TABLE families
  ADD COLUMN profile_status text,
  ADD COLUMN profile_schema_version text;

UPDATE families
SET profile_status = 'LEGACY_COMPLETE',
    profile_schema_version = 'legacy_family_profile_v0.4.1'
WHERE profile_status IS NULL OR profile_schema_version IS NULL;

ALTER TABLE families
  ALTER COLUMN profile_status SET NOT NULL,
  ALTER COLUMN profile_status SET DEFAULT 'LEGACY_COMPLETE',
  ALTER COLUMN profile_schema_version SET NOT NULL,
  ALTER COLUMN profile_schema_version SET DEFAULT 'legacy_family_profile_v0.4.1',
  ALTER COLUMN family_name DROP NOT NULL,
  ALTER COLUMN parent_name DROP NOT NULL,
  ALTER COLUMN phone DROP NOT NULL,
  ALTER COLUMN location DROP NOT NULL,
  ALTER COLUMN goal DROP NOT NULL,
  ADD CONSTRAINT families_profile_status_v005_check
    CHECK (profile_status IN ('PROVISIONAL', 'COMPLETE', 'LEGACY_COMPLETE')),
  ADD CONSTRAINT families_profile_schema_version_v005_check
    CHECK (char_length(profile_schema_version) BETWEEN 1 AND 100);

ALTER TABLE students
  ADD COLUMN profile_status text,
  ADD COLUMN profile_schema_version text,
  ADD COLUMN grade_stage text;

UPDATE students
SET profile_status = 'LEGACY_COMPLETE',
    profile_schema_version = 'legacy_student_profile_v0.4.1',
    grade_stage = COALESCE(grade_stage, grade)
WHERE profile_status IS NULL
   OR profile_schema_version IS NULL
   OR grade_stage IS NULL;

ALTER TABLE students
  ALTER COLUMN profile_status SET NOT NULL,
  ALTER COLUMN profile_status SET DEFAULT 'LEGACY_COMPLETE',
  ALTER COLUMN profile_schema_version SET NOT NULL,
  ALTER COLUMN profile_schema_version SET DEFAULT 'legacy_student_profile_v0.4.1',
  ALTER COLUMN name DROP NOT NULL,
  ADD CONSTRAINT students_profile_status_v005_check
    CHECK (profile_status IN ('PROVISIONAL', 'COMPLETE_FOR_LEVEL_2', 'COMPLETE', 'LEGACY_COMPLETE')),
  ADD CONSTRAINT students_profile_schema_version_v005_check
    CHECK (char_length(profile_schema_version) BETWEEN 1 AND 100);

CREATE INDEX students_profile_status_v005_idx
  ON students(family_id, profile_status, updated_at DESC);

-- ---------------------------------------------------------------------------
-- Versioned, purpose-specific consent. Absence of an active row is false;
-- payment, an environment flag or a grant for another scope cannot substitute.
-- The legacy guardian_consents table remains unchanged for V0.4.1 reads.
-- ---------------------------------------------------------------------------

CREATE TABLE consent_grants (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id text NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  student_id text REFERENCES students(id) ON DELETE CASCADE,
  subject_type text NOT NULL CHECK (subject_type IN ('USER', 'FAMILY', 'STUDENT')),
  subject_id text NOT NULL,
  subject_role text NOT NULL CHECK (subject_role IN ('PARENT_GUARDIAN', 'STUDENT')),
  scope text NOT NULL CHECK (scope IN (
    'CORE_ASSESSMENT',
    'STUDENT_ASSESSMENT_ASSENT',
    'AI_ANALYSIS',
    'FEISHU_PROFILE_MIRROR',
    'ADVISOR_CONTACT',
    'MARKETING_CONTACT',
    'ASKWISE_HANDOFF'
  )),
  copy_version text NOT NULL CHECK (char_length(copy_version) BETWEEN 1 AND 100),
  copy_text_hash text NOT NULL CHECK (copy_text_hash ~ '^[0-9A-Fa-f]{64}$'),
  locale text NOT NULL CHECK (char_length(locale) BETWEEN 2 AND 20),
  guardian_authority_status text NOT NULL CHECK (guardian_authority_status IN (
    'CONFIRMED', 'NOT_APPLICABLE', 'UNKNOWN'
  )),
  source_entry text NOT NULL CHECK (source_entry IN (
    'MINIPROGRAM_HOME', 'LEVEL_1_RESULT', 'DIRECT_LEVEL_2',
    'XIAOHONGSHU_CONTENT', 'ADVISOR_REFERRAL', 'INTERNAL_UAT',
    'LEGACY_V0_4_1'
  )),
  audit_metadata jsonb NOT NULL CHECK (jsonb_typeof(audit_metadata) = 'object'),
  granted_at timestamptz NOT NULL,
  withdrawn_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (withdrawn_at IS NULL OR withdrawn_at >= granted_at),
  CHECK (
    (subject_type = 'USER' AND subject_id = user_id)
    OR (subject_type = 'FAMILY' AND subject_id = family_id)
    OR (subject_type = 'STUDENT' AND student_id IS NOT NULL AND subject_id = student_id)
  )
);

CREATE UNIQUE INDEX consent_grants_one_active_scope_v005_idx
  ON consent_grants(user_id, subject_type, subject_id, scope)
  WHERE withdrawn_at IS NULL;

CREATE INDEX consent_grants_active_scope_v005_idx
  ON consent_grants(user_id, family_id, student_id, scope, granted_at DESC)
  WHERE withdrawn_at IS NULL;

-- ---------------------------------------------------------------------------
-- Assessments: add kind/version routing, source lineage, optimistic draft
-- revision and V0.5 consent references. Legacy rows keep their original
-- questionnaire, answers, consent and report links.
-- ---------------------------------------------------------------------------

ALTER TABLE assessments
  ADD COLUMN assessment_kind text,
  ADD COLUMN assessment_level text,
  ADD COLUMN respondent_role text,
  ADD COLUMN source_assessment_id text,
  ADD COLUMN education_system text,
  ADD COLUMN grade_stage text,
  ADD COLUMN source_entry text,
  ADD COLUMN common_bank_version text,
  ADD COLUMN system_bank_version text,
  ADD COLUMN bank_versions jsonb,
  ADD COLUMN schema_digest text,
  ADD COLUMN respondent_confirmation text,
  ADD COLUMN core_consent_grant_id text,
  ADD COLUMN student_assent_grant_id text,
  ADD COLUMN result_kind text,
  ADD COLUMN draft_revision integer,
  ADD COLUMN submitted_input_digest text;

UPDATE assessments
SET assessment_kind = 'LEGACY_EDUCATION_COMPASS',
    assessment_level = 'LEGACY',
    respondent_role = 'LEGACY_UNSPECIFIED',
    source_entry = 'LEGACY_V0_4_1',
    bank_versions = jsonb_build_object('legacy_questionnaire_version', questionnaire_version),
    result_kind = 'LEGACY_EDUCATION_COMPASS_REPORT',
    draft_revision = 1
WHERE assessment_kind IS NULL
   OR assessment_level IS NULL
   OR respondent_role IS NULL
   OR source_entry IS NULL
   OR bank_versions IS NULL
   OR result_kind IS NULL
   OR draft_revision IS NULL;

ALTER TABLE assessments
  ALTER COLUMN assessment_kind SET NOT NULL,
  ALTER COLUMN assessment_kind SET DEFAULT 'LEGACY_EDUCATION_COMPASS',
  ALTER COLUMN assessment_level SET NOT NULL,
  ALTER COLUMN assessment_level SET DEFAULT 'LEGACY',
  ALTER COLUMN respondent_role SET NOT NULL,
  ALTER COLUMN respondent_role SET DEFAULT 'LEGACY_UNSPECIFIED',
  ALTER COLUMN source_entry SET NOT NULL,
  ALTER COLUMN source_entry SET DEFAULT 'LEGACY_V0_4_1',
  ALTER COLUMN bank_versions SET NOT NULL,
  ALTER COLUMN bank_versions SET DEFAULT '{}'::jsonb,
  ALTER COLUMN result_kind SET NOT NULL,
  ALTER COLUMN result_kind SET DEFAULT 'LEGACY_EDUCATION_COMPASS_REPORT',
  ALTER COLUMN draft_revision SET NOT NULL,
  ALTER COLUMN draft_revision SET DEFAULT 1,
  ALTER COLUMN consent_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS assessments_status_check,
  ADD CONSTRAINT assessments_status_v005_check
    CHECK (status IN ('DRAFT', 'SUBMITTED', 'PREVIEW_READY')),
  ADD CONSTRAINT assessments_kind_v005_check
    CHECK (assessment_kind IN (
      'LEGACY_EDUCATION_COMPASS', 'FREE_PARENT_COMPASS', 'STUDENT_GROWTH_DISCOVERY'
    )),
  ADD CONSTRAINT assessments_level_v005_check
    CHECK (assessment_level IN ('LEGACY', 'LEVEL_1', 'LEVEL_2')),
  ADD CONSTRAINT assessments_respondent_v005_check
    CHECK (respondent_role IN ('LEGACY_UNSPECIFIED', 'PARENT_GUARDIAN', 'STUDENT')),
  ADD CONSTRAINT assessments_source_entry_v005_check
    CHECK (source_entry IN (
      'MINIPROGRAM_HOME', 'LEVEL_1_RESULT', 'DIRECT_LEVEL_2',
      'XIAOHONGSHU_CONTENT', 'ADVISOR_REFERRAL', 'INTERNAL_UAT',
      'LEGACY_V0_4_1'
    )),
  ADD CONSTRAINT assessments_education_system_v005_check
    CHECK (education_system IS NULL OR education_system IN (
      'GAOKAO', 'DSE', 'IGCSE', 'A_LEVEL', 'AP_US', 'IB', 'OTHER'
    )),
  ADD CONSTRAINT assessments_draft_revision_v005_check
    CHECK (draft_revision >= 1),
  ADD CONSTRAINT assessments_schema_digest_v005_check
    CHECK (schema_digest IS NULL OR schema_digest ~ '^[0-9A-Fa-f]{64}$'),
  ADD CONSTRAINT assessments_submitted_digest_v005_check
    CHECK (submitted_input_digest IS NULL OR submitted_input_digest ~ '^[0-9A-Fa-f]{64}$'),
  ADD CONSTRAINT assessments_bank_versions_object_v005_check
    CHECK (jsonb_typeof(bank_versions) = 'object'),
  ADD CONSTRAINT assessments_source_not_self_v005_check
    CHECK (source_assessment_id IS NULL OR source_assessment_id <> id),
  ADD CONSTRAINT assessments_kind_contract_v005_check
    CHECK (
      (
        assessment_kind = 'LEGACY_EDUCATION_COMPASS'
        AND assessment_level = 'LEGACY'
        AND respondent_role = 'LEGACY_UNSPECIFIED'
        AND consent_id IS NOT NULL
        AND result_kind = 'LEGACY_EDUCATION_COMPASS_REPORT'
      )
      OR (
        assessment_kind = 'FREE_PARENT_COMPASS'
        AND assessment_level = 'LEVEL_1'
        AND respondent_role = 'PARENT_GUARDIAN'
        AND source_assessment_id IS NULL
        AND (
          status = 'DRAFT'
          OR (education_system IS NOT NULL AND grade_stage IS NOT NULL)
        )
        AND common_bank_version IS NOT NULL
        AND bank_versions <> '{}'::jsonb
        AND schema_digest IS NOT NULL
        AND core_consent_grant_id IS NOT NULL
        AND result_kind = 'FAMILY_EDUCATION_SNAPSHOT'
      )
      OR (
        assessment_kind = 'STUDENT_GROWTH_DISCOVERY'
        AND assessment_level = 'LEVEL_2'
        AND respondent_role = 'STUDENT'
        AND source_assessment_id IS NOT NULL
        AND education_system IS NOT NULL
        AND (status = 'DRAFT' OR grade_stage IS NOT NULL)
        AND common_bank_version IS NOT NULL
        AND bank_versions <> '{}'::jsonb
        AND schema_digest IS NOT NULL
        AND core_consent_grant_id IS NOT NULL
        AND student_assent_grant_id IS NOT NULL
        AND result_kind = 'STUDENT_GROWTH_DISCOVERY'
      )
    ),
  ADD CONSTRAINT assessments_level2_submit_confirmation_v005_check
    CHECK (
      assessment_kind <> 'STUDENT_GROWTH_DISCOVERY'
      OR status = 'DRAFT'
      OR respondent_confirmation = 'CONFIRM_STUDENT_SELF'
    ),
  ADD CONSTRAINT assessments_v005_submission_snapshot_check
    CHECK (
      assessment_kind = 'LEGACY_EDUCATION_COMPASS'
      OR status = 'DRAFT'
      OR (submitted_at IS NOT NULL AND submitted_input_digest IS NOT NULL)
    ),
  ADD CONSTRAINT assessments_formal_system_bank_v005_check
    CHECK (
      assessment_kind <> 'STUDENT_GROWTH_DISCOVERY'
      OR education_system NOT IN ('GAOKAO', 'DSE', 'IGCSE', 'A_LEVEL', 'AP_US')
      OR system_bank_version IS NOT NULL
    ),
  ADD CONSTRAINT assessments_source_assessment_fk_v005
    FOREIGN KEY (source_assessment_id) REFERENCES assessments(id) ON DELETE RESTRICT,
  ADD CONSTRAINT assessments_core_consent_grant_fk_v005
    FOREIGN KEY (core_consent_grant_id) REFERENCES consent_grants(id) ON DELETE RESTRICT,
  ADD CONSTRAINT assessments_student_assent_grant_fk_v005
    FOREIGN KEY (student_assent_grant_id) REFERENCES consent_grants(id) ON DELETE RESTRICT;

CREATE FUNCTION phoenix_v005_enforce_assessment_consent_links()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  core_grant consent_grants%ROWTYPE;
  assent_grant consent_grants%ROWTYPE;
  source_assessment assessments%ROWTYPE;
BEGIN
  IF NEW.assessment_kind = 'LEGACY_EDUCATION_COMPASS' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO core_grant FROM consent_grants WHERE id = NEW.core_consent_grant_id;
  IF NOT FOUND
    OR core_grant.user_id IS DISTINCT FROM NEW.user_id
    OR core_grant.family_id IS DISTINCT FROM NEW.family_id
    OR core_grant.student_id IS DISTINCT FROM NEW.student_id
    OR core_grant.subject_type <> 'STUDENT'
    OR core_grant.subject_id IS DISTINCT FROM NEW.student_id
    OR core_grant.scope <> 'CORE_ASSESSMENT'
    OR core_grant.subject_role <> 'PARENT_GUARDIAN'
    OR core_grant.copy_version <> 'guardian_core_assessment_v1.0.0-rc1'
    OR lower(core_grant.copy_text_hash) <> '334a1e8e455dfef386fcaf491acea3dac23b13c4ece010cfad66d1087f6a84a5'
    OR core_grant.locale <> 'zh-CN'
    OR core_grant.guardian_authority_status <> 'CONFIRMED'
    OR core_grant.withdrawn_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'Assessment core consent linkage is invalid' USING ERRCODE = '23514';
  END IF;

  IF NEW.assessment_kind = 'STUDENT_GROWTH_DISCOVERY' THEN
    SELECT * INTO assent_grant FROM consent_grants WHERE id = NEW.student_assent_grant_id;
    IF NOT FOUND
      OR assent_grant.user_id IS DISTINCT FROM NEW.user_id
      OR assent_grant.family_id IS DISTINCT FROM NEW.family_id
      OR assent_grant.student_id IS DISTINCT FROM NEW.student_id
      OR assent_grant.subject_type <> 'STUDENT'
      OR assent_grant.subject_id IS DISTINCT FROM NEW.student_id
      OR assent_grant.scope <> 'STUDENT_ASSESSMENT_ASSENT'
      OR assent_grant.subject_role <> 'STUDENT'
      OR assent_grant.copy_version <> 'student_assent_growth_discovery_v1.0.0-rc1'
      OR lower(assent_grant.copy_text_hash) <> '0ab8f89835cfe500f97944324ab58a3cf2cce27913fc5af5d02461227b2a821d'
      OR assent_grant.locale <> 'zh-CN'
      OR assent_grant.guardian_authority_status <> 'NOT_APPLICABLE'
      OR assent_grant.withdrawn_at IS NOT NULL
    THEN
      RAISE EXCEPTION 'Assessment student assent linkage is invalid' USING ERRCODE = '23514';
    END IF;

    SELECT * INTO source_assessment FROM assessments WHERE id = NEW.source_assessment_id;
    IF NOT FOUND
      OR source_assessment.assessment_kind <> 'FREE_PARENT_COMPASS'
      OR source_assessment.status <> 'SUBMITTED'
      OR source_assessment.user_id IS DISTINCT FROM NEW.user_id
      OR source_assessment.family_id IS DISTINCT FROM NEW.family_id
      OR source_assessment.student_id IS DISTINCT FROM NEW.student_id
      OR source_assessment.core_consent_grant_id IS DISTINCT FROM NEW.core_consent_grant_id
    THEN
      RAISE EXCEPTION 'Level 2 source assessment linkage is invalid' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER assessments_consent_links_v005_trigger
BEFORE INSERT OR UPDATE OF
  assessment_kind, user_id, family_id, student_id, source_assessment_id,
  core_consent_grant_id, student_assent_grant_id
ON assessments
FOR EACH ROW EXECUTE FUNCTION phoenix_v005_enforce_assessment_consent_links();

CREATE INDEX assessments_kind_owner_v005_idx
  ON assessments(user_id, assessment_kind, student_id, status, updated_at DESC);

CREATE INDEX assessments_source_v005_idx
  ON assessments(source_assessment_id)
  WHERE source_assessment_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Reports: retain preview/modules for legacy rendering and add a versioned,
-- deterministic V0.5 payload. A locked Level 2 report still exists before the
-- order, so orders.report_id and entitlements.report_id remain NOT NULL.
-- ---------------------------------------------------------------------------

ALTER TABLE reports
  ADD COLUMN report_kind text,
  ADD COLUMN result_version text,
  ADD COLUMN result_payload jsonb,
  ADD COLUMN rule_version text,
  ADD COLUMN disclaimer_version text,
  ADD COLUMN disclaimer_text_hash text;

UPDATE reports
SET report_kind = 'LEGACY_EDUCATION_COMPASS_REPORT',
    result_version = 'legacy_compass_report_v0.4.1'
WHERE report_kind IS NULL OR result_version IS NULL;

ALTER TABLE reports
  ALTER COLUMN report_kind SET NOT NULL,
  ALTER COLUMN report_kind SET DEFAULT 'LEGACY_EDUCATION_COMPASS_REPORT',
  ALTER COLUMN result_version SET NOT NULL,
  ALTER COLUMN result_version SET DEFAULT 'legacy_compass_report_v0.4.1',
  ALTER COLUMN preview DROP NOT NULL,
  ALTER COLUMN data_as_of DROP NOT NULL,
  ALTER COLUMN disclaimer DROP NOT NULL,
  ALTER COLUMN confidence DROP NOT NULL,
  ALTER COLUMN versions DROP NOT NULL,
  ALTER COLUMN source_catalog_version DROP NOT NULL,
  ADD CONSTRAINT reports_kind_v005_check
    CHECK (report_kind IN (
      'LEGACY_EDUCATION_COMPASS_REPORT',
      'FAMILY_EDUCATION_SNAPSHOT',
      'STUDENT_GROWTH_DISCOVERY'
    )),
  ADD CONSTRAINT reports_result_payload_v005_check
    CHECK (result_payload IS NULL OR jsonb_typeof(result_payload) = 'object'),
  ADD CONSTRAINT reports_disclaimer_hash_v005_check
    CHECK (disclaimer_text_hash IS NULL OR disclaimer_text_hash ~ '^[0-9A-Fa-f]{64}$'),
  ADD CONSTRAINT reports_kind_contract_v005_check
    CHECK (
      (
        report_kind = 'LEGACY_EDUCATION_COMPASS_REPORT'
        AND preview IS NOT NULL
        AND data_as_of IS NOT NULL
        AND disclaimer IS NOT NULL
        AND confidence IS NOT NULL
        AND versions IS NOT NULL
        AND source_catalog_version IS NOT NULL
      )
      OR (
        report_kind IN ('FAMILY_EDUCATION_SNAPSHOT', 'STUDENT_GROWTH_DISCOVERY')
        AND result_payload IS NOT NULL
        AND rule_version IS NOT NULL
        AND disclaimer_version IS NOT NULL
        AND disclaimer_text_hash IS NOT NULL
      )
    );

CREATE INDEX reports_kind_owner_v005_idx
  ON reports(user_id, report_kind, status, delivery_status, created_at DESC);

-- ---------------------------------------------------------------------------
-- Product catalogue and deliverable isolation. The new SKU is distinct from
-- COMPASS_REPORT_SINGLE_39_9 even though both currently cost 3990 fen.
-- ---------------------------------------------------------------------------

INSERT INTO products (id, code, name, amount_fen, currency, scope, active, created_at)
VALUES (
  'EDUCATION_GROWTH_DISCOVERY_SINGLE_V1',
  'EDUCATION_GROWTH_DISCOVERY_SINGLE_V1',
  'Education Growth Discovery 单次报告',
  3990,
  'CNY',
  'SINGLE_REPORT',
  true,
  now()
)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name = EXCLUDED.name,
  amount_fen = EXCLUDED.amount_fen,
  currency = EXCLUDED.currency,
  scope = EXCLUDED.scope;

CREATE TABLE product_deliverables (
  id text PRIMARY KEY,
  product_code text NOT NULL UNIQUE REFERENCES products(code) ON DELETE RESTRICT,
  assessment_kind text NOT NULL CHECK (assessment_kind IN (
    'LEGACY_EDUCATION_COMPASS', 'STUDENT_GROWTH_DISCOVERY'
  )),
  report_kind text NOT NULL CHECK (report_kind IN (
    'LEGACY_EDUCATION_COMPASS_REPORT', 'STUDENT_GROWTH_DISCOVERY'
  )),
  deliverable_kind text NOT NULL CHECK (char_length(deliverable_kind) BETWEEN 1 AND 100),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (assessment_kind, report_kind, product_code)
);

INSERT INTO product_deliverables (
  id, product_code, assessment_kind, report_kind, deliverable_kind, active, created_at, updated_at
)
VALUES
  (
    'DELIVERABLE_LEGACY_COMPASS_SINGLE',
    'COMPASS_REPORT_SINGLE_39_9',
    'LEGACY_EDUCATION_COMPASS',
    'LEGACY_EDUCATION_COMPASS_REPORT',
    'LEGACY_COMPASS_REPORT_V1',
    true,
    now(),
    now()
  ),
  (
    'DELIVERABLE_GROWTH_DISCOVERY_V1',
    'EDUCATION_GROWTH_DISCOVERY_SINGLE_V1',
    'STUDENT_GROWTH_DISCOVERY',
    'STUDENT_GROWTH_DISCOVERY',
    'STUDENT_GROWTH_DISCOVERY_REPORT_V1',
    true,
    now(),
    now()
  );

CREATE FUNCTION phoenix_v005_enforce_product_report_kind()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  actual_report_kind text;
  allowed_report_kind text;
BEGIN
  SELECT report_kind
  INTO actual_report_kind
  FROM reports
  WHERE id = NEW.report_id;

  SELECT report_kind
  INTO allowed_report_kind
  FROM product_deliverables
  WHERE product_code = NEW.product_code;

  IF actual_report_kind IS NULL OR allowed_report_kind IS NULL THEN
    RAISE EXCEPTION 'Product/report deliverable mapping is missing'
      USING ERRCODE = '23514';
  END IF;

  IF actual_report_kind <> allowed_report_kind THEN
    RAISE EXCEPTION 'Product cannot unlock this report kind'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_product_report_kind_v005_trigger
BEFORE INSERT OR UPDATE OF product_code, report_id ON orders
FOR EACH ROW EXECUTE FUNCTION phoenix_v005_enforce_product_report_kind();

CREATE TRIGGER entitlements_product_report_kind_v005_trigger
BEFORE INSERT OR UPDATE OF product_code, report_id ON entitlements
FOR EACH ROW EXECUTE FUNCTION phoenix_v005_enforce_product_report_kind();

-- ---------------------------------------------------------------------------
-- Domain-isolated idempotency. Only digests are stored; raw keys and request
-- bodies must never enter this table.
-- ---------------------------------------------------------------------------

CREATE TABLE idempotency_records (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  domain text NOT NULL CHECK (domain IN (
    'ASSESSMENT_CREATE', 'DRAFT_SAVE', 'ASSESSMENT_SUBMIT',
    'ORDER_CREATE', 'AGENT_CREATE'
  )),
  key_digest text NOT NULL CHECK (key_digest ~ '^[0-9A-Fa-f]{64}$'),
  input_digest text NOT NULL CHECK (input_digest ~ '^[0-9A-Fa-f]{64}$'),
  status text NOT NULL CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'FAILED')),
  resource_type text CHECK (resource_type IS NULL OR char_length(resource_type) BETWEEN 1 AND 100),
  resource_id text,
  response_status integer CHECK (response_status IS NULL OR response_status BETWEEN 100 AND 599),
  response_digest text CHECK (response_digest IS NULL OR response_digest ~ '^[0-9A-Fa-f]{64}$'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  CHECK (
    (status = 'COMPLETED' AND resource_type IS NOT NULL AND resource_id IS NOT NULL AND completed_at IS NOT NULL)
    OR status <> 'COMPLETED'
  ),
  UNIQUE (user_id, domain, key_digest)
);

CREATE INDEX idempotency_records_resource_v005_idx
  ON idempotency_records(resource_type, resource_id)
  WHERE resource_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Advisor intent is linked to the source assessment without replacing the
-- existing report/student links or legacy GENERAL_ADVISOR behavior.
-- ---------------------------------------------------------------------------

ALTER TABLE advisor_requests
  ADD COLUMN assessment_id text REFERENCES assessments(id) ON DELETE SET NULL,
  ADD COLUMN intent text NOT NULL DEFAULT 'GENERAL_ADVISOR',
  ADD CONSTRAINT advisor_requests_intent_v005_check
    CHECK (intent IN (
      'GENERAL_ADVISOR', 'ASKWISE_LEARNING_SUPPORT', 'DEEP_ASSESSMENT'
    ));

ALTER TABLE advisor_requests
  DROP CONSTRAINT advisor_requests_status_check,
  ADD CONSTRAINT advisor_requests_status_v005_check
    CHECK (status IN ('PENDING', 'CONTACTED', 'CLOSED', 'CANCELLED_BY_CONSENT_WITHDRAWAL'));

CREATE INDEX advisor_requests_assessment_intent_v005_idx
  ON advisor_requests(user_id, assessment_id, intent, created_at DESC);

COMMIT;
