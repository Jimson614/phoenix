# Phoenix Consent Model V1 (Proposed)

Status: `FOUNDER-APPROVED — GATE 1 DESIGN`

## Boundary

Phoenix Core owns consent evidence and withdrawal state. A Compass or service may request consent for a domain purpose, but it must reference the Core consent record and may not maintain a competing authoritative ledger.

Consent, verified Family Assignment, RBAC enforcement, PostgreSQL Row Level Security, and append-only Audit Log are mandatory gates before any real family is onboarded.

## Consent record

Proposed `core.consents` fields:

| Field | Meaning |
|---|---|
| `consent_id` | Immutable Core consent identifier |
| `family_id` | Tenant/privacy boundary |
| `data_subject_type` / `data_subject_id` | Whose data: User, Guardian, or Student |
| `granted_by_user_id` | Authenticated actor who performed the action |
| `granted_by_guardian_id` | Guardian authority where the subject is a minor |
| `purpose_code` | Specific approved use; no bundled blanket purpose |
| `policy_version` | Exact privacy/consent text version |
| `locale` | Language presented |
| `channel` | Web, Mini Program, operator-assisted, API, or migration evidence |
| `status` | `GRANTED`, `WITHDRAWN`, `EXPIRED`, `REJECTED` |
| `granted_at` | Server timestamp of grant |
| `effective_from` / `expires_at` | Validity window |
| `withdrawn_at` / `withdrawn_by_user_id` | Withdrawal evidence |
| `withdrawal_reason` | Optional controlled/free-text reason |
| `evidence_hash` | Hash of the rendered consent/evidence payload |
| `created_at` / `updated_at` | Record timestamps |

Every grant, rejection, expiry, and withdrawal also appends a `core.consent_events` row and an `audit.audit_logs` event. A withdrawal changes future permission; it does not erase prior evidence or historical processing records that must legally be retained.

## Required checks

Before processing:

1. Resolve the Core subject and family.
2. Verify the actor has authority over the subject at the time of consent.
3. Match an active consent by exact `purpose_code` and `policy_version`.
4. Reject an expired or withdrawn record.
5. Record the resulting consent reference on the assessment, referral, report delivery, or data-sharing action.

For a minor, `granted_by_guardian_id` and a valid guardian-to-student relationship are mandatory unless an approved policy explicitly permits otherwise.

## Initial purpose codes

- `ASSESSMENT_SCORING`
- `LONGITUDINAL_GROWTH_RECORD`
- `ADVISOR_FOLLOW_UP`
- `ACADEMY_SERVICE_DELIVERY`
- `ASKWISE_LEARNING_ANALYTICS`
- `PRODUCT_ANALYTICS`
- `MARKETING_COMMUNICATION`
- `CROSS_SYSTEM_DATA_SHARING`

Purposes default to denied. Marketing and cross-system sharing must never be implied by assessment scoring consent.

## Legacy evidence

- Family OS `partnerApplications.privacy_consent` is a boolean without versioned evidence and is therefore insufficient as a Core consent record.
- Wealth Compass `ConsentRecord` is a useful draft but uses pseudonymous buckets rather than authoritative Core subjects.
- Existing stores are preserved and imported as legacy evidence only after review; no boolean is silently upgraded to full consent.

## Isolation and minimization

Consent lookup is always family-scoped. Evidence metadata stores hashes rather than raw IP or user-agent where possible. Health is not an active purpose/domain in this Gate; no health consent or health data table is created.
