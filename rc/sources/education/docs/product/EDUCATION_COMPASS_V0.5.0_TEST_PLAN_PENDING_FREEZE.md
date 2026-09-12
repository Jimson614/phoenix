# Education Compass V0.5.0 Test Plan — Product Frozen

> 状态：`READY_FOR_ENGINEERING_VALIDATION`  
> 测试执行：`NOT_RUN`（除冻结包静态／完整性校验外）  
> 产品定义已冻结，但所有 V0.5.0 代码、HTTP、存储、支付和外部联通用例仍为 `NOT_RUN`；不得把冻结包校验写成实现通过。

## 1. 证据分层与判定

| Level | 证据 | 可接受结果 |
|---|---|---|
| L1 | 离线合同、单元、静态、fixture/OpenAPI/DTO 验证 | `PASS/FAIL/NOT_RUN` |
| L2 | 真实启动 API + 独立 worker；InMemory + mock 微信/OpenAI/飞书 HTTP 全闭环 | `PASS/FAIL/NOT_RUN` |
| L3 | 显式测试 PostgreSQL 的迁移、持久化、并发、重启恢复 | `PASS/FAIL/BLOCKED_EXTERNAL/NOT_RUN` |
| L4 | RDS TLS、OpenAI、飞书、微信配置/prepay 各自 staging smoke | `PASS/FAIL/BLOCKED_EXTERNAL/NOT_RUN` |
| L5 | 微信 iOS/Android 真机扣款、通知/查单、退款与 UI 人工验收 | `PASS/FAIL/BLOCKED_MANUAL/NOT_RUN` |

`/health {"ok":true}`、配置存在、mock、fixture、DevTools 模拟均不能代替真实外部联通。

## 2. Freeze Gate P0

| ID | 检查 | 当前状态 |
|---|---|---|
| FG-01 | Manifest 状态为 FROZEN，批准人/日期/版本非空 | `PASS`（产品签署记录） |
| FG-02 | 精确题目、选项、校验、体系、价格、评分、Consent 与附件 hash 完整 | `PASS`（Freeze 静态校验；专业 Reviewer 仍是独立 `PENDING`） |
| FG-03 | Freeze validator 与实现/fixture/OpenAPI/client DTO 完全一致 | `NOT_RUN` |
| FG-04 | 001—004 SHA-256 与基线一致 | `PASS`（Phase A 复核项） |

FG-01/FG-02 只允许开始工程验证，不代表 FG-03 或任何 V0.5.0 实现用例已通过。

## 3. 本地 P0 矩阵（Freeze 后执行）

| ID | 范围 | 关键断言 | 证据层 |
|---|---|---|---|
| P0-01 | Legacy 回归 | 旧 bank/SKU/order/refund/entitlement/report/PDF/Agent 全部兼容 | L1/L2/L3 |
| P0-02 | Migration | 空库 001→005、已有库 004→005、重复执行与 checksum；legacy backfill 正确 | L3 |
| P0-03 | Bank | 每体系精确 ID/题数/option；required、互斥、multi、长度、UNSURE、version/digest | L1/L2 |
| P0-04 | Level 1 | 幂等 create/draft/resume/submit；每种 Snapshot 路由 fixture；无 entitlement 也完整返回 | L1/L2/L3 |
| P0-05 | Level 2 | source/owner/family/student/consent/system 校验；六项结果带 evidence；未知条件中性 | L1/L2/L3 |
| P0-06 | Authorization | 跨用户/家庭/学生、错误 source、撤回 Consent、学生拒绝、版本篡改全部拒绝 | L1/L2/L3 |
| P0-07 | State/idempotency | nextAction 跨设备；同 key 同输入重放、不同输入 409；提交后不可改 | L1/L2/L3 |
| P0-08 | Draft concurrency | 旧异步响应不覆盖新答案；体系切换仅保留 common；重启恢复 | L2/L3 |
| P0-09 | Result privacy | locked 响应不含六项正文、signals 或可推导核心结论的数据 | L1/L2 |
| P0-10 | Payment | 客户端 success 不授权；可信通知/查单才授权；重复回调一次；退款撤权；SKU 不串权 | L1/L2/L3 |
| P0-11 | Agent | Free/Paid run 经独立 worker QUEUED→SUCCEEDED；PII/自由文本不出站；失败不阻主链 | L1/L2/L3 |
| P0-12 | Feishu | 只有 flag + versioned opt-in 才入 outbox；允许字段可达、禁止字段为零；失败不阻主链 | L1/L2/L3 |
| P0-13 | Contract | OpenAPI ↔ router ↔ examples ↔ validator ↔ client DTO 一致 | L1 |
| P0-14 | Storage | remote wx storage 无 answers、自由文本、报告、Agent 正文或密钥 | L1/L2 |
| P0-15 | UI | 320/375/430px、大字号、safe area、空值 profile；无空白页/横向溢出 | L1 + 人工 |
| P0-16 | Release | 无 admin/demo/server/mock/OpenAI SDK/prompt/.env/私钥/tourist AppID；manifest/hash 完整 | L1 |

任何 P0 `FAIL` 都禁止生成命名为 verified 的候选包或声称可上线。

## 4. 可填写 HTTP Smoke（Freeze 后）

脚本必须启动真实 server HTTP 进程和独立 Agent worker，并按顺序验证：

