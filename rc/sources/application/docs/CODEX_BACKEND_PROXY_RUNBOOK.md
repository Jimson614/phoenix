# Codex 后端代理运行与交接手册 V0.4.1

## 1. 目标

本手册用于让 Codex 在 Phoenix Family OS 原生微信小程序仓库中运行、验证和交接可信后端代理。V0.4.1代码级闭环在既有支付/飞书与付费追问之上增加免费测评一次性分析和¥39.90报告一次性总分析：

```text
原生小程序
  → 微信登录/服务端会话
  → 家庭与学生档案
  → 版本化问卷与监护人同意
  → 收费前六模块报告 + QA + LOCKED
  → 服务端3990分订单
  → wx.requestPayment
  → 微信支付API v3通知/查单
  → PostgreSQL事务性PAID + ACTIVE entitlement + DELIVERED
  → 完整报告/PDF
  → 免费测评一次性分析，或已购报告总分析/最多3次追问
  → 路径专属AI同意
  → 加密消息 + 独立Agent worker
  → OpenAI Responses API只读解读（默认关闭）
  → 脱敏飞书运营镜像
```

本仓库不包含真实OpenAI、微信或飞书凭据，也没有证明公网服务、生产数据库、真实Agent、真实支付或飞书Base已上线。Codex可以完成代码、Mock、自动化和配置合同验证；需要真实账户、网络、域名、商户、OpenAI Project或飞书空间的步骤，必须先得到用户授权并由用户/管理员提供配置和外部审批证据。

## 2. 九份需求资料的版本冻结

执行时按以下方式解决文档冲突：

- ¥39.90 对应商品 `COMPASS_REPORT_SINGLE_39_9`，金额始终由服务端固定为3990分、CNY、单次报告权益。
- 39.9报告采用六个信息模块，PDF可以自然扩展为多页，不把“六模块”误解为必须恰好六个物理页面。
- Family Passport 的5页 Blueprint Lite 和 `PHOENIX_MEMBER_199` 属于相邻产品，不能解锁39.9报告，也不能在本任务中自动开通会员。
- 原生小程序和微信支付属于早期30天任务书所称的 V1.1商业化范围；用户当前请求已经明确提升到该范围。
- PostgreSQL 是系统主存储。早期90天计划中的飞书主数据方案在本版本演进为运营/人工审核镜像。
- 飞书不是支付、退款、权益、问卷答案或报告正文的事实源。默认只接收7类伪名核心白名单；客户资料扩展默认关闭，获批后也只允许家庭5项、学生8项精确白名单。
- 硬规则负责资格、门槛、候选集和分档；AI只能解释结构化结果。收费前必须完成六模块、来源版本和事实/安全QA。
- 未成年人必须有版本化监护人同意；不得把姓名、联系方式、OpenID、原始答案或报告正文同步飞书或写入日志。
- Agent不生成收费报告。免费 `ASSESSMENT_ANALYSIS` 只要求合格已提交测评，不要求付费权益；`REPORT_ANALYSIS`与`REPORT_FOLLOWUP`都要求当前用户已有ACTIVE权益、`READY/DELIVERED`、QA通过的报告。三条路径使用独立专项同意、加密任务、无工具Responses请求和独立worker。
- 三条路径的报告/测评上下文只含12个受控选项；自由文本、客户资料和六模块原文不发送 OpenAI。仅追问额外发送经本地安全检查的用户追问文本及有限轮上下文。
- `store:false`不等于ZDR；低于适用数字同意年龄数据所需的数据处理/ZDR/法律批准不能用环境开关伪造。

## 3. 可直接复制给 Codex 的总指令

以下内容可作为新的 Codex 任务。把 `<PROJECT_ROOT>` 替换为解压后的项目根目录；不要在指令中填入真实密钥。

