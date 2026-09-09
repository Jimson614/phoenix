# Phoenix Current System Inventory

Status: `AUDITED 2026-09-09 / CURRENT-HOST EVIDENCE`

This inventory records facts that were reproducible on Jimson's Windows host. It does not treat a PR description, stale artifact, or another machine's path as runtime truth. No production deployment, database migration, DNS change, merge, or secret read was performed.

## Canonical repository and worktrees

| Surface | Repository / ref | Exact SHA | Current-host path | Runtime / store | State | Migration truth |
| --- | --- | --- | --- | --- | --- | --- |
| Monorepo main | `yvettfang-netizen/phoenix`, `main` | `846f77c120cd00a49d89635dd4297b020af7d03a` | `D:\phoenix` | Mixed Node/WeChat/Cloudflare projects | `DIRTY`: 117 paths, confined to the actively repaired Education Compass worktree at capture time | Must not be reset or used as a clean release checkout |
| Family Core executable sandbox | local branch `codex/family-core-sandbox-20260909`, parent PR #11 | `fe13955a962284fe6a3a1de11ecb18418f54c875` | `D:\fc\Phoenix Family OS\phoenix-family-os-mvp` | Node 24.18; PostgreSQL 17.11 portable test server | `CLEAN`, locally committed; remote push blocked by missing GitHub HTTPS credential | `0010`, `0020`, `0030`; checksummed ledger; up/down/up verified |
| Family OS current MVP outside sandbox | PR #11 contract baseline | `921f398670b7ba764f2649f5d28462ed4234b849` | same isolated worktree | WeChat mini program; Node backend; legacy browser/WeChat storage and SQLite | Clean at parent ref | SQLite `001_questionnaire_submissions.sql`; no authoritative Core tables |
| Identity Compass | PR #8, `codex/identity-compass-gate2-sprint` | `622f425e1f201e7ac62a2aea920aff240cb1ca73` | Git object/ref; no mutable checkout used | Next.js 16; browser `localStorage`; mock Feishu adapters | Draft PR; runtime tests reported in PR, not rerun in this audit | No server schema or Core migration |
| Education Compass active repair | `main` worktree plus uncommitted repair | base `846f77c120cd00a49d89635dd4297b020af7d03a`; runtime candidate is intentionally owned by the separate task until it commits | `D:\phoenix\Phoenix Compass\education compass` | Node web/API, WeChat package, PostgreSQL-capable backend | `DIRTY`; another Codex task owns it; not touched here | SQL `001`–`005` on main; the separate task reports local/remote test alignment, not production migration |
| Application Compass / Masters intake | PR #9, `codex/masters-intake-p0` | `ebeaa1538eaf8c1476b1c63b6d7e77f6b42c4c44` | `D:\app\Phoenix Compass\education compass` (detached verification worktree) | Node 22+; WeChat; PostgreSQL; private file store | Draft candidate; isolated checkout | Adds `006_masters_intake.sql` and explicit rollback; controlled host/WeChat gate remains external |
| Website V5 release candidate | PR #6, `codex/website-phoenix-v5-digital-east` | `02859e6427de31a4feedac158d23a36cf56625bc` | `D:\web\website\phoenix-nova-website-v5` (detached verification worktree) | Vinext/Vite/Cloudflare Workers; D1 binding declared | Open, non-draft candidate; private-review/noindex baseline | D1-capable; release branch itself is not Phoenix Core authority |
| Website downstream family/auth candidate | PR #13 atop PR #12 | `91608c1a69a029df903066e409b08d894101cea2` | inspected as Git ref only after selecting PR #6 for release verification | Same Website runtime; D1 auth tables | Draft; not the release baseline | Temporary website account/session schema must not become Core identity master |
| Core architecture | PR #5, `codex/core-identity-gates-0-1-delivery` | `38199a3ba38a12db82241e0ac8e4e02a57efc18f` | cherry-picked into Family Core sandbox history | Documentation | Founder-approved Gate 1 design | Design authority only; no original implementation |
| Family contracts | PR #10 → PR #11 | `39452d9cb1c15f96baabb5b887c86ab0afbb97ed` → `921f398670b7ba764f2649f5d28462ed4234b849` | included in `D:\fc` history | Contract docs + 76-test in-memory rehearsal | Draft chain | No real PostgreSQL before this sandbox branch |

## Database and identity collisions

1. Family OS has two local masters: WeChat/browser storage (`PFS_DB_V01`) and backend SQLite. Both create text Users/Families/Students without a cross-system mapping ledger.
2. Identity Compass mints `usr_*` and `fam_*` in browser storage. Prefix similarity does not make them authoritative Core IDs.
3. Education owns domain Student/assessment/report records and its PostgreSQL migrations. These IDs cannot be joined to Core by mutable name, phone, email, school, or demographic data.
4. Website PR #13 adds D1 customer credential/session tables. Those records are authentication candidates, not Family, Member, Guardian, Consent, or Student masters.
5. PR #9 adds Masters tables to the Education database. This is a separate bounded context and must remain isolated from production and from the Family Core sandbox.
6. Existing test/demo accounts can resemble real prefixed IDs. Migration must explicitly exclude them.
7. A contact-hint collision is evidence for manual review, never permission to auto-merge.

## Runtime and infrastructure truth

- Current host: Windows, Node `v24.18.0`, npm `11.16.0`, Git `2.55.0.windows.5`.
- Family Core gate: PostgreSQL `17.11`, loopback-only disposable server; evidence databases were dropped after reconciliation.
- Docker Desktop could not provide an engine because hardware virtualization is unavailable; official portable PostgreSQL binaries were used instead.
- `D:\CODEX` does not exist on this host. No SMB mapping is present, and the provided `V7` host name does not resolve. Therefore V7 migration was not attempted.
- No current-host KAIDE checkout was found. An unverified path from another task is not accepted as authority.
- Education production/server facts are delegated to the already-running repair task. Its evidence must be consumed without modifying this dirty worktree.

## Reproduction anchors

- Family Core command: `npm run family-core:gate`
- Gate evidence: `family-core-gate-evidence.json` plus `FAMILY_CORE_SANDBOX_GATE_EVIDENCE.md`
- Backup digest: `58b529c9c7ad17cc1c8471e33585eb375063f8a0dde3386fd3c46a53f74f6dfe`
- PR dependency evidence: `PHOENIX_PR_DEPENDENCY_MAP.md`
- Environment names only: `ENV_SECRET_INVENTORY.md`; no secret values were collected.

## Audit conclusion

The sole executable Family Core candidate is the clean local sandbox branch at `fe13955a962284fe6a3a1de11ecb18418f54c875`. It is a synthetic PostgreSQL proof, not a production source of truth. Production authority remains blocked until policy, security, operations, and migration gates are approved and the locally committed branch is pushed for review.
