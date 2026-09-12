# Manual E2E Checklist：原生小程序双分析、¥39.90报告与Agent V0.4.1

> 支付项必须在认证 AppID、已绑定商户号、公网 HTTPS 服务和微信真机上执行；Agent真实项还需要获批OpenAI预发布配置、未成年人/数据处理审批。touristappid、开发者工具模拟、Mock Provider或单元测试不能勾选“真实支付/OpenAI通过”。

## 1. 环境证据

- [ ] 记录测试环境、服务端版本、数据库 migration 版本和小程序构建版本。
- [ ] 使用已批准的 `PHOENIX_API_BASE_URL` 和 `PHOENIX_MINIPROGRAM_APPID` 执行 `npm.cmd run build:release`，微信开发者工具导入的是 `dist/release`，不是仓库根目录。
- [ ] 核对正式产物 `RELEASE_BUILD.json` 与文件清单：强制remote，页面由`app.json`减demo admin规则动态派生（当前14个家庭端页面并含双分析/追问页），且无本地数据库、demo报告生成器、admin页、OpenAI SDK/服务端Prompt/Key或`server/`源码。
- [ ] AppID 已认证，商户号已绑定该 AppID，服务类目和支付权限有效。
- [ ] request、download 与支付/退款 notify 域名使用公网 HTTPS 并已配置。
- [ ] 商户私钥、API v3密钥和微信支付公钥/平台证书来自秘密管理，未进入代码包或日志。
- [ ] production 启动日志确认 PaymentProvider=wechat，且不存在 mock 降级。
- [ ] 初始部署确认 `PAID_COMPASS_ENABLED=false`；未获得审批前创单和预支付分别返回 `PAID_COMPASS_DISABLED`，已有报告/退款查询仍可用。
- [ ] `SOURCE_CATALOG_MODE=verified`，`SOURCE_CATALOG_PATH` 指向已批准且通过 schema 校验的 manifest；生产页面和服务端不使用 placeholder 事实。
- [ ] 隐私、用户协议、AI声明和监护人同意版本已获批准。
- [ ] `OPENAI_AGENT_ENABLED=false`、`AI_WORKER_ENABLED=false` 是初始安全值；未批准OpenAI真实测试时不得开启，也不得用Mock通过替代ZDR/数据处理证据。
- [ ] `FEISHU_BITABLE_ENABLED=false`、`FEISHU_CUSTOMER_PROFILE_FIELDS_ENABLED=false` 是初始安全值；若本轮未取得真实飞书审批，不得开启或勾选真实同步通过。

## 2. 原生问卷与预览

- [ ] iOS 微信真机：创建/选择家庭和学生，完成监护人同意。
- [ ] Android 微信真机：重复同一路径。
- [ ] 23字段问卷由同一份 `models/questionnaire-contract.json` 渲染与校验；草稿退出后可以恢复，提交前 PUT→GET 往返不丢键，开放题全文没有出现在普通日志/埋点。
- [ ] 完整度69时明确显示缺失项，不出现购买按钮或订单。
- [ ] 完整度70及以上时，服务端先生成全部六模块、完成事实/安全QA并保存为 `qaPassed=true`、`status=LOCKED`、`deliveryStatus=LOCKED`，随后才允许进入可购买预览。
- [ ] 人为让 Source Catalog 无效、模块缺失、生成失败或QA失败：不能创建订单，也不能取得 prepay 参数。
- [ ] 预览只含画像摘要、1条优势、1条风险、路线概览、目录、日期、置信度和声明。
- [ ] 通过调试器、分享路径、缓存和接口响应检查，未发现 full_content 或永久PDF地址。
- [ ] 商品文案明确：“¥39.90，一次付费，不是会员，不自动续费”。

## 3. 支付

