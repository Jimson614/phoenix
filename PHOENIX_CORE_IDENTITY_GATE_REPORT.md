# Phoenix Nova Core Identity Gate 1 Report

Date: 2026-08-30
Status: `PASS — ARCHITECTURE FROZEN / IMPLEMENTATION NOT STARTED`

## Delivery baseline

- Repository: `https://github.com/yvettfang-netizen/phoenix.git`
- Base branch: `main`
- Base commit: `955a5cf169125dc4d864969edc022e5a50ea3bc2`
- Delivery branch: `codex/core-identity-gates-0-1-delivery`
- Scope: documentation and decision evidence only

## Gate 0 prerequisite

Gate 0 preservation is PASS. Dirty worktrees, dormant Git histories, SQLite/WAL states, Content Automation runtime state, Website recovery work, and clean-clone-only Family OS commits were preserved outside this Git delivery.

No database, WAL/SHM file, runtime archive, real record, secret, environment file, or machine-specific path is included in this branch.

See [PHOENIX_ASSET_PRESERVATION_REPORT.md](PHOENIX_ASSET_PRESERVATION_REPORT.md) and [Gate 0/1 recovery notes](docs/architecture/GATE_0_1_RECOVERY_NOTES.md).

## Gate 1 result

Phoenix Core is the sole authority for User, Family, Student, Guardian, Consent, Role, Permission, Service Entitlement, external identity mapping, and audit evidence.

The frozen identity model is:

```text
User -> authentication account
Guardian -> independent person and guardianship relationship; optional User link
Family -> tenant and privacy boundary
Student -> stable service subject
User / Guardian / Student <-> Family through scoped relationships
Business service instance -> exactly one primary_family_id
Legacy or module ID -> Core entity through external identity mapping
```

Consent, RBAC, verified Family Assignment, PostgreSQL RLS, and append-only Audit Log are mandatory before onboarding a real family.

## Founder decisions

The accepted decisions are recorded in [FOUNDER_DECISION_LOG.md](docs/architecture/FOUNDER_DECISION_LOG.md). The ID contract is `usr_`, `fam_`, `stu_`, or `gdn_` plus random UUIDv4.

NOVA DIGITAL remains internal and must not expose Founder, Agent, project-status, administration, or private management data to Family OS users.

## Health Compass

The shared contract permits `EDUCATION`, `IDENTITY`, `WEALTH`, and `HEALTH`. `HEALTH` is `RESERVED`. No Health product or data implementation is included.

## Gate 1 deliverables

- [Phoenix Core Identity V1](docs/architecture/PHOENIX_CORE_IDENTITY_V1.md)
- [Core ID Contract](docs/architecture/CORE_ID_CONTRACT.md)
- [Cross-System Mapping](docs/architecture/CROSS_SYSTEM_MAPPING.md)
- [Consent Model](docs/architecture/CONSENT_MODEL.md)
- [RBAC Baseline](docs/architecture/RBAC_BASELINE.md)
- [Core ERD V1](docs/architecture/CORE_ERD_V1.md)
- [Founder Decision Log](docs/architecture/FOUNDER_DECISION_LOG.md)

## Stop boundary

This report does not authorize Gate 2. No business source was changed, no production schema was deployed, no identity or database was migrated, and `main` was not merged.
