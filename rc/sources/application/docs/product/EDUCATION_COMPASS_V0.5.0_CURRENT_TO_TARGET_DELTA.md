# Education Compass V0.5.0 Current-to-Target Delta

> 审计日期：2026-08-25（Asia/Shanghai）  
> 当前代码：V0.4.1  
> 目标：V0.5.0（产品定义已冻结，工程待实施）  
> 当前结论：`PRODUCT_FROZEN_IMPLEMENTATION_NOT_STARTED`；本文只记录事实和差异，产品签署不自动授权真实支付、外部写入、生产变更或发布。

## 1. 可复核基线

| 项目 | 实际结果 |
|---|---|
| Project root | `C:\Users\1\Documents\Codex\2026-08-20\new-chat\work\phoenix_v030_feishu_backend\phoenix-family-os-mvp` |
| Git | `NOT_A_GIT_REPOSITORY` |
| Node / npm | `v24.18.0` / `11.16.0` |
| 根/server version | `0.4.1` / `0.4.1` |
| 小程序页面 | `app.json` 注册 16 页；release 构建排除 2 个 admin demo，保留 14 页 |
| 当前迁移 | `001_initial_schema.sql`—`004_dual_agent_analysis.sql` |
| 当前题库 | `education_compass_v1`，6 steps、23 fields、总权重 100、完成阈值 70 |
| 当前新产品开关 | 尚无 V0.5 Growth Discovery 独立开关 |

### 1.1 不可变 migration hash

| Migration | SHA-256 |
|---|---|
| `001_initial_schema.sql` | `502AB6BED513978922FAD8FD424D1C11281B07771E37CE056CF001A2674B35C9` |
| `002_feishu_bitable_integration.sql` | `5A9FC3092BDF46025834A1211E8458CBFF9D3B1DD39ECBF3C2BD02A72CA2D34D` |
| `003_openai_agent.sql` | `1E8B64E1FE38D48BEFD11AD3D69AF73423D77AF17A294ECF8E809A83C3D197E6` |
| `004_dual_agent_analysis.sql` | `62F9B9213B768C2C2C694632AC30C791E5CAE77F75F0760CE0FB95C308D3E097` |

## 2. 当前实现事实

### 2.1 前端与漏斗

- `pages/welcome`、`home`、`compass`、`compass-questionnaire`、`compass-preview`、`payment-result`、`report` 已形成原生小程序主链；品牌组件、TabBar 和页面视觉可保留。
- 当前所有 Education Compass 用户进入同一份本地固定题库，由 `models/questionnaire-contract.json`、`models/questionnaire-schema.js`、`services/assessment.js` 驱动。
- 当前链路把家庭/学生档案、Consent、23 字段答题、免费 preview、旧 ¥39.90 报告解锁串在一个历史产品假设中。
- 当前没有 Level 1/Level 2 独立 Assessment、`sourceAssessmentId`、服务端 bank registry、教育体系分支 bank、跨设备 `nextAction` 状态接口或新版 report-kind renderer。
- remote 模式草稿由后端接口保存，但 V0.5 仍需审计 storage、异步保存竞态、页面级错误/恢复状态和多尺寸可用性。

### 2.2 后端与数据库

- `server/src/http/app.ts` 已有登录、Family/Student、Assessment draft/submit/preview、订单/预支付/查单、报告/PDF/反馈、timeline/advisor、webhook/refund 和飞书管理接口。
- `server/src/http/agent-routes.ts` 已有 Assessment/Report Agent 创建、latest、run 状态与 follow-up 路由；独立 worker 架构已经存在。
- `server/src/domain/model.ts` 的 Assessment 尚未区分 `LEGACY_EDUCATION_COMPASS / FREE_PARENT_COMPASS / STUDENT_GROWTH_DISCOVERY`，状态仍主要是 `DRAFT / PREVIEW_READY`。
- Store 抽象及 memory/file/PostgreSQL adapters 已存在，但 V0.5 新字段必须所有 adapter 一致更新。
- 生产事实源设计为 PostgreSQL；当前 migrations 001—004 不可原地修改。若 Freeze 通过，必须仅新增 005 向前迁移并做 legacy backfill。

