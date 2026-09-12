# Phoenix Education Agent 运行手册

## 1. 范围与当前证据

V0.4.1 Agent 是 Phoenix 可信后端通过 OpenAI Responses API 提供的受限教育规划辅助，不是 ChatGPT 网页、Custom GPT 或用户 ChatGPT 账号。前端明确区分：已提交测评的免费有限分析、¥39.90 已购完整报告的一次性总分析，以及最多3次的已购报告追问；每条路径都要求独立AI同意并由服务端按资源重新鉴权。

当前仓库可以提供代码、Mock、合同测试和 release 候选包；它不包含真实 OpenAI Key、ZDR/数据处理批准、生产 PostgreSQL、真实微信商户或飞书凭据。没有外部证据时，状态必须记为 `WAITING_FOR_CONFIGURATION`，不能写成“OpenAI/微信/飞书已连接或上线”。

不可改变的边界：

- 小程序只访问 Phoenix API，不含 OpenAI SDK、Key、服务端 Prompt 或模型配置；
- 双分析与追问都不生成或改写收费报告，不修改问卷、来源、订单、退款、权益或飞书；
- Agent 没有 web/file search、代码执行、computer use、MCP 或自定义工具；
- PostgreSQL 是 Agent 同意、会话、任务和无正文审计的事实源；
- Agent 内容不进入飞书、analytics、普通日志或 release；
- Agent/OpenAI 故障不得阻塞支付、退款、报告/PDF或飞书同步。

## 2. 配置与默认关闭

配置名和范围以 `server/.env.example` 与类型化配置为准。核心配置包括：

```text
OPENAI_AGENT_ENABLED=false
AI_WORKER_ENABLED=false
AGENT_PROVIDER=mock
OPENAI_API_KEY=
OPENAI_MODEL=
OPENAI_MODERATION_MODEL=
OPENAI_REQUEST_TIMEOUT_MS=30000
OPENAI_MAX_OUTPUT_TOKENS=1200
OPENAI_SAFETY_HMAC_KEY=
AI_CONTENT_KEYRING_JSON={}
AI_CONTENT_CURRENT_KEY_VERSION=v1
AI_CONVERSATION_RETENTION_DAYS=30
AI_WORKER_INTERVAL_MS=1000
AI_WORKER_BATCH_SIZE=5
AI_WORKER_LEASE_MS=60000
AI_MAX_TURNS_PER_REPORT=3
AI_MAX_MESSAGE_CHARS=2000
AI_RATE_LIMIT_MESSAGES_PER_MINUTE=6
AI_MAX_ACTIVE_RUNS_PER_USER=2
```

安全要求：

- 默认 Agent 与 worker 都关闭；development/test 默认使用确定性 Mock。
- `OPENAI_AGENT_ENABLED=true` 必须同时使用 PostgreSQL、独立 HMAC Key 和有效 AES-256-GCM current key。
- `AI_WORKER_ENABLED=true` 只能在 Agent 已开启时使用；生产 API 进程只入队，Agent worker 使用独立小连接池。
- `AGENT_PROVIDER=openai` 必须有 PostgreSQL、OpenAI Key 和显式模型；production 禁止 Mock。
- 环境变量是技术闸门，不是 ZDR、法律评估、监护人身份或上线批准的证据。
- Key 只从部署秘密管理注入，不复制进 `.env.example`、PowerShell 历史、日志、文档、小程序或构建产物。

## 3. 数据库与进程

`001_initial_schema.sql`、`002_feishu_bitable_integration.sql` 和 `003_openai_agent.sql` 是不可变历史。V0.4.1 通过 `004_dual_agent_analysis.sql` 扩展conversation purpose与活动唯一索引；只对获授权的本地、测试或预发布 PostgreSQL 运行迁移：

```powershell
$env:DATABASE_URL = '<由测试环境或秘密管理注入>'
npm.cmd --prefix server run db:migrate
```

生产部署顺序：先备份和验证 migration，再部署 API，随后单独部署 Agent worker，最后才在批准窗口开启 feature flag。API 进程不得启动 Agent timer。

服务端应提供以下脚本；以实际 `server/package.json` 为准：

```powershell
npm.cmd --prefix server run build
npm.cmd --prefix server start
npm.cmd --prefix server run start:agent-worker
npm.cmd --prefix server run agent:worker:once
```

