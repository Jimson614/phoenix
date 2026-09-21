# Jimson Friday Engineering Handoff Pack

编制时间：2026-09-10（Asia/Shanghai；第二轮复核）  
覆盖任务：2026-09-09–09-11 Friday Must-Finish、2026-09-10 周四任务、2026-09-11 周五任务。  
总 Gate：`NO PRODUCTION GO`；Family Core V1 policy 已获 Founder 批准，sandbox 可进入 policy implementation/review，但 controlled staging 仍需独立 Gate。

## Executive summary

- Family Core：Founder Policy V1 已机器化冻结；policy 18/18、14/14 policy-ID deny-path coverage 与 PostgreSQL 17.11 沙箱 35/35 在 exact-head GitHub CI 全部 PASS。
- Application Compass PR #9：修复 Windows release 包体不确定性后，工程 Gate 与 TLS PostgreSQL HTTP 流程通过；外部微信 UAT 条件未具备。
- Website V5：PR #6 基线上完成本地 a11y / contrast / WebP hardening；构建、类型、lint、5/5 测试、Lighthouse a11y 100、patch replay 通过；正式域名/ICP备案/Linux production preview/WeChat 真机不足，保持 HOLD。
- Education Compass：另一任务已完成 312 文件双端语义对齐、Web 50/50、toolchain 21/21、backend 100/100、本地 full-stack 与远端代码验证；service 仍 inactive/disabled、production blocked。本任务只读同步，没有重复修改。
- V7 Migration：本机资产审计与 dirty patch 保护完成；V7 DNS/SMB 不可达，未迁移、不覆盖、不删除。

## P0 status

| P0 | 状态 | 核心证据 | Gate |
|---|---|---|---|
| 1 Family Core 接入前工程审计 | `COMPLETE` | Inventory、Mapping、Readiness、PR DAG、Identity/Policy/Env audit | 可 review |
| 2 Family Core Sandbox | `POLICY 18/18 + DB 35/35 PASS` | exact-head GitHub run/artifact + JSON/Markdown + PostgreSQL backup | V1 approved；Legal 参数与 staging Gate pending |
| 3 Education 502 | `CODE_ALIGNED / PROD BLOCKED` | 312-file alignment；50/50 + 21/21 + 100/100；server/listener/Nginx/health | domain/TLS/DB/secret/deploy blocked |
| 4 Workspace → V7 | `PARTIAL / BLOCKED_EXTERNAL` | repo inventory + patch + untracked archive | 等 V7 可达 |
| 5 Controlled test | `ENGINEERING_PASS` | PR #9 113/113、10/10 PG、secret scan 0 | external UAT blocked |
| 6 Website V5 | `LOCAL_PASS / PROD_HOLD` | build/type/lint/test/browser/route/TLS/Lighthouse；transfer -57.9% | 等正式发布条件 |
| 7 Handoff Pack | `COMPLETE / REFRESHED` | 本目录全部交付物、GitHub remote audit、replay verification、Draft PR #14/#15/#16 | review/Founder Gate 待完成 |

## Exact candidate registry

| Product | Branch / PR | Exact SHA | Working tree | Status |
|---|---|---|---|---|
| Family Core | `codex/family-core-sandbox-20260909` / PR #14 | `6141d863475f146ec2494ebadd39c447fd38e9f5` | `D:\fc` clean | remote Draft; exact-head CI PASS / V1 frozen / review only |
| Application Compass | `codex/masters-intake-release-determinism-20260909` / PR #15 | `ef74fba6e1f264180eb0f65f749a200298ce88d9` | `D:\app` clean | remote Draft; engineering PASS / UAT HOLD |
| Website V5 | `codex/website-v5-release-hardening-20260910` / PR #16 on PR #6 | `d1942dec9354b87ec2eca0912be96275e485eca8` | `D:\web` clean | remote Draft; local+CI PASS / production HOLD |
| Education Compass | `main` + preserved dirty diff | `846f77c120cd00a49d89635dd4297b020af7d03a` | `D:\phoenix` dirty | no running production SHA |

## Family Core Gate details

The sandbox used exactly two synthetic families with adult/minor members. It verified migration from empty DB, down/up rollback, authoritative Auth UUID preservation, exclusion of test accounts, no name/phone auto-merge, conflict quarantine, idempotent adapter replay, RLS isolation, tampered family/member IDs, append-only timeline/consent, immediate consent and guardian revocation, and backup → clean restore reconciliation.

Backup SHA-256: `58b529c9c7ad17cc1c8471e33585eb375063f8a0dde3386fd3c46a53f74f6dfe`.

The denial-first V1 direction in `FOUNDER_POLICY_FREEZE_PROPOSAL_V1.md` was approved by Jimson on 2026-09-10. Machine-readable policy, reference evaluator and policy-ID traceability are implemented at `6141d863`; Legal-owned parameters remain explicit blockers and may not be invented.

## Open blockers and accountable next action

