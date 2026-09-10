# Family Core Founder Policy Freeze V1

Decision status: `APPROVED AS PROPOSED / FROZEN V1`

Decider: `Jimson / Founder`

Recorded at: `2026-09-10 15:44:44 +08:00`

Runtime posture: `DENY BY DEFAULT / SYNTHETIC SANDBOX ONLY`

> 批准 FOUNDER_POLICY_FREEZE_PROPOSAL_V1，按提案冻结；生产、真实数据、公开索引、DB migration 均继续 NO-GO，Health PR #12/#13 继续 HOLD。

## Authority boundary

This record freezes the Founder-approved V1 direction for Guardian, Consent, Retention, Entitlement, multi-family context, operator access, break glass, identity conflict, cross-domain sharing, Health scope and data export. Missing evidence, an unknown legal parameter or an unlisted action fails closed.

It does **not** authorize production, real data, public indexing, database migration, Health scope, merge, deployment or a ready-for-review transition. Legal/Privacy-owned thresholds, schedules and procedures remain required where listed below.

## Frozen decisions

| ID | Frozen V1 decision | Required failure mode | Parameter still owned outside engineering |
| --- | --- | --- | --- |
| `GUA-001` | Guardian authority requires a verified Phoenix account, Legal-approved evidence and recorded approval by an authorized Trust/Operations reviewer. Weak identity signals and self-attestation are insufficient. | Reject and create a review case. | Evidence allowlist by jurisdiction; reviewer role and cadence. |
| `GUA-002` | Guardian relationships are independent and scoped. No silent precedence. High-risk sharing, export, authority removal and conflict actions require applicable authority rules plus a second reviewer. | Suspend the action and disclose nothing new. | Precedence, emergency-order and dispute rules. |
| `CON-001` | Consent is immutable and purpose-, destination-, version-, locale-, actor- and subject-specific. No bundled, inferred, pre-checked or retroactive consent. | Deny processing or sharing without a matching active receipt. | Exact purpose codes and approved copy/version owner. |
| `CON-002` | Capacity comes from a Legal-owned jurisdiction table. Unknown or conflicting inputs receive conservative minor treatment; required assent is not replaced by Guardian consent. | Quarantine; no elevated processing. | Thresholds, emancipation and exception rules. |
| `CON-003` | Withdrawal synchronously stops new covered processing, invalidates cached authority and emits idempotent revocation events; evidence remains append-only. | Deny future requests and visibly retry failed revocations. | Deletion SLA, derived-data and notification rules. |
| `RET-001` | Engineering may not invent real-data retention. Only deterministic non-personal fixtures may be retained as test evidence until an approved schedule exists. | `POLICY_HOLD` for real data and retention jobs. | Per-class periods, deletion/anonymization and legal-hold rules. |
| `ENT-001` | Family Core ledger is the sole runtime entitlement authority; external systems emit authenticated source events only. | Deny missing, expired, suspended, conflicting or stale entitlement. | Grace, refund, suspension and reconciliation rules. |
| `ENT-002` | Membership is explicit per family. Each request carries exactly one selected family context revalidated by the server. No inherited primary family, automatic merge or cross-family query. | Reject ambiguous or unauthorized context. | Invitation, leave and primary-context UX. |
| `OPS-001` | Operator/advisor access requires least privilege, explicit subject/family assignment, purpose, bounded time and immutable audit. No global browse. | Deny when any control is absent. | Eligible roles, consent requirement and maximum duration. |
| `BRK-001` | Break glass is disabled for V1. | No emergency superuser path. | Separate Founder/Security approval, actors, MFA, dual approval, duration, alerting and review SLA. |
| `ID-001` | Never auto-merge on name, phone, email, address, device or payment. Conflicts are quarantined; any later merge needs verified evidence, second review, immutable decision and tested reversible split. | Keep identities separate and deny cross-record access. | Evidence threshold, reviewer roles and appeal process. |
| `XDS-001` | Cross-domain sharing is allowlist-only through authenticated APIs/adapters, with purpose-specific consent, entitlement where applicable, minimal fields, idempotency and audit correlation. No shared DB credentials or direct table reads. | Deny unlisted field, purpose, consumer or stale authority. | Final purpose codes and accountable Product/Legal owner. |
| `XDS-002` | Health is excluded from this release train. | Hold every Health field, route, entitlement and UI; PR #12/#13 remain Draft/HOLD. | Separate written Founder scope change and release Gate. |
| `DSR-001` | Export requires verified requester and authority, bounded subject/family scope, encrypted expiring delivery, provenance and audit. | Deny ambiguous requester or scope. | Requester rules, delivery method, SLA and export retention. |

## Approved cross-domain minimum allowlist

The machine-readable source is `backend/family-core-sandbox/policy/family-core-policy-v1.json`. It allows only:

- Core → Education: opaque subject/family IDs, membership and entitlement state, consent reference/purpose/version/status/time and correlation ID.
- Core → Identity: opaque IDs, membership and Guardian relationship state, conflict-case reference/status and consent reference.
- Core → Wealth: opaque IDs, selected family context, entitlement summary, consent reference and correlation ID.
- Domain → Core: idempotent event envelope, producer/type/version, opaque IDs, minimal decision metadata, occurred time and correlation ID; never direct mutation.
- Health ↔ any domain: no fields, routes, entitlements or UI.

Names, contact details, addresses, raw identity evidence, unrelated family members, raw assessment content, Health data, payment details, secrets and unrestricted timelines are not on the allowlist.

## Enforceable artifacts

- `backend/family-core-sandbox/policy/family-core-policy-v1.json` — frozen machine-readable baseline.
- `backend/family-core-sandbox/policy/policy-gate-v1.cjs` — denial-first reference evaluator; not a production authorization service.
- `backend/family-core-sandbox/scripts/verify-policy-v1.cjs` — baseline integrity and one executable deny-path per policy ID.
- `docs/family-core/POLICY_TRACEABILITY_V1.md` — implementation/evidence maturity map.

Any change must identify the affected policy ID, replacement text, approver and effective policy version. Separate written GO remains mandatory for every release Gate.
