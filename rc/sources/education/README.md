# Phoenix Family OS™ Mini Program MVP V0.5.0 本地验证工作副本

原生微信小程序 MVP。V0.5.0 在保留 V0.4.1 既有页面、Agent、支付与飞书能力的基础上，新增可填写、可退出恢复、可提交并查看结果的 Education Compass Level 1 免费家长问卷与 Level 2 学生成长发现闭环；Level 2 提交后以服务端商品目录的 ¥39.90 单次产品解锁完整报告。

> 当前仓库根目录是可运行、可测试的开发源码，不是可直接上传的正式包，也不是已上线产品。`demo/local` 中的“演示解锁”不会真实扣款；生产只能发布经 `npm.cmd run build:release` 生成的 `dist/release`。仓库没有真实 OpenAI、微信支付或飞书凭据，也没有证明外部 PostgreSQL、OpenAI、微信支付和飞书 Base 已经部署；这些能力仍受外部配置、未成年人安全与人工验收闸门约束。

## 当前产品闭环

家庭档案 → 孩子档案 → 监护人同意 → 6步23题问卷 → 70分完整度门槛 → 免费预览/独立同意后的有限测评分析 → ¥39.90单次解锁 → 六模块完整报告/PDF → 独立同意后的完整报告分析 → 最多3次已购报告追问 → 反馈、家庭时间线与顾问跟进。

- 当前源码由 `app.json` 注册16页原生微信小程序；构建器动态排除2个demo管理员页后得到14页家庭端 release，不用 WebView/H5 替代付费、分析或追问主流程。
- `COMPASS_REPORT_SINGLE_39_9` 固定为3990分、CNY、一次性购买。
- `PHOENIX_MEMBER_199` 是独立且默认停用的会员商品；39.9报告不会创建、续期或修改会员权益。
- 服务端 `PAID_COMPASS_ENABLED` 默认且当前必须为 `false`；只有正式数据、支付配置、审批和人工验收全部留证后，才可在受控发布中设为 `true`。
- 支付前仅显示画像摘要、1条优势、1条风险、路线概览、目录、日期、置信度和免责声明。
- 完整报告固定六个信息模块，不要求恰好六个PDF物理页面：成长画像、优势能力、推荐专业方向、大学与专业匹配、升学路线、未来6—24个月规划。
- 身份、门槛、候选集和分档由规则决定；AI/文本生成层只能解释结构化结果，不得新增事实、改分或承诺录取。
- V0.4.1 的三条 Agent 路径是：免费测评一次性有限分析 `ASSESSMENT_ANALYSIS`、¥39.90 报告一次性总分析 `REPORT_ANALYSIS`、已有的已购报告最多3次追问 `REPORT_FOLLOWUP`。免费分析不要求付费权益；后两者每阶段都要求 `ACTIVE entitlement + READY + DELIVERED + qaPassed`。它们都不生成收费报告，不拥有支付、飞书、数据库或搜索工具；OpenAI故障不影响预览、报告/PDF或交易链路。
- 三条路径的报告/测评上下文都只从同一12个受控选项构建：`school_stage`、`education_system`、`target_enrollment_year`、`learning_feeling`、`strengths`、`challenges`、`parent_expectation`、`target_region`、`route_preference`、`backup_route_acceptance`、`available_time`、`support_need`。姓名、电话、学校、精确地址、OpenID、客户资料、问卷自由文本、报告六模块原文、支付/飞书信息均不发送 OpenAI；仅 `REPORT_FOLLOWUP` 会额外发送经本地 PII、危机和越权检查的用户追问文本及有限轮会话上下文。

## 双运行模式

| 模式 | 触发方式 | 数据与支付 | 可作为何种证据 |
| --- | --- | --- | --- |
| `demo/local` | 仅直接运行源码配置时默认；不属于 `build:development` 产物 | 本地隔离存储、演示规则和模拟解锁；不调用真实支付，不生成服务端PDF | 页面、交互和本地领域流程演示；不能证明生产鉴权、数据隔离或真实支付 |
| `remote` | `build:development` 强制使用本机回环后端；正式候选包强制使用已批准的 HTTPS 后端 | 通过可信服务端处理微信登录、家庭/学生、问卷、报告、订单、权益、PDF与可关闭的Agent | 自动化及预发布联调；只有完成外部配置、未成年人审批和真机清单后才可作为上线证据 |