`agent:worker:once` 用于测试/运维单轮领取；常驻 worker 使用数据库租约与 fencing。Provider 调用在数据库事务外，结果提交前重新检查租约、会话、专项同意、权益、报告版本和上下文摘要。任务状态单调；迟到 worker 不能覆盖新结果。

客户端幂等只保证一个 Phoenix 本地 run。“上游已成功、数据库提交前进程崩溃”等模糊结果下，Provider 可能被至少执行一次以上；当前实现不持久化 OpenAI response ID，也不宣称 OpenAI exactly-once。应以单层有限重试、三轮配额、费用告警和人工排障控制此风险。

## 4. 用户链路

1. 免费预览页可进入`ASSESSMENT_ANALYSIS`；已购完整报告页分别显示`REPORT_ANALYSIS`“AI总分析”和`REPORT_FOLLOWUP`“最多3次追问”，不以同一按钮或文案混同。免费分析不要求订单/权益；两条报告路径都要求`ACTIVE entitlement + READY + DELIVERED + QA`。
2. 首次分析/追问前用户阅读AI处理、未成年人和PII提示并确认。三个创建POST都使用固定平铺字段`ai_agent_guardian_v1 / ai_education_agent / guardianConfirmed:true`；勾选本身不是授权事实。
3. 服务端验证owner和家庭角色。免费分析还验证测评已提交、完整度与安全快照；付费总分析/追问还验证`ACTIVE` entitlement、`READY/DELIVERED`和QA。
4. 分析创建和每条追问消息带`Idempotency-Key`；允许内容加密入队并返回202，本地安全阻断不进入生成模型。
5. worker调用无工具、`store:false`、strict Structured Outputs的Responses API；输出经来源、安全和本地QA后才保存和返回。
6. 小程序展示回答、关键点、下一步、限制和服务端映射的可信来源。正文只在页面内存中存在，不写`wx storage`；页面重开通过资源`/latest`接口恢复最近分析。
7. 一次性分析不接受追加消息。已购报告追问每份报告最多三个成功回复；用户可撤回追问同意或删除会话，退款/撤权后仍可发现无正文管理摘要并删除。

自动轮询最多 60 次或 2 分钟，任一上限先到即停止并保留可恢复 `runId`，由用户稍后刷新；页面 `onHide/onUnload` 必须停止 timer。

接口职责固定如下；裸集合 `GET .../agent-analyses` 当前不存在：

| 用途 | 创建 | 状态/结果 | 最近一次恢复 |
|---|---|---|---|
| 免费一次性分析 | `POST /v1/assessments/:assessmentId/agent-analyses` | `GET /v1/agent-analyses/:runId` | `GET /v1/assessments/:assessmentId/agent-analyses/latest` |
| ¥39.90 一次性总分析 | `POST /v1/reports/:reportId/agent-analyses` | `GET /v1/agent-analyses/:runId` | `GET /v1/reports/:reportId/agent-analyses/latest` |
| 已购报告追问 | `POST /v1/reports/:reportId/agent-conversations` 后 `POST .../messages` | `GET /v1/agent-runs/:runId` | 通过会话/消息接口恢复 |

创建接口只完成鉴权、同意、幂等与加密入队并返回201/202；Provider调用由独立异步worker完成，不能把入队成功描述成OpenAI已返回。

## 5. OpenAI 与未成年人安全

- 每轮独立请求，设置 `store:false`；不使用 OpenAI Conversation、`previous_response_id`、远端长期记忆或 reasoning item 回放。按 [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create) 的定义，`store` 只控制是否保存生成的response供后续检索，不能据此宣称ZDR。
- 免费分析、已购报告总分析和报告追问的测评/报告上下文都只发送同一12个受控选项：`school_stage`、`education_system`、`target_enrollment_year`、`learning_feeling`、`strengths`、`challenges`、`parent_expectation`、`target_region`、`route_preference`、`backup_route_acceptance`、`available_time`、`support_need`。不发送23题中的自由文本、六模块原文或客户资料；仅追问路径额外发送经过本地 PII、危机、注入和越权检查的用户追问文本及有限轮会话上下文。所有路径禁止姓名、电话、邮箱、证件、学校、精确地址、OpenID、数据库 ID、交易或飞书信息。
- 使用独立、用途域分离的 HMAC 伪名作为 `safety_identifier`；metadata 默认省略。
- 输入本地预检后走一种已核对当前 SDK 的官方 moderation；输出在持久化/展示前再次做安全、来源、越权和长度 QA。
- 自伤、暴力、性或虐待高风险输入使用经批准的确定性文案，跳过主生成模型；不让模型编造热线。立即危险提示联系可信成年人及当地紧急服务。
- `store:false` 不是 ZDR。若可能处理低于适用数字同意年龄儿童的数据，必须先完成适用法律评估、所需 ZDR/数据处理安排和外部批准；代码开关不能替代证据。

