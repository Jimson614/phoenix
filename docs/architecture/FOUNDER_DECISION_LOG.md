# Phoenix Nova Founder Decision Log

Decision ID: `PNX-ADR-2026-08-30-GATE01-FREEZE`
Status: `ACCEPTED`
Effective date: 2026-08-30
Scope: Phoenix Nova Core Gate 0/1 architecture freeze

## Repository baseline

- Repository: `https://github.com/yvettfang-netizen/phoenix.git`
- Base branch: `main`
- Base commit: `955a5cf169125dc4d864969edc022e5a50ea3bc2`
- Delivery branch: `codex/core-identity-gates-0-1-delivery`

## Frozen decisions

### 1. Core identifier format

Phoenix Core issues authoritative identifiers using a fixed entity prefix followed by a cryptographically random UUIDv4 encoded as 32 lowercase hexadecimal characters:

- `usr_<random UUIDv4>`
- `fam_<random UUIDv4>`
- `stu_<random UUIDv4>`
- `gdn_<random UUIDv4>`

Identifiers are opaque, immutable, non-sequential, not derived from personal information, and never reused.

### 2. User and Guardian are different entities

`User` is an account and authentication principal. `Guardian` is an independent person and guardianship relationship. A Guardian may optionally link to a User, but a Guardian is never inferred solely from account ownership, contact details, or a free-text parent name.

### 3. Multi-Family membership is scoped

User, Guardian, and Student may be related to more than one Family only through explicit scoped membership or relationship records. Every assessment, learning engagement, Academy engagement, entitlement use, advisory case, and other business service instance must declare one `primary_family_id`.

There is no default cross-family read, aggregation, inference, export, or sharing. Switching Family context requires explicit authorization and is auditable.

### 4. Mandatory real-family onboarding gates

Real families must not be onboarded until all of the following are implemented and verified together:

- purpose- and version-specific Consent;
- scoped RBAC;
- verified Family Assignment;
- PostgreSQL Row Level Security;
- append-only Audit Log.

UI-level hiding does not satisfy this requirement.

### 5. Health Compass remains reserved

`HEALTH` is a valid future Compass contract value with status `RESERVED`. Gate 0/1 creates no Health questions, scoring, diagnosis, recommendation, medical algorithm, data collection, UI, report, or Health-specific business table.

### 6. NOVA DIGITAL is internal

NOVA DIGITAL is an internal system. Family OS and other family-facing products must not expose Founder identity, Agent identities or prompts, internal project status, administration data, private management records, or operational control surfaces to family users.

Internal-system data and family-service data require separate authorization scopes and presentation contracts.

## Consequences

- Phoenix Core is the identity authority.
- Legacy and module-local identifiers remain as non-destructive mappings.
- Website, Content Automation, and Academy remain repository/domain boundaries defined by the Gate documents.
- Gate 2 may not start until the mandatory controls above have an approved implementation plan and the delivery PR is reviewed.
- This decision does not authorize source movement, database migration, production deployment, or a merge to `main`.

## Supersession

Changing any frozen decision requires a new Founder decision record that explicitly supersedes this ID. Editing this accepted record in place is not sufficient.
