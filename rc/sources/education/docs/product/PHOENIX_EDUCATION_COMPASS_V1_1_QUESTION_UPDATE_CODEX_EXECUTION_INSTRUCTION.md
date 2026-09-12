# Phoenix Education Compass V1.1 Question Update — Codex Execution Instruction

## 1. Authorization and intent

- Execution authorization: current Founder/Codex session, 2026-08-27.
- Scope: update the Free Parent Education Compass and ¥39.90 Student Growth Discovery question wording, question presentation, front-end display, and back-end questionnaire contract.
- This is an incremental V1.1 update. Do not rewrite the Family OS, payment flow, AI flow, Feishu integration, or the existing UI system.

## 2. Conservative product decisions applied by this instruction

The Founder Review Draft is used as the content baseline. Where it conflicts with the previously signed V1 product boundaries, preserve the approved boundary:

- Level 2 is completed only by the student; a guardian may explain or operate the device but must not choose answers.
- Do not collect budget, income, assets, exact scores, identity numbers, or other unnecessary sensitive information.
- Keep EGD19 as an optional education-pathway context field.
- Keep GAOKAO, DSE, IGCSE, A_LEVEL, and AP_US as formal system routes.
- Keep IB and OTHER as public-question fallback routes only.
- Keep the ¥39.90 amount, payment after submission/before full report, no numeric scoring, and the six-module report boundary unchanged.

## 3. V1.1 content update

1. Preserve all existing question IDs, answer keys, answer codes, required/optional status, result logic, and system-route semantics unless specifically changed below.
2. Create a V1.1 immutable question-update overlay. It must reference the V1.0 raw question-bank SHA-256 and be loaded only after that base file has passed integrity verification.
3. Update parent-facing wording for FP02–FP08 to be clearer and more aligned with the Founder Review Draft.
4. Update student-facing wording for EGD01–EGD19 without changing their data model. In particular, EGD07 retains code `MIXED` but its label explicitly covers a middle/variable current performance view.
5. Add display-only presentation metadata for each level: product title, eyebrow, purpose, respondent reminder, completion outcome, and action hint. It must not enter scoring or change `schemaDigest` by itself.

## 4. Back-end implementation requirements

1. Keep V1.0 freeze artifacts unchanged and auditable.
2. Add `docs/product/freeze/education-compass-v1.1/QUESTION_BANK_UPDATE_V1_1.json` with:
   - source version and base SHA-256;
   - V1.1 questionnaire versions;
   - an allowlisted set of question-label and option-label overrides;
   - no changes to IDs, answer codes, answer-key names, required flags, system routes, scoring, or privacy rules.
3. Change `server/src/domain/education-compass/registry.ts` to:
   - verify both V1.0 base and V1.1 overlay raw bytes;
   - reject an unexpected base version/hash or an unallowlisted update shape;
   - apply the overlay deterministically before question-bank parsing;
   - expose V1.1 source integrity to the status/test surfaces.
4. Update contracts and service version constants to V1.1 and keep historic V1.0 assessments readable.
5. Update OpenAPI/contract tests for the new version, checksums, label updates, stable answer codes, the student-only gate, no-budget boundary, EGD19, and IB/OTHER fallback.

## 5. Front-end implementation requirements

1. Preserve server-driven question rendering; do not create a second hard-coded bank in the Mini Program.
2. Normalize new presentation metadata with safe V1.0-compatible fallbacks.
3. Surface level-specific title, purpose, respondent rule, time range, and completion outcome in the questionnaire UI.
4. Keep the existing route sequence: Free Parent Compass → Family Education Snapshot → eligible Student Growth Discovery → ¥39.90 payment → full report.
5. Clearly display that the ¥39.90 product is a growth discovery, not a complete admission-planning or outcome-guarantee service.
6. Maintain mobile layout and existing visual design tokens.

## 6. Required verification

Run and pass:

```powershell
npm.cmd run test:education-contracts
npm.cmd run test:education-http
npm.cmd run test:education-integrations
npm.cmd run test:client
npm.cmd run typecheck:server
npm.cmd run build:release
```

Also verify the following explicitly:

- V1.0 source hash remains unchanged.
- V1.1 overlay hash is verified at runtime.
- A V1.0 draft is still served from its pinned V1.0 bank, while a newly created assessment is served from V1.1.
- No answer code, payment price, respondent restriction, privacy boundary, or fallback routing is accidentally widened.
- The Mini Program renders the new display metadata from the API.

## 7. Deliverables

- V1.1 question-update overlay and integrity checks.
- Updated server questionnaire contract and API documentation.
- Updated native Mini Program question UI and client contract handling.
- Updated automated tests and a verification summary.
