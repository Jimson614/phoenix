BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'phoenix_core_app') THEN
    CREATE ROLE phoenix_core_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END;
$$;

CREATE TABLE domain.compass_results (
  result_id uuid PRIMARY KEY,
  family_id text NOT NULL,
  subject_member_pk uuid NOT NULL,
  subject_id text NOT NULL,
  compass_type text NOT NULL CHECK (compass_type IN ('EDUCATION', 'IDENTITY', 'WEALTH')),
  source_service text NOT NULL,
  source_assessment_id text NOT NULL,
  consent_id uuid NOT NULL REFERENCES core.consents(consent_id) ON DELETE RESTRICT,
  result_payload_hash text NOT NULL CHECK (result_payload_hash ~ '^[0-9a-f]{64}$'),
  result_schema_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('COMPLETED', 'PARTIAL', 'INVALIDATED', 'SUPERSEDED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (family_id, subject_member_pk)
    REFERENCES core.family_memberships(family_id, member_pk) ON DELETE RESTRICT,
  UNIQUE (source_service, source_assessment_id)
);

CREATE TABLE domain.journeys (
  journey_id uuid PRIMARY KEY,
  family_id text NOT NULL,
  subject_member_pk uuid NOT NULL,
  source_result_id uuid NOT NULL UNIQUE REFERENCES domain.compass_results(result_id) ON DELETE RESTRICT,
  consent_id uuid NOT NULL REFERENCES core.consents(consent_id) ON DELETE RESTRICT,
  journey_type text NOT NULL CHECK (journey_type IN ('EDUCATION', 'IDENTITY', 'WEALTH')),
  journey_status text NOT NULL,
  current_state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (family_id, subject_member_pk)
    REFERENCES core.family_memberships(family_id, member_pk) ON DELETE RESTRICT
);

CREATE TABLE domain.timeline_events (
  event_id uuid PRIMARY KEY,
  family_id text NOT NULL,
  subject_member_pk uuid NOT NULL,
  journey_id uuid REFERENCES domain.journeys(journey_id) ON DELETE RESTRICT,
  consent_id uuid NOT NULL REFERENCES core.consents(consent_id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'FAMILY_PROFILE_CREATED',
    'STUDENT_PROFILE_CREATED',
    'COMPASS_ASSESSMENT_COMPLETED',
    'COMPASS_REPORT_AVAILABLE',
    'JOURNEY_ACTION_DUE',
    'ADVISOR_FOLLOW_UP_REQUESTED',
    'ADVISOR_CASE_STATUS_CHANGED',
    'PARTNER_EXPERIENCE_REQUESTED',
    'CONSENT_STATUS_CHANGED'
  )),
  source_service text NOT NULL,
  source_record_id text NOT NULL,
  source_version text NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('FAMILY', 'SUBJECT', 'ADVISOR_SHARED', 'INTERNAL_RESTRICTED')),
  title_code text NOT NULL,
  summary_code text NOT NULL,
  supersedes_event_id uuid REFERENCES domain.timeline_events(event_id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (family_id, subject_member_pk)
    REFERENCES core.family_memberships(family_id, member_pk) ON DELETE RESTRICT,
  UNIQUE (source_service, source_record_id, event_type, source_version)
);

CREATE TABLE domain.blueprints (
  blueprint_id uuid PRIMARY KEY,
  family_id text NOT NULL,
  subject_member_pk uuid NOT NULL,
  journey_id uuid NOT NULL REFERENCES domain.journeys(journey_id) ON DELETE RESTRICT,
  consent_id uuid NOT NULL REFERENCES core.consents(consent_id) ON DELETE RESTRICT,
  blueprint_type text NOT NULL CHECK (blueprint_type IN ('EDUCATION', 'IDENTITY', 'WEALTH')),
  schema_version text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (family_id, subject_member_pk)
    REFERENCES core.family_memberships(family_id, member_pk) ON DELETE RESTRICT,
  UNIQUE (journey_id, schema_version)
);

