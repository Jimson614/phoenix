BEGIN;

CREATE TABLE core.guardian_student_relationships (
  relationship_id uuid PRIMARY KEY,
  family_id text NOT NULL,
  guardian_id text NOT NULL,
  guardian_member_pk uuid NOT NULL,
  student_id text NOT NULL,
  student_member_pk uuid NOT NULL,
  relationship_type text NOT NULL,
  authority_status text NOT NULL CHECK (authority_status IN ('ACTIVE', 'WITHDRAWN', 'EXPIRED', 'POLICY_HOLD')),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (valid_until IS NULL OR valid_until > valid_from),
  CHECK ((authority_status = 'WITHDRAWN') = (withdrawn_at IS NOT NULL)),
  FOREIGN KEY (guardian_id, guardian_member_pk)
    REFERENCES core.guardians(guardian_id, member_pk) ON DELETE RESTRICT,
  FOREIGN KEY (student_id, student_member_pk)
    REFERENCES core.students(student_id, member_pk) ON DELETE RESTRICT,
  FOREIGN KEY (family_id, guardian_member_pk)
    REFERENCES core.family_memberships(family_id, member_pk) ON DELETE RESTRICT,
  FOREIGN KEY (family_id, student_member_pk)
    REFERENCES core.family_memberships(family_id, member_pk) ON DELETE RESTRICT,
  UNIQUE (family_id, guardian_id, student_id)
);

CREATE TABLE core.consents (
  consent_id uuid PRIMARY KEY,
  family_id text NOT NULL,
  subject_member_pk uuid NOT NULL,
  granted_by_user_id text NOT NULL REFERENCES core.users(user_id) ON DELETE RESTRICT,
  granted_by_guardian_id text REFERENCES core.guardians(guardian_id) ON DELETE RESTRICT,
  purpose_code text NOT NULL,
  policy_version text NOT NULL,
  locale text NOT NULL,
  channel text NOT NULL,
  status text NOT NULL CHECK (status IN ('GRANTED', 'WITHDRAWN', 'EXPIRED', 'REJECTED')),
  granted_at timestamptz NOT NULL,
  effective_from timestamptz NOT NULL,
  expires_at timestamptz,
  withdrawn_at timestamptz,
  withdrawn_by_user_id text REFERENCES core.users(user_id) ON DELETE RESTRICT,
  withdrawal_reason text,
  evidence_hash text NOT NULL CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (expires_at IS NULL OR expires_at > effective_from),
  CHECK ((status = 'WITHDRAWN') = (withdrawn_at IS NOT NULL)),
  FOREIGN KEY (family_id, subject_member_pk)
    REFERENCES core.family_memberships(family_id, member_pk) ON DELETE RESTRICT
);

CREATE TABLE core.consent_events (
  consent_event_id uuid PRIMARY KEY,
  consent_id uuid NOT NULL REFERENCES core.consents(consent_id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('GRANTED', 'WITHDRAWN', 'EXPIRED', 'REJECTED')),
  actor_user_id text NOT NULL REFERENCES core.users(user_id) ON DELETE RESTRICT,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE core.external_identity_mappings (
  mapping_id uuid PRIMARY KEY,
  entity_type text NOT NULL CHECK (entity_type IN ('USER', 'FAMILY', 'STUDENT', 'GUARDIAN')),
  phoenix_core_id text NOT NULL,
  source_system text NOT NULL,
  source_id text NOT NULL,
  source_record_version text,
  source_auth_uuid uuid,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'CONFLICT', 'SUPERSEDED', 'RETIRED')),
  match_method text NOT NULL CHECK (match_method IN ('VERIFIED_LOGIN', 'GUARDIAN_ASSERTION', 'OPERATOR_REVIEW', 'MIGRATION_RULE')),
  verified_by_user_id text REFERENCES core.users(user_id) ON DELETE RESTRICT,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  superseded_by_mapping_id uuid REFERENCES core.external_identity_mappings(mapping_id) ON DELETE RESTRICT,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (
    (entity_type = 'USER' AND phoenix_core_id ~ '^usr_[0-9a-f]{32}$') OR
    (entity_type = 'FAMILY' AND phoenix_core_id ~ '^fam_[0-9a-f]{32}$') OR
    (entity_type = 'STUDENT' AND phoenix_core_id ~ '^stu_[0-9a-f]{32}$') OR
    (entity_type = 'GUARDIAN' AND phoenix_core_id ~ '^gdn_[0-9a-f]{32}$')
  ),
  UNIQUE (source_system, entity_type, source_id)
);