## 6. 加密、日志和删除

- 消息与冻结请求使用 AES-256-GCM envelope：每次唯一随机 96-bit IV、authentication tag、key version，以及绑定表/记录/角色/会话/版本的 AAD。
- Keyring 中每个 Base64 Key 解码后必须严格为 32 字节；当前版本加密、旧版本仅用于读取尚未过期的历史 envelope。
- 内容 Key 不复用 `SESSION_SECRET`、`FEISHU_PSEUDONYM_KEY` 或 `OPENAI_SAFETY_HMAC_KEY`；内容/幂等 digest 使用用途域分离的 HMAC，不用裸 SHA。
- 日志只记录随机 run correlation、稳定错误码、耗时、重试和 token 计数；不记录正文、Prompt、原始 provider body、response id 或 Key。
- 默认正文保留 30 天、上限 90 天。删除先撤销访问并清在线敏感列；缓存和备份按批准 SLA 到期，不虚称即时物理擦除。

## 7. 验证

离线代码验证不得访问真实外部系统：

```powershell
npm.cmd --prefix server ci
npm.cmd run test:all
npm.cmd --prefix server run typecheck
npm.cmd --prefix server run build
npm.cmd --prefix server test
$env:PHOENIX_API_BASE_URL = 'https://api.example.invalid'
$env:PHOENIX_MINIPROGRAM_APPID = 'wx0123456789abcdef'
npm.cmd run build:release
```

检查重点：免费分析未提交/低完整度/跨家庭拒绝，付费总分析与追问在未支付/退款/无权益时拒绝；三条路径独立同意、幂等与配额；高风险时主模型零调用；数据库无明文；Agent故障对支付/退款/飞书调用数为零；release含双分析/追问页面与Phoenix API client，但不含OpenAI SDK、Prompt、Key、server或demo生成器。

真实 API 预发布测试必须由项目方提供独立 Project/Key、批准模型、费用/速率告警、数据处理与未成年人审批，并明确授权网络调用。变更审批中还必须记录测试数据集、12字段出站抽样、保留/删除SLA、责任人与回滚窗口；没有这些证据时保持两个开关为 `false`，不要发送测试内容。Mock/合同测试通过不代表真实外部调用已验证。

## 8. 故障与回滚

| 现象 | 安全处理 |
|---|---|
| Agent 入口不可用 | 核对 report capability、权益、QA、专项同意和 feature flag；不要绕过服务端门禁 |
| run 长时间排队 | 查看无正文 heartbeat/队列计数、租约和 worker；小程序停止无限轮询，报告/PDF仍可用 |
| moderation/模型 429 或 5xx | 尊重 `Retry-After`，保持单层有限重试和熔断；不要增加并行重试层 |
| 输出 Schema/来源/安全 QA 失败 | 丢弃正文并进入稳定失败状态；不得把原始输出返回客户端或写日志 |
| 权益退款或同意撤回 | fence 未完成 run，丢弃迟到结果，禁止正文读取；保留删除/法定数据请求渠道 |
| Key 泄露或疑似内容外泄 | 立即关闭 Agent/worker、轮换受影响 Key、保留无正文证据并启动隐私事故流程 |

紧急回滚先设置 `OPENAI_AGENT_ENABLED=false`、`AI_WORKER_ENABLED=false` 并停止 worker。保留 003/004 表和已加密内容以便合规处置，不自动执行生产 down migration；微信支付、报告/PDF与飞书继续按各自开关运行。删除SOP为：先通过会话DELETE/同意撤回即时撤销在线访问并fence未完成run，再核对在线敏感列已清、日志/飞书/analytics无正文，最后按批准的缓存/备份到期SLA留证；不得声称备份已被即时物理擦除。
