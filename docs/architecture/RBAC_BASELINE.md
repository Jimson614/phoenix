# Phoenix RBAC Baseline V1 (Proposed)

Status: `FOUNDER-APPROVED — GATE 1 DESIGN`

## Principles

- Default deny.
- Authentication does not imply family access.
- Every authorization decision includes actor, role, scope, family, action, and resource.
- Cross-family access is denied unless an explicit assignment or platform administration scope exists.
- `SUPER_ADMIN` is exceptional, time-bounded where possible, and fully audited.
- Domain services enforce policy server-side; UI hiding is not authorization.
- A person may belong to multiple Families only through explicit scoped membership. Every business service instance carries one `primary_family_id`; no default cross-family read or share is allowed.
- Consent, RBAC, Family Assignment, PostgreSQL RLS, and Audit Log must all be active before onboarding a real family.

## Baseline roles

| Role | Normal scope | Baseline capability |
|---|---|---|
| `PARENT` | Assigned family | Manage family profile, linked students, consents, and entitled services |
| `STUDENT` | Self + assigned family-limited views | View/submit own age-appropriate learning and assessment data |
| `TUTOR` | Assigned students/sessions | Access necessary Academy/learning records only |
| `ADVISOR` | Assigned families/cases | Read approved family context and write advisory records |
| `OPERATOR` | Operational queue/organization | Perform approved support workflows without blanket family access |
| `ADMIN` | Organization/domain | Configure domain operations and reviewed access within scope |
| `SUPER_ADMIN` | Platform | Emergency/platform administration with mandatory reason and audit |

The legacy Family OS values `family_user`, `admin`, and `partner_expert` are source roles, not final Core roles. They require reviewed mappings; `partner_expert` must not automatically become `TUTOR` or `ADVISOR`.

## Proposed tables

- `core.roles`
- `core.permissions`
- `core.role_permissions`
- `core.role_assignments`
- `core.family_memberships`
- domain assignment tables such as tutor-to-student or advisor-to-family references

`role_assignments` includes `scope_type`, `scope_id`, `valid_from`, `valid_until`, `granted_by_user_id`, and status. A role without a scope grants nothing.

## Permission examples

| Permission | PARENT | STUDENT | TUTOR | ADVISOR | OPERATOR | ADMIN | SUPER_ADMIN |
|---|---:|---:|---:|---:|---:|---:|---:|
| `family.read` | own | limited own | assigned/minimum | assigned | case-specific | scoped | audited platform |
| `student.update_profile` | own family | limited self | no | no | workflow-specific | scoped | audited platform |
| `assessment.submit` | own family | self if allowed | no | assisted if assigned | no | no | no |
| `learning.record.write` | no | own submissions | assigned | no | no | scoped admin | emergency only |
| `consent.grant` | if valid guardian | policy-dependent | no | no | assisted capture only | no | no |
| `role.assign` | no | no | no | no | no | scoped roles only | yes, audited |

## Family isolation

Production PostgreSQL should enforce family isolation through both application authorization and Row Level Security. Family-scoped tables carry `family_id`; request transactions set a verified family context; RLS rejects rows outside it. Composite foreign keys or equivalent service checks prevent attaching a Student, consent, entitlement, or mapping to an unrelated family.

`primary_family_id` is mandatory on each assessment, learning engagement, Academy engagement, entitlement use, advisory case, and other business service instance. A multi-family User, Guardian, or Student must explicitly switch authorized family context; services never aggregate Families by default.

Tutor and advisor access is granted by explicit assignment, limited to required fields, and revoked when the assignment ends. Operators cannot search arbitrary families by default.

## Audit requirements

Role grant/revoke, cross-family access attempts, consent changes, identity link/merge, and privileged reads/writes record actor, action, entity, before, after, timestamp, request ID, and reason. Audit rows are append-only to application roles.