CREATE TABLE domain.adapter_traces (
  trace_id uuid PRIMARY KEY,
  family_id text NOT NULL,
  subject_member_pk uuid NOT NULL,
  source_system text NOT NULL,
  source_student_id text NOT NULL,
  source_assessment_id text NOT NULL,
  mapping_id uuid NOT NULL REFERENCES core.external_identity_mappings(mapping_id) ON DELETE RESTRICT,
  result_id uuid NOT NULL REFERENCES domain.compass_results(result_id) ON DELETE RESTRICT,
  journey_id uuid NOT NULL REFERENCES domain.journeys(journey_id) ON DELETE RESTRICT,
  trace_hash text NOT NULL CHECK (trace_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (family_id, subject_member_pk)
    REFERENCES core.family_memberships(family_id, member_pk) ON DELETE RESTRICT,
  UNIQUE (source_system, source_assessment_id)
);

CREATE TRIGGER timeline_events_append_only
BEFORE UPDATE OR DELETE ON domain.timeline_events
FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();

CREATE TRIGGER adapter_traces_append_only
BEFORE UPDATE OR DELETE ON domain.adapter_traces
FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();

CREATE OR REPLACE FUNCTION core.has_active_entitlement(
  p_family_id text,
  p_subject_member_pk uuid,
  p_service_code text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = entitlement, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM entitlement.service_entitlements se
    WHERE se.family_id = p_family_id
      AND se.subject_member_pk = p_subject_member_pk
      AND se.service_code = p_service_code
      AND se.status = 'ACTIVE'
      AND se.valid_from <= statement_timestamp()
      AND (se.valid_until IS NULL OR se.valid_until > statement_timestamp())
  );
$$;

CREATE OR REPLACE FUNCTION domain.ingest_education_synthetic(
  p_family_id text,
  p_source_student_id text,
  p_source_assessment_id text,
  p_scoring_consent_id uuid,
  p_longitudinal_consent_id uuid,
  p_result_payload_hash text,
  p_result_id uuid,
  p_journey_id uuid,
  p_timeline_event_id uuid,
  p_blueprint_id uuid,
  p_trace_id uuid,
  p_audit_id uuid
)
RETURNS TABLE (
  receipt_status text,
  result_id uuid,
  journey_id uuid,
  timeline_event_id uuid,
  blueprint_id uuid,
  trace_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = domain, core, entitlement, audit, pg_temp
AS $$
DECLARE
  actor_id text := core.current_actor_user_id();
  context_family text := core.current_family_id();
  resolved_student_id text;
  resolved_member_pk uuid;
  resolved_mapping_id uuid;
  existing_result domain.compass_results%ROWTYPE;
  existing_journey_id uuid;
  existing_timeline_id uuid;
  existing_blueprint_id uuid;
  existing_trace_id uuid;
BEGIN
  IF current_setting('phoenix.synthetic_mode', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SYNTHETIC_MODE_REQUIRED';
  END IF;
  IF actor_id IS NULL OR context_family IS NULL OR context_family <> p_family_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'FAMILY_CONTEXT_MISMATCH';
  END IF;
  IF p_result_payload_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'RESULT_HASH_INVALID';
  END IF;

  resolved_student_id := core.resolve_active_mapping('EDUCATION_COMPASS', 'STUDENT', p_source_student_id);
  SELECT s.member_pk, m.mapping_id
    INTO resolved_member_pk, resolved_mapping_id
  FROM core.students s
  JOIN core.external_identity_mappings m
    ON m.entity_type = 'STUDENT'
   AND m.phoenix_core_id = s.student_id
   AND m.source_system = 'EDUCATION_COMPASS'
   AND m.source_id = p_source_student_id
   AND m.status = 'ACTIVE'
  WHERE s.student_id = resolved_student_id
    AND s.status = 'ACTIVE';

  IF resolved_member_pk IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'STUDENT_MAPPING_NOT_RESOLVED';
  END IF;
  IF NOT core.has_active_entitlement(p_family_id, resolved_member_pk, 'EDUCATION_COMPASS') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ENTITLEMENT_REQUIRED';
  END IF;
  IF NOT core.can_access_subject_record(
    p_family_id, resolved_member_pk, p_scoring_consent_id,
    'ASSESSMENT_SCORING', 'assessment.submit'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ASSESSMENT_AUTHORITY_DENIED';
  END IF;
  IF NOT core.can_access_subject_record(
    p_family_id, resolved_member_pk, p_longitudinal_consent_id,
    'LONGITUDINAL_GROWTH_RECORD', 'timeline.append'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'LONGITUDINAL_AUTHORITY_DENIED';
  END IF;

  SELECT * INTO existing_result
  FROM domain.compass_results cr
  WHERE cr.source_service = 'EDUCATION_COMPASS'
    AND cr.source_assessment_id = p_source_assessment_id;

  IF FOUND THEN
    IF existing_result.family_id <> p_family_id
       OR existing_result.subject_member_pk <> resolved_member_pk
       OR existing_result.result_payload_hash <> p_result_payload_hash THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'IDEMPOTENCY_CONFLICT';
    END IF;

    SELECT j.journey_id INTO existing_journey_id
    FROM domain.journeys j WHERE j.source_result_id = existing_result.result_id;
    SELECT te.event_id INTO existing_timeline_id
    FROM domain.timeline_events te
    WHERE te.source_service = 'EDUCATION_COMPASS'
      AND te.source_record_id = p_source_assessment_id
      AND te.event_type = 'COMPASS_ASSESSMENT_COMPLETED';
    SELECT b.blueprint_id INTO existing_blueprint_id
    FROM domain.blueprints b WHERE b.journey_id = existing_journey_id;
    SELECT at.trace_id INTO existing_trace_id
    FROM domain.adapter_traces at
    WHERE at.source_system = 'EDUCATION_COMPASS'
      AND at.source_assessment_id = p_source_assessment_id;

    RETURN QUERY SELECT 'DUPLICATE', existing_result.result_id, existing_journey_id,
      existing_timeline_id, existing_blueprint_id, existing_trace_id;
    RETURN;
  END IF;

  INSERT INTO domain.compass_results (
    result_id, family_id, subject_member_pk, subject_id, compass_type,
    source_service, source_assessment_id, consent_id, result_payload_hash,
    result_schema_version, status
  ) VALUES (
    p_result_id, p_family_id, resolved_member_pk, resolved_student_id, 'EDUCATION',
    'EDUCATION_COMPASS', p_source_assessment_id, p_scoring_consent_id,
    p_result_payload_hash, 'SYNTHETIC_EDUCATION_RESULT_V1', 'COMPLETED'
  );

  INSERT INTO domain.journeys (
    journey_id, family_id, subject_member_pk, source_result_id, consent_id,
    journey_type, journey_status, current_state
  ) VALUES (
    p_journey_id, p_family_id, resolved_member_pk, p_result_id,
    p_longitudinal_consent_id, 'EDUCATION', 'SYNTHETIC_REVIEW', 'ASSESSMENT_COMPLETE'
  );

  INSERT INTO domain.timeline_events (
    event_id, family_id, subject_member_pk, journey_id, consent_id, event_type,
    source_service, source_record_id, source_version, visibility,
    title_code, summary_code, occurred_at, metadata
  ) VALUES (
    p_timeline_event_id, p_family_id, resolved_member_pk, p_journey_id,
    p_longitudinal_consent_id, 'COMPASS_ASSESSMENT_COMPLETED',
    'EDUCATION_COMPASS', p_source_assessment_id, 'SYNTHETIC_SOURCE_V1', 'FAMILY',
    'SYNTHETIC_EDUCATION_COMPLETE', 'SYNTHETIC_ONLY_NO_REAL_STUDENT',
    clock_timestamp(), jsonb_build_object('result_hash', p_result_payload_hash)
  );

  INSERT INTO domain.blueprints (
    blueprint_id, family_id, subject_member_pk, journey_id, consent_id,
    blueprint_type, schema_version, payload
  ) VALUES (
    p_blueprint_id, p_family_id, resolved_member_pk, p_journey_id,
    p_longitudinal_consent_id, 'EDUCATION', 'SYNTHETIC_BLUEPRINT_V1',
    jsonb_build_object('state', 'SYNTHETIC_REVIEW', 'next_actions', jsonb_build_array('HUMAN_REVIEW'))
  );

  INSERT INTO domain.adapter_traces (
    trace_id, family_id, subject_member_pk, source_system, source_student_id,
    source_assessment_id, mapping_id, result_id, journey_id, trace_hash
  ) VALUES (
    p_trace_id, p_family_id, resolved_member_pk, 'EDUCATION_COMPASS',
    p_source_student_id, p_source_assessment_id, resolved_mapping_id,
    p_result_id, p_journey_id,
    md5(p_source_student_id || ':' || p_source_assessment_id || ':' || p_result_payload_hash) ||
    md5(p_result_payload_hash || ':' || p_family_id)
  );

  INSERT INTO audit.audit_logs (
    audit_id, actor_user_id, action, entity_type, entity_id, family_id,
    before_json, after_json, reason, request_id, source_service
  ) VALUES (
    p_audit_id, actor_id, 'EDUCATION_ADAPTER_ACCEPTED', 'COMPASS_RESULT',
    p_result_id::text, p_family_id, NULL,
    jsonb_build_object(
      'source_assessment_id', p_source_assessment_id,
      'result_payload_hash', p_result_payload_hash,
      'mapping_id', resolved_mapping_id
    ),
    'Synthetic adapter proof only', 'synthetic:' || p_source_assessment_id,
    'FAMILY_CORE_SANDBOX'
  );

  RETURN QUERY SELECT 'ACCEPTED', p_result_id, p_journey_id,
    p_timeline_event_id, p_blueprint_id, p_trace_id;
END;
$$;

ALTER TABLE domain.compass_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain.compass_results FORCE ROW LEVEL SECURITY;
ALTER TABLE domain.journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain.journeys FORCE ROW LEVEL SECURITY;
ALTER TABLE domain.timeline_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain.timeline_events FORCE ROW LEVEL SECURITY;
ALTER TABLE domain.blueprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain.blueprints FORCE ROW LEVEL SECURITY;
ALTER TABLE domain.adapter_traces ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain.adapter_traces FORCE ROW LEVEL SECURITY;

CREATE POLICY compass_results_family_select ON domain.compass_results
  FOR SELECT TO phoenix_core_app
  USING (core.can_access_subject_record(
    family_id, subject_member_pk, consent_id,
    'ASSESSMENT_SCORING', 'family.read'
  ));

CREATE POLICY journeys_family_select ON domain.journeys
  FOR SELECT TO phoenix_core_app
  USING (core.can_access_subject_record(
    family_id, subject_member_pk, consent_id,
    'LONGITUDINAL_GROWTH_RECORD', 'family.read'
  ));

CREATE POLICY timeline_family_select ON domain.timeline_events
  FOR SELECT TO phoenix_core_app
  USING (core.can_access_subject_record(
    family_id, subject_member_pk, consent_id,
    'LONGITUDINAL_GROWTH_RECORD', 'family.read'
  ));

CREATE POLICY blueprints_family_select ON domain.blueprints
  FOR SELECT TO phoenix_core_app
  USING (core.can_access_subject_record(
    family_id, subject_member_pk, consent_id,
    'LONGITUDINAL_GROWTH_RECORD', 'family.read'
  ));

CREATE POLICY adapter_traces_family_select ON domain.adapter_traces
  FOR SELECT TO phoenix_core_app
  USING (core.can_access_subject_record(
    family_id, subject_member_pk,
    (SELECT j.consent_id FROM domain.journeys j WHERE j.journey_id = adapter_traces.journey_id),
    'LONGITUDINAL_GROWTH_RECORD', 'family.read'
  ));

GRANT USAGE ON SCHEMA domain TO phoenix_core_app;
GRANT SELECT ON domain.compass_results, domain.journeys, domain.timeline_events,
  domain.blueprints, domain.adapter_traces TO phoenix_core_app;
GRANT EXECUTE ON FUNCTION domain.ingest_education_synthetic(
  text, text, text, uuid, uuid, text, uuid, uuid, uuid, uuid, uuid, uuid
) TO phoenix_core_app;

REVOKE ALL ON FUNCTION domain.ingest_education_synthetic(
  text, text, text, uuid, uuid, text, uuid, uuid, uuid, uuid, uuid, uuid
) FROM PUBLIC;

COMMIT;