### 2.3 支付、Agent、飞书

- `server/src/domain/products.ts` 当前只有历史 `COMPASS_REPORT_SINGLE_39_9`（3990 分）及旧报告交付语义。
- 微信 JSAPI provider、通知验签/解密、主动查单、退款与 entitlement 基础已存在，应复用而不是重写；V0.5 必须使用独立 SKU 和独立 fail-closed 开关。
- Agent 已有 mock/OpenAI provider、加密内容、moderation、安全策略、独立 worker 与 Free/Paid 分析链路；V0.5 只扩展 versioned context/prompt，不新增 Agent 产品。
- 飞书已有 7 类运营镜像、allowlist、pseudonym、outbox/lease/retry/reconcile；V0.5 必须新增用户级版本化 profile opt-in，不能把环境开关当 Consent。
- `.env.example` 当前默认 `PAYMENT_PROVIDER=mock`，并关闭付费、飞书 profile、OpenAI API 与 AI worker，符合 fail-closed 基线。

## 3. Keep / Modify / Add / Deprecate / Defer

| 模块 | 分类 | 理由与冻结后动作 |
|---|---|---|
| 原生微信小程序、品牌组件、TabBar、现有主要页面 | **KEEP** | 保持页面结构与视觉语言；仅按 report kind / nextAction 增量适配 |
| `services/assessment.js` legacy 路径 | **KEEP** | 历史题库、订单、退款、权益、PDF、Agent 继续可读；另建 V0.5 adapter |
| 现有微信支付 provider/webhook/refund/entitlement | **KEEP + MODIFY** | 复用安全机制；增加新 SKU 隔离与被冻结 payment timing 的语义 |
| 现有 Agent provider/worker/run 状态 | **KEEP + MODIFY** | 新增 context/prompt version 和 kind 路由；核心结果不依赖 AI |
| 现有 Feishu outbox/reconcile/allowlist | **KEEP + MODIFY** | 增加用户 Consent gate、provisional/null 规则和 V0.5 allowlist |
| 当前单一 Assessment/Report 模型 | **MODIFY** | additive enum/字段、source link、result payload/version、legacy backfill |
| 客户端本地题库作为新流程事实源 | **DEPRECATE FOR V0.5** | legacy 保留；新流程改为服务端 registry + schema digest |
| 旧 23 字段/六模块作为新产品定义 | **DEPRECATE FOR V0.5** | 只能用于历史记录，不可原地改写或当作 Level 1/2 |
| V0.5 service adapter、questionnaire registry/result rules/OpenAPI | **ADD AFTER FREEZE** | 冻结后按纵向切片实施 |
| Askwise 网络连接与 Aoyu 表现层 | **ADD AFTER PRODUCT + INTEGRATION SIGNATURE; CURRENTLY BLOCKED** | 2026-08-24 Founder scope 把 target 改为 handoff→session→first task→Aoyu→writeback；签署和外部授权前仍为 RESERVED_ONLY，当前仓库缺 ASKWISE runtime/API 与 Aoyu assets |
| Level 3 完整题库、报告与 ¥980 支付 | **DEFER** | 仅冻结入口状态、reason codes、handoff context、Advisor intent |
| Wealth/Identity Compass、大学匹配/录取概率 | **DEFER / OUT OF SCOPE** | 本轮明确不做 |

## 4. 目标差异清单

