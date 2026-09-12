# MVP Acceptance：Education Compass 双分析 + ¥39.90 + Agent V0.4.1

## 1. 当前结论

当前状态为 **V0.4.1代码候选、生产上线未验收**。V0.4.0既有付费追问与支付闭环是历史自动化基线；V0.4.1增加双一次性分析、统一12字段OpenAI上下文和飞书客户资料精确白名单后，必须重新保存完整`npm.cmd run test:all`结果，不能沿用旧的固定测试数量。原生小程序双分析/追问客户端、动态release边界可在离线Mock中验证；真实OpenAI、飞书、扣款、退款、合法域名、生产PostgreSQL、正式数据、未成年人/隐私审批和微信真机流程仍未完成。

不得把以下任一结果描述为“真实支付已上线”：`touristappid`、微信开发者工具模拟器、MockPaymentProvider、demo“演示解锁”、单元/集成测试或签名fixture。

状态标记：

- `[x-auto]`：已由本工作副本中的自动化命令验证；
- `[ ] integration`：需要由V0.4.1最终工作树的完整集成测试验证；
- `[ ] manual`：必须由人工在指定环境执行，目前未留存通过证据；
- `[ ] external`：依赖业务、法务、财务、教研或生产基础设施配置；
- `[ ] test-gap`：当前代码有相应边界，但本轮自动化没有直接覆盖该完整陈述，不能标为通过。

## 2. 产品与范围验收

- `[x-auto]` 开发源码 `app.json` 当前注册16个原生页面，付费、双分析与追问主流程未使用 WebView/H5；测试从配置动态读取页面清单。
- `[x-auto]` 仓库根目录被定义为开发源码，不是正式上传目录；正式候选包只能由 `npm.cmd run build:release` 写入 `dist/release`。
- `[x-auto]` 参数化构建要求 HTTPS `PHOENIX_API_BASE_URL` 和非 tourist `PHOENIX_MINIPROGRAM_APPID`；产物强制remote，缺参失败，不回退到本地付费。
- `[x-auto]` 正式产物按`app.json - demo admin排除项`动态派生；当前为14个家庭端页面并包含双分析结果页与追问页，且不含本地数据库、demo报告生成器、2个admin演示页、OpenAI SDK/服务端Prompt/Key或`server/`源码。
- `[x-auto]` 页面流程覆盖：家庭/孩子档案 → 同意 → 问卷 → 预览 → 支付结果 → 完整报告 → 反馈/顾问/时间线。
- `[x-auto]` `COMPASS_REPORT_SINGLE_39_9` 在小程序侧固定为3990分、CNY、单次解锁。
- `[x-auto]` 自动测试断言服务端订单、微信下单和支付回调固定并复核3990分、CNY。
- `[ ] test-gap` 创单HTTP DTO不绑定客户端金额，但当前测试没有专门发送伪造金额字段来验证其被忽略。
- `[ ] test-gap` `PHOENIX_MEMBER_199` 在实现中保持独立且停用，但当前服务端测试没有直接尝试以会员SKU购买或解锁39.9报告。
- `[x-auto]` 旧版免费成长洞察与新版付费报告使用不同展示和访问语义，不会误标成已购报告。
- `[x-auto]` Partner/Permission 仍为空模型；Culture、Health、Identity、Wealth、商城及会员入口不在本次验收范围。

## 3. 问卷、同意与报告验收