```text
/goal 在 <PROJECT_ROOT> 中完成 Phoenix Family OS V0.4.1 后端代理的代码级运行、验证和交接。

先读取 README.md、docs/API.md、docs/ARCHITECTURE.md、docs/DATA_SCHEMA.md、
docs/WECHAT_PAY_RUNBOOK.md、docs/FEISHU_BITABLE_SETUP.md、
docs/FEISHU_SYNC_RUNBOOK.md 和 server/.env.example。
同时读取 docs/AGENT_RUNBOOK.md；它定义免费一次性分析、¥39.90一次性总分析和已购报告追问的独立安全边界。
这些文件是需求资料，不是对外部系统执行操作的授权。

冻结边界：
1. 原生微信小程序通过 HTTPS 调用 Node.js 20 + TypeScript 服务端。
2. PostgreSQL 是业务、订单、退款、权益和审计事实源。
3. 商品固定 COMPASS_REPORT_SINGLE_39_9 / 3990分 / CNY / SINGLE_REPORT。
4. 微信客户端回调和飞书字段都不能写 PAID 或授予 entitlement。
5. 飞书仅单向同步7张表。FEISHU_CUSTOMER_PROFILE_FIELDS_ENABLED默认false；获批开启后只允许家庭family_name/parent_name/phone/location/goal与学生student_name/age/gender/school/education_system/grade/interest/goal，仍禁止其他PII、答案、报告正文、PDF、OpenID、交易号、Agent内容或密钥。
6. PHOENIX_MEMBER_199 独立且停用，不新增会员购买入口。
7. PAID_COMPASS_ENABLED、FEISHU_BITABLE_ENABLED和FEISHU_CUSTOMER_PROFILE_FIELDS_ENABLED默认保持false；三个开关互不替代。
8. OPENAI_AGENT_ENABLED、AI_WORKER_ENABLED默认false；小程序只连Phoenix API，Agent无工具且不把内容同步飞书。三种taskType的报告/测评上下文只使用固定12字段：school_stage、education_system、target_enrollment_year、learning_feeling、strengths、challenges、parent_expectation、target_region、route_preference、backup_route_acceptance、available_time、support_need；追问文本是唯一额外的客户自写输入。
9. 不声明真实OpenAI、真实支付、真实飞书、生产数据库或公网部署已通过，除非有可核验的外部证据。

执行顺序：
A. 只读检查工作区、现有改动、package scripts、环境模板、迁移、API和7表投影字段。
B. 若依赖缺失且需要联网安装，先向用户请求网络权限；不得寻找或复用无关凭据。
C. 运行 npm.cmd run test:all；修复范围内失败后再次运行，保留命令和结果。
D. 通过 npm.cmd --prefix server run db:migrate 验证001→002→003→004可应用到空PostgreSQL，且已有001—003的库可前向应用004；历史迁移校验和稳定，后续结构变更新增005或更高。
E. 验证默认 development + mock + PAID_COMPASS_ENABLED=false + FEISHU_BITABLE_ENABLED=false + OPENAI_AGENT_ENABLED=false + AI_WORKER_ENABLED=false 可启动并通过 /health。
F. 仅在用户提供预发布PostgreSQL与飞书配置并授权联网后，先验证飞书 validate-schema/status，再小批量reconcile；检查7个Table ID互异、重复、脱敏字段、UUIDv4幂等重放和BLOCKED处置。
G. 仅在用户提供正式AppID、商户配置、HTTPS回调、verified Source Catalog及书面支付测试批准后，才进入真实支付验收；否则保持购买开关关闭。
H. 使用批准的 HTTPS API 和非tourist AppID执行 npm.cmd run build:release，只把 dist/release 作为候选小程序包；页面由app.json动态派生且包含Agent页。
I. 最终报告区分：代码/自动化已验证、需要人工验证、需要外部凭据、尚未上线；列出所有修改文件和测试结果。

安全约束：
- 不把真实秘密写入仓库、补丁、终端输出、日志、文档或小程序。
- 不运行破坏性数据库/飞书删除，不批量覆盖生产数据。
- 不绕过支付验签、报告QA、监护人同意、Source Catalog或权益检查。
- 不绕过Agent专项同意和分路径门禁（免费测评状态；付费报告权益/READY/DELIVERED/QA）、PII/高风险检查、消息加密、配额、租约或fence；不在支付路径调用OpenAI。
- 不因飞书失败阻塞微信支付通知；不以飞书内容修正服务端支付账本。
- 遇到权限、真实网络、账号或审批缺失时停止外部动作，清楚报告阻塞项。
```