- [ ] 正常支付：收银台显示正确商品和 ¥39.90。
- [ ] 支付配置齐全并取得书面测试审批后，由授权发布人仅在受控验收窗口把 `PAID_COMPASS_ENABLED` 改为 `true`；确认创单与预支付仍分别受verified目录、来源版本、六模块和QA闸门保护。生产常开另需最终发布批准。
- [ ] 创建订单后主支付中状态为 `PENDING`；新订单和服务端DTO不产生旧的 `PAYING`。若客户端为历史缓存保留兼容显示，不得把它写回服务端或作为新状态使用。
- [ ] 微信下单请求中的 `time_expire` 与服务端订单 `expiresAt` 一致。
- [ ] 用户支付后页面先显示“确认中”，只在服务端确认 PAID 后解锁。
- [ ] 服务端订单中的 appid、mchid、out_trade_no、transaction_id、3990分和CNY核对一致。
- [ ] 用户取消：页面回到预览，服务端不标 PAID，可安全重试。
- [ ] 连续点击购买/支付：只有一个有效订单，不发生重复扣款。
- [ ] 前端返回 success 但人为延迟回调：报告保持锁定，主动查单后才恢复。
- [ ] 回调临时不可达后恢复：主动查单或重试通知最终只授予一次权益。
- [ ] 重放同一通知：订单、权益、时间线和交付事件都只有一份。
- [ ] prepay/order过期：先查原订单；仅在NOTPAY且关单成功、原订单CANCELLED后用新幂等键重建，不产生两个同时未决的可支付订单。
- [ ] 高频轮询同一PENDING订单时，服务端对微信主动查单最多每5秒一次。
- [ ] 人为让PENDING订单到期且微信为NOTPAY：先成功查单、再调用关单，只有关单成功后才显示CANCELLED；USERPAYING不被误取消。
- [ ] 错误/伪造通知：验签或字段核对失败，不改变订单和权益。
- [ ] 成功支付只新增/复用一次ACTIVE entitlement，并把已锁定报告改为 `READY/DELIVERED`；报告正文、来源与版本哈希未在支付后改变，也没有再次运行生成或QA。
- [ ] 已取得支付参数后关闭 `PAID_COMPASS_ENABLED`：新的创单/预支付被拒绝，但该在途订单若可信成功仍正常交付；错误签名、金额或身份仍拒绝。
- [ ] 模拟Source Catalog在在途支付后紧急撤回：不静默扣款不交付，创建人工事故记录，由管理员退款并保留审计/对账证据。

## 4. 报告与PDF

- [ ] 未付费账号、跨家庭账号和撤销会话都无法读取完整报告。
- [ ] 已付费用户能看到且只看到规定的六模块。
- [ ] 报告显示 Source ID、适用年份/数据日期、版本、置信度、资料缺口和免责声明。
- [ ] 抽检中无候选集外事实、无来源事实或“保证/保录/录取率”等承诺。
- [ ] PDF通过带有效会话与报告权益的鉴权接口获得临时文件/短时下载，再由 `wx.openDocument` 打开。
- [ ] 会话失效、无权益或跨用户请求时失败；接口与数据中没有公开永久PDF URL。
- [ ] 已购报告再次进入不会再次收费。
- [ ] 新测评不会覆盖旧的已购快照。

## 5. 退款、反馈和顾问

- [ ] 管理员退款接口要求服务端RBAC和幂等键，并写审计。
- [ ] 同一退款请求/通知重复执行不会重复退款或重复撤权。
- [ ] 同步查退款发现SUCCESS时，即使退款回调丢失也完成REFUNDED和撤权；随后重放PROCESSING/CLOSED/ABNORMAL不会让SUCCESS倒退或恢复访问。
- [ ] 当前安全默认下，退款成功后该订单权益被撤销、完整报告/PDF恢复门禁；若OD-07批准例外，再按批准政策复测。
- [ ] 满意度、有帮助与否、问题标签和咨询意向可提交。
- [ ] 反馈自由文本已限制长度并脱敏；埋点无PII。
- [ ] 顾问申请仍写入家庭时间线；普通用户无法进入管理员演示入口。

## 6. 双分析与已购报告 Agent

### 6.1 免费/付费一次性分析

- [ ] 提交合格测评后，免费预览显示“免费测评·有限AI分析”，同时明确它不等同于¥39.90完整报告或报告追问。
- [ ] 首次免费分析前显示独立AI处理、监护人、PII和结果限制提示；未勾选不能POST。请求body只有固定平铺同意三字段并带`Idempotency-Key`。
- [ ] 免费分析使用 `POST /v1/assessments/:assessmentId/agent-analyses` 创建、`GET /v1/agent-analyses/:runId` 取结果、assessment `/latest` 恢复，返回`ASSESSMENT_ANALYSIS`；低完整度、未提交、跨家庭、同意无效或功能未开启时页面显示稳定友好提示，不展示伪结果。未支付但测评合格时仍可分析，证明免费路径不错误要求entitlement。
- [ ] 已购完整报告页同时有“AI总分析”和“最多3次追问”两个独立入口；未支付/退款/非READY/非DELIVERED/QA失败时服务端拒绝总分析。
- [ ] 已购报告总分析使用 `POST /v1/reports/:reportId/agent-analyses` 创建、同一run GET取结果、report `/latest` 恢复，返回`REPORT_ANALYSIS`；若无`ACTIVE entitlement + READY + DELIVERED + qaPassed`任一条件则拒绝；若服务端返回错误分析类型，客户端拒绝展示。
- [ ] 抽查免费分析和付费总分析的出站上下文精确且仅包含12个受控键：`school_stage`、`education_system`、`target_enrollment_year`、`learning_feeling`、`strengths`、`challenges`、`parent_expectation`、`target_region`、`route_preference`、`backup_route_acceptance`、`available_time`、`support_need`；不含姓名、电话、学校、地址、客户资料、问卷自由文本、六模块原文、OpenID、支付或飞书信息。
- [ ] 页面重开通过各资源`/agent-analyses/latest`恢复最近结果；Storage面板没有analysis runId、reply、测评答案、报告正文、Prompt或Key。
- [ ] 自动轮询最多60次或2分钟，切后台/卸载立即停timer；达到上限或临时网络失败保留当前页面内存runId并提供人工刷新。