- `[x-auto]` 当前 Education Compass 为6步23题，`models/questionnaire-contract.json` 是前后端共同的字段/类型/权重合同，总权重100。
- `[x-auto]` remote提交前执行服务端草稿GET往返核对；已填写字段缺失或变化时以 `ANSWER_SCHEMA_MISMATCH` 阻断，不能带着静默丢失的答案继续。
- `[x-auto]` 客户端69分被拦截，70分可提交；服务端必须独立重算，客户端分数不是事实源。
- `[x-auto]` 未完成当前步骤的必填题不能继续，草稿可保存并恢复。
- `[x-auto]` 新版测评开始前要求监护人确认、隐私同意和报告服务说明。
- `[x-auto]` 服务端保存版本化同意并在提交、创单及预支付时复核状态；自动测试覆盖订单创建后撤回同意导致后续创单和预支付均失败。
- `[x-auto]` 免费预览只含画像摘要、1条优势、1条风险、路线概览、六模块目录、数据日期、置信度和免责声明。
- `[x-auto]` 未付费及跨用户读取只能得到预览或拒绝，无法取得完整报告/PDF；已付费路径才返回六模块和PDF字节。
- `[x-auto]` demo完整报告严格包含六模块且顺序固定：成长画像、优势能力、专业方向、大学匹配、升学路线、6—24个月行动规划。
- `[x-auto]` submit时在服务端生成全部六模块并以 `qaPassed=true、status=LOCKED、deliveryStatus=LOCKED` 保存；placeholder目录、QA失败或生成失败不能创建订单。
- `[ ] test-gap` 报告实现保存 Source ID、适用年份/数据日期及 student/questionnaire/rule/data/prompt/template 版本，但当前测试没有逐字段断言整个版本快照。
- `[ ] test-gap` QA实现包含模块顺序及禁止承诺词检查，但当前测试没有注入候选集外事实或每个禁止词验证拒绝。

## 4. 订单、支付与权益验收

- `[x-auto]` 原生预览页存在“微信支付并解锁”CTA；remote支付边界调用 `wx.requestPayment`。
- `[x-auto]` 小程序不会依据 `wx.requestPayment` 的 success/cancel/fail 直接写 `PAID`，而是查询服务端订单。
- `[x-auto]` `PAID_COMPASS_ENABLED` 默认 `false`、非法配置被拒绝；关闭时新的创单返回 `PAID_COMPASS_DISABLED`。
- `[x-auto]` 创单受verified Source Catalog及QA锁定闸门保护；收银台等待阶段使用 `PENDING` 主状态。
- `[ ] test-gap` 预支付实现会再次检查购买开关、Source Catalog版本及QA锁定，但当前测试没有分别篡改这三项后调用预支付。
- `[ ] test-gap` 创单实现按用户/幂等键和用户/测评/商品有效订单去重，但当前测试没有直接覆盖并发重复创单。
- `[x-auto]` 微信下单携带订单 `time_expire`；主动查单至少间隔5秒。PENDING到期先查单，NOTPAY且关单成功后才CANCELLED；丢通知可由可信查单恢复PAID。
- `[x-auto]` API v3请求/响应签名、成功通知原始body验签与AES-256-GCM解密已用fixture验证；篡改签名/密文及错误appid、mchid、金额、币种、transaction_id或付款OpenID均不能授权。
- `[x-auto]` 重复成功通知保持一次订单、一次 `ACTIVE` entitlement、一次报告任务及一次交付时间线；只把收费前QA通过的报告切换为 `READY/DELIVERED`，支付后不再生成报告。
- `[ ] test-gap` kill switch关闭或当前目录撤回后的“已发支付参数仍可信交付”已在实现中保持，但当前测试未直接模拟开关/目录在预支付后的切换；目录撤回事故与人工退款也必须人工演练。
- `[x-auto]` 未付费、无权益或跨用户无法取得完整报告/PDF；有权益用户得到鉴权PDF文件字节，接口不返回永久对象URL。
- `[ ] test-gap` 失效会话访问完整报告/PDF的HTTP级路径未在当前测试中单独覆盖。
- `[x-auto]` 管理退款具备RBAC、幂等和审计；退款成功只撤权一次，主动/定时查退款可补偿丢失回调，退款请求前崩溃会以同一out_refund_no重放，`SUCCESS` 不会被后到的PROCESSING/CLOSED/ABNORMAL倒退。
- `[x-auto]` 当前bearer可由 `DELETE /v1/auth/session` 撤销，小程序退出会调用该接口；撤销后旧token访问受保护资源返回401。
- `[x-auto]` 回调入口在占处理槽前拒绝缺失签名头，应用设置128KB/5秒body边界及短Server超时；production URL同源和PostgreSQL `sslmode=verify-full` 配置已有自动断言。
- `[ ] external` 退款政策例外、真实微信退款、财务对账及Source Catalog撤回后的人工事故处理仍未批准/演练。

