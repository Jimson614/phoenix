# Phoenix Family OS 原生小程序付费与Agent架构 V0.4.1

## 1. 产品边界

当前可交付闭环是：

家庭档案 → 孩子档案 → Education Compass → 免费预览/有限测评分析 → ¥39.90 单次微信支付 → 六模块报告/PDF → 完整报告AI总分析 → 独立AI同意与有限报告追问 → 家庭时间线 → 顾问跟进。

可操作角色仍为 family_user 与 server-authorized admin。Partner 与 Permission 保留未来模型；任何合作方都不能绕过家庭授权。PHOENIX_MEMBER_199 仅保留独立类型，不在本版本建设会员购买入口。

## 2. 信任边界

~~~mermaid
flowchart LR
  MP[原生微信小程序] -->|HTTPS + opaque session| API[可信 API]
  API --> AUTH[微信 code2Session]
  API --> DB[(PostgreSQL)]
  DB --> FSYNC[脱敏投影与重试]
  FSYNC -.->|单向最终一致| FEISHU[(飞书多维表格运营镜像)]
  API --> RULES[硬规则与报告 QA]
  API --> PAY[WeChat Pay API v3]
  PAY -->|验签/加密通知| API
  API --> PDF[受控 PDF Renderer/Storage]
  API --> TX[事务性交付状态与时间线]
  API -->|只入队| AQ[(Agent任务/加密内容)]
  AW[独立Agent Worker] -->|租约/Fence| AQ
  AW -->|store:false / 无工具| OAI[OpenAI Responses API]
~~~

小程序属于不可信客户端：

- 金额、SKU、user/family/student id、角色、订单状态和 entitlement 必须由服务端复核；
- AppSecret、session_key、商户私钥、API v3密钥、微信支付验签材料、AI密钥、Prompt和内部规则不得进入小程序；
- 页面隐藏不等于数据隔离，未支付响应从序列化层就不能含 full_content。
- 飞书不在支付信任边界内；飞书状态、人工编辑和自动化均不能确认支付、授予权益、修改退款或交付报告。
- OpenAI不在支付或报告事实边界内；三条 Agent 路径的报告/测评上下文都只由固定12个受控选项构建，不发送六模块原文、问卷自由文本或客户资料，也无数据库、支付、飞书、网络搜索或写操作工具。只有已购追问会额外携带经本地安全检查的用户追问文本及有限轮上下文。
- 小程序页面隐藏和`mode=free/paid`只用于体验；测评owner/提交状态、报告owner/权益/`READY/DELIVERED`/QA、专项同意、配额和会话状态必须由服务端在每个阶段重检。

## 3. 双运行模式

### demo/local

- 用于 touristappid 和自动化/产品演示；
- 使用隔离的 local adapter 与 MockPaymentProvider；
- 必须清晰标识“演示流程、无真实扣款”；
- 不能作为支付、数据隔离或生产验收证据。

### production/remote

- 所有家庭、学生、同意、测评、报告、订单、权益和角色来自可信服务端；
- 构建必须强制 remote adapter；
- PaymentProvider 必须为 wechat；
- 真实配置或通过 schema 校验的 `verified` Source Catalog manifest 缺失时 fail closed，不回退到 mock 或 placeholder。

## 4. 报告与支付顺序

生产发布还有独立的构建信任边界：仓库根目录当前由`app.json`注册16页并含demo/local能力，禁止直接上传；`npm.cmd run build:release`只有在传入HTTPS API与非tourist AppID时才生成`dist/release`。构建器按明确排除规则动态得到当前14页家庭端产物，强制remote并排除本地数据库、demo报告生成器、admin演示页、OpenAI SDK/服务端Prompt及服务端源码。

~~~mermaid
sequenceDiagram
  participant U as 家庭用户
  participant M as 小程序
  participant S as 服务端
  participant W as 微信支付

  U->>M: 同意并完成版本化问卷
  M->>S: 提交不可变测评快照
  S->>S: 23字段完整度/硬规则/生成六模块/QA/LOCKED
  S-->>M: 白名单免费预览
  U->>M: 选择一次性购买 ¥39.90
  M->>S: 幂等创单/预支付
  S->>W: API v3 JSAPI/小程序下单
  W-->>S: prepay_id
  S-->>M: RSA 调起参数
  M->>W: wx.requestPayment
  W-->>M: 前端临时结果
  W->>S: 支付加密通知
  S->>S: 验签、解密、字段核对、事务性授权+DELIVERED
  M->>S: 轮询/读取订单
  S-->>M: PAID + ACTIVE entitlement
  M->>S: 请求完整报告/PDF
  S-->>M: 已预生成六模块或鉴权临时PDF
~~~

六模块必须在收费前已经生成并通过事实/安全QA；支付成功后只授予权益并标记交付，不得在扣款后才生成或QA。前端回调只改变页面提示，不改变服务端订单。回调缺失时由服务端主动查单；两条路径复用同一幂等状态迁移。

