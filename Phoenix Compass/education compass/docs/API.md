# API Contract：Education Compass Paid Report + Agent V0.4.1

## 1. 通用约定

- Base path：`/v1`；健康检查为 `GET /health`。
- JSON使用 `Content-Type: application/json`；PDF响应为 `application/pdf`。
- 登录后接口使用服务端签发的 `Authorization: Bearer <opaque-token>`。
- 客户端角色、user/family/student ID、OpenID、金额、订单状态和支付回调结果均不是授权或交易事实。
- DTO使用扁平结构；字段名以本文件和合同测试为准。
- 金额使用整数分，时间使用RFC 3339字符串。
- 商品固定为 `COMPASS_REPORT_SINGLE_39_9`、3990分、CNY、单次购买；客户端不能覆盖价格。
- `PHOENIX_MEMBER_199` 是独立且停用的商品，本API不提供会员购买或权益转换接口。
- `PAID_COMPASS_ENABLED` 默认 `false`；只有正式审批和生产配置完成后才允许受控改为 `true`。该开关是服务端事实，客户端按钮不构成启用。
- 飞书多维表格是可选的单向脱敏运营镜像，不是账户、问卷、报告、订单、退款、权益或Agent的事实源；飞书写入失败不得改变任一业务接口结果。
- AI接口分为免费测评有限分析、已购完整报告分析和已购报告追问；都不接受客户端提交model、Prompt、tools、测评/报告上下文、用户/家庭/学生ID或OpenAI状态ID。
- 生产错误不得返回堆栈、OpenID、会话密钥、完整问卷、完整报告、Agent消息、Prompt、provider response id、支付密文或任何密钥。

错误统一为：

~~~json
{
  "error": {
    "code": "STABLE_MACHINE_CODE",
    "message": "可显示或可排障的信息",
    "details": {}
  }
}
~~~

## 2. 微信会话

### POST /v1/auth/wechat/session

请求：

~~~json
{ "code": "wx.login 返回的一次性code" }
~~~

服务端调用 `code2Session`，保存OpenID/session_key边界信息，但绝不把OpenID或session_key返回客户端。

响应是扁平DTO：

~~~json
{
  "accessToken": "opaque-token",
  "expiresAt": "2026-08-27T12:00:00.000Z",
  "user": { "id": "usr_xxx", "role": "family_user" }
}
~~~

### DELETE /v1/auth/session

使用当前 `Authorization: Bearer <opaque-token>` 撤销该会话，成功返回204。小程序退出登录时先发起该请求，再清理本地token及最小缓存；被撤销token后续访问返回 `SESSION_INVALID`。网络不可用时本地仍会退出，但生产运维必须依赖会话到期、异常登录监测和用户支持流程处理无法送达的撤销请求。

## 3. 家庭、学生及关系数据

- `GET /v1/me/family` → `{ "family": Family | null }`
- `PUT /v1/me/family` → `{ "family": Family }`
- `GET /v1/me/students` → `{ "students": Student[] }`
- `POST /v1/me/students` → `{ "student": Student }`
- `GET /v1/me/students/:studentId` → `{ "student": Student }`
- `PUT /v1/me/students/:studentId` → `{ "student": Student }`
- `GET /v1/me/reports` → `{ "reports": ReportSummary[] }`
- `GET /v1/me/timeline` → `{ "events": TimelineEvent[] }`
- `GET /v1/me/advisor-requests` → `{ "requests": AdvisorRequest[] }`
- `POST /v1/advisor-requests` → `{ "request": AdvisorRequest }`

学生档案中，`age` 的规范请求值是 3–100 的整数；为了兼容旧小程序，服务端也接受等价的十进制数字字符串，并把空白值归一为 `null`。`educationSystem` 非空时落库为 `GAOKAO`、`DSE`、`IGCSE`、`A_LEVEL`、`AP_US`、`IB` 或 `OTHER`；服务端会将旧版已发布的显示标签归一为这些编码，未知非空值返回 `400 INVALID_PROFILE`。