## 5. 双分析与已购报告 Agent 验收

- `[x-auto]` 小程序只在服务端full DTO同时为`access=full`、`READY`、`DELIVERED`、`qaPassed=true`、`entitled=true`且capability可用时显示已购报告追问入口；AI总分析入口也要求上述full DTO状态，页面隐藏或显示都不替代服务端重检。
- `[x-auto]` 原生Agent页包含独立监护人同意、PII提醒、不保证录取声明、消息幂等、有限轮询、可信来源/限制展示、撤回和删除；代码不调用OpenAI，也不把消息/回复写入`wx storage`。
- `[x-auto]` 免费预览显示“有限测评分析”，完整报告显示独立的“AI总分析”和“最多3次追问”；三个产品层级没有共用模糊按钮文案。
- `[x-auto]` 两个一次性分析POST均只发送固定平铺专项同意和`Idempotency-Key`；GET run/latest按资源恢复，客户端校验`ASSESSMENT_ANALYSIS/REPORT_ANALYSIS`类型，60次/2分钟停止轮询且不把runId/reply/answers写入Storage。
- `[ ] integration` 免费分析在合格 `PREVIEW_READY` 测评上不要求订单或entitlement；¥39.90总分析与报告追问均在创建、领取、提交和读取阶段要求owner、`ACTIVE entitlement`、`READY/DELIVERED`与QA。
- `[ ] integration` 三种taskType的报告/测评出站上下文精确且只含 `school_stage`、`education_system`、`target_enrollment_year`、`learning_feeling`、`strengths`、`challenges`、`parent_expectation`、`target_region`、`route_preference`、`backup_route_acceptance`、`available_time`、`support_need`；自由文本答案、客户资料和六模块原文为零。追问路径只额外包含经本地安全检查的用户追问文本及有限轮上下文。
- `[ ] integration` 一次性分析使用各自POST、`GET /v1/agent-analyses/:runId`和资源`/latest`；裸集合GET返回不存在/不支持，不能被文档或客户端当作列表API。
- `[x-auto]` release页面清单动态派生且包含双分析页、追问页、`services/agent-analysis.js`和`services/agent.js`，不含OpenAI SDK、Key、server、服务端Prompt或demo报告生成器。
- `[ ] integration` 服务端创建会话在同一事务内验证owner/家庭角色/ACTIVE权益/READY/DELIVERED/QA并创建报告/会话专属同意；每阶段重新检查门禁。
- `[ ] integration` 每份报告跨会话原子限制3个成功回复；同key/同digest复用、同key/不同digest为409；同一会话最多一个未决run。
- `[ ] integration` Agent repository使用原子claim、lease和fence；provider在事务外；退款、撤回、版本变化或迟到worker不能保存结果。
- `[ ] integration` 消息/冻结请求采用AES-256-GCM envelope，数据库无明文content；input/idempotency digest为用途域HMAC，日志/飞书/analytics无正文。
- `[ ] integration` provider请求为Responses API、`store:false`、strict Structured Outputs、无tools、HMAC `safety_identifier`；输入/输出安全和来源QA失败时不保存/展示正文。
- `[ ] integration` 本地高风险阻断不保存原文、不调用主模型；退款/撤权禁止正文但继续允许管理摘要、撤回和删除。
- `[ ] integration` submit/创单/预支付/支付与退款webhook/查单/飞书路径Agent provider调用为0；OpenAI失败不影响原链路。
- `[ ] manual` iOS/Android验证同意、3次配额、轮询超限、页面隐藏停止timer、退款/撤回后的删除路径和监护人文案。
- `[ ] external` OpenAI Project/Key、批准模型、费用/速率告警、数据处理/保留/ZDR、未成年人披露/同意、内容分级、危机文案、人工升级和真实预发布授权已留证。