`PAID_COMPASS_ENABLED` 是默认关闭的服务端 kill switch。创单与预支付同时要求开关开启、verified Source Catalog版本匹配及报告 `LOCKED/LOCKED + qaPassed`。关闭开关只阻止新的创单/预支付，不阻断通知、查单、退款或既有权益读取。已经取得签名支付参数的交易如在开关关闭或目录撤回后可信成功，仍交付收费前锁定的快照；目录异常作为人工退款/事故事件处置。

## 5. 领域状态

- assessment持久状态：DRAFT → PREVIEW_READY；提交过程中的校验/生成失败以错误返回，不能留下可收费报告。
- report：收费前 `status=LOCKED、qaPassed=true、deliveryStatus=LOCKED`；支付后 `status=READY、deliveryStatus=DELIVERED`；生成/QA失败不得创单。
- order：CREATED → PENDING → PAID；PENDING可进入FAILED/CANCELLED；PAID可进入REFUNDING → REFUNDED。微信预支付携带订单 `time_expire`；到期的PENDING必须先查单，只有 `NOTPAY` 且关单成功后才CANCELLED，`SUCCESS/USERPAYING`分别交付/继续等待。服务端主动查单至少间隔5秒。
- entitlement：ACTIVE 或 REVOKED。

退款成功是单调状态：一旦 `SUCCESS/REFUNDED`，后到的处理中或失败类事件不能让订单、退款或权益倒退。退款申请响应已显示成功或回调丢失时，服务端通过签名验证的主动查退款结果进入同一幂等退款事务。

关键唯一约束：out_trade_no、payment notification id、transaction_id、refund out_refund_no及订单权益。

## 6. 家庭关系与所有权

所有资源都通过服务端关系回到家庭：

- Student.family_id
- GuardianConsent.family_id/student_id
- Assessment.student_id
- Report.assessment_id → Student → Family
- Order.user_id/family_id/student_id/assessment_id/report_id
- Entitlement.user_id/order_id/report_id
- TimelineEvent.family_id
- AdvisorRequest.family_id

客户端本地 ID 不能直接用于创单，除非服务端已经存在同一资源且验证当前用户所有权。

## 7. 规则与AI

前后端以 `models/questionnaire-contract.json` 的23字段、类型和权重为同一问卷合同；remote提交前还会读取服务端草稿核对字段往返。硬规则负责身份资格、招生路线、必需科目、语言门槛、截止日期、完整度、候选集和分档。AI只解释结构化结果，不新增事实、不改分、不推断缺失输入。报告在收费前通过 Source ID、数据日期、禁止承诺词和结构完整性QA。

production 必须加载并验证 `SOURCE_CATALOG_MODE=verified` 指定的 Source Catalog manifest；placeholder、manifest无效、版本不一致、生成失败或QA失败时，创单和预支付均 fail closed。

历史 V0.4.0 新增的 Phoenix Education Agent 框架不参与上述报告生成；V0.4.1 在其已购报告追问基础上增加两个一次性分析。三条路径都使用相同的最小化报告/测评上下文：

- 每轮是`store:false`独立Responses请求；服务端从固定Prompt版本、12字段报告/测评快照重建上下文，追问再附加经检查的当前问题及有限轮本地加密消息；
- 不使用OpenAI Conversation、`previous_response_id`、远端长期记忆或reasoning item回放；
- 只允许strict Structured Outputs且工具列表为空；alias由服务端映射到当前报告受信来源；
- 输入在HTTP层做长度/速率/PII/injection/高风险预检，worker再做一种经当前SDK验证的官方moderation；输出在落库/展示前做来源、安全和越权QA；
- Agent内容采用字段级AES-256-GCM加密，日志、analytics和飞书没有正文；
- 每份报告最多3个成功回复，退款/撤回立即停止新问题与正文读取，但不阻断删除或法定数据请求。

12字段白名单为：`school_stage`、`education_system`、`target_enrollment_year`、`learning_feeling`、`strengths`、`challenges`、`parent_expectation`、`target_region`、`route_preference`、`backup_route_acceptance`、`available_time`、`support_need`。这份白名单排除家庭/学生资料、姓名、电话、学校、精确地址、OpenID、问卷自由文本、六模块原文、支付与飞书信息。

API进程只入队。生产Agent worker是独立进程，使用独立小PostgreSQL pool、HTTP client、并发上限、熔断、租约和fencing；OpenAI慢请求不能耗尽微信webhook资源。Provider调用在事务外，提交结果前再次复核权益、同意、report/context版本和fence。

小程序还把一次性分析分成两个明确产品层级，并共用原生`assessment-analysis`结果页：

- `ASSESSMENT_ANALYSIS`通过assessment资源创建，只使用已提交测评的12个受控选项，输出免费有限概览，不要求付费权益，也不冒充六模块完整报告；
- `REPORT_ANALYSIS`通过report资源创建，只面向已购、已交付、QA通过的完整报告，使用同一12字段安全上下文和服务端来源别名输出一次性整体分析；
- `REPORT_FOLLOWUP`仍是独立conversation能力，提供最多3个成功追问，不与上述一次性分析混同；
- 三条路径均提交固定、独立的监护人AI同意并由服务端鉴权；POST带幂等键，客户端有限轮询，最近一次分析从服务端`latest`接口恢复，不在`wx storage`保存正文或runId。