开发源码的运行模式及 API 地址在 `config/runtime.js` 中配置；`build:development` 会生成独立的、仅允许微信 `develop` 环境访问 `127.0.0.1` 的 remote 联调包。`build:release` 在 HTTPS API 地址与真实 AppID 同时提供时生成 `dist/release`；两者都未提供时只生成不可上传的 `dist/offline-test`，只提供其中一项则失败。任何正式候选包都不会回退到本地演示支付，生产服务端禁止使用 Mock Payment Provider。

## 已实现

### 原生小程序

- 16个页面：欢迎、家庭中心、家庭档案、孩子档案、Compass入口、问卷、免费预览、双模式AI分析结果、支付结果、完整/历史报告、已购报告AI追问、时间线、顾问申请、个人中心及2个本地顾问演示页。
- 6步23题版本化问卷；客户端从题目定义生成运行时合同，并由测试与 `models/questionnaire-contract.json` 逐字段核对，支持草稿保存、恢复、条件校验、字段往返核对和服务端重新计算完整度。
- 监护人、隐私及报告服务确认；未同意不能开始新版付费测评。
- 原生预览、`wx.requestPayment` 调起边界、订单轮询和支付结果页。
- 六模块报告展示、经鉴权的临时PDF下载/打开、反馈、顾问申请和家庭时间线。
- 报告 capability 严格门禁、独立 AI 同意、带 `Idempotency-Key` 的消息入队、有上限run轮询、可信来源/限制/安全文案、撤回与删除；对话正文只保留在页面内存，不写入 `wx storage`。
- 免费测评与已购完整报告各有独立的一次性分析入口；两种POST均提交固定、平铺的专项同意字段并由服务端重新鉴权，共用原生结果页和60次/2分钟轮询上限，结果正文不写入`wx storage`。
- 历史 V0.1 免费洞察与新版付费报告分开显示，不会误标为已购买。
- 刘海屏、灵动岛、Android状态栏和微信胶囊安全区适配；沿用 Phoenix Nova 品牌资源。

### 可信服务端边界

`server/` 是 Node.js 20 + TypeScript 服务端实现，提供：

- 微信 `code2Session` 边界、服务端 opaque session，以及退出时撤销当前 bearer 会话；
- 家庭、学生、监护人同意、不可变测评快照、预览与报告接口；
- 3990分服务端定价、订单幂等、Mock/微信支付 Provider 边界；
- 微信支付 API v3 下单、签名/验签、通知解密、主动查单及退款领域逻辑；
- 测评提交时生成六模块、完成事实/安全QA并保存为收费前 `LOCKED` 报告；
- 订单以 `PENDING` 为收银台主状态，支付成功后只原子更新订单、授予权益、标记 `DELIVERED` 并写时间线，不在扣款后才生成或QA报告；
- 创单和预支付同时受购买开关、verified Source Catalog、来源版本、六模块完整性及QA锁定闸门保护；微信预支付请求携带订单 `time_expire`；
- 服务端对微信订单查询至少间隔5秒。`PENDING` 到期不会直接取消：先查单，只有微信返回 `NOTPAY` 且关单成功后才转 `CANCELLED`；
- 查单兼容微信在非成功状态省略 `payer/amount` 的官方响应形态；只有 `SUCCESS` 才强制要求付款OpenID、3990分/CNY及微信交易号齐全，非成功态对实际返回的字段仍逐项核对；
- 关闭购买开关只停止新的创单/预支付。已取得签名支付参数的在途订单若随后通过签名、金额、商户、AppID和OpenID校验，仍必须交付，避免已扣款不发报告；
- 支付/退款回调在占用处理槽前检查必需头、时间窗及声明长度，并使用128KB body上限、5秒读取期限和短服务端超时；生产仍必须在可信反向代理/WAF上限制连接、请求体和速率；
- 退款 `PROCESSING` 由持久化对账任务每分钟退避查询；若进程在记录退款意图后、调用微信前崩溃，会以同一 `out_refund_no` 幂等重放，再通过签名查退款完成撤权；
- entitlement 门禁后的完整报告、临时PDF下载和反馈接口；
- V0.4.1 Agent provider-neutral合同、两种一次性分析及已有付费追问、独立专项同意、字段级加密会话、原子队列/租约worker、分路径权益门禁、moderation与本地来源/安全QA；默认关闭，生产worker与API进程隔离；
- 开发/测试内存存储及生产 PostgreSQL schema/migration；生产数据库URL强制 `sslmode=verify-full`，回调URL必须是 `PUBLIC_BASE_URL` 同源固定路径；
- 可选飞书多维表格单向同步：把7类服务端实体投影为稳定HMAC伪名ID和脱敏运营字段，使用 `integration_links` 保存映射、摘要、冻结UUIDv4幂等操作、状态和退避重试；稳定伪名仍按受保护数据处理；
- 飞书外写前会预检7表必需字段、类型和主字段；管理员可校验Schema、查看同步状态或触发1—200条小批量核对，周期任务默认每60秒运行，飞书失败不进入支付、退款、权益或报告读取事务。