`store:false`、环境开关或Mock通过都不是ZDR、法律批准或真实OpenAI上线证据。

## 6. 已自动验证

历史 V0.4.0 前端合并阶段曾在当前工作副本运行：

```bash
npm.cmd run test:client
```

历史结果：通过；它只证明当时的页面/模块/问卷、Agent客户端合同和隔离release构建。V0.4.1 最终候选必须再运行`npm.cmd run test:all`并把命令、时间、commit/包版本和结果填写到 [V0.4.1验证记录](V0.4.1_VERIFICATION.md)，不在本文预填新结果或硬编码测试数量。历史命令覆盖：

- 原有家庭 → 学生 → Compass → 报告 → 时间线 → 顾问 demo 领域流程；
- `app.json`当前16页文件、JSON/JS/WXML语法、相对模块解析和必要模型；
- 问卷总权重、70分边界和六模块契约；
- 免费预览不含完整付费模块；
- demo草稿 → 预览 → 隔离演示解锁 → 六模块报告；
- 原生支付CTA、`wx.requestPayment` 边界及服务端订单查询；
- 家庭页面的 remote API adapter 和本地/服务端ID映射。
- 实际候选产物构建边界：强制remote、从配置动态派生当前14页路由、真实格式AppID/HTTPS API注入，并排除demo生成器、本地数据库、admin页、OpenAI SDK/服务端Prompt/Key和server源码；
- Agent客户端专项同意固定scope/version、创建/消息`Idempotency-Key`、run DTO/可信来源归一化、60次/2分钟轮询上限，以及页面/服务无本地正文存储；
- 双分析客户端免费/付费POST、latest恢复、固定专项同意、分析类型校验、友好安全错误、有限轮询和免费/付费/追问边界文案；
- 服务端23字段合同、69/70/100边界、草稿往返、收费前六模块QA锁定、购买开关默认关闭及placeholder/QA/生成失败创单阻断；
- `time_expire`、5秒查询节流、丢回调主动查单恢复、到期NOTPAY关单后取消、3990分幂等交付、跨用户/PDF门禁和反馈；
- 管理退款RBAC/幂等/审计/撤权、同步与定时查退款补偿、请求前崩溃重放、退款SUCCESS单调性、会话撤销、回调入口限额与Server期限、生产URL/TLS配置、非成功查单可选字段、API v3规范化签名、响应验签、原始通知验签和AES-256-GCM篡改拒绝；
- 文件适配器持久化及migration关键字段与最终状态枚举一致性。

未直接覆盖的服务端声明已标为`[ ] integration`或`[ ] test-gap`，不得从相邻测试推断为通过。该套件未连接生产PostgreSQL、OpenAI、微信或飞书真实环境。

## 7. 必须人工验证