服务端从Bearer会话解析owner。资源不属于当前家庭时返回403或404；不得接受客户端传入的owner user ID作为授权依据。

## 4. 测评合同与草稿

问卷版本为 `education_compass_v1`。前后端共同合同为 `models/questionnaire-contract.json`：23个字段、类型和权重，总权重100，付费预览门槛70。

### POST /v1/students/:studentId/education-assessments

请求：

~~~json
{
  "familyId": "fam_xxx",
  "questionnaireVersion": "education_compass_v1",
  "studentVersion": "student-v1",
  "consent": {
    "consentVersion": "education_compass_guardian_v1",
    "scope": "education_compass_report",
    "guardianConfirmed": true
  }
}
~~~

响应：

~~~json
{
  "assessmentId": "asm_xxx",
  "status": "DRAFT",
  "questionnaireVersion": "education_compass_v1"
}
~~~

服务端验证家庭/学生所有权、studentVersion和版本化同意。未成年人或年龄未知时必须有有效监护人确认。

### PUT /v1/assessments/:assessmentId/draft

请求：`{ "answers": { ...23字段中的已填字段... } }`。

服务端拒绝未知字段、错误类型、非法枚举及超长文本，并按共同合同重新计算完整度。已提交快照不能覆盖。

响应：

~~~json
{
  "assessmentId": "asm_xxx",
  "status": "DRAFT",
  "completenessScore": 86,
  "missingFields": ["language_level"]
}
~~~

### GET /v1/assessments/:assessmentId/draft

用于草稿恢复及remote提交前字段往返核对：

~~~json
{
  "assessmentId": "asm_xxx",
  "status": "DRAFT",
  "questionnaireVersion": "education_compass_v1",
  "answers": {},
  "completenessScore": 86
}
~~~

客户端发现任一已填写字段未原样往返时，以 `ANSWER_SCHEMA_MISMATCH` 阻断提交，不得静默丢字段。

## 5. 提交、收费前报告及预览

### POST /v1/assessments/:assessmentId/submit

服务端依次执行：

1. 所有权、问卷版本及不可变状态检查；
2. 有效监护人同意检查；
3. 23字段合同完整度重新计算，低于70拒绝；
4. 硬规则、候选集和报告依据处理；
5. 在可信后端生成全部六模块；
6. 事实/安全QA，禁止无来源事实、越权候选和录取承诺；
7. 保存 `qaPassed=true、status=LOCKED、deliveryStatus=LOCKED` 的报告及版本。

生成或QA失败时提交失败，不创建可收费报告。成功响应：

~~~json
{
  "assessmentId": "asm_xxx",
  "status": "PREVIEW_READY",
  "completenessScore": 86,
  "confidence": "medium",
  "reportId": "rpt_xxx"
}
~~~

### GET /v1/assessments/:assessmentId/preview

响应严格使用白名单：

~~~json
{
  "reportId": "rpt_xxx",
  "assessmentId": "asm_xxx",
  "completenessScore": 86,
  "confidence": "medium",
  "profileSummary": "...",
  "oneStrength": "...",
  "oneRisk": "...",
  "routeOverview": "...",
  "tableOfContents": [
    "学生成长画像",
    "优势能力分析",
    "推荐专业方向",
    "大学与专业匹配",
    "升学路线建议",
    "未来6—24个月时间规划"
  ],
  "dataAsOf": "2026-08-20",
  "disclaimer": "...",
  "canPurchase": true
}
~~~

该响应不得含modules/fullContent、完整院校或专业候选、详细路线、详细时间表、内部规则、Prompt或PDF地址。

## 6. 订单与小程序支付

### POST /v1/assessments/:assessmentId/orders

请求：

~~~json
{
  "productCode": "COMPASS_REPORT_SINGLE_39_9",
  "idempotencyKey": "cmp_asm_xxx_random"
}
~~~

服务端只有在以下条件全部满足时才能创单：`PAID_COMPASS_ENABLED=true`，production Source Catalog manifest 为 `verified`，manifest版本与报告一致，报告为 `LOCKED/LOCKED`，`qaPassed=true`，六模块完整，商品启用且固定3990分/CNY，同意仍有效。

