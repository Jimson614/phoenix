# Build Provenance

- 工作日期：2026-08-20
- 原始包：C:\Users\1\Desktop\工作相关\Phoenix-Family-OS-Mini-Program-MVP-V0.1 (2).zip
- 原始包 SHA-256：992EAB334BEF9B2992666E7656425331D3F5031206AED18D13E8E7688E92BBDB
- 工作方式：先校验 ZIP 条目，再解压到 Codex 工作目录；所有实现只发生在工作副本。
- 原始包状态：未修改。
- 初始基线：npm test 通过；12个原生小程序页面、JSON/JS语法、家庭→学生→Compass→报告→时间线→顾问演示闭环均通过。
- 项目版本控制：解压后的原始项目不包含 .git 目录，因此交付时使用文件清单、自动化测试结果和交付 ZIP 复核。

本文件不包含任何 AppSecret、商户私钥、API v3密钥、OpenID、真实订单号或未成年人数据。

## V0.2.1 微信开发者工具兼容修复（2026-08-21）

- 修复客户端直接 `require('./questionnaire-contract.json')` 导致微信运行时解析为缺失的 `questionnaire-contract.json.js`、家庭页无法注册的问题；
- 客户端合同改为由问卷题目定义生成，自动化测试继续与跨层 JSON 合同逐字段比对；
- 新增客户端相对模块解析检查，并禁止在小程序 CommonJS 代码中直接加载 JSON；
- 为家庭页和个人中心的首帧提供安全默认数据，避免异步初始化期间解引用空对象；
- 2026-08-21 重新执行 `npm run test:all`，客户端校验、服务端 TypeScript 检查及26项服务端测试全部通过。

## 当前工作副本演进

在保留原始家庭关系闭环和品牌资源的基础上，当前工作副本已扩展为：

- `app.json`当前注册16个原生小程序页面，包含Compass免费预览、双模式AI分析结果、支付结果和V0.4.1已购报告追问页；
- 6步23题版本化问卷、70分完整度门槛和监护人同意；
- `demo/local` 与 `remote` 双运行模式；
- ¥39.90一次性报告商品，与停用的¥199会员商品/权益隔离；
- 支付前白名单预览、六模块完整报告、PDF/反馈接口边界；
- `server/` 可信服务端、PostgreSQL migration、Mock/微信支付 Provider 和支付运行文档。
- 参数化正式包构建器：页面从`app.json`与demo-admin排除规则动态派生；当前`dist/release`强制remote、含14个家庭端页面，并排除本地数据库、demo报告生成器、admin演示页、OpenAI SDK/服务端Prompt/Key和server源码。
- V0.4.0增加已购报告Agent：小程序专项同意、幂等消息、有限轮询、可信来源/安全文案、撤回/删除；服务端Agent能力默认关闭并与支付/飞书隔离。
- V0.4.1完成双分析闭环：免费`ASSESSMENT_ANALYSIS`与付费`REPORT_ANALYSIS`共用原生结果页，创建请求带独立专项同意和幂等键，最近结果从服务端latest接口恢复；既有`REPORT_FOLLOWUP`继续独立显示。

上述内容是工作副本相对原始 ZIP 的演进，不回写原始包，也不表示真实微信支付已经配置或上线。

## V0.4.1 合并前前端与release证据（2026-08-22）

在当前共享工作副本执行`npm.cmd run test:client`：通过。命令实际验证：

- `app.json`当前16页的JS/JSON/WXML语法、相对模块解析和Page注册；
- Agent客户端固定同意scope/version、创建/消息`Idempotency-Key`、run/可信来源DTO和无本地正文持久化；
- Agent入口同时检查full、READY、DELIVERED、QA、entitlement和服务端capability；
- 自动轮询上限为60次或2分钟，页面隐藏/卸载停止timer；管理列表不展示conversationId；
- 双分析客户端验证免费/付费POST、latest恢复、固定专项同意、幂等键、类型校验、60次/2分钟轮询上限和无本地正文持久化。
- 隔离release从源码动态派生当前14页并包含双分析/追问页；产物强制remote且排除demo/local/admin/server、OpenAI SDK/服务端Prompt和Key。

该阶段证据不覆盖V0.4.1服务端合并结果；最终候选复验见本文末节及`V0.4.1_VERIFICATION.md`。

## 当前自动化证据

2026-08-20 在项目根目录执行 `npm run test:all`：通过。该命令完成客户端测试、服务端 TypeScript typecheck 及26项服务端测试；输出确认：

