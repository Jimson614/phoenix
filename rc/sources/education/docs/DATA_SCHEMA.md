# 数据结构与状态不变量 V0.4.1

本文定义 Education Compass 免费分析、¥39.90 付费路径、报告总分析及已购报告追问的服务端持久化合同。TypeScript领域模型、不可变的`001_initial_schema.sql`/`002_feishu_bitable_integration.sql`/`003_openai_agent.sql`、新增`004_dual_agent_analysis.sql`和自动化测试必须一致。PostgreSQL migration 是生产部署的结构事实；客户端 demo/local 存储和飞书多维表格都不是生产数据库。

当前仓库仅包含 Schema、适配器和测试，没有证明外部 PostgreSQL 或飞书已经部署。

## 1. 问卷合同

- 共同合同为 `models/questionnaire-contract.json`。
- `education_compass_v1` 包含23个答案键，总权重100，付费预览门槛70。
- 小程序按合同渲染，服务端按同一键名、类型和权重重新验证。
- remote最终提交前，客户端先写草稿再读回；任一已填键缺失或变化时以 `ANSWER_SCHEMA_MISMATCH` 阻断提交和结账。
- `assessments.answers` 使用 JSONB，随 `questionnaire_version` 和 `student_version` 保存不可变快照；未来合同不得静默重新解释旧答案。

## 2. PostgreSQL 核心记录

### 2.1 身份与家庭

- `users`：内部用户和角色，当前为 `family_user` 或 `admin`。
- `wechat_identities`：唯一OpenID、可选UnionID和所属用户；不得返回小程序。
- `sessions`：bearer token摘要、过期和撤销时间；不保存原始token。
- `families`：当前MVP中一个用户的家庭档案。
- `students`：家庭中的孩子及 `student_version` 快照标识。
- `guardian_consents`：`education_compass_report` 目的的肯定监护人同意、版本、同意时间和可选撤销时间。

### 2.2 测评与报告

- `assessments`：用户/家庭/学生/同意关联、合同和学生版本、答案快照、完整度、缺失项、状态及报告引用。
- `reports`：白名单预览、六模块完整报告、来源、版本、置信度、免责声明、QA和交付状态。
- `report_jobs`：报告生成和QA的可审计结果。当前SKU在创单前生成；只有确有业务需要时才关联订单。

完整报告的模块键固定为：

1. `student_profile`
2. `strengths`
3. `major_directions`
4. `university_match`
5. `routes`
6. `action_plan`

每条来源包含 `sourceId`、`applicableYear`、`verifiedAt` 和 `dataVersion`。报告还保存不可变的 `sourceCatalogVerified` 与 `sourceCatalogVersion` 证据。

### 2.3 交易与权益

- `products`：服务端商品代码、整数分金额、币种、权益范围和启用状态。
- `orders`：不可变商品/金额/币种快照、用户/家庭/学生/测评/报告关联、幂等键、Provider标识、状态和时间。
- `payment_events`：唯一Provider事件ID、订单、可信body摘要和处理时间，是回调幂等账本。
- `entitlements`：一笔订单到一份报告的 `ACTIVE` 或 `REVOKED` 访问授权。
- `refunds`：退款单号、管理员、请求幂等键、原因、Provider标识、金额和状态。

当前商品为 `COMPASS_REPORT_SINGLE_39_9`、3990分、`CNY`、`SINGLE_REPORT`。`PHOENIX_MEMBER_199` 是独立且停用的会员SKU，永远不能满足单份报告权益检查。

### 2.4 跟进与审计

- `report_feedback`：1—5评分、标签、评论和顾问联系意向。
- `advisor_requests`：期望联系时间、主题、备注及可选学生/报告关联。
- `timeline_events`：家庭可见里程碑。
- `audit_logs`：安全、管理和关键业务操作轨迹。

### 2.5 双分析与已购报告 Agent