### 6.2 已购报告追问

#### 无真实OpenAI的客户端/Mock检查

- [ ] 未支付、退款、无ACTIVE权益、报告非READY、非DELIVERED或QA未通过时不显示“AI解读”能力入口；如有历史会话，仍显示无正文的管理/删除入口。
- [ ] 已购报告入口文案明确AI辅助、不保证录取、监护人陪同、勿输入PII；首次进入必须单独勾选`ai_agent_guardian_v1`同意。
- [ ] 创建会话和每条消息各发送`Idempotency-Key`；快速连点/网络重试不创建第二个本地会话或run。
- [ ] 每份报告最多3个成功回复；删除/新建会话不能重置额度，失败/阻断不占成功回复但受到速率限制。
- [ ] 回答显示answer、关键点、下一步、限制和服务端映射的可信来源；不展示内部Prompt、provider id、冻结请求或原始错误。
- [ ] 输入高风险、PII、Prompt injection、索要改价/解锁/系统Prompt时走固定安全结果；高风险主生成模型调用为0。
- [ ] 追问的报告上下文仍只有同一12字段；唯一额外客户自写输入是经过本地PII/危机/注入/越权检查的追问文本及有限轮上下文。故意输入姓名、电话或学校时应在Provider调用前阻断。
- [ ] 自动轮询达到60次或2分钟停止并提示手动刷新；页面`onHide/onUnload`后Network面板不再持续请求。
- [ ] Storage面板不存在Agent消息、回复、报告、Prompt或Key；管理列表不向用户显示内部conversationId。
- [ ] 撤回同意会关闭会话、取消未完成run；删除在正常、退款和撤权状态均可幂等执行。
- [ ] OpenAI/worker不可用时，报告/PDF、支付通知、退款和飞书仍正常；页面给稳定提示而不诱导重复支付。

#### 获批真实OpenAI预发布

- [ ] 已留存独立staging Project/Key、批准模型、费用/速率上限与告警、数据处理/保留/必要ZDR、未成年人披露/专项同意、内容分级、危机文案和人工升级SOP。
- [ ] API进程只入队，独立Agent worker运行；worker使用独立小PostgreSQL pool、并发上限、租约/fence与无正文heartbeat。
- [ ] 抽查三种taskType的出站请求为Responses API、`store:false`、无tools、无OpenAI Conversation/`previous_response_id`；报告/测评上下文逐键等于上述12字段白名单，不含姓名、联系方式、学校、OpenID、数据库ID、支付或飞书信息。
- [ ] 数据库快照只见AES-256-GCM envelope，没有明文content；日志、飞书、analytics和release没有消息/回复/Prompt/provider response id。
- [ ] 模糊超时、429/5xx和worker崩溃最多提交一个本地结果；监控能识别可能的上游重复调用/费用，不宣称exactly-once。
- [ ] 退款或同意撤回与运行中请求竞态时，迟到结果被fence丢弃，正文不再可读；删除和法定数据请求路径仍存在。

## 7. 对账与收尾

- [ ] 微信支付订单、服务端订单、权益、退款与财务金额可以一一对应。
- [ ] 对账差异、回调积压、报告失败和重复支付有告警。
- [ ] 密钥轮换、查单、关单、退款、撤权和数据删除手册已演练。
- [ ] iOS 与 Android 结果、测试订单号和证据截图存入受控验收记录。
- [ ] 将本次测试订单退款或按财务流程处理。
- [ ] 清理真实Agent测试内容和短时Key，核对正文保留/删除SLA、备份到期与无正文审计；不要宣称即时物理擦除。
- [ ] 若测试过飞书客户资料扩展：先关闭 `FEISHU_CUSTOMER_PROFILE_FIELDS_ENABLED`，确认未完成敏感冻结体不再重放，再按批准SOP清除既有扩展单元格、导出/备份副本并撤销临时访问；保存双人核对证据。

## 验收结论

- 测试负责人：
- 测试日期：
- 小程序版本：
- 服务端版本：
- 通过项：
- 未通过项：
- 外部阻塞项：
- 是否允许生产开启购买：是 / 否
