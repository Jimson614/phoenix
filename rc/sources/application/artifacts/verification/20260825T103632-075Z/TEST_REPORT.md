# Phoenix Education Compass V0.5.0 — Local Verification Evidence

- Generated at (UTC): `2026-08-25T10:36:32.076Z`
- Verification status: `LOCAL_LEVEL1_LEVEL2_VERIFICATION_FAILED`
- Scope: Level 1 and Level 2 local implementation only
- Mode: local process + in-memory HTTP mock; no external service calls
- Release candidate: `NO`

## Integrity bindings

- Freeze SHA-256: `9884503DA89A61F1DFC78FF97F429FDE210D240B30764D099105DD7C8A100B2D`
- Migration aggregate SHA-256: `DBDCDDA40BB8995BC65CED72A6F7D867F55ED1F270AE5C3F437DB238DDDA703D`
- Source before SHA-256: `07E17215A716DCFBDFD7F83474BA96B36DC50EFA2607C14F0CF2201EF91B229F`
- Source after SHA-256: `07E17215A716DCFBDFD7F83474BA96B36DC50EFA2607C14F0CF2201EF91B229F`
- Source changed during verification: `false`

## Executed commands

| Command ID | Result | Exit code | Duration (ms) |
|---|---:|---:|---:|
| release-secret-scan | PASS | 0 | 136 |
| server-build | PASS | 0 | 3562 |
| server-typecheck | PASS | 0 | 3311 |
| client-tests | PASS | 0 | 2259 |
| server-tests | FAIL | 1 | 5479 |
| openapi-and-examples | PASS | 0 | 112 |
| education-http-smoke | PASS | 0 | 370 |
| education-postgres | BLOCKED_EXTERNAL | 0 | 76 |

## Verified local path

The HTTP smoke test covers health, profile creation, Level 1 create/save/submit/result, Level 2 create/save/submit/locked zero-leak result, mock payment authority, and unlocked Level 2 result. A `PASS` here is evidence only for this isolated local run.

## Explicitly not verified

- PostgreSQL migration/schema: `BLOCKED_EXTERNAL` — EDUCATION_TEST_DATABASE_URL is not configured; no database connection was attempted
- Real WeChat Pay: `BLOCKED_EXTERNAL`
- Real OpenAI Agent request: `BLOCKED_EXTERNAL`
- Real Feishu Bitable write: `BLOCKED_EXTERNAL`
- WeChat DevTools manual UX check: `BLOCKED_MANUAL`
- Production deployment or release approval: `NOT_REQUESTED`

This directory is a redacted local evidence package, not a deployable or verified/candidate ZIP.