| Blocker | Owner | Next action | Evidence needed to close |
|---|---|---|---|
| Legal parameters and later runtime integration | Legal/Privacy/Product/Security/Operations/Engineering | complete jurisdiction/evidence/retention/DSAR parameters and wire reviewed values into bounded runtime changes | named owners, approved parameters, integration tests and traceability; 14/14 reference deny paths already complete |
| GitHub content review | Founder/reviewers | review dependency chain and Draft PR #14/#15/#16 | review decision, exact SHA and approved merge order |
| Website formal domain & ICP | Founder/Infra/Legal | provide exact domain, DNS and备案号 | DNS/TLS/redirect/footer screenshots + probes |
| Website Linux production preview | Infra | run candidate on target-like Linux | assets 200, routes/health PASS |
| WeChat UAT | WeChat admin/Product | provide test AppID, members, legal domains | DevTools+iOS+Android run record |
| Education production | Infra/DB owner | freeze dirty diff; approve domain/TLS/DB/service plan | local+public health, logs, exact running SHA |
| V7 workspace | V7 owner | restore hostname/SMB and confirm target layout | read-only inventory + conflict report |
| Production monitoring | Infra | select monitor and alert routes | active checks, owner, alert test |

## Weekend-safe statement

No production merge, deployment, migration, secret publication, real-customer sandboxing, dirty-worktree overwrite, or V7 overwrite was performed. The temporary local PostgreSQL and Website preview services used for evidence collection are stopped during handoff.

## Founder review order

1. Inspect GitHub run `34457501661`, artifact `family-core-gate-6141d863475f146ec2494ebadd39c447fd38e9f5`, `FAMILY_CORE_POLICY_V1_IMPLEMENTATION_RESULT_2026-09-10.md` and the approved policy IDs.
2. Assign Legal/Privacy owners for the remaining parameters.
3. Review the #5, #10 → #11 → #14 dependency chain and policy-test traceability.
4. Decide later whether to authorize controlled synthetic staging—this is not production GO.
5. Review Website/Application blockers and assign V7, Education production and monitoring owners.

## 2026-09-10 GitHub复核补充

- 当前 main 仍为 `846f77c120cd00a49d89635dd4297b020af7d03a`；只确认 PR #1、#3 已合并。
- 发布后共 13 个 open PR，复核时均可机械 clean merge；只有 #2/#6 非 Draft，只有 #4/#5 有批准记录；CI 绿存在于 #6/#8/#9/#12/#13/#15/#16。
- Family `6141d863`、Application `ef74fba`、Website `d1942de` 已发布到 `Jimson614/phoenix` fork，并分别成为 upstream Draft PR #14/#15/#16 的 head。
- 六个 recovery patches 已在精确 remote base 上重放，三个候选 tree identity 全部 PASS。
- 上游直推因 `Jimson614` 权限返回 403，未改变 upstream ref；已用 fork 安全发布，无 force，三条 fork ref 与 PR head SHA 独立验证一致。
- #14 exact-head combined policy/PostgreSQL Gate SUCCESS；#15 自动检查成功；#16 三个 Website checks 成功。三者仍为 Draft，等待内容与依赖审查。
- 详细远端矩阵见 `GITHUB_REMOTE_AUDIT_2026-09-10.md`，本人动作见 `JIMSON_PERSONAL_ACTIONS_2026-09-10.md`。

## 2026-09-10 Founder policy / release Gate 补充

- `FOUNDER_POLICY_FREEZE_PROPOSAL_V1.md` 已逐项给出 Guardian、Consent、Entitlement、身份冲突、跨域共享等 denial-first V1，并于 `2026-09-10 15:44:44 +08:00` 获 Jimson / Founder `APPROVED AS PROPOSED`。
- `FOUNDER_RELEASE_AUTHORIZATION_RECORD_V1.md` 已把 production、真实数据、公开索引、production DB migration 记录为 NO-GO；Health 与 PR #12/#13 继续 HOLD。
- `DELEGATION_ENTRYPOINTS_AND_RACI_2026-09-10.md` 已列出正式域名/ICP、Linux staging、微信真机、V7、Education production、监控所需的人类负责人、入口和 closure evidence。
- `FOUNDER_DECISION_RECORD_FAMILY_CORE_POLICY_V1_2026-09-10.md` 保存本次批准的上下文、原文、后果和实施要求。
- `FAMILY_CORE_POLICY_V1_IMPLEMENTATION_RESULT_2026-09-10.md` 保存 14/14 deny-path、35/35 PostgreSQL、CI 修复链、artifact digest 与仍未授权的边界。

## 2026-09-10 Education 协调补充

- 最新跨任务审计确认 Education 已达到 `CODE_ALIGNED / LOCAL_FULL_STACK_VERIFIED / REMOTE_CODE_VERIFIED`，不是“没有工程进度”。
- 腾讯云 production 仍保持 service inactive/disabled；没有 HTTPS 域名、证书、合法域名、生产凭据与 PostgreSQL TLS，因此仍是 `REMOTE_PRODUCTION_BLOCKED`。
- 三张图片本体与开发包逐字节有效；微信报错指向失效 pageframe 端口。file/compile/network/session 项目缓存已清理，但最终 reopen 目测尚未回交，状态为 `FINAL_REOPEN_RETEST_PENDING`。
- 本任务没有触碰 Education 源码或远端配置，避免与该任务重复施工。
