# Phoenix Core PostgreSQL ERD V1 (Proposed)

Status: `FOUNDER-APPROVED — DESIGN ONLY`
Target: RDS PostgreSQL. This document is not executable DDL and performs no deployment.

The ERD is split by bounded context to keep keys and relationships readable. Polymorphic links in mapping, consent, entitlement, and audit require service-level validation or typed association tables in the eventual DDL; they are not silently treated as unrestricted foreign keys.

## Identity, consent, mapping, entitlement

```mermaid
erDiagram
    USER ||--o{ AUTH_IDENTITY : authenticates_with
    USER ||--o{ FAMILY_MEMBERSHIP : joins
    FAMILY ||--o{ FAMILY_MEMBERSHIP : has
    FAMILY ||--o{ STUDENT_FAMILY_MEMBERSHIP : includes
    STUDENT ||--o{ STUDENT_FAMILY_MEMBERSHIP : belongs_through
    USER o|..o| GUARDIAN : may_represent
    GUARDIAN ||--o{ GUARDIAN_STUDENT_RELATIONSHIP : holds_authority
    STUDENT ||--o{ GUARDIAN_STUDENT_RELATIONSHIP : is_protected_by
    FAMILY ||--o{ CONSENT : scopes
    CONSENT ||--o{ CONSENT_EVENT : records
    USER ||..o{ CONSENT : acts_on
    FAMILY ||..o{ EXTERNAL_IDENTITY_MAPPING : maps_legacy
    STUDENT ||..o{ EXTERNAL_IDENTITY_MAPPING : maps_legacy
    USER ||..o{ EXTERNAL_IDENTITY_MAPPING : maps_legacy
    GUARDIAN ||..o{ EXTERNAL_IDENTITY_MAPPING : maps_legacy
    FAMILY ||--o{ SERVICE_ENTITLEMENT : receives
    FAMILY ||--o{ BUSINESS_SERVICE_INSTANCE : scopes
    STUDENT ||..o{ BUSINESS_SERVICE_INSTANCE : receives

    USER {
        text user_id PK
        text status
        timestamptz created_at
        timestamptz updated_at
    }
    AUTH_IDENTITY {
        text auth_identity_id PK
        text user_id FK
        text provider
        text provider_subject
        text status
        timestamptz verified_at
    }
    FAMILY {
        text family_id PK
        text display_name
        text status
        timestamptz created_at
        timestamptz updated_at
    }
    FAMILY_MEMBERSHIP {
        text membership_id PK
        text family_id FK
        text user_id FK
        text membership_type
        text status
        timestamptz valid_until
    }
    STUDENT {
        text student_id PK
        text status
        date date_of_birth
        timestamptz created_at
        timestamptz updated_at
    }
    STUDENT_FAMILY_MEMBERSHIP {
        text student_family_id PK
        text student_id FK
        text family_id FK
        bool is_primary
        text status
    }
    GUARDIAN {
        text guardian_id PK
        text user_id FK
        text status
        timestamptz created_at
    }
    GUARDIAN_STUDENT_RELATIONSHIP {
        text relationship_id PK
        text guardian_id FK
        text student_id FK
        text relationship_type
        text authority_status
        timestamptz valid_until
    }
    EXTERNAL_IDENTITY_MAPPING {
        text mapping_id PK
        text entity_type
        text phoenix_core_id
        text source_system
        text source_id
        text status
        timestamptz verified_at
    }
    CONSENT {
        text consent_id PK
        text family_id FK
        text data_subject_type
        text data_subject_id
        text granted_by_user_id FK
        text purpose_code
        text policy_version
        text status
        timestamptz granted_at
        timestamptz withdrawn_at
    }
    CONSENT_EVENT {
        text consent_event_id PK
        text consent_id FK
        text event_type
        text actor_user_id FK
        jsonb evidence
        timestamptz occurred_at
    }
    SERVICE_ENTITLEMENT {
        text entitlement_id PK
        text family_id FK
        text student_id
        text service_code
        text status
        timestamptz valid_until
    }
    BUSINESS_SERVICE_INSTANCE {
        text service_instance_id PK
        text primary_family_id FK
        text student_id FK
        text service_type
        text status
        timestamptz created_at
    }
```

## RBAC and audit

```mermaid
erDiagram
    ROLE ||--o{ ROLE_PERMISSION : grants
    PERMISSION ||--o{ ROLE_PERMISSION : contains
    USER ||--o{ ROLE_ASSIGNMENT : receives
    ROLE ||--o{ ROLE_ASSIGNMENT : assigns
    USER ||..o{ AUDIT_LOG : acts
    FAMILY ||..o{ AUDIT_LOG : scopes

    ROLE {
        text role_code PK
        text description
        text status
    }
    PERMISSION {
        text permission_code PK
        text description
        text risk_level
    }
    ROLE_PERMISSION {
        text role_code PK, FK
        text permission_code PK, FK
    }
    ROLE_ASSIGNMENT {
        text role_assignment_id PK
        text user_id FK
        text role_code FK
        text scope_type
        text scope_id
        text status
        timestamptz valid_until
    }
    AUDIT_LOG {
        text audit_id PK
        text actor_user_id FK
        text action
        text entity_type
        text entity_id
        text family_id FK
        jsonb before_json
        jsonb after_json
        text reason
        timestamptz occurred_at
    }
    USER {
        text user_id PK
    }
    FAMILY {
        text family_id PK
    }
```

## PostgreSQL enforcement notes

- Use explicit checks for ID prefixes and controlled status values.
- Enforce unique provider identity `(provider, provider_subject)`.
- Enforce unique mapping source `(source_system, entity_type, source_id)`.
- Use partial uniqueness for one active primary Student-Family membership if the business rule is approved.
- Protect family-scoped tables with RLS and application policy checks.
- Require one `primary_family_id` on every business service instance; multi-family membership never implies cross-family access.
- Make audit and consent-event deletion unavailable to application roles.
- Keep `HEALTH` only in the shared Compass registry/enum with `RESERVED` status; no Health table appears in this ERD.
