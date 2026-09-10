# Family Core Policy V1 Traceability

Status: `14/14 EXECUTABLE REFERENCE DENY PATHS / PRODUCTION HOLD`

This matrix distinguishes three evidence levels:

- `DB_RUNTIME_DENY`: exercised against the disposable PostgreSQL 17 sandbox.
- `REFERENCE_DENY`: exercised by the Node policy gate but not wired into a production request path.
- `PARAMETER_PENDING`: an accountable Legal/Privacy/Product/Security owner must supply the recorded parameter before staging or production.

Passing the reference gate is not proof of production integration. No database migration is introduced by this policy freeze.

| Policy ID | Executable denial evidence | Existing runtime evidence | Remaining implementation/owner gate |
| --- | --- | --- | --- |
| `GUA-001` | Self-attestation and missing approved evidence/reviewer are denied. | Active Guardian relationship is required for minor access. | Evidence allowlist, review-case workflow and reviewer authority are `PARAMETER_PENDING`. |
| `GUA-002` | Disputed high-risk action without all rules and second review is suspended. | Relationships are independently stored; withdrawal immediately removes access. | Precedence, dispute and dual-review workflow are `PARAMETER_PENDING`. |
| `CON-001` | Missing purpose-specific matching receipt is denied. | PostgreSQL checks active receipt, family, subject and purpose; receipts record version, locale and actor. | Destination/version compatibility and approved purpose catalog need service integration and Legal/Product ownership. |
| `CON-002` | Unknown jurisdiction/age denies elevated processing. | No production capacity resolver exists. | Jurisdiction table, thresholds and exceptions are `PARAMETER_PENDING`; current safety is reference denial only. |
| `CON-003` | Withdrawn or stale consent is denied. | Withdrawal is append-only and removes Journey visibility; subsequent adapter write fails. | Consumer revocation delivery/retry and deletion rules remain unimplemented. |
| `RET-001` | Real-data retention is held; only non-personal synthetic evidence is allowed. | Sandbox fixtures are deterministic and synthetic. | Entire real-data schedule and deletion/backup jobs are `PARAMETER_PENDING`. |
| `ENT-001` | Stale entitlement is denied. | Core-ledger active status and effective interval gate adapter writes. | Billing event authentication and reconciliation policy remain pending. |
| `ENT-002` | Mismatched/ambiguous family context is denied. | Forced RLS and server context checks prevent cross-family reads and forged writes. | Invitation/leave/primary-context UX remains pending. |
| `OPS-001` | Missing explicit assignment is denied. | Family-scoped role assignments include status and validity intervals. | Operator identity, consent, role catalog and maximum duration remain pending. |
| `BRK-001` | Every break-glass request is denied. | No break-glass function, route or entitlement exists in the sandbox. | Separate Founder/Security design, approval and test are mandatory before enablement. |
| `ID-001` | Weak-signal automatic merge is quarantined. | Test accounts and ambiguous matching are denied; reviewed Auth UUID mapping is preserved. | Evidence threshold, two-reviewer workflow, appeal and reversible split tooling remain pending. |
| `XDS-001` | An unlisted field is denied; one minimum synthetic Education shape is accepted by the reference gate. | Synthetic Education adapter requires mapping, context, Guardian, consent, RBAC, entitlement, idempotency and audit. | Authenticated service boundary, purpose catalog and consumers beyond Education remain pending. |
| `XDS-002` | Every Health request is denied. | Health is absent from schema enums, contract enums and the synthetic adapter. | PR #12/#13 remain Draft/HOLD; separate written scope and release GO required. |
| `DSR-001` | Export is held while Legal parameters are pending. | No export route exists in the sandbox. | Requester, scope, delivery, SLA, retention and audit workflow are all pending. |

## Reproduction

From `Phoenix Family OS/phoenix-family-os-mvp`:

```powershell
npm run family-core:policy
```

Expected summary:

```text
FAMILY_CORE_POLICY_GATE=PASS
POLICY_DENY_PATH_COVERAGE=14/14
POLICY_ASSERTIONS=18/18
```

`npm run family-core:gate` runs this policy gate first and then the PostgreSQL synthetic gate. Any failure stops the combined gate.