placeholder、Source版本不一致、生成/QA失败或未锁定报告返回错误，不得进入预支付。

响应为扁平 `OrderDto`：

~~~json
{
  "orderId": "ord_xxx",
  "outTradeNo": "PX...",
  "status": "CREATED",
  "productCode": "COMPASS_REPORT_SINGLE_39_9",
  "amountFen": 3990,
  "currency": "CNY",
  "reportId": "rpt_xxx"
}
~~~

相同用户和幂等键返回同一业务结果；幂等键不得复用于其他测评或商品。

### POST /v1/orders/:orderId/wechat-prepay

服务端创建或复用同一安全订单的prepay；预支付事务会再次检查购买开关、测评/报告关联、监护人同意未撤回、商品仍启用且为单次3990分/CNY、Source Catalog版本与QA锁定状态，并在微信返回后落库前再次复核。中途状态变化时先关微信订单，关单成功后才本地取消。微信下单请求的 `time_expire` 使用服务端订单 `expiresAt`；进入收银台等待阶段后订单主状态为 `PENDING`。

~~~json
{
  "orderId": "ord_xxx",
  "status": "PENDING",
  "paymentParams": {
    "timeStamp": "1787215000",
    "nonceStr": "...",
    "package": "prepay_id=...",
    "signType": "RSA",
    "paySign": "..."
  }
}
~~~

客户端只把 `paymentParams` 传给 `wx.requestPayment`。success/cancel/fail只能改变页面提示，不能修改服务端订单或解锁报告。

### GET /v1/orders/:orderId

返回扁平 `OrderDto`。对于PENDING订单，服务端可主动查单并通过同一幂等事务完成状态协调；不论客户端轮询多快，微信侧主动查单至少间隔5秒。

~~~json
{
  "orderId": "ord_xxx",
  "outTradeNo": "PX...",
  "status": "PAID",
  "productCode": "COMPASS_REPORT_SINGLE_39_9",
  "amountFen": 3990,
  "currency": "CNY",
  "reportId": "rpt_xxx",
  "paidAt": "2026-08-20T12:00:00.000Z"
}
~~~

客户端轮询使用退避和最大等待时间；超时显示“仍在确认”，不能自行把订单标为失败。

`PENDING` 到达 `expiresAt` 时不能直接改为取消：服务端先查微信订单；`SUCCESS` 走正常交付，`USERPAYING` 保持等待，只有 `NOTPAY` 且微信关单成功后才写 `CANCELLED`。`CREATED` 且从未预支付的过期订单可本地取消。

微信查单的非成功响应可省略 `payer` 与 `amount`。服务端对 `SUCCESS` 始终严格要求并核对OpenID、3990分、CNY和transaction_id；对 `NOTPAY/CLOSED/USERPAYING` 等状态，appid、mchid、out_trade_no、trade_type仍为必检，amount/payer若返回也必须匹配。

## 7. 微信支付通知

### POST /v1/webhooks/wechat-pay/transactions

- 不使用用户Bearer会话，必须读取原始body；
- 在占用回调处理槽前快速检查必需 `Wechatpay-*` 头、5分钟时间窗及Content-Length；应用层使用128KB上限和5秒body读取期限，服务端设置短headers/request/keepalive timeout；
- 验证 `Wechatpay-*` 请求头、签名时间窗及微信支付公钥ID；
- AES-256-GCM解密resource；
- 核对appid、mchid、out_trade_no、transaction_id、SUCCESS、3990、CNY及付款OpenID；
- provider event ID、transaction_id和权益唯一约束防重；
- 在同一事务中写事件、订单PAID、一次ACTIVE entitlement、报告DELIVERED及一次时间线/交付记录；
- 不在支付后才生成或QA报告。

重复的合法成功通知返回成功，但不能重复授权或交付。无效签名或业务字段不一致返回错误并写脱敏安全记录。

