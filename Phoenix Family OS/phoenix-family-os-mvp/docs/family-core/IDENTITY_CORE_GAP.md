# Identity Compass to Phoenix Core Gap Audit

Status: `AUDITED / INTEGRATION HOLD`

## Evidence baseline

- Identity implementation: PR #8, `codex/identity-compass-gate2-sprint`, `622f425e1f201e7ac62a2aea920aff240cb1ca73`.
- Core design: PR #5, `38199a3ba38a12db82241e0ac8e4e02a57efc18f`.
- Executable Core sandbox: local `codex/family-core-sandbox-20260909`, tested at `fe13955a962284fe6a3a1de11ecb18418f54c875`.

## Current Identity state

Identity Compass is a Next.js client application. `getOrCreateIdentityIds()` creates `usr_*`, `fam_*`, and assessment IDs in browser storage. Repository interfaces exist for lead, profile, family context, assessment, policy, study admission, report, and advisor follow-up, but the current persistent implementation is local/browser or mock adapter oriented. There is no trusted Core database, verified login binding, Guardian entity, Consent ledger, entitlement check, RLS claim, or migration ledger in PR #8.

## Required identity semantics

- The assessment account principal must resolve to an adult `Member` and authoritative `User`/identity subject.
- `student_id` is a child/service-subject identifier and must never be reused as the adult Identity subject.
- Browser-created IDs remain source IDs until an authenticated Core service resolves or issues context.
- `family_id` is a tenant boundary, not a mutable browser preference.

## Gaps

| Area | Current PR #8 | Required Core contract | Blocker |
| --- | --- | --- | --- |
| Authentication | no verified provider binding in the assessment flow | `auth_identities` → authoritative User → adult Member | provider/session integration and verified UUID mapping |
| Family context | locally minted `fam_*` | active Family membership/assignment and selected family claim | server context endpoint and switching policy |
| Subject | `user_id` carried directly in profile/lead | adult `member_pk` plus public `user_id`; optional subject relationship | schema and API field additions |
| Minor path | age band is assessment data | separate Student/minor Member plus active Guardian authority | product decision on whether Identity is adult-only or has a minor path |
| Consent | no Core purpose/version/evidence reference | active purpose-specific `consent_id` | Founder policy and consent UI/contract |
| Permissions | client route logic | Core RBAC, family scope, entitlement, RLS/server enforcement | service identity and authorization middleware |
| Persistence | localStorage/mock Feishu | trusted service repository with idempotency and audit | backend implementation and managed database |
| Migration | no candidate/mapping queue | test exclusion, Auth UUID preservation, collision quarantine, operator approval | source snapshot and migration runbook |
| Audit | analytics/domain records only | append-only identity/link/consent/privileged access evidence | request ID and actor/service audit contract |
| Retention | browser keys without approved lifecycle | per-data-class retention/withdrawal behavior | Founder retention decisions |

## Safe adapter contract

Identity Compass may submit an assessment only after receiving an opaque server-issued context containing authoritative `user_id`, adult `member_pk`, `family_id`, active membership/assignment, required `consent_id`, and service entitlement. It returns a domain assessment/result ID and payload hash; it does not mint or merge Core identities.

## Migration blockers

1. Existing browser IDs have no proof of uniqueness beyond one browser profile.
2. Email/phone/name are mutable attributes and cannot establish identity equality.
3. No complete inventory of PR #8 client contexts exists, and localStorage is not a managed migration source.
4. Founder decisions for minor Identity use, Guardian authority, consent purposes, and retention are open.
5. The Family Core sandbox is not yet a reviewed network service and its commits are not remotely shared.

Decision: keep PR #8 independent and Draft. Do not wire it to the Education `student_id`, Website D1 account ID, or Family OS demo user. Integrate only through a reviewed Core context adapter after policy and service gates.
