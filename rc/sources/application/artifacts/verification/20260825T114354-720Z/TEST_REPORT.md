# Phoenix Education Compass V0.5.0 — Local Verification Evidence

- Generated at (UTC): `2026-08-25T11:43:54.721Z`
- Verification status: `LOCAL_LEVEL1_LEVEL2_HTTP_MOCK_VERIFIED`
- Scope: Level 1 and Level 2 local implementation only
- Mode: local process + in-memory HTTP mock; no external service calls
- Release candidate: `NO`

## Integrity bindings

- Freeze SHA-256: `9884503DA89A61F1DFC78FF97F429FDE210D240B30764D099105DD7C8A100B2D`
- Migration aggregate SHA-256: `FDC9381640103998DF9415EAFD4BEFA6EA0B6BFA7D9FCED0776AAD7818855846`
- Source before SHA-256: `D6681C7B38929A87CF5DF9BBDD3EBB28C138953459F2846E76F02E9AA323B038`
- Source after SHA-256: `D6681C7B38929A87CF5DF9BBDD3EBB28C138953459F2846E76F02E9AA323B038`
- Source changed during verification: `false`

## Executed commands

| Command ID | Result | Exit code | Duration (ms) |
|---|---:|---:|---:|
| release-secret-scan | PASS | 0 | 141 |
| server-build | PASS | 0 | 4375 |
| server-typecheck | PASS | 0 | 3434 |
| client-tests | PASS | 0 | 1858 |
| server-tests | PASS | 0 | 5728 |
| openapi-and-examples | PASS | 0 | 107 |
| education-http-smoke | PASS | 0 | 378 |
| education-postgres | BLOCKED_EXTERNAL | 0 | 66 |

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