关闭 `PAID_COMPASS_ENABLED` 只阻止新的创单/预支付。若某订单已取得签名支付参数，随后开关关闭或当前Source Catalog被撤回，其通过签名、appid、mchid、金额、币种、transaction_id和付款OpenID校验的成功通知/查单结果仍授予既有锁定报告权益，避免扣款后拒绝交付。目录异常须进入人工事故与退款流程，不能用静默不交付代替退款。

### POST /v1/webhooks/wechat-pay/refunds

执行同等的原始body验签、解密、字段核对和幂等处理。当前安全默认是退款成功后把该订单的 entitlement 改为 `REVOKED`；`SUCCESS` 为单调终态，后到的 `PROCESSING/CLOSED/ABNORMAL` 不得恢复访问或倒退账本。持久化对账任务每分钟扫描 `PROCESSING`：正常情况主动查退款；若只落了退款意图、尚无provider退款ID，则以同一 `out_refund_no` 幂等重放申请，再通过验签查询进入相同迁移。任何保留或恢复访问的例外须等OD-07批准并修改合同测试。

## 8. 完整报告、PDF与反馈

### GET /v1/reports/:reportId

无ACTIVE entitlement时只返回预览：

~~~json
{
  "access": "preview",
  "reportId": "rpt_xxx",
  "status": "LOCKED",
  "preview": {},
  "entitled": false
}
~~~

有ACTIVE entitlement且报告已DELIVERED时返回：

~~~json
{
  "access": "full",
  "reportId": "rpt_xxx",
  "status": "READY",
  "deliveryStatus": "DELIVERED",
  "qaPassed": true,
  "entitled": true,
  "preview": {},
  "full": {
    "modules": [
      { "key": "student_profile", "title": "学生成长画像", "summary": "...", "items": [] },
      { "key": "strengths", "title": "优势能力分析", "summary": "...", "items": [] },
      { "key": "major_directions", "title": "推荐专业方向", "summary": "...", "items": [] },
      { "key": "university_match", "title": "大学与专业匹配", "summary": "...", "items": [] },
      { "key": "routes", "title": "升学路线建议", "summary": "...", "items": [] },
      { "key": "action_plan", "title": "未来6—24个月时间规划", "summary": "...", "items": [] }
    ],
    "sources": [
      { "sourceId": "...", "applicableYear": "2026", "verifiedAt": "2026-08-20", "dataVersion": "..." }
    ],
    "dataAsOf": "2026-08-20",
    "versions": {
      "studentVersion": "v1",
      "ruleVersion": "v1",
      "dataVersion": "v1",
      "promptVersion": "v1",
      "templateVersion": "v1"
    },
    "confidence": "medium",
    "disclaimer": "..."
  },
  "capabilities": {
    "agentFollowup": {
      "available": true,
      "reasonCode": null,
      "maxRepliesPerReport": 3,
      "remainingReplies": 3,
      "activeConversationId": null,
      "consentStatus": null,
      "hasConversations": false,
      "managementAvailable": false
    }
  }
}
~~~

`agentFollowup.available=true` 只表示当前用户满足进入独立同意/创建会话流程的服务端条件，不代表已经同意，也不能替代后续每次消息、任务领取、结果提交和正文返回时的完整复核。退款或撤权后 `available=false`，但有历史会话时可通过 `hasConversations/managementAvailable` 暴露无正文删除入口。

### GET /v1/reports/:reportId/pdf

先验证当前用户所有权和ACTIVE entitlement，再返回临时 `application/pdf` 文件流/受控下载。不得返回可永久公开或跨用户复用的对象地址；客户端把本次响应写入临时文件后调用 `wx.openDocument`。

### POST /v1/reports/:reportId/feedback

请求：

~~~json
{
  "rating": 5,
  "tags": ["方向清晰"],
  "comment": "...",
  "advisorContactRequested": false
}
~~~

仅已解锁报告可提交。服务端限制评分、标签数量/长度及comment长度；日志和analytics不得复制comment全文。

## 9. 双分析与已购报告 Agent