| 领域 | Current V0.4.1 | Target V0.5.0（冻结后） | 依赖的冻结决策 |
|---|---|---|---|
| 产品层级 | 单一 legacy compass | FREE_PARENT_COMPASS + STUDENT_GROWTH_DISCOVERY + legacy | L1/L2 banks、路由 |
| Assessment | 单一类型，无 source link | kind/respondent/source/system/bank versions/digest/assent/result kind | respondents、Consent、profile policy |
| Question bank | 客户端固定 23 字段 | 服务端权威、版本化 common + system banks | 精确题目/选项/校验/体系 |
| Result | preview + 旧六模块 | Full Family Snapshot；locked/full Student Growth 六项结果 | scoring、result/routing rules |
| Commercial | 旧 3990 SKU | 独立 price-neutral code，金额由冻结目录给出 | amount、payment timing |
| API | legacy create/draft/submit/preview | state/bank/assessment questionnaire/result/product/consent 等新版路由 | 全部 freeze contracts |
| Frontend | 本地 ref 推断、单一 renderer contract | 服务端 nextAction、新版 adapter、版本化 report renderer | API + bank schema |
| Agent | 已支持 free assessment/paid report | 按新 kind 发送脱敏结构化结果，仍独立可选 | result schema |
| Feishu | 环境 flag 控制 profile allowlist | 环境 flag + 用户版本化 opt-in 双闸门 | Consent scope/revoke |
| Askwise | 未标准化、无实现 | 签署后为 versioned handoff/session/first task/writeback + 7-state Aoyu；当前 RESERVED_ONLY | integration contract/Consent/ID/idempotency/state/error/assets/UAT |
| Level 3 | 未标准化 | entry state + reason codes + Advisor intent | trigger/CTA；不做完整 ¥980 产品 |

## 5. 安全增量路径

1. Founder 完成 Product Freeze，并对附件 hash、价格、支付时点、Consent 和结果规则逐项批准。
2. 先增加合同测试和 OpenAPI，再新增 `005_education_compass_levels.sql`；001—004 hash 不变。
3. 先完成后端 Level 1 纵向切片及 mock HTTP，再接前端填写/恢复/Snapshot。
4. 再完成 Level 2 bank/submit/locked/full result；随后接前端体系路由和报告 renderer。
5. 再接新 SKU mock 支付、Agent context 与 Feishu Consent/outbox；Level 3 仍只做入口预留。
6. ASKWISE/Aoyu 必须另以 `ASKWISE_AOYU_INTEGRATION_CONTRACT_V1_RC1.md` 为准：先补真实仓库/API/Auth/资产和批准内容包，再做 adapter→session/task→Aoyu→writeback；五日 UAT 只用合成数据与测试权益。
7. 依次取得 L1/L2、本地 PostgreSQL L3、外部 staging L4、真机人工 L5 证据；证据层级不得互相替代。ASKWISE/Aoyu 与支付各自验证，不能互相替代。

## 6. 逐文件修改面（冻结后）

| 路径/区域 | 处理 | 说明 |
|---|---|---|
| `server/src/domain/questionnaire.ts` | KEEP legacy | 23 字段/权重 100 的历史合同只读保留 |
| `models/questionnaire-contract.json`、`models/questionnaire-schema.js` | KEEP legacy | 不原地改成 Level 1/2；新版使用独立 DTO/adapter |
| `server/src/domain/model.ts` | MODIFY | additive kinds、respondent、source、system、versions/digest/result payload |
| `server/src/store/store.ts`、`memory-store.ts`、`file-store.ts`、`postgres-store.ts` | MODIFY TOGETHER | 所有 adapter、自然唯一约束、JSON fields/table allowlist 必须同步 |
| `server/src/http/app.ts` | MODIFY | 新增 state/bank/questionnaire/result/product/consent 路由，保持 legacy |
| `server/src/http/agent-routes.ts` | MODIFY minimally | 路由尽量复用；只支持新 kind/context 和现有鉴权/幂等 |
| `server/src/domain/products.ts` | ADD product | 新 SKU 独立，旧 3990 SKU 不变；金额来自 Freeze |
| `server/src/services/order-service.ts` | MODIFY | 从全局旧商品假设改为校验订单产品快照/交付 kind |
| `server/src/ai/context/*`、`prompt/*` | ADD version | 新 result kind 的脱敏结构化 context；legacy prompt 保留 |
| `server/src/integrations/feishu/*` | MODIFY | versioned user Consent + allowlist；不改变 PostgreSQL 事实源 |
| `services/assessment.js` | KEEP legacy | 新流程不得破坏当前调用方 |
| `services/education-compass.js` | ADD | 受控 V0.5 API、DTO、revision 与错误状态 |
| `pages/home`、`compass*`、`report`、`payment-result` | MODIFY incrementally | 消费 server state/report kind/order 权威状态；保留页面和品牌 |

