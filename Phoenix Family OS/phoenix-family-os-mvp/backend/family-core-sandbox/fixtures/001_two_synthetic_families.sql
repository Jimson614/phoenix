BEGIN;

INSERT INTO core.members (member_pk, member_kind, status) VALUES
  ('10000000-0000-4000-8000-000000000001', 'ADULT', 'ACTIVE'),
  ('10000000-0000-4000-8000-000000000002', 'MINOR', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000000001', 'ADULT', 'ACTIVE'),
  ('20000000-0000-4000-8000-000000000002', 'MINOR', 'ACTIVE');

INSERT INTO core.users (user_id, member_pk, status) VALUES
  ('usr_00000000000040008000000000000001', '10000000-0000-4000-8000-000000000001', 'ACTIVE'),
  ('usr_00000000000040008000000000000002', '20000000-0000-4000-8000-000000000001', 'ACTIVE');

INSERT INTO core.auth_identities (
  auth_identity_id, user_id, provider, provider_subject, auth_subject_uuid,
  source_system, status, is_test_account, verified_at
) VALUES
  (
    '11000000-0000-4000-8000-000000000001',
    'usr_00000000000040008000000000000001',
    'SYNTHETIC_OIDC', 'synthetic-parent-a',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'SYNTHETIC_AUTH', 'ACTIVE', false, '2026-09-09T00:00:00Z'
  ),
  (
    '21000000-0000-4000-8000-000000000001',
    'usr_00000000000040008000000000000002',
    'SYNTHETIC_OIDC', 'synthetic-parent-b',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'SYNTHETIC_AUTH', 'ACTIVE', false, '2026-09-09T00:00:00Z'
  );

INSERT INTO core.families (family_id, display_label, status) VALUES
  ('fam_00000000000040008000000000000001', 'SYNTHETIC_FAMILY_A', 'ACTIVE'),
  ('fam_00000000000040008000000000000002', 'SYNTHETIC_FAMILY_B', 'ACTIVE');

INSERT INTO core.family_memberships (
  membership_id, family_id, member_pk, relationship_label, status, valid_from
) VALUES
  (
    '12000000-0000-4000-8000-000000000001',
    'fam_00000000000040008000000000000001',
    '10000000-0000-4000-8000-000000000001',
    'SYNTHETIC_ADULT_MEMBER', 'ACTIVE', '2026-09-09T00:00:00Z'
  ),
  (
    '12000000-0000-4000-8000-000000000002',
    'fam_00000000000040008000000000000001',
    '10000000-0000-4000-8000-000000000002',
    'SYNTHETIC_MINOR_MEMBER', 'ACTIVE', '2026-09-09T00:00:00Z'
  ),
  (
    '22000000-0000-4000-8000-000000000001',
    'fam_00000000000040008000000000000002',
    '20000000-0000-4000-8000-000000000001',
    'SYNTHETIC_ADULT_MEMBER', 'ACTIVE', '2026-09-09T00:00:00Z'
  ),
  (
    '22000000-0000-4000-8000-000000000002',
    'fam_00000000000040008000000000000002',
    '20000000-0000-4000-8000-000000000002',
    'SYNTHETIC_MINOR_MEMBER', 'ACTIVE', '2026-09-09T00:00:00Z'
  );

INSERT INTO core.students (student_id, member_pk, status) VALUES
  ('stu_00000000000040008000000000000001', '10000000-0000-4000-8000-000000000002', 'ACTIVE'),
  ('stu_00000000000040008000000000000002', '20000000-0000-4000-8000-000000000002', 'ACTIVE');

INSERT INTO core.guardians (guardian_id, member_pk, user_id, status) VALUES
  (
    'gdn_00000000000040008000000000000001',
    '10000000-0000-4000-8000-000000000001',
    'usr_00000000000040008000000000000001', 'ACTIVE'
  ),
  (
    'gdn_00000000000040008000000000000002',
    '20000000-0000-4000-8000-000000000001',
    'usr_00000000000040008000000000000002', 'ACTIVE'
  );

INSERT INTO core.guardian_student_relationships (
  relationship_id, family_id, guardian_id, guardian_member_pk,
  student_id, student_member_pk, relationship_type, authority_status, valid_from
) VALUES
  (
    '13000000-0000-4000-8000-000000000001',
    'fam_00000000000040008000000000000001',
    'gdn_00000000000040008000000000000001',
    '10000000-0000-4000-8000-000000000001',
    'stu_00000000000040008000000000000001',
    '10000000-0000-4000-8000-000000000002',
    'SYNTHETIC_GUARDIAN', 'ACTIVE', '2026-09-09T00:00:00Z'
  ),
  (
    '23000000-0000-4000-8000-000000000001',
    'fam_00000000000040008000000000000002',
    'gdn_00000000000040008000000000000002',
    '20000000-0000-4000-8000-000000000001',
    'stu_00000000000040008000000000000002',
    '20000000-0000-4000-8000-000000000002',
    'SYNTHETIC_GUARDIAN', 'ACTIVE', '2026-09-09T00:00:00Z'
  );

INSERT INTO core.roles (role_code, description, status) VALUES
  ('PARENT', 'Synthetic parent role based on the approved Gate 1 RBAC baseline', 'ACTIVE');

INSERT INTO core.permissions (permission_code, description, risk_level) VALUES
  ('family.read', 'Read one explicitly scoped family', 'HIGH'),
  ('assessment.submit', 'Submit an assessment for an authorised subject', 'HIGH'),
  ('timeline.append', 'Append a minimised timeline event', 'HIGH');

INSERT INTO core.role_permissions (role_code, permission_code) VALUES
  ('PARENT', 'family.read'),
  ('PARENT', 'assessment.submit'),
  ('PARENT', 'timeline.append');

INSERT INTO core.role_assignments (
  role_assignment_id, user_id, role_code, scope_type, scope_id,
  status, valid_from, granted_by_user_id
) VALUES
  (
    '14000000-0000-4000-8000-000000000001',
    'usr_00000000000040008000000000000001', 'PARENT', 'FAMILY',
    'fam_00000000000040008000000000000001', 'ACTIVE',
    '2026-09-09T00:00:00Z', 'usr_00000000000040008000000000000001'
  ),
  (
    '24000000-0000-4000-8000-000000000001',
    'usr_00000000000040008000000000000002', 'PARENT', 'FAMILY',
    'fam_00000000000040008000000000000002', 'ACTIVE',
    '2026-09-09T00:00:00Z', 'usr_00000000000040008000000000000002'
  );

INSERT INTO core.consents (
  consent_id, family_id, subject_member_pk, granted_by_user_id,
  granted_by_guardian_id, purpose_code, policy_version, locale, channel,
  status, granted_at, effective_from, expires_at, evidence_hash
) VALUES
  (
    '15000000-0000-4000-8000-000000000001',
    'fam_00000000000040008000000000000001',
    '10000000-0000-4000-8000-000000000002',
    'usr_00000000000040008000000000000001',
    'gdn_00000000000040008000000000000001',
    'ASSESSMENT_SCORING', 'SYNTHETIC_POLICY_V1', 'zh-Hans', 'SYNTHETIC_TEST',
    'GRANTED', '2026-09-09T00:00:00Z', '2026-09-09T00:00:00Z',
    '2027-09-09T00:00:00Z',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  ),
  (
    '15000000-0000-4000-8000-000000000002',
    'fam_00000000000040008000000000000001',
    '10000000-0000-4000-8000-000000000002',
    'usr_00000000000040008000000000000001',
    'gdn_00000000000040008000000000000001',
    'LONGITUDINAL_GROWTH_RECORD', 'SYNTHETIC_POLICY_V1', 'zh-Hans', 'SYNTHETIC_TEST',
    'GRANTED', '2026-09-09T00:00:00Z', '2026-09-09T00:00:00Z',
    '2027-09-09T00:00:00Z',
    'abababababababababababababababababababababababababababababababab'
  ),
  (
    '25000000-0000-4000-8000-000000000001',
    'fam_00000000000040008000000000000002',
    '20000000-0000-4000-8000-000000000002',
    'usr_00000000000040008000000000000002',
    'gdn_00000000000040008000000000000002',
    'ASSESSMENT_SCORING', 'SYNTHETIC_POLICY_V1', 'zh-Hans', 'SYNTHETIC_TEST',
    'GRANTED', '2026-09-09T00:00:00Z', '2026-09-09T00:00:00Z',
    '2027-09-09T00:00:00Z',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  ),
  (
    '25000000-0000-4000-8000-000000000002',
    'fam_00000000000040008000000000000002',
    '20000000-0000-4000-8000-000000000002',
    'usr_00000000000040008000000000000002',
    'gdn_00000000000040008000000000000002',
    'LONGITUDINAL_GROWTH_RECORD', 'SYNTHETIC_POLICY_V1', 'zh-Hans', 'SYNTHETIC_TEST',
    'GRANTED', '2026-09-09T00:00:00Z', '2026-09-09T00:00:00Z',
    '2027-09-09T00:00:00Z',
    'bcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbc'
  );

INSERT INTO core.consent_events (
  consent_event_id, consent_id, event_type, actor_user_id, evidence, occurred_at
) VALUES
  (
    '16000000-0000-4000-8000-000000000001',
    '15000000-0000-4000-8000-000000000001', 'GRANTED',
    'usr_00000000000040008000000000000001',
    '{"fixture":"SYNTHETIC_ONLY"}', '2026-09-09T00:00:00Z'
  ),
  (
    '16000000-0000-4000-8000-000000000002',
    '15000000-0000-4000-8000-000000000002', 'GRANTED',
    'usr_00000000000040008000000000000001',
    '{"fixture":"SYNTHETIC_ONLY"}', '2026-09-09T00:00:00Z'
  ),
  (
    '26000000-0000-4000-8000-000000000001',
    '25000000-0000-4000-8000-000000000001', 'GRANTED',
    'usr_00000000000040008000000000000002',
    '{"fixture":"SYNTHETIC_ONLY"}', '2026-09-09T00:00:00Z'
  ),
  (
    '26000000-0000-4000-8000-000000000002',
    '25000000-0000-4000-8000-000000000002', 'GRANTED',
    'usr_00000000000040008000000000000002',
    '{"fixture":"SYNTHETIC_ONLY"}', '2026-09-09T00:00:00Z'
  );

INSERT INTO entitlement.service_entitlements (
  entitlement_id, family_id, subject_member_pk, service_code,
  status, valid_from, valid_until
) VALUES
  (
    '17000000-0000-4000-8000-000000000001',
    'fam_00000000000040008000000000000001',
    '10000000-0000-4000-8000-000000000002',
    'EDUCATION_COMPASS', 'ACTIVE', '2026-09-09T00:00:00Z', '2027-09-09T00:00:00Z'
  ),
  (
    '27000000-0000-4000-8000-000000000001',
    'fam_00000000000040008000000000000002',
    '20000000-0000-4000-8000-000000000002',
    'EDUCATION_COMPASS', 'ACTIVE', '2026-09-09T00:00:00Z', '2027-09-09T00:00:00Z'
  );

INSERT INTO core.external_identity_mappings (
  mapping_id, entity_type, phoenix_core_id, source_system, source_id,
  source_record_version, status, match_method, verified_by_user_id,
  verified_at, metadata
) VALUES
  (
    '51000000-0000-4000-8000-000000000001', 'STUDENT',
    'stu_00000000000040008000000000000001', 'EDUCATION_COMPASS',
    'edu_student_synthetic_a', 'SYNTHETIC_SOURCE_V1', 'ACTIVE',
    'MIGRATION_RULE', 'usr_00000000000040008000000000000001',
    '2026-09-09T00:00:00Z', '{"fixture":"SYNTHETIC_ONLY"}'
  ),
  (
    '51000000-0000-4000-8000-000000000002', 'STUDENT',
    'stu_00000000000040008000000000000002', 'EDUCATION_COMPASS',
    'edu_student_synthetic_b', 'SYNTHETIC_SOURCE_V1', 'ACTIVE',
    'MIGRATION_RULE', 'usr_00000000000040008000000000000002',
    '2026-09-09T00:00:00Z', '{"fixture":"SYNTHETIC_ONLY"}'
  );

INSERT INTO core.identity_migration_candidates (
  candidate_id, source_system, entity_type, source_id, source_record_version,
  source_auth_uuid, source_payload_hash, match_hint_hash, is_test_account,
  resolution_status
) VALUES
  (
    '61000000-0000-4000-8000-000000000001', 'LEGACY_AUTH', 'USER',
    'test_account_synthetic_001', 'SYNTHETIC_SOURCE_V1',
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
    'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    NULL, true, 'EXCLUDED_TEST'
  ),
  (
    '61000000-0000-4000-8000-000000000002', 'LEGACY_AUTH', 'USER',
    'legacy_parent_synthetic_alpha', 'SYNTHETIC_SOURCE_V1', NULL,
    'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    false, 'APPROVED'
  ),
  (
    '61000000-0000-4000-8000-000000000003', 'LEGACY_AUTH', 'USER',
    'legacy_parent_synthetic_beta', 'SYNTHETIC_SOURCE_V1', NULL,
    'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    false, 'REVIEW_REQUIRED'
  ),
  (
    '61000000-0000-4000-8000-000000000004', 'LEGACY_AUTH', 'USER',
    'legacy_auth_uuid_synthetic_a', 'SYNTHETIC_SOURCE_V1',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    '1212121212121212121212121212121212121212121212121212121212121212',
    '3434343434343434343434343434343434343434343434343434343434343434',
    false, 'APPROVED'
  );

COMMIT;
