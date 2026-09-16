# Family OS Contract Acceptance Matrix V1

Status: `FOUNDER APPROVED / DOCUMENTATION CONTRACT / NOT RUNTIME`

## Compatibility matrix

| Area | Current `main@846f77c` | V1 contract decision | Runtime action now |
|---|---|---|---|
| User/Family/Student IDs | locally minted text IDs | Core-issued opaque IDs; local IDs map as source IDs | none |
| Family ownership | `families.user_id` single-owner shortcut | scoped memberships/assignments and one `primary_family_id` | none |
| Guardian | no authoritative entity | Core Guardian + verified Guardian–Student relationship | none |
| Consent | partner boolean / no assessment ledger | Core purpose- and version-specific consent | none |
| RBAC | local roles and placeholder permission table | Core role assignment with explicit scope | none |
| Family isolation | application/local ownership checks | server policy + PostgreSQL RLS | none |
| Compass sync | Education-only Local Demo payload | versioned common handoff with hash and idempotency | none |
| Timeline | mutable local array records | append-only registered, minimised events | none |
| Advisor follow-up | local request/note records | request → scoped assignment → case → protected note | none |
| Health | enum placeholder | `RESERVED`, fail closed | none |

## Contract test scenarios

These are required for a future synthetic adapter; they are not claimed as executed by this documentation-only package.

| ID | Scenario | Expected result |
|---|---|---|
| FC-01 | Valid actor, family, subject, consent, permission | command accepted and audited |
| FC-02 | Actor belongs to two families and omits family context | `FAMILY_CONTEXT_AMBIGUOUS` |
| FC-03 | Subject belongs to another family | `FAMILY_CONTEXT_MISMATCH` |
| FC-04 | Legacy ID has conflicting mappings | `SOURCE_MAPPING_CONFLICT` |
| FC-05 | Minor has no verified Guardian authority where required | `GUARDIAN_AUTHORITY_REQUIRED` |
| CH-01 | Exact Compass handoff replay | `DUPLICATE`, same receipt |
| CH-02 | Same idempotency key with changed hash | `IDEMPOTENCY_CONFLICT` |
| CH-03 | Unknown rule/result/question version | fail closed |
| CH-04 | `HEALTH` handoff | `UNSUPPORTED_COMPASS_TYPE` |
| CH-05 | Handoff embeds raw sensitive documents | `HANDOFF_PAYLOAD_TOO_BROAD` |
| TL-01 | Registered, minimised timeline event | accepted and appended |
| TL-02 | Existing event mutated in place | rejected; superseding event required |
| AF-01 | Follow-up requested with active exact-purpose consent | request accepted |
| AF-02 | Assessment consent used for advisor contact | `CONSENT_REQUIRED` |
| AF-03 | Advisor assignment expired | `PERMISSION_DENIED` |
| AF-04 | Full advisor note copied to timeline | rejected |

## Dependencies before runtime implementation

- Founder review of this contract package.
- Resolution/merge strategy for Draft PR #5 Core Gate 1 contracts.
- Founder review of Draft PR #8 Identity Gate 2 contracts.
- Decision on whether Draft PR #4 documentation is merged, rebased, or selectively restacked.
- Approved production schema and additive migrations.
- Server-side Core identity resolution, Family Assignment, Consent, RBAC, RLS, Audit, and entitlement services.
- Data classification, retention, export, correction, withdrawal, and deletion policies.
- Real WeChat server-side authentication and approved HTTPS infrastructure.

## Founder decisions resolved

Approved on 2026-09-16:

1. The V1 shared Compass list is exactly `EDUCATION | IDENTITY | WEALTH`; `HEALTH` remains `RESERVED` and ingestion fails closed.
2. Family Timeline uses `FAMILY`, `SUBJECT`, `ADVISOR_SHARED`, and `INTERNAL_RESTRICTED` as presentation meanings. Family Assignment, exact-purpose Consent, RBAC, and RLS remain authoritative.
3. `LONGITUDINAL_GROWTH_RECORD` is required only when creating or persisting Journey, Growth Blueprint, or Family Timeline state. A minimum one-time assessment/report handoff uses `ASSESSMENT_SCORING` and must not infer longitudinal consent.
4. Customer-facing vocabulary is limited to `顾问跟进`, `预约顾问解读`, and `顾问服务`; internal systems retain `AdvisorRequest`, `AdvisorCase`, and `AdvisorNote`. Topic codes, channel allowlists, SLA values, and detailed status copy remain implementation parameters.
5. Withdrawal immediately stops new processing for the withdrawn purpose. Customer presentation may be hidden or restricted, while immutable audit evidence is not rewritten. Exact retention, deletion, anonymisation, DSAR, appeal, and jurisdictional periods remain Legal/Privacy parameters.
6. Minimum assessment/report handoff does not require a service entitlement unless the target experience is paid or restricted. Paid features, formal advisor service, and restricted delivery require an active entitlement in addition to consent and permission. SKU-to-entitlement mapping remains a Product/Catalogue parameter.

These decisions approve the documentation contract only. They do not approve runtime implementation, database migration, real-family data, staging deployment, production deployment, or external writeback.

## Release gates

The status remains `NO-GO FOR REAL FAMILY DATA` until all of the following pass with evidence:

- Core identity and mapping implementation;
- verified Family Assignment;
- exact-purpose Consent lifecycle;
- server-side RBAC;
- PostgreSQL RLS;
- append-only Audit Log;
- idempotent handoff and timeline adapters;
- synthetic cross-family and withdrawal tests;
- security/privacy review;
- approved database migration and rollback rehearsal;
- WeChat platform/device validation;
- explicit Founder authorization for the next Gate.

Documentation approval alone cannot clear these gates.
