# Policy Gaps for Founder

Status: `POLICY HOLD / NO DEFAULTS INVENTED`

The sandbox implements denial-first mechanics and test-only status values. It does not choose business or legal policy.

| Policy question | Technical options | Default risk if Jimson/Codex guesses | Founder decision required | Blocks |
| --- | --- | --- | --- | --- |
| Who may establish Guardian authority? | verified legal-document review; verified existing account plus manual operator approval; external authority provider | unauthorized adult gains access to a minor | permitted evidence, approver role, review cadence, dispute flow | real minor onboarding, sharing, consent |
| Shared custody / multiple Guardians | all active Guardians can act; purpose-specific Guardian; unanimous/high-risk actions | one Guardian may overrule another or lock access incorrectly | authority precedence, conflicts, emergency/suspension rules | multi-guardian production model |
| Consent purposes and versions | separate purpose codes per scoring, longitudinal history, sharing, AI processing; bundled consent | bundled consent may be invalid or too broad | exact purposes, legal copy owner, versioning, locale, re-consent triggers | production consent API and UI |
| Age and capacity rules | jurisdiction-specific age table; manual exception; conservative minor treatment | incorrect capacity classification | jurisdiction owner, age thresholds, emancipation/exception handling | adult/minor transitions |
| Withdrawal consequences | immediate future denial with retained audit; delete/anonymize eligible content; suspend pending review | either illegal retention or destroyed audit/business evidence | which records remain, deletion SLA, derived-data treatment, notifications | erasure workflow and retention jobs |
| Retention periods | per data class and status; single platform period; legal hold override | over-retention or premature deletion | periods for identity, assessment, attachments, consent/audit, backups; legal hold authority | TTLs, backup lifecycle, privacy notices |
| Entitlement source | Core ledger; billing/contract adapter; operator grant | stale or duplicated access | authority, effective dates, grace/refund/suspension rules, reconciliation owner | paid service access |
| Family membership and multi-family users | explicit memberships with one selected context; fixed primary family; case-by-case operator assignment | accidental cross-family disclosure | switch rules, primary-family semantics, invitation/leave rules | production RLS claims and UI |
| Advisor/operator access | explicit time-bound assignment; family consent plus assignment; support break-glass | staff can over-read family data | roles, approval, duration, reason, audit and review | staff portal access |
| Break-glass administration | disabled; two-person approval; on-call role with post-review | either no recovery path or silent superuser access | eligible actors, MFA, duration, alerting, review SLA | incident operations |
| Identity conflict resolution | operator review with evidence; user-assisted verified login; no merge, link aliases | false merge causes irreversible privacy breach | approver, evidence threshold, undo/split procedure | legacy migration |
| Cross-domain data sharing | explicit per-domain consent; Core-provided minimal context; central aggregation | purpose creep and excessive exposure | allowed fields and purposes for Education/Identity/Wealth; Health remains reserved | adapter productionization |
| Data subject access/export | family-level export; subject-level export; controlled operator package | incomplete or cross-family export | eligible requester, scope, identity proof, delivery method and SLA | privacy operations |

Until each row is approved, production code must keep the relevant path denied or `POLICY_HOLD`. The synthetic fixtures and tests are not policy precedent.