- `[ ] manual` 使用已批准参数执行 `npm.cmd run build:release`，只导入 `dist/release`；微信开发者工具无页面路由、WXML、样式或运行时错误。不得用根源码目录完成发布验收。
- `[ ] manual` 免费分析、已购报告AI总分析和最多3次追问三个入口/标题不混淆；首次同意、latest恢复、可信来源、限制/安全文案、轮询停止、撤回、删除和退款后的管理入口在真机可用，分析/聊天正文未进入Storage调试视图。
- `[ ] manual` demo模式在页面上持续显示“演示环境/演示解锁”，用户不会误以为发生真实扣款。
- `[ ] manual` 草稿退出/恢复、69分提示、70分提交、预览内容和历史免费报告在真实页面中符合预期。
- `[ ] manual` 刘海屏、灵动岛、Android状态栏、微信胶囊和底部安全区无内容遮挡。
- `[ ] manual` remote预发布环境中完成家庭/学生所有权、登录过期、跨家庭访问和报告门禁检查。
- `[ ] manual` iOS与Android微信真机完成正常支付、取消、回调延迟、主动查单、重复通知、PDF打开和反馈。
- `[ ] manual` 管理员退款、对账、告警、密钥轮换、数据删除和恢复流程完成演练。
- `[ ] manual` 开关关闭后的在途可信成功仍交付；Source Catalog紧急撤回时完成事故登记、受影响订单识别、人工退款与审计演练。

人工支付与真机细项以 [MANUAL_E2E_CHECKLIST.md](MANUAL_E2E_CHECKLIST.md) 为唯一执行清单，必须保存环境、版本、测试订单和受控证据。

## 8. 等待外部配置或批准

- `[ ] external` 认证小程序 AppID、主体、服务类目、微信支付权限及与商户号绑定。
- `[ ] external` AppSecret、商户私钥、API v3密钥、微信支付公钥、回调地址和退款权限通过秘密管理注入。
- `[ ] external` production API、request/download/notify 合法域名及公网 HTTPS 环境。
- `[ ] external` 正式构建使用的 `PHOENIX_API_BASE_URL` 与 `PHOENIX_MINIPROGRAM_APPID` 已由运维/小程序管理员复核并留存构建记录。
- `[ ] external` 生产 PostgreSQL migration、加密、备份恢复、审计、删除和监控策略。
- `[ ] external` production `verified` Source Catalog manifest、适用年份、核验人、规则版本及正式报告模板。
- `[ ] external` 隐私政策、用户协议、AI报告声明和监护人同意文本获得批准并配置版本。
- `[ ] external` 数字报告退款、访问期限、重新生成、注销后处理、发票税务及客服SLA完成决策。
- `[ ] external` OpenAI独立staging/production Project/Key、批准模型、费用/速率告警、数据处理/保留/必要ZDR、未成年人披露与专项同意、内容安全、危机文案、人工升级和真实预发布授权完成批准。
- `[ ] external` 飞书真实Base/App/7表、最小访问权限和客户资料处理审批已留证；`FEISHU_CUSTOMER_PROFILE_FIELDS_ENABLED` 默认保持 `false`。若批准开启，只允许家庭 `family_name/parent_name/phone/location/goal` 与学生 `student_name/age/gender/school/education_system/grade/interest/goal`，并已演练停用、历史单元格/导出/备份删除与访问撤销SOP。
- `[ ] external` P0审批与以上证据留存后，由授权发布人批准把 `PAID_COMPASS_ENABLED` 从默认 `false` 改为 `true`；当前无此批准。

以上项目对应 [OPEN_DECISIONS.md](OPEN_DECISIONS.md)。P0未关闭时，生产购买必须 fail closed。

## 9. 最终判定

只有同时满足以下条件，才可将结论改为“允许生产开启购买”：

1. 根目录与服务端自动化全部通过并保存日志；
2. `OPEN_DECISIONS` 中支付P0以及Agent的OpenAI/未成年人P0全部关闭；
3. 微信开发者工具、iOS和Android真机人工清单全部通过；
4. 至少一次受控真实支付、取消、延迟回调/主动查单、重复通知及退款对账通过；
5. 正式 Source Catalog、报告QA、隐私/协议、生产数据库及监控均有审批和部署证据；
6. 页面、README和发布说明没有把 Mock、demo或测试fixture称为真实支付。
7. 候选版本来自受控的 `dist/release` 构建，未直接上传仓库根目录。

当前最终判定：**不允许生产开启购买或OpenAI Agent；可继续进行demo演示、自动化、Mock和不发送真实数据的remote预发布联调。**