所有接口复用当前 Bearer 会话和统一错误 envelope。`Idempotency-Key` 限制字符集/长度；客户端不得提交 owner、模型、Prompt、tools、`previous_response_id`、测评答案或报告内容。小程序的`mode=free/paid`只决定调用哪个资源路径和展示文案，不是权限事实；服务端必须按路径重新验证owner、来源状态和同意。所有创建接口只入队，实际 Provider 调用由异步 Agent worker 执行；HTTP 202 不是分析已经完成。

V0.5 Education Compass 的合同以 [`education-compass-v0.5.0.openapi.yaml`](./openapi/education-compass-v0.5.0.openapi.yaml) 为准。旧 `ai_agent_guardian_v1 / ai_education_agent` 只兼容 legacy 测评/报告；V0.5 必须使用 `agent_analysis_opt_in_v1.0.0-rc1 / AI_ANALYSIS`，并由学生本人和监护人分别确认。

三条路径的服务端报告/测评上下文使用同一个精确12字段白名单：`school_stage`、`education_system`、`target_enrollment_year`、`learning_feeling`、`strengths`、`challenges`、`parent_expectation`、`target_region`、`route_preference`、`backup_route_acceptance`、`available_time`、`support_need`。这12项都是问卷合同中的受控选项；不得发送姓名、电话、邮箱、学校、精确地址、OpenID、家庭/学生客户资料、问卷自由文本、六模块报告原文、支付或飞书信息。`REPORT_FOLLOWUP` 只可在该安全上下文之外增加经本地 PII、危机、注入和越权检查的用户追问文本及有限轮会话上下文；两个一次性分析没有客户自写消息。

### POST /v1/assessments/:assessmentId/agent-analyses

创建一次免费、有限的测评分析。Headers包含`Authorization`和`Idempotency-Key`；V0.5 body只允许固定、平铺的独立 AI 同意：

~~~json
{
  "consentVersion": "agent_analysis_opt_in_v1.0.0-rc1",
  "scope": "AI_ANALYSIS",
  "guardianConfirmed": true,
  "studentConfirmed": true,
  "locale": "zh-CN"
}
~~~

服务端必须验证当前用户拥有该测评、测评为 `PREVIEW_READY`、完整度至少70、关联收费前报告QA通过且原始监护人同意有效，并只构建上述12字段上下文。该免费分析不要求订单或 `ACTIVE entitlement`，但仍要求本次独立AI同意。客户端不能提交答案、studentId或reportId。

### POST /v1/reports/:reportId/agent-analyses

创建一次 ¥39.90 已购完整报告整体分析。Headers/body与免费分析相同，但服务端还必须验证owner、`ACTIVE` entitlement、`READY/DELIVERED`、`qaPassed=true`和六模块已存在；送往 Provider 的报告上下文仍只包含上述12个受控选项及服务端来源别名，不发送六模块原文、问卷自由文本或客户资料。不能因客户端从报告页进入就省略任何门禁。

两个POST都返回202；相同key/相同输入复用原run：

~~~json
{
  "runId": "arun_xxx",
  "status": "QUEUED",
  "analysisType": "ASSESSMENT_ANALYSIS",
  "retryAfterMs": 1000
}
~~~

付费报告分析的`analysisType`为`REPORT_ANALYSIS`。

### GET /v1/agent-analyses/:runId

只允许owner，并按分析类型重新检查测评/报告访问条件与专项同意。`QUEUED/RUNNING`返回状态和`retryAfterMs`；终态使用与报告追问相同的`reply` DTO、可信来源映射和稳定安全错误，不返回内部Prompt/provider标识。小程序最多轮询60次或2分钟，隐藏/卸载页面立即停止timer。

### GET /v1/assessments/:assessmentId/agent-analyses/latest

### GET /v1/reports/:reportId/agent-analyses/latest

