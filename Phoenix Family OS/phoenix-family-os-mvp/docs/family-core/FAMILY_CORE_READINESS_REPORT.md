# Family Core Readiness Report

Status: `SANDBOX GATE PASS / PRODUCTION HOLD`

## Baseline

- Repository: `https://github.com/yvettfang-netizen/phoenix.git`
- Local branch: `codex/family-core-sandbox-20260909`
- Tested exact SHA: `fe13955a962284fe6a3a1de11ecb18418f54c875`
- Parent: PR #11 `921f398670b7ba764f2649f5d28462ed4234b849`
- Design inputs: PR #5 `38199a3ba38a12db82241e0ac8e4e02a57efc18f`, PR #10 `39452d9cb1c15f96baabb5b887c86ab0afbb97ed`
- Engine: PostgreSQL `17.11`, disposable loopback-only test instance
- Data class: deterministic synthetic fixtures only
- Remote state: local commits exist; push failed because this host has no usable GitHub HTTPS credential

## Gate result

| Capability | Result | Reproducible evidence |
| --- | --- | --- |
| Empty database rebuild | PASS | 3 ordered migrations; 3 checksummed ledger rows |
| Rollback and reapply | PASS | 3 reverse migrations; Core/domain schemas removed; clean up reapply returns 3 |
| Two fictional families | PASS | 2 Families, 2 adult Members, 2 minor Members |
| Account subject rule | PASS | every User maps to an adult Member; non-adult account path rejected |
| Tenant isolation | PASS | PostgreSQL forced RLS returns one family result per context |
| Negative tampering | PASS | cross-family context returns zero; forged `family_id` and member mapping rejected |
| Guardian withdrawal | PASS | minor result visibility changes from 1 to 0 immediately |
| Consent withdrawal | PASS | journey visibility changes from 1 to 0; subsequent adapter write rejected |
| Identity migration safety | PASS | Auth UUID preserved; test account denied; ambiguous contact collision not merged |
| Education adapter | PASS | A/B accepted; exact replay duplicate; changed replay conflict; two trace chains |
| Append-only evidence | PASS | mutation attempts on Consent event and Timeline fail |
| Backup/restore reconciliation | PASS | PostgreSQL custom dump; 24 table row-count/checksum pairs identical |
| Existing Family OS regression | PASS | existing tests, build and typecheck passed before gate capture |
| PR #11 contract rehearsal | PASS | 76 tests passed; branch parent retained |

Total executable sandbox assertions: `35/35 PASS`.

Migration SHA-256 values:

- `0010_core_identity_family.up.sql`: `0c45c59fe404ddc7ad46f097c8a63f7e1944ee9016103e26b8461de4bab45cd2`
- `0020_core_authority_mapping_audit.up.sql`: `e67363dcd785025c4a46bc6dbb666fb183757731a6f039aef7fc31488ab49bc4`
- `0030_family_domain_rls_adapter.up.sql`: `ee032871e20a2d8fde993cd2d86eceacdf3f3c096a6d4fe0da1c7230d8b34357`

Backup archive SHA-256: `58b529c9c7ad17cc1c8471e33585eb375063f8a0dde3386fd3c46a53f74f6dfe`.

## Readiness decision

The candidate is ready for code review and repeatable synthetic CI. It is not ready for production, a real-family pilot, or data migration.

Production blockers:

1. Founder must resolve the policy holds in `POLICY_GAPS_FOR_FOUNDER.md`.
2. Security/privacy review, threat model, service-to-service authentication, managed-secret injection, least-privilege runtime roles, connection pooling, monitoring, and incident/restore procedures are not approved.
3. Existing local and product-specific identities require a checksummed inventory, explicit source owner, conflict queue, dry run, human approval, and rollback plan.
4. No production RDS endpoint, schema, real record, or credential was touched.
5. The local commits must be pushed and reviewed before they can be a shared source of truth.

## Safe next gate

1. Push the local branch without rewriting commits.
2. Open a Draft PR targeting the PR #11 contract branch or a Founder-approved integration base.
3. Run the supplied PostgreSQL 17 workflow and compare the machine-readable evidence.
4. Review policy holds; encode only approved outcomes in a new migration.
5. Perform a no-data service security review before any integration with Education, Identity, Website, or Family OS runtimes.