`003_openai_agent.sql` 前向新增以下实体；`004_dual_agent_analysis.sql` 只扩展conversation用途与活动唯一索引。001—003均可能已应用，不得修改：

- `agent_consents`：绑定owner/family/student/report，固定scope `ai_education_agent`、版本 `ai_agent_guardian_v1`，记录合资格家庭角色、actor、条款摘要、同意与撤回时间；每条同意只供一个会话引用。
- `agent_conversations`：绑定owner/family/student/report/consent，purpose为 `REPORT_FOLLOWUP / ASSESSMENT_ANALYSIS / REPORT_ANALYSIS`，状态 `ACTIVE/CLOSED/EXPIRED`，保存Prompt版本、创建幂等与过期/关闭时间。活动唯一索引为 `(user_id, report_id, purpose)`，同一user/report可分别拥有每种purpose的活动conversation，但同一purpose最多一个。
- `agent_messages`：角色 `USER/ASSISTANT`、AES-256-GCM `content_envelope`、安全状态和时间；禁止明文content列。
- `agent_runs`：`QUEUED/RUNNING/SUCCEEDED/FAILED/BLOCKED/CANCELLED`、消息幂等HMAC、输入HMAC、加密冻结请求、report/context版本摘要、provider/model/prompt、attempt/lease/fence/错误/token/time；默认不保存OpenAI response id。
- `agent_worker_heartbeats`：随机worker实例ID、build version、started/lastSeen和无正文健康状态，短保留期。

关键约束：

- 每个user message恰好一个run；同一会话最多一个 `QUEUED/RUNNING`；终态单调。
- 每份报告按user+report跨全部会话累计最多3个成功回复；入队时原子预留 `SUCCEEDED+QUEUED+RUNNING`。
- provider调用在事务外。PostgreSQL repository使用租约/`FOR UPDATE SKIP LOCKED`与fencing；迟到worker不能提交。
- 退款、同意撤回、报告版本变化或会话关闭使未完成run进入 `CANCELLED`，清冻结请求并丢弃上游输出。
- 客户端幂等只保证一个本地run；上游模糊超时可能至少一次执行，不能宣称OpenAI exactly-once。

`ASSESSMENT_ANALYSIS`与`REPORT_ANALYSIS`各自是一次性run，不接受消息追加；`REPORT_FOLLOWUP`才使用最多3次成功回复额度。免费分析门禁为owner、有效AI/原监护人同意、`PREVIEW_READY`、完整度至少70及关联报告QA；不要求付费权益。报告总分析与追问每阶段都要求owner、`ACTIVE entitlement`、`READY/DELIVERED`、QA通过和六模块存在。

三种purpose冻结请求中的报告/测评上下文只允许12个受控答案键：`school_stage`、`education_system`、`target_enrollment_year`、`learning_feeling`、`strengths`、`challenges`、`parent_expectation`、`target_region`、`route_preference`、`backup_route_acceptance`、`available_time`、`support_need`。客户资料、自由文本答案和六模块原文禁止进入；`REPORT_FOLLOWUP`只额外保存/发送经本地安全检查的客户追问文本及有限轮上下文。

消息与冻结请求的envelope包含algorithm/key version、唯一随机96-bit IV、ciphertext、authentication tag，并用AAD绑定表、记录、角色、会话和版本。Keyring中每个Base64 Key解码后严格32字节；当前Key加密、旧Key仅用于读取未过期内容。内容Key不复用session、飞书伪名或OpenAI safety key；输入/幂等digest使用用途域分离的HMAC，不使用裸SHA。

## 3. 飞书同步映射账本

`002_feishu_bitable_integration.sql` 创建 `integration_links`：