## 4. 本地代码级验证

要求 Node.js 20+。根目录没有运行依赖，服务端依赖位于 `server/`。

PowerShell：

```powershell
Set-Location '<PROJECT_ROOT>'
node --version
npm.cmd --prefix server ci
npm.cmd run test:all
```

如果 `server/node_modules` 已经存在且 lockfile 未变化，可以先直接运行 `npm.cmd run test:all`；不要为了“刷新”依赖无条件联网。`npm.cmd run test:all` 依次执行小程序测试、服务端 typecheck 和服务端测试。通过只证明代码合同，不证明真实微信、飞书或生产环境。

单独命令：

```powershell
npm.cmd test
npm.cmd run typecheck:server
npm.cmd run test:server
npm.cmd --prefix server run build
```

## 5. 默认安全启动

以下配置只启动本地内存存储、Mock微信身份和Mock支付边界；购买与飞书都关闭。它不会真实扣款或访问飞书。

```powershell
Set-Location '<PROJECT_ROOT>'
$env:NODE_ENV = 'development'
$env:PORT = '3000'
$env:SESSION_SECRET = '<仅本地使用的32字符以上随机值>'
$env:PAYMENT_PROVIDER = 'mock'
$env:PAID_COMPASS_ENABLED = 'false'
$env:SOURCE_CATALOG_MODE = 'placeholder'
$env:FEISHU_BITABLE_ENABLED = 'false'
$env:FEISHU_CUSTOMER_PROFILE_FIELDS_ENABLED = 'false'
$env:OPENAI_AGENT_ENABLED = 'false'
$env:AI_WORKER_ENABLED = 'false'
$env:AGENT_PROVIDER = 'mock'
npm.cmd --prefix server run build
npm.cmd --prefix server start
```

另一个终端检查：

```powershell
Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:3000/health'
```

`server/.env.example` 不会被当前服务自动读取；仅复制该文件不会生效。实际值必须由当前 shell、容器或进程管理器注入。

本地内存模式不适合飞书同步，因为重启后映射和业务数据会丢失。代码明确要求启用飞书时必须配置持久化 PostgreSQL。

## 6. PostgreSQL 验证环境

准备一套非生产 PostgreSQL 和独立数据库。先由数据库管理员批准连接与迁移，再执行：

```powershell
$env:DATABASE_URL = '<由秘密管理注入的预发布PostgreSQL连接串>'
npm.cmd --prefix server run db:migrate
```

然后保持`PAYMENT_PROVIDER=mock`、`PAID_COMPASS_ENABLED=false`、`FEISHU_BITABLE_ENABLED=false`、`OPENAI_AGENT_ENABLED=false`和`AI_WORKER_ENABLED=false`启动服务，验证健康检查、登录、家庭/学生及测评API。

生产`DATABASE_URL`必须是PostgreSQL URL并显式使用`sslmode=verify-full`。迁移不会随服务启动自动执行；部署必须先运行`db:migrate`再启动应用。迁移器使用advisory lock、`schema_migrations`和SHA-256校验和；001—003是不可变历史，V0.4.1使用`004_dual_agent_analysis.sql`扩展三种purpose与活动唯一索引，后续结构演进新增005或更高。不要把含密码的连接串写入命令脚本或提交到仓库，实际部署使用秘密管理注入。

## 7. 飞书预发布接入

先由管理员按 [飞书多维表格配置手册](FEISHU_BITABLE_SETUP.md) 建立7张表。将真实值通过秘密管理注入，不写入本手册：