1. mock 登录取得 Bearer token；
2. `GET state`；
3. `GET bank`；
4. create Level 1；
5. PUT full draft → GET resume；
6. submit → full Family Snapshot；
7. create Level 2 with source Assessment；
8. GET assessment questionnaire；
9. draft/resume/submit → locked result；
10. product quote → mock order/prepay/status；
11. mock trusted payment event → full report；
12. create Agent run → worker → poll result；
13. mock refund → entitlement revoked；
14. Feishu fake gateway outbox/reconcile；
15. assertions on logs/storage/forbidden fields.

每个正式 system route 使用完整可提交合成 fixture；unsupported/fallback 使用独立 fixture。脚本不能只直接调用 service 函数。

当前生产 worker 入口依赖 PostgreSQL。若 L2 选择 InMemory，测试 harness 必须启动真实 HTTP listener，并让独立的 worker actor 通过显式依赖注入共享同一个测试 Store；否则 Agent 跨进程证据应归入 L3 PostgreSQL，不能把 service 直调记作 L2 PASS。

## 5. 计划运行命令

PowerShell 使用 `npm.cmd`，不改变 ExecutionPolicy：

```powershell
Set-Location -LiteralPath 'C:\Users\1\Documents\Codex\2026-08-20\new-chat\work\phoenix_v030_feishu_backend\phoenix-family-os-mvp'

node --version
npm.cmd --version
npm.cmd ci
npm.cmd --prefix server ci --cache .npm-cache
npm.cmd run test:client
npm.cmd run typecheck:server
npm.cmd run test:server
npm.cmd run test:all
npm.cmd --prefix server run build
npm.cmd run build:release
```

Freeze 后还需把 migration、OpenAPI、fixtures、mock HTTP smoke、PostgreSQL 与 secret scan scripts 接入默认 `test:all` 或明确的 P0 聚合脚本，避免“测试文件存在但未执行”。

## 6. 外部 Smoke 闸门

| 环境 | 最小前提 | 自动化边界 | 无条件时状态 |
|---|---|---|---|
| PostgreSQL test | 显式测试 `DATABASE_URL`，允许创建/迁移专用 DB | 不 reset/delete 用户数据库 | `BLOCKED_EXTERNAL` |
| OpenAI staging | 专用 Project/Key、明确 model、合成数据 | 1 Free + 1 测试权益 Paid；不记录正文/ID/key | `BLOCKED_EXTERNAL` |
| Feishu staging | 专用 Base、7 个不同 Table ID、最小权限、隐私/保留删除批准 | validate-schema → 合成 profile → reconcile 两次 | `BLOCKED_EXTERNAL` |
| ASKWISE staging | Product + Integration Freeze 已签、真实 repo/API/Auth/tenant、批准 UAT task pack、合成数据 | Consent→handoff→幂等 session/task→pause/complete/fail→writeback；不做真实支付 | `BLOCKED_EXTERNAL` |
| Aoyu assets/mobile | 现有母版／姿态／音频路径、owner/license/hash、批准静态 fallback | 7 状态由真实 ASKWISE event 驱动；点击语音、字幕、重播、无音频降级 | `BLOCKED_EXTERNAL` |
| WeChat prepay | 测试 AppID/secret、商户配置、证书/key、HTTPS notify | code2Session + prepay 参数；不等于付款成功 | `BLOCKED_EXTERNAL` |
| WeChat charge/refund | 用户明确实际金额、测试者真机确认、财务/退款授权 | 不得自动触发；iOS/Android、通知/查单、退款撤权全验 | `BLOCKED_MANUAL` |
| WeChat DevTools | 可用 CLI 或人工打开项目 | 实际填写、退出恢复、提交、结果、多尺寸 | `BLOCKED_MANUAL`（若无 CLI） |

不要让用户把密钥粘贴到聊天或仓库；使用部署 secret store 或本机未提交环境配置。

## 7. 当前真实结果

| 项目 | 命令/证据 | 状态 |
|---|---|---|
| Node/npm | `node --version`; `npm.cmd --version`，exit 0 | `PASS` |
| V0.4.1 server dependencies | `npm.cmd --prefix server ci --cache .npm-cache`，exit 0，19 packages，0 vulnerabilities | `PASS` |
| V0.4.1 local aggregate | `npm.cmd run test:all`，exit 0；client validation/typecheck/build 通过；server `65 passed, 0 failed` | `PASS` |
| V0.5.0 L1/L2 | 产品已冻结；代码／HTTP 实施测试尚未开始 | `NOT_RUN` |
| PostgreSQL L3 | 未提供显式测试数据库 | `BLOCKED_EXTERNAL` |
| ASKWISE/Aoyu | 产品合同已冻结；当前仓库无 runtime/API/Auth/tenant/生产内容包/资产 | `BLOCKED_EXTERNAL` |
| OpenAI/Feishu/WeChat L4 | 未使用 staging 凭据或执行外部调用 | `BLOCKED_EXTERNAL` |
| WeChat 真机 L5 | 无本次实际扣款/退款授权 | `BLOCKED_MANUAL` |

当前最高可写结论为 `PRODUCT_FROZEN_IMPLEMENTATION_NOT_STARTED`；只有冻结包静态与完整性校验通过，V0.5.0 运行代码未在本冻结任务中修改或验证。
