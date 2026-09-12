# PR #14 Core Schema Reconciliation

Status: `IMPLEMENTED IN SYNTHETIC SANDBOX / NOT MIGRATED / NOT DEPLOYED`

Baseline: `6141d863475f146ec2494ebadd39c447fd38e9f5`

## Reconciled boundaries

- Family memberships retain historical rows and enforce one active row through
  a partial unique index.
- Guardian–Student relationships retain historical rows and enforce one active
  authority row through a partial unique index.
- `core.student_family_memberships` is the authoritative physical
  Student–Family relation and links to the exact family-membership episode.
- Consent retains the existing purpose/policy/evidence model while adding
  independent `scope`, `document_version`, and `document_hash` evidence.
- `ASKWISE_HANDOFF` is independent from assessment and longitudinal scopes.
- `core.authorize_student_access(memberId, studentId, action, requiredScope)`
  is exposed through the existing four-argument application adapter.
- Core identity, relationship, role-assignment, and consent tables now have
  forced RLS. Administrative mapping/candidate tables have forced RLS with no
  application read policy.

## Preserved

- `core.users` remains separate from `core.members`.
- Entitlement remains authoritative under the `entitlement` schema.
- Audit and consent events remain append-only.
- External and legacy identity mapping remains explicit and review-gated.

## Evidence posture

`npm run family-core:reconciliation` is database-free and checks schema and
adapter shape. The disposable PostgreSQL gate includes historical relationship,
Student–Family, AskWise withdrawal, Core RLS, backup/restore, and rollback
tests, but must only be run when disposable database execution is explicitly
authorized.