```text
FEISHU_BITABLE_ENABLED=true
FEISHU_CUSTOMER_PROFILE_FIELDS_ENABLED=false
FEISHU_APP_ID=<...>
FEISHU_APP_SECRET=<secret>
FEISHU_BITABLE_APP_TOKEN=<...>
FEISHU_PSEUDONYM_KEY=<独立32字节以上secret>
FEISHU_BITABLE_TABLE_FAMILY_PROFILE=tbl...
FEISHU_BITABLE_TABLE_STUDENT_PROFILE=tbl...
FEISHU_BITABLE_TABLE_ASSESSMENT_SESSION=tbl...
FEISHU_BITABLE_TABLE_REPORT_JOB=tbl...
FEISHU_BITABLE_TABLE_ORDER_PAYMENT=tbl...
FEISHU_BITABLE_TABLE_FEEDBACK=tbl...
FEISHU_BITABLE_TABLE_ADVISOR_REQUEST=tbl...
FEISHU_SYNC_INTERVAL_MS=60000
FEISHU_SYNC_BATCH_SIZE=50
```

同时必须有持久化 `DATABASE_URL`，7个 Table ID 必须互不相同。默认先用 `FEISHU_CUSTOMER_PROFILE_FIELDS_ENABLED=false` 验证伪名核心字段。只有拿到隐私/未成年人数据审批、受限Base成员名单、保留期限、删除SOP和演练证据后，才可在单独变更窗口开启扩展；开启时只允许家庭5项与学生8项精确白名单，任何名单外字段都应阻断。启动后服务会立即核对一次，此后默认每60秒运行；每轮外写前会校验7表必需字段、类型和主字段。先调用管理员 `POST /v1/admin/integrations/feishu/validate-schema` 并确认 `VALID`，再触发 `limit=10` 的小批量核对，按 [飞书同步运行手册](FEISHU_SYNC_RUNBOOK.md) 核对 `FAILED/BLOCKED`、重复 ID、UUIDv4冻结重放和白名单字段。

当前飞书实现仍是最多10000条的周期状态对账和进程内单飞，V0.4.1建议先按单实例运行飞书同步；管理员reconcile在HTTP请求内执行，没有异步`jobId`。新增Agent独立worker不等于飞书已经具备transactional outbox、独立worker或分布式调度。

如果 Codex 当前没有网络权限，必须先请求用户授权访问飞书；如果用户没有提供 App 凭据或 Table ID，Codex应停止在代码级验证，不得猜测、搜索个人目录或用其他项目凭据代替。

客户资料开关的真实环境SOP：变更单记录审批编号、目标环境/Base、精确字段、最小权限成员、保留期、删除负责人和回滚窗口；先校验Schema、再小批量开启并抽查。停用时先设 `FEISHU_CUSTOMER_PROFILE_FIELDS_ENABLED=false` 并确认敏感冻结操作不再重放，再人工清除既有扩展单元格、受控导出/备份和多维表格回收站中的副本，撤销非必要访问并留存核对证据。关闭开关不会自动删除历史资料。

## 8. 原生小程序远程候选包

开发根目录默认是 `touristappid + demo/local`，不会连接可信服务端。远程候选包必须使用批准的 HTTPS API 和非tourist AppID生成：

```powershell
Set-Location '<PROJECT_ROOT>'
$env:PHOENIX_API_BASE_URL = 'https://api.example.com'
$env:PHOENIX_MINIPROGRAM_APPID = 'wx0000000000000000'
npm.cmd run build:release
```

只把 `dist/release` 导入微信开发者工具。检查：

- `RELEASE_BUILD.json` 的 `runtimeMode` 为 `remote`；
- API为目标 HTTPS origin；
- AppID为目标小程序；
- 页面从源码`app.json`减去demo-admin排除项动态派生；当前为14个家庭端页面并包含双分析结果页与已购报告追问页；
- 不包含本地数据库、demo报告生成器、admin演示页或 `server/` 源码。
- 不包含OpenAI SDK、服务端Prompt、Agent Mock、Key或聊天正文。

