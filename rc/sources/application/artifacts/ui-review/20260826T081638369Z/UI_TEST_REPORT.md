# Phoenix Education Compass UI Test Report

## Result

- Overall local status: **LOCAL_HTTP_MOCK_VERIFIED**
- Automated UI/API contracts: **PASS**
- WeChat DevTools and real devices: **BLOCKED_MANUAL**
- Dedicated PostgreSQL integration: **BLOCKED_EXTERNAL** (not attempted)
- Migration: **none**; signed freeze, existing migrations and package lockfiles are unchanged.
- Real WeChat Pay/OpenAI/Feishu/Askwise calls: **not performed**.

## Seven-screen route map

1. Free home — `pages/compass/index?level=1&studentId=…`
2. Free questionnaire — `pages/compass-questionnaire/index?level=1&assessmentId=…`
3. Free result — `pages/compass-preview/index?mode=family-snapshot&assessmentId=…`
4. Level 2 home — `pages/compass/index?level=2&studentId=…&sourceAssessmentId=…` (server-authorized only)
5. Level 2 questionnaire — `pages/compass-questionnaire/index?level=2&assessmentId=…`
6. Delivered report — `pages/report/index?id=reportId` (FULL/READY + entitlement gates)
7. Next support — report bottom region plus `pages/advisor-request/index` for independent advisor Consent.

## Reference-to-product corrections

- Free is 8 required questions and 3–5 minutes, not 4 questions/15 seconds.
- Level 2 uses resolved-bank dynamic counts and 15–20 minutes, not a fixed 40 questions.
- Price is returned by the catalog as 3990 fen/CNY and formatted as ¥39.90; no release page hard-codes the display price.
- Payment remains AFTER_SUBMIT_BEFORE_REPORT; starting Level 2 never creates an order or calls requestPayment.
- Four evidence-status cards replace the five-axis ability radar; scoring remains NONE.
- The flow is Family/Student/Assessment linked and is not described as anonymous.
- Askwise remains RESERVED/BLOCKED/DISABLED with no action or network call.
- Level 3 exposes information/advisor intent only, with no ¥980 price, SKU, order or auto-appointment.
- Native sharing targets only the generic welcome route and carries no IDs, names or result summary.

## Required commands

| Command | Exit | Status | Duration ms |
|---|---:|---|---:|
| npm.cmd run validate | 0 | PASS | 1643 |
| npm.cmd run test:ui-contract | 0 | PASS | 890 |
| npm.cmd run test:client | 0 | PASS | 2251 |
| npm.cmd run typecheck:server | 0 | PASS | 4342 |
| npm.cmd run test:server | 0 | PASS | 8009 |
| npm.cmd run test:education-contracts | 0 | PASS | 6190 |
| npm.cmd run test:education-http | 0 | PASS | 8497 |
| npm.cmd run validate:education-docs | 0 | PASS | 6406 |
| npm.cmd run test:all | 0 | PASS | 14773 |
| npm.cmd run smoke:education | 0 | PASS | 5443 |
| npm.cmd run build:release | 0 | PASS | 934 |
| npm.cmd run scan:release-secrets | 0 | PASS | 978 |

## Manual completion required

Open the source project in WeChat DevTools, clear Console, compile, and capture all seven normal states plus loading/error/disabled/conflict/payment-state fixtures at 320/360/375/390/430 widths. Repeat safe-area and payment-cancel checks on iOS and Android. Add only actual simulator/device screenshots to `screenshots/`; design-reference crops do not count.
