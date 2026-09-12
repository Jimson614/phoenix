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
- Consent lookup matches scope and purpose independently and binds the receipt
  to the authenticated actor and active Guardian authority for a minor.
- `core.authorize_student_access(memberId, sourceStudentId, action,
  requiredScope, requestId, auditId)` resolves an `ASKWISE_SQLITE` source ID
  through the existing Core mapping ledger, requires a separate active
  `ASKWISE` entitlement, and records every returned decision in append-only
  audit evidence.
- Core identity, relationship, role-assignment, and consent tables now have
  forced RLS. Guardian relationship and role-assignment reads require the
  explicit selected Family plus active membership/authority. Administrative
  mapping/candidate tables have forced RLS with no application read policy.

## Preserved

- `core.users` remains separate from `core.members`.
- Entitlement remains authoritative under the `entitlement` schema.
- Audit and consent events remain append-only.
- External and legacy identity mapping remains explicit and review-gated.

## Evidence posture

`npm run family-core:reconciliation` is database-free and checks schema and
adapter shape. The disposable PostgreSQL gate includes exact Consent
scope/purpose, AskWise mapping and entitlement deny/allow, authorization audit,
selected-Family RLS, withdrawal, backup/restore, and rollback tests, but must
only be run when disposable database execution is explicitly authorized.
