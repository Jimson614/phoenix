# Phoenix Core Identity V1 (Proposed)

Status: `FOUNDER-APPROVED — GATE 1 DESIGN / IMPLEMENTATION NOT STARTED`
Canonical owner: `yvettfang-netizen/phoenix.git`
Production target: Alibaba Cloud ECS + RDS PostgreSQL + OSS; no deployment is part of this Gate.

## Authoritative boundary

Phoenix Core owns User, Family, Student, Guardian, Consent, Role, Permission, Service Entitlement, Cross-System ID Mapping, and Audit Log. Domain products own their domain records but reference Core IDs.

| Product/domain | Owns | Must reference |
|---|---|---|
| Family OS | Family experience, longitudinal family views | Core `user_id`, `family_id`, `student_id`, consent, entitlement |
| Education Compass | Questions, answers, scoring, tags, reports | Core family/student and consent references |
| Identity Compass | Identity-assessment rules and reports | Core family/user/student as applicable; may not mint authoritative identity |
| Wealth Compass | Wealth rules and reports | Core subjects and consent |
| Health Compass | Nothing implemented; reserved contract slot only | Future Core IDs after separate approval |
| ASKWISE | Learning tasks, attempts, error analysis, mastery, revalidation | Core `student_id` via mapping; optional `family_id` and entitlement |
| Phoenix Academic Studio | Tutor/package/session/credit/settlement domain | Core student/tutor identity, order and entitlement references |
| Website | Presentation and navigation | Core authentication/session reference; no master data |
| Content Automation | Content workflow, publishing state, remote IDs, audit | No customer identity master |

## Current conflict matrix

### User

| Current source | ID / creator | Storage and fields | Relationships/dependencies | Risk |
|---|---|---|---|---|
| Family OS local | Local repository inserts `users.id`; demo auth finds `wechat_id=local_family_user`; known values include `usr_phoenix_advisor` | WeChat storage `PFS_DB_V01`; `id`, `wechat_id`, `name`, `phone`, `role`, `created_at` | `families.user_id`, requests, analytics | Demo ID and contact-coupled records can collide or be mistaken for production identity |
| Family OS backend | Server/demo flow creates text `users.id` with provider subject | SQLite; `id`, `auth_provider`, `provider_subject`, `created_at` | Sessions, families, submissions, audit | Separate master from local store; only `local_demo` provider |
| Identity Compass | Browser creates `usr_${crypto.randomUUID()}` | localStorage key `pn:identity:context:v1`; mock Feishu profiles | Family context and assessment | Each browser can create another apparent User; prefix looks authoritative but is not |
| Website recovery | ChatGPT auth headers expose email/full name; no User table | Request headers; D1 schema intentionally empty | Presentation session only | Email is mutable PII and cannot be a stable master ID |

### Family

| Current source | ID / creator | Storage and fields | Relationships/dependencies | Risk |
|---|---|---|---|---|
| Family OS local | Local repository-created text ID | `PFS_DB_V01`; family name, parent name, phone, location, goal | User, students, reports, timeline, advisor, permissions | `parent_name` is not a Guardian entity; single-owner shape limits multi-guardian families |
| Family OS backend | Backend text ID | SQLite `families(id,user_id,created_at,updated_at)` | Students, submissions, audit | Duplicates local family and assumes one owning User |
| Identity Compass | Browser creates `fam_${crypto.randomUUID()}` | localStorage context plus mock Feishu `families` record | User profile and assessments | Anonymous/browser family can duplicate an existing Family |

### Student

| Current source | ID / creator | Storage and fields | Relationships/dependencies | Risk |
|---|---|---|---|---|
| Family OS local | Local repository-created text ID | `PFS_DB_V01`; family, name, age, gender, school, system, grade, interests, goal | Assessments, reports, partner experiences | No global uniqueness; mutable demographic fields may be used for unsafe matching |
| Family OS backend | Backend text ID | SQLite `students(id,family_id,created_at,updated_at)` | Questionnaire submissions | Duplicate of local Student with no mapping ledger |
| ASKWISE | SQLite autoincrement integer created by a local demo seed | Local SQLite `students(id INTEGER,name UNIQUE)` | Experiments, tasks, sessions, evidence, maps, reflections | ASKWISE integer is module-local; name uniqueness is not person identity |

### Guardian, Consent, Role, Permission

| Entity | Current definitions | Conflict/gap |
|---|---|---|
| Guardian | No authoritative entity found. Family OS stores `parent_name`; Wealth draft distinguishes guardian/minor only as a consent bucket. | Cannot prove adult-to-child authority, shared custody, or multi-family relationships. |
| Consent | Family OS partner application has `privacy_consent` boolean. Wealth draft defines a versioned pseudonymous `ConsentRecord`. | Neither is a complete Core subject-linked, auditable consent ledger; withdrawal and authority are fragmented. |
| Role | Family OS local roles are `family_user`, `admin`, `partner_expert`; backend audit has an actor but no Core role model. | Role meanings and scopes are inconsistent; no Tutor/Advisor/Student baseline. |
| Permission | Family OS has `permissions(permission_id,family_id,partner_id,access_scope)` placeholder. | Partner access is not sufficient RBAC and does not enforce tenant isolation across systems. |