用于页面重开后从服务端恢复最近一次结果，不依赖`wx storage`。返回`{"analysis":null}`或`{"analysis":AgentRunDto}`；服务端仍需按资源类型重新鉴权。小程序不保存runId、回复、测评答案或报告正文。当前合同没有 `GET /v1/assessments/:assessmentId/agent-analyses` 或 `GET /v1/reports/:reportId/agent-analyses` 集合列表接口；读取单个run使用 `/v1/agent-analyses/:runId`，恢复最近一次只使用 `/latest`。

**已购报告追问接口**

以下conversation接口是最多3次的已购报告追问，与上面两个一次性分析明确分离。创建会话时，服务端在同一事务中验证owner、合资格家庭角色、`ACTIVE` entitlement、`READY/DELIVERED`、`qaPassed=true`，并创建该报告/会话专属的独立同意。V0.5 仍使用上方五字段 `AI_ANALYSIS` body；legacy 报告才兼容旧三字段 body。追问的报告上下文同样只能使用上述12字段；客户自己的追问文本经本地检查后才可进入异步任务。

### POST /v1/reports/:reportId/agent-conversations

Headers：`Authorization: Bearer ...`、`Idempotency-Key: ...`。

~~~json
{
  "consentVersion": "agent_analysis_opt_in_v1.0.0-rc1",
  "scope": "AI_ANALYSIS",
  "guardianConfirmed": true,
  "studentConfirmed": true,
  "locale": "zh-CN"
}
~~~

成功返回201；同一用户/报告只能有一个 `ACTIVE` 会话，相同幂等键/摘要返回原结果：

~~~json
{
  "conversationId": "acv_xxx",
  "purpose": "REPORT_FOLLOWUP",
  "status": "ACTIVE",
  "created": true,
  "expiresAt": "2026-09-21T12:00:00.000Z",
  "limits": {
    "maxMessageChars": 2000,
    "maxRepliesPerReport": 3,
    "remainingReplies": 3
  }
}
~~~

客户端勾选只是请求内容；服务端必须验证当前认证账号的合资格家庭角色并保存 actor、条款摘要/版本和同意时间。

### POST /v1/agent-conversations/:conversationId/messages

Headers必须包含新的 `Idempotency-Key`；body只允许：

~~~json
{ "message": "请解释报告中主路线与备选路线的差别。" }
~~~

允许入队时返回202：

~~~json
{
  "runId": "arun_xxx",
  "conversationId": "acv_xxx",
  "status": "QUEUED",
  "retryAfterMs": 1000
}
~~~

本地PII/injection/高风险预检阻断时仍返回无正文的终态 `BLOCKED` run和批准的安全文案，不进入worker、不占成功回复额度但计入速率限制。相同key/同摘要返回原run；同key不同消息返回409。客户端重试不创建第二个本地run，但模糊上游超时不承诺OpenAI exactly-once。

### GET /v1/agent-runs/:runId

只允许owner。`QUEUED/RUNNING` 返回状态和 `retryAfterMs`；`FAILED/BLOCKED/CANCELLED` 只返回稳定code与可展示文案。`SUCCEEDED` 在再次检查权益/同意并通过本地QA后返回：

~~~json
{
  "runId": "arun_xxx",
  "conversationId": "acv_xxx",
  "status": "SUCCEEDED",
  "reply": {
    "answer": "...",
    "keyPoints": ["..."],
    "nextSteps": ["..."],
    "limitations": ["仅解释当前报告，不保证录取结果。"],
    "sources": [
      { "alias": "S1", "name": "受信公开来源", "applicableYear": "2027", "dataVersion": "v1", "verifiedAt": "2026-08-20" }
    ],
    "safety": { "level": "STANDARD", "requiresGuardianAttention": false }
  }
}
~~~

`sources` 由服务端把模型返回的alias映射为当前报告的受信公共来源DTO；客户端不得自行构造来源。响应不含SDK stack、Prompt、冻结请求、provider body或response id。

### GET /v1/agent-conversations/:conversationId/messages?cursor=&limit=20

只有owner且当前权益、同意和会话仍有效时返回解密后的有限分页消息；`limit` 有服务端上限。不返回system Prompt、上游标识、内部安全规则或密钥。退款/撤权后正文读取返回403。

