# Family Timeline Event Contract V1

Status: `DESIGN PREPARATION / APPEND-ONLY EVIDENCE`

## Purpose

Family Timeline is the longitudinal presentation layer for meaningful family events. It is not the Phoenix audit ledger, not a CRM activity dump, and not a place to copy raw assessment answers or sensitive documents.

## Event envelope

```text
contract_version = FAMILY_TIMELINE_EVENT_V1
event_id
event_type
occurred_at
recorded_at
primary_family_id
subject_type
subject_id
actor_user_id
source_service
source_record_type
source_record_id
source_version
visibility
title
summary
action_ref (nullable)
supersedes_event_id (nullable)
audit_ref
metadata
```

## Initial event registry

| Event type | Producer | Minimum consent/policy condition |
|---|---|---|
| `FAMILY_PROFILE_CREATED` | Family OS | authorised family membership |
| `STUDENT_PROFILE_CREATED` | Family OS | verified family/subject relationship |
| `COMPASS_ASSESSMENT_COMPLETED` | Compass handoff | assessment and longitudinal-record purposes |
| `COMPASS_REPORT_AVAILABLE` | Compass handoff | report-delivery authority |
| `JOURNEY_ACTION_DUE` | Family OS journey | authorised journey and date source |
| `ADVISOR_FOLLOW_UP_REQUESTED` | Family OS | exact advisor-follow-up purpose |
| `ADVISOR_CASE_STATUS_CHANGED` | Advisor service | active assignment and family-scoped permission |
| `PARTNER_EXPERIENCE_REQUESTED` | Family OS | separate approved purpose; legacy boolean is insufficient |
| `CONSENT_STATUS_CHANGED` | Phoenix Core | restricted, minimised presentation only |

Future domain events require registry review; they are not accepted as arbitrary strings. `HEALTH_*` events are prohibited until a separate Health gate is authorised.

## Visibility

- `FAMILY`: visible to authorised family members under product rules.
- `SUBJECT`: visible only to the authorised subject and qualifying guardian views.
- `ADVISOR_SHARED`: visible to family and an actively assigned advisor.
- `INTERNAL_RESTRICTED`: operational reference only; not shown to family users.

Visibility is a presentation hint. Server-side RBAC, family assignment, consent, and RLS remain authoritative.

## Data minimisation

Allowed timeline content is short, human-readable continuity information. The following must remain outside the timeline payload:

- raw Compass answers;
- passport, HKID, bank, medical, or school-document numbers/binaries;
- full advisor notes;
- authentication tokens, provider subjects, or mapping details;
- internal prompts, agent identities, operations status, or NOVA DIGITAL records;
- approval probabilities, guaranteed outcomes, investment returns, or diagnostic claims.

## Immutability and correction

Accepted events are append-only. A correction creates a new event with `supersedes_event_id`; consumers hide or annotate the older presentation while audit evidence remains intact. Deletion/retention policy is controlled separately and cannot be simulated by mutating audit history.

## Idempotency

The unique logical key is `(source_service, source_record_type, source_record_id, event_type, source_version)`. Exact replay returns the original `event_id`. A changed payload using the same logical key is rejected and reviewed.