| PostgreSQL字段 | 含义 |
| --- | --- |
| `id` | 内部映射ID |
| `provider` | 固定 `feishu_bitable` |
| `table_id` | 目标飞书Table ID |
| `entity_type` | 7类投影之一 |
| `entity_id` | PostgreSQL内部实体ID，仅留在主库 |
| `external_record_id` | 飞书 `record_id` |
| `payload_digest` | 最近成功投影的SHA-256摘要 |
| `status` | `PENDING / PROCESSING / SYNCED / FAILED / BLOCKED` |
| `attempts` | 当前连续处理尝试数 |
| `lease_token` | 当前120秒处理租约的随机标识 |
| `operation_token` | 当前未知结果可安全重放的随机UUIDv4 `client_token` |
| `operation_digest` | 冻结操作的字段摘要 |
| `operation_body` | 冻结操作的序列化脱敏飞书请求体 |
| `last_error_code` | 最近脱敏错误码 |
| `next_attempt_at` | 租约或下次重试时间 |
| `last_synced_at` | 最近成功时间 |
| `created_at / updated_at` | 映射记录时间 |

唯一约束：

- `(provider, table_id, entity_type, entity_id)`；
- `(provider, table_id, external_record_id)`。

它只保证内部实体和飞书记录的幂等映射，不参与订单、退款、权益或报告事务，也不保存飞书密钥。`operation_body` 只能包含第4节白名单字段；失败/未知响应期间使用同一 token 和同一 body 重放，成功后清空冻结操作字段。

## 4. 七张飞书表的精确英文字段

所有表都会附加 `schema_version=phoenix_feishu_ops_v1` 和 `source_updated_at`。所有ID都是 HMAC生成的 `PHX-...` 伪名ID，不是PostgreSQL主键；稳定伪名仍可关联，必须按受保护数据处理，不能宣称已经匿名化。

| 实体/环境变量 | 唯一字段 | 精确字段列表 |
| --- | --- | --- |
| `family_profile` / `FEISHU_BITABLE_TABLE_FAMILY_PROFILE` | `family_id` | 核心：`family_id`, `status`, `created_at`, `schema_version`, `source_updated_at`；扩展开关开启后仅增加：`family_name`, `parent_name`, `phone`, `location`, `goal` |
| `student_profile` / `FEISHU_BITABLE_TABLE_STUDENT_PROFILE` | `student_id` | 核心：`student_id`, `family_id`, `student_version`, `created_at`, `schema_version`, `source_updated_at`；扩展开关开启后仅增加：`student_name`, `age`, `gender`, `school`, `education_system`, `grade`, `interest`, `goal` |
| `assessment_session` / `FEISHU_BITABLE_TABLE_ASSESSMENT_SESSION` | `session_id` | `session_id`, `family_id`, `student_id`, `questionnaire_version`, `student_version`, `status`, `completeness`, `submitted_at`, `created_at`, `schema_version`, `source_updated_at` |
| `report_job` / `FEISHU_BITABLE_TABLE_REPORT_JOB` | `report_id` | `report_id`, `family_id`, `student_id`, `assessment_id`, `status`, `delivery_status`, `qa_status`, `data_version`, `rule_version`, `prompt_version`, `template_version`, `source_catalog_version`, `data_as_of`, `created_at`, `schema_version`, `source_updated_at` |
| `order_payment` / `FEISHU_BITABLE_TABLE_ORDER_PAYMENT` | `order_id` | `order_id`, `family_id`, `student_id`, `assessment_id`, `report_id`, `product_code`, `amount_fen`, `currency`, `channel`, `status`, `paid_at`, `refunded_at`, `created_at`, `schema_version`, `source_updated_at` |
| `feedback` / `FEISHU_BITABLE_TABLE_FEEDBACK` | `feedback_id` | `feedback_id`, `report_id`, `rating`, `consult_intent`, `created_at`, `schema_version`, `source_updated_at` |
| `advisor_request` / `FEISHU_BITABLE_TABLE_ADVISOR_REQUEST` | `request_id` | `request_id`, `family_id`, `student_id`, `report_id`, `status`, `created_at`, `schema_version`, `source_updated_at` |