## Proposed normalized model

The Core identity spine is:

```text
User -> Auth Identity
User <-> Family through Family Membership
Student <-> Family through Student Family Membership
Guardian <-> Student through Guardian Relationship
Guardian -> optional User account
Legacy/module ID -> Core entity through External Identity Mapping
```

This separates an account (`User`) from an independent person with guardianship authority (`Guardian`) and a service subject (`Student`). Guardian may optionally link to User. User, Guardian, and Student may have scoped membership in multiple Families, but every business service instance has one explicit `primary_family_id`. A Family is a tenant boundary, not merely a row owned by one user, and no membership permits default cross-family reads or sharing.

## Proposed Core tables

| Schema | Table | Purpose |
|---|---|---|
| `core` | `users` | Stable account principals |
| `core` | `auth_identities` | Provider subject to User links; email/phone are attributes, not IDs |
| `core` | `families` | Family tenant records |
| `core` | `family_memberships` | User-to-Family relationship and membership status |
| `core` | `students` | Stable Student master |
| `core` | `student_family_memberships` | Student-to-Family relationship, including primary/current state |
| `core` | `guardians` | Guardian person record, optionally linked to User |
| `core` | `guardian_student_relationships` | Guardian authority/relationship and validity |
| `core` | `external_identity_mappings` | Immutable legacy/module ID bridge |
| `core` | `consents` | Current subject-, purpose-, and version-specific consent |
| `core` | `consent_events` | Append-only consent lifecycle evidence |
| `core` | `roles` | Controlled role catalog |
| `core` | `permissions` | Controlled action catalog |
| `core` | `role_permissions` | Role-to-permission policy |
| `core` | `role_assignments` | Actor role plus family/domain/organization scope |
| `entitlement` | `service_entitlements` | Service access/credits/status tied to Core subjects |
| `audit` | `audit_logs` | Append-only critical mutation and privileged-access evidence |

Commerce tables are intentionally excluded from implementation in this Gate. Future Commerce Core owns Order, Payment, Refund, and Payment Event.

## Audit baseline

Every identity create/link/merge, family membership change, guardian relationship change, consent lifecycle event, role change, entitlement mutation, and privileged access records:

`actor_user_id`, service actor when applicable, `action`, `entity_type`, `entity_id`, `family_id`, `before_json`, `after_json`, `occurred_at`, `reason`, `request_id`, and source metadata.

Audit records are append-only to application roles and contain minimized/redacted values for sensitive fields.

## Family isolation

1. Every family-scoped request is evaluated against active membership or explicit assignment.
2. Family-scoped rows carry `family_id` and are protected by PostgreSQL Row Level Security plus server-side authorization.
3. Core rejects a relationship whose referenced Student/Guardian/entitlement belongs outside the authorized family context.
4. Batch jobs and adapters use scoped service identities, not `SUPER_ADMIN` user credentials.
5. Cross-family searches and exports require explicit administrative permission, reason, and audit.

Before real-family onboarding, Consent, RBAC, verified Family Assignment, PostgreSQL RLS, and Audit Log are mandatory release gates.

## Internal-system boundary

NOVA DIGITAL is an internal system. Family OS and other family-facing products must not expose Founder identity, Agent identities or prompts, internal project status, administration data, operational control surfaces, or private management records to family users. Internal data and family data use separate authorization scopes and presentation contracts.

## Answers required for Gate 1

1. **Who owns User?** Phoenix Core `core.users` and `core.auth_identities`.
2. **Who owns Family?** Phoenix Core `core.families`; membership is separate.
3. **Who owns Student?** Phoenix Core `core.students`.
4. **How does ASKWISE identify the same child?** Its integer student ID resolves through `external_identity_mappings` to one Core `student_id`.
5. **How does Identity Compass identify the same family?** It receives/resolves the Core family context; legacy `fam_*` is a source mapping only.
6. **How do legacy IDs migrate without deletion?** Checksummed snapshot, staging, verified mapping, conflict quarantine, permanent mapping/audit lineage.
7. **How is consent recorded?** Subject + consenting actor/guardian + purpose + version + timestamp + withdrawal + immutable events/audit.
8. **How are different families isolated?** Scoped memberships/assignments, server authorization, `family_id`, RLS, and audited denial/privileged access.

## Explicit non-actions

No source directory was moved. No database was merged. No production schema was deployed. No identity was migrated. No Health implementation was created. Gate 2 requires Founder approval.