小程序端的金额、用户ID、角色、订单状态和 `wx.requestPayment` 回调都不是可信事实。完整报告只应在服务端确认 `PAID` 并授予 `ACTIVE` entitlement 后返回。

### 飞书运营镜像边界

九份需求资料存在“早期飞书主数据”与“后续关系型主库”的版本差异。本候选版本已经进入原生小程序和微信支付阶段，采用 PostgreSQL 作为系统事实源，飞书只承担运营查看与人工协作：

- 7张表为 Family Profile、Student Profile、Assessment Session、Report Job、Order & Payment、Feedback、Advisor Request；
- 默认只同步伪名业务ID、版本、状态、评分、金额/币种和时间等核心白名单字段；`FEISHU_CUSTOMER_PROFILE_FIELDS_ENABLED` 默认 `false`。
- 只有飞书总开关已开启且隐私、未成年人数据、访问控制、保留/删除均经审批后，才可把该扩展开关设为 `true`。允许增加的家庭字段精确为 `family_name/parent_name/phone/location/goal`，学生字段精确为 `student_name/age/gender/school/education_system/grade/interest/goal`；运行时拒绝任何名单外字段。
- 无论开关状态，均不同步邮箱、OpenID/UnionID、内部ID、原始问卷、报告正文/PDF、Agent内容、微信交易号、回调内容、退款原因或密钥；客户资料只进入 Family/Student 两张镜像表，绝不进入 OpenAI。
- 飞书中的人工修改不会回写服务端，也不能把订单改成 `PAID`、授予权益、交付报告或发起退款；
- 飞书开关和购买开关相互独立，飞书故障不得阻塞可信微信支付结果的事务性交付。

字段与建表步骤见 [飞书多维表格配置手册](docs/FEISHU_BITABLE_SETUP.md)，状态、重试和故障处理见 [飞书同步运行手册](docs/FEISHU_SYNC_RUNBOOK.md)。

## 明确尚未完成上线验收

- 未配置已认证小程序 AppID、已绑定商户号、API v3密钥/公钥、生产合法域名或公网 HTTPS 通知地址。
- 未执行真实扣款、退款、对账、回调延迟和 iOS/Android 微信真机验收。
- 未接入生产 `verified` Source Catalog manifest；placeholder/演示内容不得创单或用于真实收费，production 配置必须 fail closed。
- `PAID_COMPASS_ENABLED` 尚无正式启用审批，必须保持 `false`。若来源目录在已有在途订单后被紧急撤回，须保留可信成功交易的交付并进入人工事故、退款和审计流程，不能静默拒绝已付款家庭。
- 隐私政策、用户协议、AI报告声明、监护人同意文本、数字报告退款及访问期限仍需外部批准。
- 生产 PostgreSQL、受信CA/`verify-full`连接、备份恢复、静态加密、审计、数据删除和监控告警仍需部署验证。
- 未配置或验证真实飞书企业自建应用、App Token、7个Table ID、权限和网络；未完成飞书数据删除、保留和供应商安全评估。
- 尚无真实 OpenAI Project/Key、批准模型、费用告警、数据处理/ZDR、未成年人披露与同意、危机升级文案或真实API预发布证据；Agent代码与Mock通过也不代表外部服务获准启用。
- 199会员无购买入口、无会员权益实现，也不属于本次39.9报告验收范围。
- 生产顾问后台/RBAC不在当前小程序交付内；两个顾问页面只在 demo 模式显示。