`completeness`、`amount_fen`、`rating`以及扩展字段`age`为数字；其余字段按当前API载荷为字符串。所有 `*_at`、`data_as_of` 和 `source_updated_at` 当前发送RFC 3339/日期字符串，飞书必须按单行文本建字段。空值会从投影中省略。

`FEISHU_CUSTOMER_PROFILE_FIELDS_ENABLED` 默认 `false`，此时姓名、联系方式等扩展资料均不进入飞书。只有飞书总开关开启且隐私/未成年人数据、最小权限、保留/删除审批齐全时才能开启；运行时精确白名单只允许上表列出的家庭5项和学生8项，且只进入family/student表。无论开关状态都禁止：邮箱、OpenID/UnionID、内部ID、监护人身份、问卷答案/开放回答、报告预览/正文/PDF、Agent内容、Source正文、Prompt、商户订单号、交易号、通知ID、回调原文、退款原因、权益、幂等键和密钥。详细字段类型见 [飞书配置手册](FEISHU_BITABLE_SETUP.md)。

## 5. 状态机

### 5.1 测评与报告

```text
assessment DRAFT
  -> 验证同意 + 23字段合同 + completeness >= 70
  -> 使用verified来源快照运行硬规则并生成六模块
  -> 事实/安全QA通过
  -> assessment PREVIEW_READY
  -> report status=LOCKED, deliveryStatus=LOCKED, qaPassed=true

可信支付通知或主动查单
  -> entitlement ACTIVE
  -> report status=READY, deliveryStatus=DELIVERED
```

所有报告正文在收费前生成和锁定。placeholder目录、模块不完整、生成/QA失败、来源未核验或非 `LOCKED` 报告必须阻断创单和预支付。支付成功不生成或重写报告，只授予访问并标记交付。

### 5.2 订单

```text
CREATED -> PENDING -> PAID
   |          |
   +----------+-> FAILED or CANCELLED
PAID -> REFUNDING -> REFUNDED
```

`PENDING` 是Provider付款中的规范状态。同一 `(user_id, idempotency_key)` 返回同一订单；Provider交易ID和事件ID唯一。同一测评和SKU已有有效权益或已支付订单时不得二次扣款。

`orders.expires_at` 作为微信 `time_expire`。`orders.last_provider_query_at` 协调至少5秒的主动查单间隔。过期 `CREATED` 可本地取消；过期 `PENDING` 必须先查微信，只有 `NOTPAY` 且关单成功后才转 `CANCELLED`。`USERPAYING` 保持等待，`SUCCESS` 交付。

### 5.3 飞书映射

```text
无映射/投影变化
  -> PROCESSING（120秒租约）
  -> SYNCED
  ↘ FAILED -> 到达next_attempt_at后重新PROCESSING
  ↘ BLOCKED（不可重试或第8次失败；仅管理员修复根因后重排）
```

投影摘要未变的 `SYNCED` 记录跳过。可重试失败从30秒指数退避并加入抖动，最长6小时；不可重试或连续尝试达到8次进入 `BLOCKED`。飞书状态不得反向驱动任何业务状态。

### 5.4 Agent

```text
免费：合格PREVIEW_READY测评 + 专属同意 + ASSESSMENT_ANALYSIS conversation
付费总分析：ACTIVE entitlement + READY/DELIVERED/QA + 专属同意 + REPORT_ANALYSIS conversation
付费追问：ACTIVE entitlement + READY/DELIVERED/QA + 专属同意 + REPORT_FOLLOWUP conversation
  -> 固定一次性请求或USER追问加密 + run QUEUED
  -> RUNNING（租约/fence）
  -> SUCCEEDED（QA后加密ASSISTANT消息）
  ↘ FAILED / BLOCKED / CANCELLED

同意撤回、退款、报告版本变化、关闭或到期
  -> conversation CLOSED/EXPIRED
  -> 未完成run CANCELLED
  -> 正文访问撤销并按保留策略清理
```