## 7. 高风险结构差异

- 当前 Family 的关键资料和 `Student.name` 为非空；若 Freeze 允许 provisional，必须用真实的 nullable/profile status 设计，不能写“未命名孩子”、假电话或默认家庭作为事实。
- 当前 `orders.report_id`、`entitlements.report_id` 的数据结构天然适合“答题后解锁报告”；若冻结为 `BEFORE_QUESTIONNAIRE`，需要 assessment-access entitlement，不能硬套旧模型。
- `PostgresStore` 对 tables/JSON fields 使用显式清单，`MemoryStore` 也实现自然唯一性；只改 SQL 会造成 adapter 漂移。
- 客户端旧题库以中文 label 作为值；V0.5 必须保存 canonical option code。
- 当前自动保存没有服务端 revision 防护，存在较旧响应覆盖较新答案的风险。
- 普通 API 请求体目前多为解析后挑选已知字段，多余字段不一定被拒绝；V0.5 新路由必须共用 exact-object validator。
- Assessment create 每次创建新对象，submit 只有状态级重复返回；尚不满足 `Idempotency-Key + input digest + conflict 409` 的新合同。
- `home` 依赖 wx 本地 assessment/order references 推断下一步；V0.5 应改为服务端 `state.nextAction`。
- 页面存在对 `student.name.charAt(0)` 的非空假设；provisional profile 必须补空值安全测试。
- Report、PDF、Agent 均假设旧六模块；必须按 report kind/version 注册，不能用条件散落覆盖历史语义。
- 当前 entitlement 主要按 report ID 判定，缺少 product→deliverable/report-kind 约束；新旧 SKU 共存时必须阻止交叉解锁。
- `services/family-data.js` 会给远端报告补旧 `COMPASS_REPORT_SINGLE_39_9`；新版必须保留服务端的 report kind/version/product code。
- Agent provider/crypto/worker 可复用，但 context、资格判断和 PostgreSQL worker claim 仍依赖旧 modules/状态；新 result payload 需要 kind-specific 规则，历史追问能力不能自动授予新报告。
- 当前独立 worker 启动器使用 PostgreSQL；若 L2 要用 InMemory mock HTTP，需专用测试 bootstrap 让真实 HTTP listener 与独立 worker actor 共享注入 store，否则该证据属于 L3。
- 当前 option/评分触控高度约 66–76rpx，固定双列/最小宽度存在小于 44px 或窄屏溢出的风险，必须做 320/375/430px 与大字号检查。
- 当前没有 OpenAPI 文件；V0.5 必须建立 router/OpenAPI/fixture/client DTO 的自动一致性检查。
- 飞书只有环境开关，没有每用户资料镜像 Consent；这不是等价授权。

## 8. 当前基线测试证据

| 命令 | Exit code | 结果 |
|---|---:|---|
| `node --version` | 0 | `v24.18.0` |
| `npm.cmd --version` | 0 | `11.16.0` |
| 首次 `npm.cmd run test:all` | 非 0 | server TypeScript 编译器未安装，真实失败，不计 PASS |
| `npm.cmd --prefix server ci --cache .npm-cache` | 0 | 安装 19 packages，0 vulnerabilities |
| 再次 `npm.cmd run test:all` | 0 | client validation/typecheck/build 通过；server 动态测试 `65 passed, 0 failed` |

本结果只证明现有 V0.4.1 本地 L1 基线，不证明 V0.5.0、PostgreSQL、OpenAI、飞书、微信 staging 或真机支付已联通。
