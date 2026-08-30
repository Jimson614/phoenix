# Cross-System Identity Mapping V1 (Proposed)

Status: `FOUNDER-APPROVED — GATE 1 DESIGN`

## Purpose

`core.external_identity_mappings` is the non-destructive bridge from legacy or module-local identity keys to authoritative Phoenix Core IDs. It allows old data to remain in place while every future request resolves to one User, Family, Student, or Guardian.

## Proposed table contract

| Column | Type | Rule |
|---|---|---|
| `mapping_id` | text | Core-issued `map_<random>` primary key |
| `entity_type` | enum | `USER`, `FAMILY`, `STUDENT`, `GUARDIAN` |
| `phoenix_core_id` | text | Existing authoritative ID with matching entity prefix |
| `source_system` | text | Controlled registry value |
| `source_id` | text | Exact immutable legacy/internal identifier |
| `source_record_version` | text nullable | Optional schema/version evidence |
| `status` | enum | `ACTIVE`, `CONFLICT`, `SUPERSEDED`, `RETIRED` |
| `match_method` | enum | `VERIFIED_LOGIN`, `GUARDIAN_ASSERTION`, `OPERATOR_REVIEW`, `MIGRATION_RULE` |
| `confidence` | numeric nullable | Supporting signal only; never authorizes access |
| `verified_by_user_id` | text nullable | Reviewer/actor when applicable |
| `verified_at` | timestamptz nullable | Verification time |
| `created_at` | timestamptz | Append evidence time |
| `superseded_by_mapping_id` | text nullable | Non-destructive lineage |
| `metadata` | jsonb | Source snapshot hash and migration evidence; no unnecessary PII |

Required unique constraint: `(source_system, entity_type, source_id)`. Multiple legacy source IDs may intentionally map to the same Core ID. All changes generate an audit event.

## Controlled source systems

Initial proposed values:

- `FAMILY_OS_LOCAL_PFS_DB_V01`
- `FAMILY_OS_BACKEND_SQLITE`
- `IDENTITY_COMPASS_LOCAL_V1`
- `ASKWISE_SQLITE`
- `WEBSITE_CHATGPT_AUTH`
- `ACADEMY` (reserved for a reviewed adapter)

## Known mappings to create during a future migration rehearsal

| Current source | Current key | Target |
|---|---|---|
| Family OS local store | `users.id` | Core `user_id` |
| Family OS local store | `families.id` | Core `family_id` |
| Family OS local store | `students.id` | Core `student_id` |
| Family OS backend SQLite | `users.id` | Core `user_id` |
| Family OS backend SQLite | `families.id` | Core `family_id` |
| Family OS backend SQLite | `students.id` | Core `student_id` |
| Identity Compass localStorage | legacy `usr_*` | Core `user_id` |
| Identity Compass localStorage | legacy `fam_*` | Core `family_id` |
| ASKWISE SQLite | integer `students.id` | Core `student_id` |
| Website auth header | provider subject/email evidence | Core auth identity, then `user_id` |

Website email is not itself a Core ID. The production mapping should use a stable, verified provider subject; the current header-only email behavior is presentation/authentication evidence, not a User master.

## Resolution API semantics

```text
resolve(source_system, entity_type, source_id)
  -> ACTIVE mapping: return phoenix_core_id
  -> CONFLICT: deny mutation and route to review
  -> missing: require verified link/create workflow
```

ASKWISE example:

```text
(ASKWISE_SQLITE, STUDENT, "17")
  -> stu_550e8400e29b41d4a716446655440000
```

Identity Compass example:

```text
(IDENTITY_COMPASS_LOCAL_V1, FAMILY, "fam_<legacy-randomUUID>")
  -> fam_<core-random-id>
```

## Non-destructive migration sequence

1. Freeze a checksummed source snapshot.
2. Import source IDs into a staging register without changing source records.
3. Resolve exact previously verified mappings.
4. Create new Core entities only when evidence establishes a distinct person/family.
5. Put ambiguous candidates in `CONFLICT`; do not name-match automatically.
6. Write mappings and audit events in one transaction.
7. Reconcile counts and orphan references.
8. Switch a module to Core lookup only after a rollback rehearsal.

No mapping or data migration is executed in Gate 1.

Every future service record resolved through a mapping must also declare its authorized `primary_family_id`. Resolving the same person across systems does not authorize reading records belonging to another Family.
