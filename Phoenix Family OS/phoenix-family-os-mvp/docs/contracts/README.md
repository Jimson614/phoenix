# Phoenix Family OS Contract Preparation V1

Status: `DESIGN PREPARATION / REVIEW REQUIRED / NOT RUNTIME`

This directory freezes the smallest reviewable contract boundary between Phoenix Core, Family OS, the Compass products, Family Timeline, and Advisor Follow-up. It does not authorize production migration, real-family onboarding, deployment, or a merge to `main`.

## Baseline and evidence

| Source | Ref | Use in this package |
|---|---|---|
| Phoenix canonical baseline | `main@846f77c120cd00a49d89635dd4297b020af7d03a` | Runtime inventory and legacy compatibility |
| Family OS Sprint 2 docs | Draft PR `#4@b97dcd4dca26f08e72d172ccf9e92918512ff068` | Reviewed 23-file documentation evidence; not merged |
| Phoenix Core identity | Draft PR `#5@38199a3ba38a12db82241e0ac8e4e02a57efc18f` | Founder-approved Gate 1 design dependency; not runtime |
| Identity Compass Gate 2 | Draft PR `#8@622f425e1f201e7ac62a2aea920aff240cb1ca73` | Identity result and Family OS handoff dependency; not merged |

The references above are dependencies, not evidence that the proposed Core schema or Gate 2 handoff is deployed.

## Documents

- `FAMILY_CONTEXT_CONTRACT_V1.md` — authoritative family context required by every Family OS command.
- `COMPASS_HANDOFF_CONTRACT_V1.md` — common envelope for Education, Identity, and Wealth handoffs.
- `FAMILY_TIMELINE_EVENT_CONTRACT_V1.md` — append-only, family-scoped timeline events.
- `ADVISOR_FOLLOW_UP_CONTRACT_V1.md` — family-initiated requests and assigned advisor cases.
- `CONTRACT_ACCEPTANCE_MATRIX_V1.md` — compatibility, tests, dependencies, and release gates.

## Contract rules

1. Phoenix Core is the sole authority for `user_id`, `family_id`, `student_id`, `guardian_id`, consent, assignment, RBAC, entitlement, external identity mapping, and audit evidence.
2. Every business service instance declares exactly one `primary_family_id`.
3. Authentication alone never grants family access.
4. A module-local ID remains a source ID until a verified Core mapping exists.
5. Consent is purpose- and policy-version-specific. Assessment consent does not imply marketing or cross-system sharing consent.
6. Handoffs and commands fail closed when family, actor, subject, consent, entitlement, provenance, or version checks are incomplete.
7. Timeline and audit events are append-only evidence; they are not mutable customer notes.
8. `HEALTH` remains `RESERVED`; this package creates no Health questions, scoring, data collection, recommendation, or medical logic.

## Explicit non-actions

- No runtime code or database migration is changed.
- No Core ID is minted by Family OS or a Compass.
- No production database, WeChat identity, secret, customer record, or real-family data is used.
- No deployment, PR merge, `main` write, payment, CRM, or production external writeback is authorized.

