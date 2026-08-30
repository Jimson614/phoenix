# Phoenix Core ID Contract V1 (Proposed)

Status: `FOUNDER-APPROVED — GATE 1 DESIGN`
Scope: Gate 1 design only; no production migration or deployment is authorized.

## Decision

Phoenix Core is the sole issuer and authority for the following identifiers:

| Entity | Field | Proposed external form | Authority |
|---|---|---|---|
| User | `user_id` | `usr_<32 lowercase hex>` | Phoenix Core |
| Family | `family_id` | `fam_<32 lowercase hex>` | Phoenix Core |
| Student | `student_id` | `stu_<32 lowercase hex>` | Phoenix Core |
| Guardian | `guardian_id` | `gdn_<32 lowercase hex>` | Phoenix Core |

The suffix is a cryptographically secure UUIDv4 value encoded as 32 lowercase hexadecimal characters without hyphens. Example: `stu_550e8400e29b41d4a716446655440000`.

This format is the frozen Founder decision for Gate 1. It is a contract decision, not yet an implemented schema.

## Invariants

1. IDs are globally unique, opaque, immutable, and never reused.
2. IDs are not sequential and are not derived from name, email, phone, WeChat ID, birth date, school, or any other sensitive attribute.
3. A change to contact details, authentication provider, family name, or school never changes a Core ID.
4. Every module receives Core IDs; a module may retain an internal ID only through `core.external_identity_mappings`.
5. Domain modules must not mint values using reserved Core prefixes.
6. APIs validate the prefix and exact shape before accepting an ID.
7. Legacy IDs are retained as mappings or aliases; they are never overwritten or deleted merely because a Core ID is assigned.

Proposed PostgreSQL check pattern:

```sql
^(usr|fam|stu|gdn)_[0-9a-f]{32}$
```

Each table applies only its own prefix, for example `^stu_[0-9a-f]{32}$` on `core.students.student_id`.

## Entity semantics

- `User` is an authentication principal/account. A person can change or add authentication providers without creating a second User.
- `Family` is a tenant and privacy boundary. Access to family-scoped records requires an active scoped membership or an explicitly scoped assignment.
- `Student` is the stable person receiving assessment, learning, Academy, and entitlement services. A Student may have scoped membership in multiple Families; every service instance must carry one explicit `primary_family_id`. ASKWISE numeric IDs are not Phoenix Student IDs.
- `Guardian` is an independent adult/person record and guardianship relationship. A Guardian may optionally link to a User and may have scoped membership in multiple Families. Guardian is not inferred from `families.parent_name`.
- `User` may hold scoped membership in multiple Families. Membership never authorizes implicit cross-family reads or sharing.

## Creation authority

Only a trusted Phoenix Core command/API may create these entities. Website, Compass, ASKWISE, Academy, Family OS clients, and adapters submit creation or link requests; they do not generate authoritative IDs locally.

For offline/demo flows, locally generated IDs must be explicitly namespaced as non-authoritative source IDs and later mapped. Existing `usr_*` / `fam_*` values from Identity Compass remain legacy source IDs even though their prefixes resemble the proposed Core form.

## Resolution rules

1. Resolve a known `(source_system, entity_type, source_id)` mapping first.
2. If no mapping exists, authenticated and verified linking may create one.
3. Never auto-merge on name, phone, email, school, or child name alone.
4. Ambiguous matches enter `CONFLICT` review and continue to preserve every source record.
5. A merge marks the losing Core record as an alias/superseded record; history and mappings remain queryable.

## Compass contract slot

The shared enum is reserved as:

```text
compass_type = EDUCATION | IDENTITY | WEALTH | HEALTH
```

`HEALTH` has `status = RESERVED`. This contract creates no Health questions, medical logic, reports, UI, or Health-specific tables.

## Versioning

This document defines `core-id-contract/v1-proposed`. Any incompatible ID shape or ownership change requires a new contract version and an explicit migration decision.