- 当时V0.3.0的14页项目结构及JS/JSON语法有效；
- 问卷权重、70分门槛、六模块契约和非破坏性本地迁移通过；
- demo草稿→预览→隔离演示解锁→六模块报告通过；
- 原生预览/支付结果流程及服务端权威支付检查边界存在；
- remote家庭数据适配和服务端ID映射检查通过。
- 当时V0.3.0候选产物边界测试通过：HTTPS API与非tourist AppID参数校验、remote运行时、12页路由及demo/local/admin/server排除规则均已执行；当前V0.4.1证据见本文末节。
- 服务端23字段合同、69/70边界、收费前六模块QA锁定、购买开关默认关闭、placeholder/QA/生成失败收费阻断通过；
- `time_expire`、PENDING查询节流、丢回调主动查单恢复、到期NOTPAY关单、3990分幂等交付及伪造字段/跨用户拒绝通过；
- 管理退款RBAC/幂等/撤权、同步与定时查退款补偿、退款请求前崩溃重放、SUCCESS单调性、会话撤销、回调入口限额/期限、生产URL/TLS配置、非成功查单可选字段、API v3签名验签和AES-256-GCM篡改拒绝通过。

该自动化未使用认证 AppID、商户号、真实支付、生产 PostgreSQL、正式 Source Catalog 或真实未成年人资料，因此不能作为这些项目的通过证据，也不授权把 `PAID_COMPASS_ENABLED` 设为 `true`。

## 历史 V0.4.0 最终离线验证（2026-08-22）

- 首次执行 `npm.cmd --prefix server ci` 时，Windows 拒绝访问用户级 npm 缓存；改用项目内临时缓存执行 `npm.cmd --prefix server ci --cache .npm-cache` 后成功，安装19个包，审计结果为0个漏洞。该失败与重试均未改用管理员权限。
- `npm.cmd run test:all` 完整通过：客户端结构/隐私/release合同通过，服务端 TypeScript typecheck 通过，服务端53项测试全部通过且0失败。
- `npm.cmd --prefix server run typecheck`、`npm.cmd --prefix server run build`、`npm.cmd --prefix server test` 分别复跑通过；服务端测试入口实际包含 `agent.test.js`。
- 使用 `https://api.example.invalid` 与非 tourist 测试 AppID 重建 `dist/release` 成功：源码16页、release 14页、88个文件，并包含`pages/assessment-analysis`与`services/agent-analysis.js`；release 路径和正文扫描未发现 server、node_modules、OpenAI Key/API origin、服务端 Prompt、demo/local数据库或admin页面。
- 默认安全配置启动成功，`http://127.0.0.1:3104/health` 返回 `{"ok":true}`；该检查使用 Mock 支付并关闭付费、飞书、Agent和Agent worker，未调用外部网络。
- 历史迁移 SHA-256 未变：001 为 `502AB6BED513978922FAD8FD424D1C11281B07771E37CE056CF001A2674B35C9`，002 为 `5A9FC3092BDF46025834A1211E8458CBFF9D3B1DD39ECBF3C2BD02A72CA2D34D`；003 为 `1E8B64E1FE38D48BEFD11AD3D69AF73423D77AF17A294ECF8E809A83C3D197E6`。
- 当前机器没有 `psql`、Docker 或 PostgreSQL 服务，因此未实际执行空库 `001→002→003` 或既有库前向迁移。真实 PostgreSQL、OpenAI、微信支付、飞书和微信真机验收均为 `WAITING_FOR_CONFIGURATION`，不属于本次离线通过证据。

## V0.4.1 最终离线验证（2026-08-22）

- `npm.cmd run test:all`完整通过：客户端结构、隐私边界与release合同通过；服务端TypeScript typecheck通过；服务端65项测试全部通过且0失败。
- 使用`https://api.example.invalid`与非tourist占位AppID重建`dist/release`成功：源码16页、release 14页、88个文件，`RELEASE_BUILD.json`为`productVersion: 0.4.1`、`runtimeMode: remote`并声明`includesDualAgentAnalysis: true`。
- 该`.invalid`产物仅用于构建边界验证，不能部署；正式包必须使用已备案HTTPS业务域名与真实小程序AppID重新构建。
- 001—003迁移SHA-256保持不变；004为`62F9B9213B768C2C2C694632AC30C791E5CAE77F75F0760CE0FB95C308D3E097`。当前机器仍未连接PostgreSQL，因此没有声称实际执行迁移。
- 真实PostgreSQL、OpenAI、微信支付、飞书和微信真机验收仍为`WAITING_FOR_CONFIGURATION`；代码级通过不等于这些外部系统已上线。