生产购买开关必须保持关闭，直至 [开放决策与上线闸门](docs/OPEN_DECISIONS.md) 和 [人工真机清单](docs/MANUAL_E2E_CHECKLIST.md) 全部满足。

## 本地运行小程序

仓库根同时包含 Next.js Web、服务端和微信小程序源码，不能把整个根目录交给微信编译器。先启动本机后端，再生成隔离的小程序联调包：

如果微信开发者工具已经打开本项目，先关闭该项目再执行构建。构建完成后再导入或重新打开 `dist/development`，避免旧 WebView 继续访问已经失效的本地 `pageframe` 端口。

```powershell
npm.cmd run build:server
npm.cmd run start:server
# 在另一个 PowerShell 窗口执行：
npm.cmd run build:development
```

1. 安装并打开微信开发者工具。
2. 删除此前导入的仓库根项目，并执行“清缓存 → 全部清除”。
3. 选择“导入项目”，目录必须指向 `dist/development`。
4. 确认请求目标为 `http://127.0.0.1:3000`；该明文地址只允许开发者工具的 `develop` 环境。
5. 点击“开始家庭成长规划”，依次完成档案、问卷、预览、开发联调解锁和六模块报告。

根 `project.config.json` 还把 `miniprogramRoot` 固定到 `dist/development/`，并停止监听 `.next`，用于防止误打开仓库根时微信编译器扫描 Next.js 动态构建文件。开发/发布构建器会从独立产物配置中移除该仓库级路径，避免出现嵌套目录。每次修改小程序源码后都要重新执行 `npm.cmd run build:development`。

若控制台出现 `Failed to load image http://127.0.0.1:<随机端口>/__pageframe__/assets/...` 且同时显示 `net::OK`，先不要修改图片或路径。这通常是开发者工具仍持有旧的本地资源端口：完全关闭项目，在工具关闭期间重新执行 `build:development`，仅清除该项目的 file/compile/network/session 缓存，然后直接重新打开 `dist/development`。不要清除 auth/storage，也不要删除 `.next`。

演示页面必须显示“演示环境/演示解锁”。演示解锁不能被记录为真实支付验收结果。

## 构建正式小程序包

不要把仓库根目录直接上传或发布。根目录还包含 Next.js Web、开发辅助代码、管理员演示页和 `server/` 源码，只适合开发与测试。

在 PowerShell 中使用已批准的 HTTPS API 和非 tourist AppID 构建：

```powershell
$env:PHOENIX_API_BASE_URL = 'https://api.example.com'
$env:PHOENIX_MINIPROGRAM_APPID = 'wx0000000000000000'
npm.cmd run build:release
```

在 POSIX shell 中的等价命令是：

```bash
PHOENIX_API_BASE_URL=https://api.example.com PHOENIX_MINIPROGRAM_APPID=wx0000000000000000 npm run build:release
```

只把生成的 `dist/release` 导入微信开发者工具并作为候选发布包。构建器会强制 `remote`、写入目标 API/AppID、开启域名校验，并从产物中移除本地数据库、demo报告生成器、两个admin演示页和服务端源码。页面清单从 `app.json` 动态派生；当前源码16页、正式产物14页并包含原生双分析结果页和已购报告追问页。`RELEASE_BUILD.json` 只记录非秘密的V0.4.1构建边界信息，不能替代人工或外部上线审批。

## 本地运行服务端

要求 Node.js 20+。首次运行：

```powershell
npm.cmd --prefix server install
npm.cmd --prefix server run typecheck
npm.cmd --prefix server test
npm.cmd --prefix server start
```

开发默认使用内存存储、Mock微信身份、Mock支付、`PAID_COMPASS_ENABLED=false`、`OPENAI_AGENT_ENABLED=false` 与 `AI_WORKER_ENABLED=false`。配置项见 `server/.env.example`；不要把任何真实密钥写入仓库、小程序代码或日志。把测试环境开关设为 `true` 不等于生产获批。