### GET /v1/reports/:reportId/agent-conversations

owner可读取该报告的无正文管理摘要，包括活动/关闭/退款会话和同意状态；不要求当前 `ACTIVE` entitlement，以保证所有保留内容均可发现并删除。响应只包含不透明资源ID、状态和时间，不包含任何消息或Prompt。

### DELETE /v1/agent-conversations/:conversationId

owner可在任何权益状态下执行；204幂等。服务端关闭会话、撤回其专属同意、fence未完成run并清理在线敏感内容。商业撤权不能阻断另行提供的法定数据访问、删除或申诉流程。

### DELETE /v1/agent-conversations/:conversationId/consent

owner撤回专项同意；204幂等。关闭会话、取消/隔离未完成任务，迟到模型结果不得保存或展示。撤回后仍可调用会话DELETE。

### DELETE /v1/me/ai-analysis-consents/:studentId

V0.5 owner 可独立、幂等撤回该学生的 `AI_ANALYSIS` 授权；成功返回 `enabled=false` 的版本化状态，并关闭该学生仍活动的 Agent 会话。该接口不撤回核心测评同意、学生 assent、飞书资料镜像或顾问联系同意。

小程序轮询最多60次或2分钟，页面隐藏/卸载停止timer；达到上限时保留内存中的runId并提示稍后刷新。小程序不把消息、回复、报告或Prompt写入本地长期存储。

## 10. 管理退款

### POST /v1/admin/orders/:orderId/refunds

仅服务端admin RBAC。请求包含受控 `idempotencyKey` 和 `reason`；退款金额由服务端从原订单和政策计算，普通客户端不能指定任意金额。接口、微信退款通知和主动查退款共享幂等状态迁移并写审计。

在退款政策未批准前，不向家庭用户开放自助退款按钮。

## 11. 飞书运营镜像管理接口

飞书接口只供服务端授权管理员查看同步状态和触发核对。普通家庭用户、客户端角色字段或飞书成员身份不能获得管理员权限。接口不接受飞书记录反向修改业务数据。

### GET /v1/admin/integrations/feishu/status

使用 `Authorization: Bearer <admin-token>`。响应：

~~~json
{
  "enabled": true,
  "projectionVersion": "phoenix_feishu_ops_v1",
  "customerProfileFieldsEnabled": false,
  "configuredEntities": [
    "family_profile",
    "student_profile",
    "assessment_session",
    "report_job",
    "order_payment",
    "feedback",
    "advisor_request"
  ],
  "counts": {
    "PENDING": 0,
    "PROCESSING": 0,
    "SYNCED": 42,
    "FAILED": 0,
    "BLOCKED": 0
  },
  "schema": {
    "state": "VALID",
    "checkedAt": "2026-08-21T09:59:50.000Z",
    "errorCode": null
  },
  "lastSyncedAt": "2026-08-21T10:00:00.000Z"
}
~~~

`enabled=false` 只表示飞书 Gateway 关闭，不表示后端或微信支付异常。`customerProfileFieldsEnabled` 对应默认关闭的 `FEISHU_CUSTOMER_PROFILE_FIELDS_ENABLED`；只有飞书总开关已开启且隐私、未成年人数据、访问控制、保留/删除审批齐全时才可为 `true`。允许的扩展字段精确为家庭 `family_name/parent_name/phone/location/goal` 与学生 `student_name/age/gender/school/education_system/grade/interest/goal`，客户资料只进入这两张镜像表，不进入 Agent/OpenAI。`schema.state` 为 `DISABLED / UNKNOWN / VALID / INVALID`；`lastSyncedAt` 在尚无成功记录时为 `null`。

### POST /v1/admin/integrations/feishu/validate-schema

强制读取7张远端表的字段元数据，校验合同英文字段、单行文本/数字类型和主字段。成功返回：

~~~json
{
  "state": "VALID",
  "checkedAt": "2026-08-21T09:59:50.000Z",
  "errorCode": null
}
~~~