CREATE TABLE core.identity_migration_candidates (
  candidate_id uuid PRIMARY KEY,
  source_system text NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('USER', 'FAMILY', 'STUDENT', 'GUARDIAN')),
  source_id text NOT NULL,
  source_record_version text,
  source_auth_uuid uuid,
  source_payload_hash text NOT NULL CHECK (source_payload_hash ~ '^[0-9a-f]{64}$'),
  match_hint_hash text CHECK (match_hint_hash IS NULL OR match_hint_hash ~ '^[0-9a-f]{64}$'),
  is_test_account boolean NOT NULL DEFAULT false,
  resolution_status text NOT NULL CHECK (resolution_status IN ('REVIEW_REQUIRED', 'APPROVED', 'CONFLICT', 'EXCLUDED_TEST', 'MAPPED')),
  resolved_core_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (NOT is_test_account OR (resolution_status = 'EXCLUDED_TEST' AND resolved_core_id IS NULL)),
  UNIQUE (source_system, entity_type, source_id)
);

COMMENT ON COLUMN core.identity_migration_candidates.match_hint_hash IS
  'Non-authoritative matching signal only. It can trigger review but never an automatic merge.';

CREATE TABLE core.roles (
  role_code text PRIMARY KEY,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RETIRED'))
);

CREATE TABLE core.permissions (
  permission_code text PRIMARY KEY,
  description text NOT NULL,
  risk_level text NOT NULL CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'))
);

CREATE TABLE core.role_permissions (
  role_code text NOT NULL REFERENCES core.roles(role_code) ON DELETE RESTRICT,
  permission_code text NOT NULL REFERENCES core.permissions(permission_code) ON DELETE RESTRICT,
  PRIMARY KEY (role_code, permission_code)
);

CREATE TABLE core.role_assignments (
  role_assignment_id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES core.users(user_id) ON DELETE RESTRICT,
  role_code text NOT NULL REFERENCES core.roles(role_code) ON DELETE RESTRICT,
  scope_type text NOT NULL CHECK (scope_type IN ('FAMILY', 'DOMAIN', 'ORGANIZATION', 'PLATFORM')),
  scope_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REVOKED')),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  granted_by_user_id text REFERENCES core.users(user_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE TABLE entitlement.service_entitlements (
  entitlement_id uuid PRIMARY KEY,
  family_id text NOT NULL,
  subject_member_pk uuid NOT NULL,
  service_code text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'EXPIRED', 'POLICY_HOLD')),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (valid_until IS NULL OR valid_until > valid_from),
  FOREIGN KEY (family_id, subject_member_pk)
    REFERENCES core.family_memberships(family_id, member_pk) ON DELETE RESTRICT,
  UNIQUE (family_id, subject_member_pk, service_code)
);