`server/.env.example` 只是配置模板，当前服务不会自动读取 `.env` 文件；运行时必须由 shell、容器或进程管理器注入。`FEISHU_BITABLE_ENABLED` 和 `FEISHU_CUSTOMER_PROFILE_FIELDS_ENABLED` 均默认 `false`；启用飞书时强制要求持久化 PostgreSQL、飞书 App凭据、独立32字节以上伪名密钥和7个有效Table ID。客户资料扩展开关还要求预先审批、受限 Base 和人工删除SOP，不能因为总开关已开启而自动开启。完整顺序和可复制的 Codex 指令见 [Codex后端代理运行手册](docs/CODEX_BACKEND_PROXY_RUNBOOK.md)。

连接 PostgreSQL 后先运行 `npm.cmd --prefix server run db:migrate`；迁移器会加 advisory lock 并校验已应用文件的SHA-256，已经应用的迁移不可修改。`001`—`003`为不可变历史，V0.4.1 新增 `004_dual_agent_analysis.sql`；飞书未来结构变更必须新建 `005` 或更高迁移。飞书候选同步当前最多扫描10000条源投影，建议先按单实例运行；尚未实现 transactional outbox、跨实例全局限速、异步 reconcile job、空值清除或删除 tombstone，不能描述成已满足生产SLA。

开发者工具联调必须使用 `npm.cmd run build:development` 生成的回环专用包，不要手工修改 `config/runtime.js`。正式体验版/发布版必须使用 HTTPS 域名构建 `dist/release`；生产参数和启用条件见 [微信支付运行手册](docs/WECHAT_PAY_RUNBOOK.md)。

## 自动化验证

小程序侧无第三方运行依赖：

```powershell
npm.cmd run test:all
```

该根命令依次运行小程序测试、服务端 typecheck 和服务端测试；页面数量从 `app.json` 和release排除规则动态验证。覆盖既有问卷、收费前报告、原生支付、权益/退款、飞书镜像边界，以及V0.4.1双分析/报告追问的同意、幂等、12字段出站最小化、有限轮询、来源/安全QA和故障隔离。客户端测试会实际生成隔离候选产物，确认强制remote、包含分析与追问页面，并排除本地数据库、demo生成器、admin页、OpenAI SDK/服务端Prompt、Key和server源码；这不等于真实环境发布通过。

只需单独验证小程序时可运行 `npm.cmd test`；只验证服务端时可运行 `npm.cmd run typecheck:server` 和 `npm.cmd run test:server`。自动化通过只证明代码级契约，不证明微信真实支付、生产配置、正式数据或真机体验已经通过。完整分层证据见 [MVP验收标准](docs/MVP_ACCEPTANCE.md)。

## 关键目录

```text
pages/             当前14个家庭端/付费/AI页面与2个demo管理员页面
services/          demo/remote适配、鉴权、测评、支付、报告、双分析/追问API与数据访问
models/            小程序DTO、问卷结构和demo/local schema
config/            运行模式、产品、问卷与同意版本
server/            可信API、领域服务、支付Provider、PostgreSQL migration、飞书运营镜像
scripts/           参数化正式包构建器；产物只写入dist/release
tests/             小程序领域及工程结构自动化
docs/              决策、架构、API、数据、支付、验收与交接文档
assets/brand/      Phoenix Nova深浅Logo与图标资源
```

## 文档索引

- [ADR-0001：付费闭环决策](docs/decisions/ADR-0001-paid-compass.md)
- [ADR-0002：已购报告AI解读决策](docs/decisions/ADR-0002-paid-report-agent.md)
- [系统架构](docs/ARCHITECTURE.md)
- [API契约](docs/API.md)
- [数据结构](docs/DATA_SCHEMA.md)
- [微信支付运行手册](docs/WECHAT_PAY_RUNBOOK.md)
- [飞书多维表格配置手册](docs/FEISHU_BITABLE_SETUP.md)
- [飞书同步运行手册](docs/FEISHU_SYNC_RUNBOOK.md)
- [Codex后端代理运行与交接](docs/CODEX_BACKEND_PROXY_RUNBOOK.md)
- [Phoenix Education Agent运行手册](docs/AGENT_RUNBOOK.md)
- [MVP验收标准](docs/MVP_ACCEPTANCE.md)
- [人工E2E清单](docs/MANUAL_E2E_CHECKLIST.md)
- [V0.4.1 验证记录骨架](docs/V0.4.1_VERIFICATION.md)
- [开放决策](docs/OPEN_DECISIONS.md)
- [构建来源记录](docs/BUILD_PROVENANCE.md)