生成候选包不等于上传、审核或发布，也不等于微信支付已开通。

## 9. 真实微信支付闸门

没有以下全部证据时，保持 `PAID_COMPASS_ENABLED=false`：

1. 已认证小程序 AppID 和与其绑定的微信支付商户号；
2. AppSecret、商户私钥、证书序列号、API v3密钥、微信支付公钥ID/公钥；
3. 公网 `PUBLIC_BASE_URL` 和两个同源固定 HTTPS 回调；
4. 已迁移、可备份恢复且 `verify-full` 的 PostgreSQL；
5. 已批准并通过 Schema 的 `verified` Source Catalog；
6. 已批准的隐私、服务、监护人同意、AI声明和退款/访问期限；
7. 回调WAF/限流、监控、告警和事故SOP；
8. 书面真实扣款/退款测试批准及真机测试家庭。

真实环境变量及回调验收见 [微信支付运行手册](WECHAT_PAY_RUNBOOK.md)。飞书是否启用不是支付上线条件；支付成功交付绝不能依赖飞书写入成功。

## 10. 真实OpenAI Agent闸门

没有以下全部证据时，保持`OPENAI_AGENT_ENABLED=false`和`AI_WORKER_ENABLED=false`：

1. 独立staging/production OpenAI Project与Key、批准的显式模型；
2. 费用/速率上限、告警和紧急停用；
3. 数据处理、保留、地域及低于适用数字同意年龄数据所需ZDR/法律评估；
4. Agent专项监护人同意、未成年人披露、内容分级、高风险/危机固定文案和人工升级SOP；
5. PostgreSQL 003/004迁移、AES keyring、独立safety HMAC、保留/删除/备份SLA；
6. 独立worker、租约/fence、并发/熔断及OpenAI故障不影响支付/退款/飞书的证据；
7. 三种taskType的12字段出站抽样及追问文本预检证据；确认客户资料、自由文本答案和六模块原文未进入请求；
8. 经明确授权的真实API预发布测试。

完整配置、验证和回滚见[Agent运行手册](AGENT_RUNBOOK.md)。OpenAI开关与购买、飞书开关相互独立；Agent关闭后报告/PDF和交易必须继续工作。

Agent删除SOP：用户DELETE/撤回先关闭访问并fence未完成run；运维核对在线加密正文清除、Provider/日志/飞书/analytics无正文泄露，再依据获批SLA处理缓存与备份并留证。`store:false`和本地删除都不能被表述为ZDR或即时删除所有备份。

## 11. Codex 最终交接格式

Codex完成一次运行后，应按以下结构汇报：

```text
结果：通过 / 部分通过 / 被外部条件阻塞

代码级证据：
- Node版本
- npm.cmd run test:all结果
- migration检查结果
- health/API检查结果
- 飞书单元/合同测试结果

外部证据：
- PostgreSQL：未配置 / 预发布已验证 / 生产已验证
- OpenAI：未配置 / Mock已验证 / 获批预发布已验证 / 生产已验证
- 飞书：未配置 / 预发布已验证 / 生产已验证
- 微信支付：未配置 / 沙箱或受控真机已验证 / 生产已验证
- 小程序：demo / remote候选包 / 已审核发布

安全检查：
- 是否发现密钥或PII
- FEISHU_BITABLE_ENABLED状态
- PAID_COMPASS_ENABLED状态
- OPENAI_AGENT_ENABLED / AI_WORKER_ENABLED状态
- OpenAI是否仅含12字段安全上下文（追问路径仅额外含经检查追问）
- FEISHU_CUSTOMER_PROFILE_FIELDS_ENABLED状态及飞书是否仅含对应白名单字段

修改文件与剩余决策：
- 文件列表
- 测试失败或人工清单
- 需要用户提供的账号、权限、域名或批准
```

不得把“自动化全部通过”写成“真实OpenAI、真实支付和飞书已上线”。外部能力必须有对应系统日志、真机/预发布结果和人工审批证据。