CREATE TABLE audit.audit_logs (
  audit_id uuid PRIMARY KEY,
  actor_user_id text REFERENCES core.users(user_id) ON DELETE RESTRICT,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  family_id text REFERENCES core.families(family_id) ON DELETE RESTRICT,
  before_json jsonb,
  after_json jsonb,
  reason text,
  request_id text NOT NULL,
  source_service text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION audit.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'APPEND_ONLY_RECORD';
END;
$$;

CREATE TRIGGER consent_events_append_only
BEFORE UPDATE OR DELETE ON core.consent_events
FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();

CREATE TRIGGER audit_logs_append_only
BEFORE UPDATE OR DELETE ON audit.audit_logs
FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();

CREATE OR REPLACE FUNCTION core.core_id_exists(p_entity_type text, p_core_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
  SELECT CASE p_entity_type
    WHEN 'USER' THEN EXISTS (SELECT 1 FROM core.users WHERE user_id = p_core_id)
    WHEN 'FAMILY' THEN EXISTS (SELECT 1 FROM core.families WHERE family_id = p_core_id)
    WHEN 'STUDENT' THEN EXISTS (SELECT 1 FROM core.students WHERE student_id = p_core_id)
    WHEN 'GUARDIAN' THEN EXISTS (SELECT 1 FROM core.guardians WHERE guardian_id = p_core_id)
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION core.promote_migration_candidate(
  p_candidate_id uuid,
  p_target_core_id text,
  p_verified_by_user_id text,
  p_mapping_id uuid,
  p_request_id text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, audit, pg_temp
AS $$
DECLARE
  candidate core.identity_migration_candidates%ROWTYPE;
  conflicting_count integer;
BEGIN
  SELECT * INTO candidate
  FROM core.identity_migration_candidates
  WHERE candidate_id = p_candidate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'MIGRATION_CANDIDATE_NOT_FOUND';
  END IF;
  IF candidate.is_test_account OR candidate.resolution_status = 'EXCLUDED_TEST' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TEST_ACCOUNT_EXCLUDED';
  END IF;
  IF candidate.resolution_status <> 'APPROVED' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MIGRATION_REVIEW_REQUIRED';
  END IF;

  SELECT count(*) INTO conflicting_count
  FROM core.identity_migration_candidates other
  WHERE candidate.match_hint_hash IS NOT NULL
    AND other.match_hint_hash = candidate.match_hint_hash
    AND other.candidate_id <> candidate.candidate_id
    AND other.resolution_status IN ('REVIEW_REQUIRED', 'APPROVED', 'CONFLICT');

  IF conflicting_count > 0 THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'SOURCE_MAPPING_CONFLICT';
  END IF;
  IF NOT core.core_id_exists(candidate.entity_type, p_target_core_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'TARGET_CORE_ID_NOT_FOUND_OR_WRONG_TYPE';
  END IF;

  INSERT INTO core.external_identity_mappings (
    mapping_id, entity_type, phoenix_core_id, source_system, source_id,
    source_record_version, source_auth_uuid, status, match_method,
    verified_by_user_id, verified_at, metadata
  ) VALUES (
    p_mapping_id, candidate.entity_type, p_target_core_id, candidate.source_system,
    candidate.source_id, candidate.source_record_version, candidate.source_auth_uuid,
    'ACTIVE', 'OPERATOR_REVIEW', p_verified_by_user_id, clock_timestamp(),
    jsonb_build_object('candidate_id', candidate.candidate_id, 'source_payload_hash', candidate.source_payload_hash)
  );

  UPDATE core.identity_migration_candidates
  SET resolution_status = 'MAPPED', resolved_core_id = p_target_core_id, updated_at = clock_timestamp()
  WHERE candidate_id = p_candidate_id;

  INSERT INTO audit.audit_logs (
    audit_id, actor_user_id, action, entity_type, entity_id, family_id,
    before_json, after_json, reason, request_id, source_service
  ) VALUES (
    p_mapping_id, p_verified_by_user_id, 'IDENTITY_MAPPING_CREATED', candidate.entity_type,
    p_target_core_id, NULL, NULL,
    jsonb_build_object('source_system', candidate.source_system, 'source_id', candidate.source_id),
    'Explicit reviewed mapping; no contact-field auto-merge', p_request_id, 'FAMILY_CORE_SANDBOX'
  );

  RETURN p_mapping_id;
END;
$$;

CREATE OR REPLACE FUNCTION core.current_actor_user_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('phoenix.actor_user_id', true), '');
$$;

CREATE OR REPLACE FUNCTION core.current_family_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('phoenix.family_id', true), '');
$$;

CREATE OR REPLACE FUNCTION core.has_active_family_membership(p_user_id text, p_family_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM core.users u
    JOIN core.family_memberships fm ON fm.member_pk = u.member_pk
    WHERE u.user_id = p_user_id
      AND u.status = 'ACTIVE'
      AND fm.family_id = p_family_id
      AND fm.status = 'ACTIVE'
      AND fm.valid_from <= statement_timestamp()
      AND (fm.valid_until IS NULL OR fm.valid_until > statement_timestamp())
  );
$$;

CREATE OR REPLACE FUNCTION core.actor_has_permission(
  p_user_id text,
  p_family_id text,
  p_permission_code text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM core.role_assignments ra
    JOIN core.role_permissions rp ON rp.role_code = ra.role_code
    WHERE ra.user_id = p_user_id
      AND ra.scope_type = 'FAMILY'
      AND ra.scope_id = p_family_id
      AND ra.status = 'ACTIVE'
      AND ra.valid_from <= statement_timestamp()
      AND (ra.valid_until IS NULL OR ra.valid_until > statement_timestamp())
      AND rp.permission_code = p_permission_code
  );
$$;

CREATE OR REPLACE FUNCTION core.has_active_guardian_authority(
  p_user_id text,
  p_family_id text,
  p_subject_member_pk uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM core.guardians g
    JOIN core.guardian_student_relationships rel
      ON rel.guardian_id = g.guardian_id
     AND rel.guardian_member_pk = g.member_pk
    WHERE g.user_id = p_user_id
      AND g.status = 'ACTIVE'
      AND rel.family_id = p_family_id
      AND rel.student_member_pk = p_subject_member_pk
      AND rel.authority_status = 'ACTIVE'
      AND rel.valid_from <= statement_timestamp()
      AND (rel.valid_until IS NULL OR rel.valid_until > statement_timestamp())
  );
$$;

CREATE OR REPLACE FUNCTION core.has_active_consent(
  p_consent_id uuid,
  p_family_id text,
  p_subject_member_pk uuid,
  p_purpose_code text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM core.consents c
    WHERE c.consent_id = p_consent_id
      AND c.family_id = p_family_id
      AND c.subject_member_pk = p_subject_member_pk
      AND c.purpose_code = p_purpose_code
      AND c.status = 'GRANTED'
      AND c.effective_from <= statement_timestamp()
      AND (c.expires_at IS NULL OR c.expires_at > statement_timestamp())
  );
$$;

CREATE OR REPLACE FUNCTION core.can_access_subject_record(
  p_family_id text,
  p_subject_member_pk uuid,
  p_consent_id uuid,
  p_purpose_code text,
  p_permission_code text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
DECLARE
  actor_id text := core.current_actor_user_id();
  context_family text := core.current_family_id();
  subject_kind text;
BEGIN
  IF actor_id IS NULL OR context_family IS NULL OR context_family <> p_family_id THEN
    RETURN false;
  END IF;
  IF NOT core.has_active_family_membership(actor_id, p_family_id) THEN
    RETURN false;
  END IF;
  IF NOT core.actor_has_permission(actor_id, p_family_id, p_permission_code) THEN
    RETURN false;
  END IF;

  SELECT member_kind INTO subject_kind
  FROM core.members
  WHERE member_pk = p_subject_member_pk AND status = 'ACTIVE';
  IF subject_kind IS NULL THEN
    RETURN false;
  END IF;
  IF subject_kind = 'MINOR'
     AND NOT core.has_active_guardian_authority(actor_id, p_family_id, p_subject_member_pk) THEN
    RETURN false;
  END IF;

  RETURN core.has_active_consent(p_consent_id, p_family_id, p_subject_member_pk, p_purpose_code);
END;
$$;

CREATE OR REPLACE FUNCTION core.resolve_active_mapping(
  p_source_system text,
  p_entity_type text,
  p_source_id text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
DECLARE
  resolved_id text;
BEGIN
  SELECT phoenix_core_id INTO resolved_id
  FROM core.external_identity_mappings
  WHERE source_system = p_source_system
    AND entity_type = p_entity_type
    AND source_id = p_source_id
    AND status = 'ACTIVE';

  IF resolved_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'CORE_MAPPING_NOT_ACTIVE';
  END IF;
  RETURN resolved_id;
END;
$$;

CREATE OR REPLACE FUNCTION core.withdraw_consent(
  p_consent_id uuid,
  p_actor_user_id text,
  p_reason text,
  p_request_id text,
  p_event_id uuid,
  p_audit_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, audit, pg_temp
AS $$
DECLARE
  target core.consents%ROWTYPE;
BEGIN
  SELECT * INTO target FROM core.consents WHERE consent_id = p_consent_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'CONSENT_NOT_FOUND';
  END IF;
  IF target.status <> 'GRANTED' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'CONSENT_NOT_ACTIVE';
  END IF;

  UPDATE core.consents
  SET status = 'WITHDRAWN', withdrawn_at = clock_timestamp(),
      withdrawn_by_user_id = p_actor_user_id, withdrawal_reason = p_reason,
      updated_at = clock_timestamp()
  WHERE consent_id = p_consent_id;

  INSERT INTO core.consent_events (
    consent_event_id, consent_id, event_type, actor_user_id, evidence
  ) VALUES (
    p_event_id, p_consent_id, 'WITHDRAWN', p_actor_user_id,
    jsonb_build_object('reason_recorded', p_reason IS NOT NULL, 'request_id', p_request_id)
  );

  INSERT INTO audit.audit_logs (
    audit_id, actor_user_id, action, entity_type, entity_id, family_id,
    before_json, after_json, reason, request_id, source_service
  ) VALUES (
    p_audit_id, p_actor_user_id, 'CONSENT_WITHDRAWN', 'CONSENT', p_consent_id::text,
    target.family_id, jsonb_build_object('status', target.status),
    jsonb_build_object('status', 'WITHDRAWN'), p_reason, p_request_id, 'FAMILY_CORE_SANDBOX'
  );
END;
$$;

CREATE OR REPLACE FUNCTION core.withdraw_guardian_authority(
  p_relationship_id uuid,
  p_actor_user_id text,
  p_reason text,
  p_request_id text,
  p_audit_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, audit, pg_temp
AS $$
DECLARE
  target core.guardian_student_relationships%ROWTYPE;
BEGIN
  SELECT * INTO target
  FROM core.guardian_student_relationships
  WHERE relationship_id = p_relationship_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'GUARDIAN_RELATIONSHIP_NOT_FOUND';
  END IF;
  IF target.authority_status <> 'ACTIVE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'GUARDIAN_AUTHORITY_NOT_ACTIVE';
  END IF;

  UPDATE core.guardian_student_relationships
  SET authority_status = 'WITHDRAWN', withdrawn_at = clock_timestamp(), updated_at = clock_timestamp()
  WHERE relationship_id = p_relationship_id;

  INSERT INTO audit.audit_logs (
    audit_id, actor_user_id, action, entity_type, entity_id, family_id,
    before_json, after_json, reason, request_id, source_service
  ) VALUES (
    p_audit_id, p_actor_user_id, 'GUARDIAN_AUTHORITY_WITHDRAWN', 'GUARDIAN_RELATIONSHIP',
    p_relationship_id::text, target.family_id,
    jsonb_build_object('status', target.authority_status),
    jsonb_build_object('status', 'WITHDRAWN'), p_reason, p_request_id, 'FAMILY_CORE_SANDBOX'
  );
END;
$$;

CREATE INDEX guardian_relationship_subject_idx
  ON core.guardian_student_relationships (family_id, student_member_pk, authority_status);
CREATE INDEX consents_lookup_idx
  ON core.consents (family_id, subject_member_pk, purpose_code, status);
CREATE INDEX role_assignments_lookup_idx
  ON core.role_assignments (user_id, scope_type, scope_id, status);
CREATE INDEX mappings_target_idx
  ON core.external_identity_mappings (entity_type, phoenix_core_id, status);
CREATE INDEX audit_family_time_idx
  ON audit.audit_logs (family_id, occurred_at);

REVOKE ALL ON FUNCTION core.promote_migration_candidate(uuid, text, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION core.resolve_active_mapping(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION core.withdraw_consent(uuid, text, text, text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION core.withdraw_guardian_authority(uuid, text, text, text, uuid) FROM PUBLIC;

COMMIT;
