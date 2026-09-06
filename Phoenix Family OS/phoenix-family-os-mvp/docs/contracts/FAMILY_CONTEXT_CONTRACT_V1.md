# Family Context Contract V1

Status: `DESIGN PREPARATION / CORE GATE DEPENDENCY`

## Purpose

Every Family OS read, command, handoff, timeline event, and advisor workflow must operate in one explicit, verified family context. A person may belong to multiple Families, but one request never aggregates them implicitly.

## Context envelope

```text
contract_version = FAMILY_CONTEXT_V1
request_id
occurred_at
source_service
source_version
actor_user_id
primary_family_id
subject_type
subject_id
guardian_id (nullable)
consent_id (nullable only where the command requires no consent)
entitlement_id (nullable only where the service requires no entitlement)
role_assignment_id
external_identity_mapping_ids[]
audit_context
```

Allowed `subject_type` values for V1:

- `USER`
- `GUARDIAN`
- `STUDENT`
- `FAMILY`

`HEALTH` is not a subject type or an active domain in this contract.

## Required validation order

1. Validate the contract version and required field shapes.
2. Resolve the authenticated principal to `actor_user_id` through Phoenix Core.
3. Resolve `primary_family_id` to one active Core Family.
4. Verify active family membership or an explicit scoped assignment for the actor.
5. Resolve the subject and verify that the subject relationship is authorised in the same family.
6. If a minor is involved, verify the Guardian relationship and current authority where required.
7. Check the exact purpose, policy version, status, and validity window of `consent_id`.
8. Check entitlement when the requested service requires it.
9. Check the permission for `(actor, role, scope, family, action, resource)`.
10. Execute the domain command and append audit evidence using the same `request_id`.

Every failed check denies the command. Missing context is never repaired by selecting the first family or by name, phone, email, school, or child-name matching.

## ID authority and legacy mapping

Authoritative Core IDs follow the Gate 1 proposed forms:

| Entity | Shape |
|---|---|
| User | `usr_<32 lowercase hex>` |
| Family | `fam_<32 lowercase hex>` |
| Student | `stu_<32 lowercase hex>` |
| Guardian | `gdn_<32 lowercase hex>` |

Existing Family OS `PFS_DB_V01` IDs and Local Demo SQLite IDs are non-authoritative source IDs, even when their prefixes resemble Core IDs. They resolve through `core.external_identity_mappings`; they are never silently promoted, overwritten, or deleted.

## Family isolation invariants

- `primary_family_id` is mandatory on assessments, reports, timeline events, advisor requests/cases, partner experiences, entitlements, and future service instances.
- Payload family, subject family, consent family, assignment scope, and stored row family must match.
- Multi-family membership requires an explicit authorised context switch.
- Cross-family reads, searches, exports, or mutations require a separately scoped administrative permission, reason, and audit event.
- Production enforcement requires both server-side authorisation and PostgreSQL RLS. UI filtering is insufficient.

## Legacy-to-contract compatibility

| Current Family OS source | Current field | Contract treatment |
|---|---|---|
| `users.id` | local user key | `source_id`; resolve to Core `actor_user_id` |
| `families.id` | local family key | `source_id`; resolve to Core `primary_family_id` |
| `students.id` | local student key | `source_id`; resolve to Core `subject_id` |
| `families.user_id` | single-owner shortcut | legacy ownership evidence only; not production membership |
| `partnerApplications.privacy_consent` | boolean | insufficient; never upgraded to Core consent |
| `permissions` placeholder | family/partner scope | insufficient; never upgraded to Core RBAC |
| Local Demo bearer session | installation identity | synthetic test identity only |

## Fail-closed reason codes

- `CORE_CONTEXT_UNAVAILABLE`
- `FAMILY_NOT_RESOLVED`
- `FAMILY_CONTEXT_AMBIGUOUS`
- `ACTOR_NOT_AUTHORISED`
- `SUBJECT_RELATIONSHIP_UNVERIFIED`
- `GUARDIAN_AUTHORITY_REQUIRED`
- `CONSENT_REQUIRED`
- `CONSENT_NOT_ACTIVE`
- `ENTITLEMENT_REQUIRED`
- `PERMISSION_DENIED`
- `FAMILY_CONTEXT_MISMATCH`
- `SOURCE_MAPPING_CONFLICT`

Reason codes may be displayed in internal diagnostics. Customer-facing copy must not expose internal IDs, authorization topology, or sensitive evidence.

