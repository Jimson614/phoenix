# Compass → Family OS Handoff Contract V1

Status: `DESIGN PREPARATION / SYNTHETIC VALIDATION ONLY`

## Scope

This contract defines one shared Family OS ingestion boundary for `EDUCATION`, `IDENTITY`, and `WEALTH`. It does not standardise their business questions or scoring rules. `HEALTH` is reserved and rejected by the V1 ingest path.

## Handoff envelope

```text
contract_version = COMPASS_FAMILY_OS_HANDOFF_V1
handoff_id
idempotency_key
request_id
source_service
source_version
compass_type
assessment_id
assessment_status
assessment_created_at
completed_at
question_bank_version
rule_version
result_schema_version
evidence_registry_version (nullable only for a domain with no evidence registry)
primary_family_id
actor_user_id
subject_type
subject_id
guardian_id (nullable)
consent_id
entitlement_id (nullable)
result_payload_hash
result_summary
journey_seed
timeline_candidates[]
human_review
audit_context
```

## Shared enums

`compass_type`:

- `EDUCATION`
- `IDENTITY`
- `WEALTH`
- `HEALTH` (`RESERVED`; ingestion denied)

`assessment_status`:

- `COMPLETED`
- `PARTIAL`
- `INVALIDATED`
- `SUPERSEDED`

`human_review`:

```text
required
reason_codes[]
review_scope[]
blocking_unknowns[]
```

## Payload boundary

`result_summary` contains only the minimum information Family OS needs to present continuity and next actions:

```text
headline
readiness
themes[]
gaps[]
risk_flags[]
next_actions[]
report_locator
explanation_disclaimer
```

Raw answers, identity documents, bank records, full generated reports, and unrestricted evidence binaries are not embedded in the handoff. `report_locator` is an opaque authorised reference, not a public URL.

`journey_seed` contains planning state only:

```text
journey_type
journey_status
current_state
recommended_path (nullable)
alternative_paths[]
important_dates[]
required_evidence[]
risk_flags[]
next_actions[]
source_assessment_id
```

For Identity, the seed preserves PR #8 semantics: it is planning state, not an immigration decision, legal advice, guaranteed approval, or approval probability. For Wealth, it must not become a product recommendation or promise of return. For Education, it must not become an admission guarantee.

## Version and provenance rules

- `question_bank_version`, `rule_version`, and `result_schema_version` are immutable for the handoff.
- A source may not label draft or unverified rules as loaded/current.
- Family OS stores version references and the result hash; it does not reinterpret a Compass score.
- A corrected result creates a new handoff with a supersession link in audit evidence. It does not mutate prior evidence in place.
- Missing source provenance or an unknown contract version fails closed.

## Idempotency

The producer creates a stable `handoff_id` and `idempotency_key` for one logical completed result. Family OS accepts an exact replay and returns the original receipt. Reuse with a different `result_payload_hash`, family, subject, or assessment returns `IDEMPOTENCY_CONFLICT` and appends a security/audit event.

## Receipt

```text
status = ACCEPTED | DUPLICATE | REJECTED
handoff_id
family_os_receipt_id
accepted_at
timeline_event_ids[]
journey_id (nullable)
reason_codes[]
```

An `ACCEPTED` receipt is storage evidence only. It is not Founder approval, professional advice, or proof that a production release is safe.

## Required checks

- Validate the Family Context V1 envelope.
- Require an active consent for `ASSESSMENT_SCORING` and any separately requested longitudinal storage or advisor follow-up purpose.
- Verify family/subject consistency and source mapping.
- Verify source versions and result hash.
- Reject `HEALTH` and unknown Compass types.
- Deny timeline or advisor side effects that lack their own purpose, permission, or assignment checks.
- Append metadata-only audit evidence; never log raw answers or sensitive documents.

## Failure codes

- All Family Context V1 reason codes
- `UNSUPPORTED_COMPASS_TYPE`
- `SOURCE_VERSION_UNKNOWN`
- `QUESTION_BANK_VERSION_UNKNOWN`
- `RULE_VERSION_UNKNOWN`
- `RESULT_SCHEMA_VERSION_UNKNOWN`
- `PROVENANCE_INCOMPLETE`
- `RESULT_HASH_MISMATCH`
- `IDEMPOTENCY_CONFLICT`
- `HANDOFF_PAYLOAD_TOO_BROAD`
- `HUMAN_REVIEW_REQUIRED`