## 8. PDF与交付

报告正文与PDF只存在于可信服务端。GET report/pdf 在检查 ACTIVE entitlement 后返回鉴权的临时文件流/短时下载；永久对象URL不可公开。退款后的访问、报告期限和重新生成由上线政策配置。

Agent正文与PDF/报告正文采用独立访问路径。Agent失败、队列积压或关闭时，完整报告和PDF继续可用；Agent不能修改报告快照或延迟微信回调。

## 9. 管理员与顾问

生产环境移除公开 Advisor 演示登录。管理员权限由服务端会话和RBAC决定，并对查看未成年人数据、退款、备注和状态变更写审计。客户端 role 只能控制展示，不能授权。

## 10. 飞书运营镜像

九份需求资料记录了从“飞书作为早期低代码主数据”到“关系型数据库成为系统主存储、飞书保留运营与人工审核”的演进。本版本已包含原生小程序和微信支付，因此采用后一种边界：

```text
PostgreSQL事实记录
  → 7类实体白名单
  → 环境隔离的HMAC伪名ID
  → integration_links映射/摘要/状态
  → 飞书按唯一伪名业务ID upsert
```

7类投影为：`family_profile`、`student_profile`、`assessment_session`、`report_job`、`order_payment`、`feedback`、`advisor_request`。默认 `FEISHU_CUSTOMER_PROFILE_FIELDS_ENABLED=false`，只投影伪名核心字段。只有单独完成隐私、未成年人数据、访问控制和保留/删除审批后才能开启；此时新增白名单精确为家庭 `family_name/parent_name/phone/location/goal` 与学生 `student_name/age/gender/school/education_system/grade/interest/goal`。扩展资料只进入这两张镜像表，绝不进入 OpenAI；问卷答案、邮箱、OpenID、报告正文/PDF、Agent内容、支付交易/通知标识、退款原因、权益或密钥始终禁止投影。

当前实现为周期扫描和最终一致核对，不是支付事务中的 outbox：

- 服务启动立即核对一次，此后默认每60秒执行；
- 同一进程内不并发运行多轮，单轮默认尝试50条、最多200条；
- 外写前校验7表必需字段、文本/数字类型和主字段，成功结果缓存15分钟；Schema无效时只降级飞书集成；
- `integration_links` 状态为 `PENDING / PROCESSING / SYNCED / FAILED / BLOCKED`，使用120秒租约；可重试错误按30秒至6小时指数退避并加入抖动，不可重试或8次失败进入 `BLOCKED`；
- 每次外写把随机 UUIDv4 `client_token`、摘要和冻结请求体持久化为 `operation_token / operation_digest / operation_body`，未知结果只能用同一 token 重放同一 body，成功后才清除；
- 字段摘要未变化时跳过写入；已有飞书 `record_id` 时直接更新，否则按伪名唯一字段搜索后upsert；稳定伪名仍按受保护数据处理；
- 飞书写入失败只影响运营镜像，不能让微信回调超时或回滚已完成的业务事务。

管理员状态和手动核对接口受服务端 RBAC 保护。飞书没有反向写入能力；运营增加的公式、视图或标签不能与合同字段同名，更不能触发支付、权益、退款或报告状态。字段和运行细节见 [飞书配置手册](FEISHU_BITABLE_SETUP.md) 与 [同步运行手册](FEISHU_SYNC_RUNBOOK.md)。

当前仓库没有真实飞书凭据、Base或Table ID，不得把代码存在解释为外部飞书已经部署。启用客户资料前必须有审批编号、最小权限成员名单、保留期限、数据主体请求负责人和删除演练证据。停用时先关闭客户资料扩展开关并核对未完成敏感冻结体不再重放，再按SOP清理既有单元格、导出/备份和访问权限并留证；当前同步器不会自动删除飞书记录，关闭开关不等于历史删除完成。

当前飞书同步最多扫描10000条源投影，V0.4.1仍建议先按单实例运行飞书同步；其周期扫描限制与新增的独立Agent worker无关。飞书尚无transactional outbox/独立worker、跨实例全局单飞、按表共享限流、异步reconcile `jobId`、空值清除或删除tombstone；这些是飞书多实例、高容量和正式SLA前的扩展项。

## 11. 视觉策略

继续使用 Phoenix Nova 羽翼 Logo、Phoenix Navy、Phoenix Gold、Ivory White、宋体标题和长期陪伴感。预览、双分析结果、支付结果、报告与追问页面沿用现有组件和状态栏/微信胶囊安全区，不使用 WebView 替代核心流程。双分析页持续区分免费/付费层级并展示专项同意、PII与结果限制；追问页继续提供撤回和删除入口。
