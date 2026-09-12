BEGIN;

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS entitlement;
CREATE SCHEMA IF NOT EXISTS domain;
CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE core.members (
  member_pk uuid PRIMARY KEY,
  member_kind text NOT NULL CHECK (member_kind IN ('ADULT', 'MINOR')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'RETIRED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

COMMENT ON TABLE core.members IS
  'Internal person spine. member_pk is not a new externally issued Phoenix identifier.';

CREATE TABLE core.users (
  user_id text PRIMARY KEY CHECK (user_id ~ '^usr_[0-9a-f]{32}$'),
  member_pk uuid NOT NULL UNIQUE REFERENCES core.members(member_pk) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'LOCKED', 'RETIRED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (user_id, member_pk)
);

CREATE TABLE core.auth_identities (
  auth_identity_id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES core.users(user_id) ON DELETE RESTRICT,
  provider text NOT NULL,
  provider_subject text NOT NULL,
  auth_subject_uuid uuid,
  source_system text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED', 'CONFLICT')),
  is_test_account boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (provider, provider_subject),
  UNIQUE (provider, auth_subject_uuid)
);

COMMENT ON COLUMN core.auth_identities.auth_subject_uuid IS
  'Preserved provider/Auth UUID when one exists; never regenerated during migration.';

CREATE TABLE core.families (
  family_id text PRIMARY KEY CHECK (family_id ~ '^fam_[0-9a-f]{32}$'),
  display_label text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE core.family_memberships (
  membership_id uuid PRIMARY KEY,
  family_id text NOT NULL REFERENCES core.families(family_id) ON DELETE RESTRICT,
  member_pk uuid NOT NULL REFERENCES core.members(member_pk) ON DELETE RESTRICT,
  relationship_label text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'ENDED')),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (valid_until IS NULL OR valid_until > valid_from),
  UNIQUE (family_id, member_pk),
  UNIQUE (membership_id, family_id, member_pk)
);

CREATE TABLE core.students (
  student_id text PRIMARY KEY CHECK (student_id ~ '^stu_[0-9a-f]{32}$'),
  member_pk uuid NOT NULL UNIQUE REFERENCES core.members(member_pk) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'RETIRED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (student_id, member_pk)
);

CREATE TABLE core.guardians (
  guardian_id text PRIMARY KEY CHECK (guardian_id ~ '^gdn_[0-9a-f]{32}$'),
  member_pk uuid NOT NULL UNIQUE REFERENCES core.members(member_pk) ON DELETE RESTRICT,
  user_id text UNIQUE REFERENCES core.users(user_id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'RETIRED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (guardian_id, member_pk)
);

CREATE OR REPLACE FUNCTION core.assert_adult_account_subject()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = core, pg_temp
AS $$
DECLARE
  resolved_kind text;
BEGIN
  SELECT member_kind INTO resolved_kind
  FROM core.members
  WHERE member_pk = NEW.member_pk;

  IF resolved_kind IS DISTINCT FROM 'ADULT' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'ACCOUNT_SUBJECT_MUST_BE_ADULT';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER users_require_adult_member
BEFORE INSERT OR UPDATE OF member_pk ON core.users
FOR EACH ROW EXECUTE FUNCTION core.assert_adult_account_subject();

CREATE TRIGGER guardians_require_adult_member
BEFORE INSERT OR UPDATE OF member_pk ON core.guardians
FOR EACH ROW EXECUTE FUNCTION core.assert_adult_account_subject();

CREATE INDEX family_memberships_member_idx
  ON core.family_memberships (member_pk, status);
CREATE INDEX auth_identities_user_idx
  ON core.auth_identities (user_id, status);

COMMIT;