每次创建、领取、提交和正文返回均重检owner、对应资源状态与专项同意。免费分析不检查付费权益；报告总分析和追问均重检`ACTIVE` entitlement、报告 `READY/DELIVERED`与`qaPassed=true`。只有追问接受消息并累计三次成功回复；删除/新建会话不能重置额度。

## 6. 事务边界

测评提交必须一次性提交以下收费前快照：

- 同意、所有权和问卷验证；
- `PREVIEW_READY` 测评；
- 包含来源/版本证据、`qaPassed=true`、`LOCKED/LOCKED` 的六模块报告；
- 成功报告任务、审计和时间线。

可信支付成功必须一次性提交：

- 幂等 `payment_events`；
- 订单 `PAID`、Provider交易号和付款时间；
- 该订单/报告恰好一个 `ACTIVE` entitlement；
- 报告 `READY/DELIVERED`；
- 支付/交付时间线与审计。

事务失败时不得部分可见。通知重试、主动查单和退款补偿必须安全。退款 `SUCCESS` 是单调终态，迟到的 `PROCESSING / CLOSED / ABNORMAL` 不能覆盖成功或恢复权益。

`PAID_COMPASS_ENABLED=false` 默认拒绝新创单和预支付，但不参与可信成功交易的最终交付判断：此前已签发支付参数的交易完成后仍必须获得收费前锁定报告。

飞书写入发生在独立的最终一致流程中，不属于上述事务。支付事务提交后即使飞书不可用，也必须及时向微信应答并让家庭读取权益。

Agent入队事务只写Agent自有表与无正文审计；OpenAI网络调用发生在独立worker且不占支付事务。支付/退款/报告/飞书代码可以写各自既有记录，但不得同步调用Agent provider。Agent结果提交使用短事务和fence复核，任何前置条件失效都不能保存正文。

## 7. Source Catalog 与 PDF

- 生产必须使用 `SOURCE_CATALOG_MODE=verified` 和通过Schema、已批准的 `SOURCE_CATALOG_PATH`；缺失或错误时fail closed。
- `placeholder` 只允许本地/demo，不能创建真实订单或预支付参数。
- 规则和经审核数据决定事实，AI可改善表达但不能创造学校、排名、录取概率或保证。
- PDF只在鉴权和ACTIVE entitlement后返回临时文件流/短时下载，不暴露永久公开URL，也不同步飞书。

## 8. 隐私、删除与运行

- 仅保存教育报告目的所需数据；日志不得含 bearer token、支付证书、完整回调密文、学生答案正文或不必要的未成年人标识。
- Agent消息和冻结请求默认30天、可配置但上限90天；关闭/删除/到期先撤销访问并清在线敏感列，缓存/备份按批准SLA到期，不虚称即时物理擦除。
- 退款后产品API拒绝Agent正文，但owner仍可读取无正文管理摘要、撤回同意和删除；商业权益不能阻断另行提供的法定数据访问/删除/申诉流程。
- 同意撤回、保留/删除期限、静态加密/KMS、备份恢复和生产访问角色仍需部署政策与验证；Schema存在不等于外部环境已配置。
- 当前飞书同步不会自动删除历史镜像。客户资料扩展开关默认关闭；若曾开启，停用时先关闭开关并取消未成功的敏感冻结体，再按批准SOP清理既有单元格、导出/备份与访问权限并保留必要审计。关闭开关不等于历史删除完成。
- 当前空值会从飞书投影中省略，不会清空远端旧值；删除传播、tombstone和保留期自动化尚未实现。
- Schema变更必须提供migration，并通过 `npm.cmd --prefix server run db:migrate` 验证空PostgreSQL能按 `001→002→003→004` 依次应用；还要验证已应用001—003的库可前向应用`004_dual_agent_analysis.sql`。001—003 checksum不可改变；004已被双分析占用，后续调整新增005或更高，不回写历史。
- 飞书字段变更必须同步更新投影代码、自动化、API合同和两份飞书手册。
