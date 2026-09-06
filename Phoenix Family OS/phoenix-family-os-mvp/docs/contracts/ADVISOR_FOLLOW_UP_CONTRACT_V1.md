# Advisor Follow-up Contract V1

Status: `DESIGN PREPARATION / NO CRM OR PRODUCTION WRITEBACK`

## Separation of records

Family OS distinguishes:

- `AdvisorRequest`: a family-initiated request for contact.
- `AdvisorCase`: an operational record created only after an authorised assignment.
- `AdvisorNote`: restricted professional/operational content, never copied wholesale into Family Timeline.
- `TimelineEvent`: a minimised family-facing status event.

The legacy local `advisorRequests` and `advisorNotes` remain demo records. They are not evidence of production consent, assignment, or Core identity.

## Advisor request

```text
contract_version = ADVISOR_FOLLOW_UP_V1
advisor_request_id
request_id
created_at
primary_family_id
requested_by_user_id
subject_type
subject_id
topic_code
preferred_contact_window
preferred_channel
contact_reference
consent_id
source_service
source_record_id (nullable)
status
audit_context
```

Allowed request status:

- `REQUESTED`
- `WITHDRAWN`
- `EXPIRED`
- `ACCEPTED_FOR_TRIAGE`
- `CLOSED_NO_ACTION`

`contact_reference` is an opaque Core/customer-contact reference. Phone numbers, emails, and WeChat identifiers are not copied into this contract when an authorised reference is available.

## Advisor case

```text
advisor_case_id
advisor_request_id
primary_family_id
subject_type
subject_id
assigned_advisor_user_id
role_assignment_id
assignment_valid_from
assignment_valid_until
case_status
service_level_due_at
created_at
updated_at
audit_context
```

Allowed case status:

- `TRIAGE`
- `ASSIGNED`
- `CONTACT_SCHEDULED`
- `IN_PROGRESS`
- `WAITING_FOR_FAMILY`
- `COMPLETED`
- `CANCELLED`

Case status is operational state, not a statement that a Compass outcome or external application has been approved.

## Required checks

1. Validate Family Context V1.
2. Require active `ADVISOR_FOLLOW_UP` consent for the exact subject and family.
3. Require the family member to have permission to request follow-up for that subject.
4. Create a case only after an active, scoped Advisor role assignment exists.
5. Restrict advisor reads/writes to assigned families, subjects, purposes, and validity windows.
6. Append audit evidence for request, withdrawal, assignment, status change, privileged read, note creation, and closure.
7. Publish only minimised status events to Family Timeline.

Assessment consent alone does not authorise advisor contact. Marketing consent is separate and must never be inferred.

## Advisor note boundary

```text
advisor_note_id
advisor_case_id
primary_family_id
author_user_id
note_type
content_ref
created_at
supersedes_note_id (nullable)
audit_ref
```

The contract stores a protected `content_ref` rather than embedding note content in timeline or handoff payloads. Access is family- and assignment-scoped, audited, and denied after assignment expiry except for separately authorised retention/review duties.

## Explicit exclusions

- No CRM, Feishu, Notion, email, SMS, or WeChat external writeback.
- No production contact details or real-family records.
- No automatic advisor assignment based only on a Compass score.
- No sale, product recommendation, legal conclusion, admission guarantee, approval probability, or promise of return.

