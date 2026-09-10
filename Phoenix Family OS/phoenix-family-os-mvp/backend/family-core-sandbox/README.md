# Phoenix Family Core PostgreSQL Sandbox

Status: `FOUNDER POLICY V1 FROZEN / SYNTHETIC TEST ONLY / NO PRODUCTION AUTHORITY`

This package turns the approved Gate 0/1 identity design, the PR #10–#11 Family OS contracts, and the Founder-approved Family Core Policy V1 into reproducible denial-first proofs. It does not migrate a production database, accept real customer data, deploy a service, or invent any unresolved Legal/Privacy parameter.

## Authoritative baseline

- Repository: `https://github.com/yvettfang-netizen/phoenix.git`
- Branch: `codex/family-core-sandbox-20260909`
- Contract parent: PR #11 at `921f398670b7ba764f2649f5d28462ed4234b849`
- Contract/design inputs: PR #10 at `39452d9cb1c15f96baabb5b887c86ab0afbb97ed` and PR #5 at `38199a3ba38a12db82241e0ac8e4e02a57efc18f`
- Database engine exercised by CI: PostgreSQL 17
- Application role: `phoenix_core_app` (`NOLOGIN`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`)

Phoenix Core remains the authority for `user_id`, `family_id`, `student_id`, `guardian_id`, auth identity links, family membership, Guardian authority, Consent, RBAC, mapping, entitlement, and audit evidence. `member_pk` is an internal relational key that connects adult and minor subjects; it is not a newly issued public Phoenix identifier.

## Migration convention

Every change uses a matched pair:

```text
NNNN_<bounded_context>_<purpose>.up.sql
NNNN_<bounded_context>_<purpose>.down.sql
```

The runner orders files lexically, records the SHA-256 of every applied `up` file in `public.family_core_schema_migrations`, and fails on checksum drift. Rollback runs the matching `down` files in reverse order.

## Gate commands

The policy gate uses Node.js only and requires no database:

```powershell
npm run family-core:policy
```

It validates the frozen machine-readable baseline and executes at least one deny path for every approved policy ID.

The combined gate requires PostgreSQL client commands (`psql`, `createdb`, `dropdb`, `pg_dump`, and `pg_restore`) and a disposable PostgreSQL server. Supply connection values through the process environment; do not commit them.

```powershell
$env:FAMILY_CORE_PG_URL = 'postgresql://postgres@127.0.0.1:5432/postgres'
$env:PGPASSWORD = '<injected-test-password>'
$env:FAMILY_CORE_PG_BIN = 'C:\path\to\postgresql\bin' # optional
npm run family-core:gate
```

The GitHub workflow starts an isolated PostgreSQL 17 service and runs the same combined command. Policy and database evidence are uploaded as short-lived artifacts.

## What the gate proves

1. The frozen V1 baseline is internally consistent and every one of its 14 policy IDs has an executable deny path.
2. A new empty database is built only from ordered migrations.
3. Exactly two fictional families are loaded, each with an adult account/Guardian and a minor Student member.
4. An Auth UUID survives an explicit reviewed mapping unchanged.
5. Test accounts are excluded and ambiguous contact hints cannot auto-merge identities.
6. Education source IDs map to `family_id + member_pk + student_id`, then atomically create a Compass Result, Journey, Timeline Event, Blueprint, adapter trace, and audit row.
7. Exact replay is idempotent; changed replay is rejected.
8. PostgreSQL RLS isolates Family A from Family B.
9. Tampered `family_id` and Student/member mappings are rejected.
10. Consent and Guardian withdrawal remove access immediately.
11. Consent, Timeline, adapter trace, and audit evidence is append-only.
12. `pg_dump` → clean `pg_restore` reproduces row counts and deterministic per-table checksums.
13. All migrations roll back, schemas disappear, and the empty database can be rebuilt again.

## Data flow

```text
Auth provider UUID
  -> core.auth_identities
  -> core.users (adult account principal)
  -> core.members (internal adult/minor subject spine)
  -> core.family_memberships -> core.families
  -> core.guardians -> core.guardian_student_relationships -> core.students
  -> core.consents + RBAC + entitlement
  -> domain.compass_results
  -> domain.journeys
  -> domain.timeline_events + domain.blueprints
  -> domain.adapter_traces + audit.audit_logs
```

## Safety boundaries

- The fixture file contains only values beginning with `SYNTHETIC_` or deterministic test identifiers.
- The adapter refuses to run unless `phoenix.synthetic_mode = on`.
- The adapter accepts hashes and controlled codes, not raw answers, documents, names, phone numbers, or public report URLs.
- The package never reads application `.env` files.
- No command targets the existing Family OS SQLite database, Education PostgreSQL database, production host, RDS instance, D1 database, or WeChat environment.
- Founder-approved directions are frozen in `docs/family-core/FOUNDER_POLICY_FREEZE_V1.md` and the machine-readable policy file. Legal/Privacy parameters that remain unresolved are tracked in `docs/family-core/POLICY_GAPS_FOR_FOUNDER.md` and continue to fail closed.

## Known limitation

This is an executable schema and authorization reference proof, not a production Core service. Production still requires the named Legal/Privacy parameters, threat/privacy review, service authentication, managed-secret injection, connection pooling, observability, RDS operational rehearsal, and an explicitly approved release and migration plan.