校验失败返回503并在状态接口留下 `INVALID` 和脱敏错误码；任何记录写入前也会执行相同预检（成功结果缓存15分钟）。

### POST /v1/admin/integrations/feishu/reconcile

请求必须带 JSON 对象；`limit` 可省略，允许1—200：

~~~json
{ "limit": 50 }
~~~

响应为202：

~~~json
{
  "enabled": true,
  "discovered": 42,
  "attempted": 12,
  "succeeded": 11,
  "failed": 1,
  "skipped": 30
}
~~~

当前接口在请求内完成核对后返回202，不返回异步 `jobId`。调用会把 `BLOCKED` 记录重新排入队列，因此只能在根因修复后由管理员使用。逐条飞书错误会进入 `integration_links` 的 `FAILED/BLOCKED` 状态，本轮通常仍返回摘要；不得因为 `failed > 0` 回滚或修改业务订单。字段合同、配置和排障见 [飞书配置手册](FEISHU_BITABLE_SETUP.md) 与 [飞书同步运行手册](FEISHU_SYNC_RUNBOOK.md)。

## 12. 主要错误码

| HTTP | code | 含义 |
| --- | --- | --- |
| 400 | INVALID_JSON / INVALID_ANSWERS | 请求或answers结构无效 |
| 400 | UNKNOWN_ANSWER_FIELDS / ANSWER_SCHEMA_MISMATCH | 问卷字段合同不一致 |
| 403 | GUARDIAN_CONSENT_REQUIRED | 缺少或撤回监护人同意 |
| 403 | REPORT_PAYMENT_REQUIRED | 无完整报告/PDF权益 |
| 403 | AGENT_CONSENT_REQUIRED / AGENT_ACCESS_REVOKED | Agent专项同意缺失、撤回或权益已失效 |
| 403 | ADMIN_REQUIRED | 当前会话不是服务端授权管理员 |
| 404 | *_NOT_FOUND | 资源不存在 |
| 409 | ASSESSMENT_ALREADY_SUBMITTED | 已提交快照不可覆盖 |
| 409 | AGENT_ASSESSMENT_NOT_READY | 免费测评尚未完成提交、完整度或安全快照门槛 |
| 409 | AGENT_ANALYSIS_IS_ONE_SHOT | 一次性测评/报告分析不接受追加消息 |
| 409 | REPORT_NOT_LOCKED / REPORT_QA_REQUIRED | 报告未达到收费前门槛 |
| 409 | ORDER_STATE_CHANGED / ORDER_NOT_PAYABLE | 订单状态不允许操作 |
| 409 | IDEMPOTENCY_KEY_REUSED / AGENT_RUN_PENDING / AGENT_REPLY_LIMIT_REACHED | Agent幂等冲突、会话已有未决任务或成功回复额度用尽 |
| 503 | PAID_COMPASS_DISABLED | 购买开关关闭，禁止新的创单或预支付 |
| 503 | SOURCE_CATALOG_NOT_VERIFIED | 生产来源目录未审核，禁止购买 |
| 503 | FEISHU_INTEGRATION_UNAVAILABLE | 当前服务实例未配置飞书同步依赖 |
| 503 | AGENT_DISABLED / AGENT_UNAVAILABLE | Agent关闭、worker/provider不可用；报告与支付仍应可用 |
| 400 | FEISHU_SYNC_LIMIT_INVALID | 手动核对批量不在1—200 |
| 503 | FEISHU_SCHEMA_FIELD_MISSING / FEISHU_SCHEMA_FIELD_TYPE_MISMATCH / FEISHU_SCHEMA_PRIMARY_FIELD_MISMATCH | 远端飞书表不符合字段合同，外写停止 |
| 502 | WECHATPAY_* | 微信支付请求、响应或验证失败 |

最终代码如调整DTO或飞书投影，必须同时更新小程序services适配、此合同、飞书7表字段手册和服务端合同测试。本文档不表示已配置真实AppID、商户号、真实支付环境、飞书App或多维表格。
