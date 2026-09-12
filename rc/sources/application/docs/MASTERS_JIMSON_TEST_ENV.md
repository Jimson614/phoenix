# Application Compass｜Jimson 隔离联调环境交接清单

> Round 3 补充：Codex 已获授权自行在本任务隔离开发环境/Actions 建立可销毁 PostgreSQL、随机临时密码/证书/会话密钥并清理，无需 Founder 或 Jimson 逐项生成。自动数据库、CI、合成资料加密备份恢复由 Codex 执行，详见 [Round 3 执行说明](MASTERS_PR9_ROUND3.md)。以下由 Jimson 安全提供的配置指目标主机和真实微信联调，不能把自动工程项全部交回 Jimson。专项的 `MASTERS_TEST_DATABASE_URL` 现在只供迁移/清理；新增同库的 `MASTERS_TEST_APP_DATABASE_URL` 供独立最小 DML 账号运行 HTTP。临时库通过不替代目标主机或微信证据。

状态：交接模板与只读就绪检查说明，不是已完成的外部验收记录。本文对应 PR #9 的下一轮候选；每一份实际证据都必须填写执行时的候选 `HEAD_SHA`，不能把 `29df2358718232294dcda4af9f2410fd0b32aab6` 或更早的测试输出直接沿用为新版本通过。

仓库：`yvettfang-netizen/phoenix`
分支：`codex/masters-intake-p0`
原始本轮核对点：`29df2358718232294dcda4af9f2410fd0b32aab6`
目标：只在隔离测试环境补齐真实 PostgreSQL、微信开发者工具与 iOS/Android 真机证据。

本清单不改变 Jimson 负责的网站上线优先级，也不是生产 DNS、生产发布或合并授权。此次不增加副学士模块、不改价格、不启用外部 AI、不开放真实学生资料；Founder 和运营人员不需要、也不应当把任何密钥粘贴到聊天、Notion、GitHub、PR、截图或日志。

## 1. 交接角色与回报规则

Jimson 通过公司的秘密管理器、受控 CI secret 或经批准的安全渠道提供测试凭据和环境状态。Codex 只接收“资源名称、已配置/缺失、负责人、脱敏证据编号、审批状态”，不接收秘密值。AppSecret、数据库口令、会话密钥、证书私钥、数据库连接串和备份解密密钥均由 Jimson 负责注入服务运行环境；Founder/运营不承担粘贴密钥的工作。

环境回报只写以下内容：

| 字段 | 允许回报 | 禁止回报 |
| --- | --- | --- |
| 资源名称 | 例如 `MASTERS_TEST_DATABASE_URL`、测试 AppID、HTTPS 合法域名、私有原件根目录 | 连接串、用户名、密码、AppSecret、证书私钥 |
| 状态 | `CONFIG_PRESENT`、`BLOCKED_EXTERNAL`，以及外部验收表中的 `PASS/FAIL/NOT_RUN` | 仅凭变量存在写“端到端通过” |
| 证据 | 候选 SHA、工具/设备版本、脱敏请求 ID、恢复后的计数/摘要、截图或录屏编号 | 真实学生资料、真实附件、秘密日志、私有绝对路径；合成材料可用于验收画面 |
| 审批 | Jimson 负责人、隐私/安全审批编号、测试库销毁窗口 | 以本清单代替生产发布或 DNS 审批 |

`node scripts/check-masters-test-environment.js` 是本仓库新增的只读预检。它只读取当前进程环境和非敏感的项目配置形状，不读取 `.env`、不扫描密钥、不连接或写入远程数据库、不调用微信、不写文件。每个检查项只输出 `CONFIG_PRESENT` 或 `BLOCKED_EXTERNAL`；脚本总状态始终为 `BLOCKED_EXTERNAL`，因为配置存在不能证明数据库、附件恢复、微信会话或真机流程已通过。

## 2. Jimson 需要安全提供的配置

下表的变量名均来自当前代码，未引入新的运行变量；“交接表字段”只是人工证据标签。

### 2.1 服务端、数据库与 worker

| 配置/资源 | 用途与约束 | 敏感性与交接方式 |
| --- | --- | --- |
| `NODE_ENV=test` | 仅用于隔离联调；`MASTERS_INTAKE_ENABLED=true` 在 production 会被 `server/src/masters/config.ts` 拒绝 | 非秘密值，可回报是否已设 |
| `MASTERS_INTAKE_ENABLED=true` | 打开 P0 测试入口；保持生产关闭 | 非秘密值，可回报状态 |
| `MASTERS_WORKER_ENABLED=true` | 运行真实持久队列/租约/清理 worker | 非秘密值，可回报状态 |
| `MASTERS_AI_ENABLED=false` | 外部 AI 未获批准，必须保持关闭；规则草稿与人工核验继续可用 | 非秘密值，可回报状态 |
| `DATABASE_URL` | **人工/微信联调 HTTP 服务运行连接**。服务必须连接到专用 PostgreSQL，不得因缺失而回退 FileStore | 连接串含凭据时按秘密处理，只回报格式和脱敏证据 |
| `MASTERS_TEST_DATABASE_URL` | **自动迁移与真实 HTTP 回归连接**。`scripts/test-masters-postgres.js` 用它在隔离 UUID schema 执行 006 up/down/up 和真实 PostgresStore HTTP 流程；测试库名称须含 `test`、`testing`、`ci` 或 `sandbox` 标记，并使用 `sslmode=verify-full` | 连接串和口令只由 Jimson 安全注入 |
| `MASTERS_TEST_DATABASE_ALLOW_MUTATION=YES` | 只有确认数据库可销毁后，才允许测试脚本创建和删除 UUID schema | 非秘密哨兵，可回报是否已设；不得在共享业务库使用 |
| `EDUCATION_TEST_DATABASE_URL`、`EDUCATION_TEST_DATABASE_ALLOW_MUTATION=YES` | 既有 Education Compass 基线迁移回归的独立连接和哨兵；它不能替代 Masters HTTP 流程的 `DATABASE_URL` | 连接串按秘密处理 |
| `SESSION_SECRET` | 测试服务会话签名密钥；至少 32 字节，不能使用开发默认值 | 秘密管理器注入，绝不回报值 |

这两个 Masters 数据库连接有不同用途：

1. `MASTERS_TEST_DATABASE_URL` 由测试 runner 使用，允许在**专用、可销毁**数据库中创建 `masters_test_<uuid>` schema、运行迁移、清理 schema，并检查 001–005 旧表不受损。自动 HTTP 回归也明确注入此 schema 的 PostgresStore，不使用 FileStore；测试身份是合成会话，不等于微信登录验收。
2. `DATABASE_URL` 由实际 HTTP server 使用，必须指向已经通过隔离核对的测试数据库/测试 schema。应用角色只拥有服务需要的 `CONNECT`、schema `USAGE` 以及相关既有认证表和 `masters_*` 表的最小 DML 权限；不得拥有删库、删 schema、建角色或授予角色权限。若采用预创建 schema，须在证据中记录 schema 名的脱敏标识和授权范围。

使用相同数据库时也不要把迁移/清理角色的秘密交给应用进程。使用不同数据库时必须在回报中明确“迁移连接”和“HTTP 运行连接”分别指向哪个隔离资源。只运行 SQL migration、只看到 `schema_migrations` 或只看到 `FileStore` 文件，都不能证明真实 HTTP 使用 PostgreSQL。

### 2.2 微信、HTTPS 与原生包

| 配置/资源 | 用途与约束 | 敏感性与交接方式 |
| --- | --- | --- |
| `WECHAT_APP_ID` | 服务端真实 `code2Session` 使用的测试小程序 AppID | AppID 本身不是私钥，但只回报末端脱敏标识或“已配置”；由 Jimson 指定测试账号 |
| `WECHAT_APP_SECRET` | 服务端调用微信 `jscode2session` 的 AppSecret | 秘密管理器注入，只回报存在性，绝不粘贴 |
| `PUBLIC_BASE_URL` | 服务端公开 origin；实际使用必须是已批准的 HTTPS origin | URL 可回报域名审批编号，禁止把含凭据的 URL 放日志 |
| `PHOENIX_API_BASE_URL` | `scripts/build-release.js` 的原生包构建参数；必须为 HTTPS | 非秘密值可回报 origin 审批编号，不把测试路径伪装成生产 |
| `PHOENIX_MINIPROGRAM_APPID` | 原生包构建参数；须与 API URL 成对提供，格式为真实 `wx` AppID | 可回报脱敏标识；不能把现有 `project.config.json` 的 AppID 当作测试成员证明 |
| 微信后台合法域名 | 对 `wx.request`、`wx.uploadFile`、`wx.downloadFile` 分别确认 request/uploadFile/downloadFile 合法 HTTPS 域名 | 由 Jimson/微信后台安全配置，记录审批和实际域名核验结果 |
| 测试成员与隐私配置 | 开发/体验成员、隐私说明、用户授权文案、撤回路径和后台配置 | 只回报测试账号角色和审批编号，不回报个人微信资料 |

当前 `config/runtime.js` 默认 `API_BASE_URL=''`，开发/测试模式保留 demo 保护；当前 `project.config.json` 只说明项目文件格式和 `urlCheck=true`。真正的测试包应由受控构建过程安全注入 `PHOENIX_API_BASE_URL` 与 `PHOENIX_MINIPROGRAM_APPID`，而不是把离线包或项目文件 AppID 当作微信联调证据。`OFFLINE_TEST_ONLY` 包只能用于离线验证。

本轮是免费咨询入口，不改变价格和支付链路；不要为了这项验收索取或配置生产微信支付商户密钥。若既有测试还需 `WECHAT_PAY_*`，仍按原有支付审批单独注入和验收，不与 Masters P0 混写。

### 2.3 私有原件、清理、字体与备份

| 配置/资源 | 要求 | 证据门槛 |
| --- | --- | --- |
| `MASTERS_PRIVATE_STORAGE_DIR` | 已存在的绝对目录，位于源码、`.git`、静态资源和 `dist` 之外；不纳入小程序包或 Git | 记录脱敏目录标识、OS ACL、目录模式和服务账号，不写绝对路径 |
| `MASTERS_RETENTION_DAYS` | 1–90 天整数，未设置时当前代码缺省 30 天 | 记录实际 worker 清理时间、删除对象清单和脱敏审计 ID |
| `MASTERS_PDF_FONT_PATH` | 目标主机已安装/安全挂载的合法中文字体文件，位于源码之外；字体文件不提交 Git | 记录字体名称、版本、许可依据和目标主机可读证据，不上传字体文件 |
| 备份加密密钥、备份目标 | 备份数据库与附件索引/原件时使用批准的静态加密和访问控制 | 由 Jimson 的备份系统注入；只回报恢复作业 ID、摘要和审批，不回报密钥 |

私有原件至少需要实际验证：创建虚构学生的 DOCX/PDF/PNG/JPEG，确认数据库元数据中的 `sha256` 与下载字节一致；服务重启后仍能授权下载；在干净的隔离恢复目标中恢复数据库与附件后再次核对同一对应关系；撤回/过期后原件、提取结果和个人资料按规则清理。仅证明目录存在、备份文件生成或文件名可见均不足以通过。

## 3. 最小 PostgreSQL 权限与真实 HTTP 流程

Jimson 回报应至少包含：专用数据库标识、TLS 握手成功的脱敏记录、迁移 runner 角色和 HTTP app 角色的权限摘要、schema `search_path`、测试库销毁窗口。不要在共享业务库执行 006 down 或清理。

环境齐备后的顺序：

1. 运行只读预检，确认变量格式和路径边界；任何 `BLOCKED_EXTERNAL` 都保留在交接表中。
2. 用 `MASTERS_TEST_DATABASE_URL` 运行 `node scripts/test-masters-postgres.js`，验证 006 up → down → up、001–005 旧表保留、重连、约束、并发提交和 worker 租约隔离，并在同一 UUID schema 用真实 PostgresStore 跑 HTTP 上传、重启后下载、顾问改派、报告审核和 PDF/XLSX 导出。只有完整运行输出 `httpFlow=PASS` 才能记为自动 PostgreSQL HTTP 通过；缺字体或跳过均不通过。脚本若显示缺库/未连接，整体仍为 `BLOCKED_EXTERNAL`，即使进程退出码为 0。
3. 单独启动真实 server，让它使用 `DATABASE_URL` 和 `MASTERS_PRIVATE_STORAGE_DIR`；由 HTTP 请求完成咨询建立、字段更新、七类独立上传、提取确认、缺件提交、重启恢复、后台分配/改派、顾问编辑/复核、Founder 批准/开放、学生查看和 PDF/XLSX 导出。启动日志要证明选用 PostgreSQL；不能把本地 FileStore 流程写成此项通过。
4. 在服务重启后重复读取同一虚构咨询和附件，验证数据库版本、文件摘要、授权边界、旧报告/旧任务失效和新版本结果一致。
5. 进行数据库与附件的加密备份/干净目标恢复，并保留恢复查询摘要、附件下载摘要和候选 SHA 的脱敏记录。

建议使用三名完全虚构的 fixture：

| fixture | 关键路径 | 必须观察 |
| --- | --- | --- |
| `synthetic_resume_enrolled` | 上传简历 → 核对提取 → 只补缺项；在读状态显示在读证明入口 | 简历后不默认展开长表单；七卡片独立；缺件仍可提交咨询 |
| `synthetic_graduated` | 已毕业状态 → 上传毕业证、学位证、成绩单和语言成绩 | 毕业/学位卡片独立；在读材料按状态隐藏但资料仍保留；替换产生新版本 |
| `synthetic_no_resume_incomplete` | 无简历 → 分步填写 → 只上传部分材料 → 提交 | 分步表单、缺件提示、`NEEDS_REVIEW` 队列、不能伪称完整方案 |

申请人的姓名、联系方式、教育背景、经历和附件必须完全虚构；候选项目的官网来源应为实际公开院校页面。自动 HTTP 流程使用隔离的合成身份，不替代下面使用真实测试微信账号的 `code2Session` 验收；真机填入的申请资料仍全部虚构。

## 4. 微信开发者工具与真机验收矩阵

网页工作台的成功只证明内部 HTTP/工作台的一部分；网页不等于微信。FileStore 的成功只证明本地开发存储；FileStore 不等于 PostgreSQL。每一行必须在同一候选 `HEAD_SHA` 下填写工具/设备版本、真实微信会话证据、请求 ID、录屏或截图编号及结果；没有环境先标 `BLOCKED_EXTERNAL`，不得用注入 bearer、mock code、浏览器截图或设计图代替。

通用登录要求：在开发者工具、iOS 真机和 Android 真机分别执行原生 `wx.login`，后端真实调用 `https://api.weixin.qq.com/sns/jscode2session`，服务端创建会话；验收记录只能引用脱敏的 code2Session 成功/失败状态和请求 ID，不能把本机注入的虚构 bearer 当作微信会话。

| 客户端 | 有简历/在读 | 已毕业 | 无简历/缺件 |
| --- | --- | --- | --- |
| 微信开发者工具 | `BLOCKED_EXTERNAL`：真实登录、简历上传/核对、只补缺项、七卡片、退出重登恢复 | `BLOCKED_EXTERNAL`：毕业证/学位证/成绩单/语言成绩独立卡片、隐藏在读材料保留 | `BLOCKED_EXTERNAL`：分步填写、部分上传、允许先提交、后台状态回读 |
| iOS 真机 | `BLOCKED_EXTERNAL`：相册/文件选择、隐私同意、真实上传、替换/撤除、查看已开放报告 | `BLOCKED_EXTERNAL`：状态切换、卡片滚动、键盘和安全区、版本提示 | `BLOCKED_EXTERNAL`：取消/失败重试、重登、缺件提交、权限拒绝 |
| Android 真机 | `BLOCKED_EXTERNAL`：相册/文件选择、隐私同意、真实上传、替换/撤除、查看已开放报告 | `BLOCKED_EXTERNAL`：状态切换、卡片滚动、键盘和导航区、版本提示 | `BLOCKED_EXTERNAL`：取消/失败重试、重登、缺件提交、权限拒绝 |

每个平台至少覆盖：DOCX/PDF、相册/拍照（如设备支持）、隐私同意、上传/替换/撤除、取消、失败重试、重登恢复、缺件提交、后台分配后学生查看已开放报告。证据可展示带合成标记的虚构申请资料，但不能包含真实学生原文、二维码、AppSecret、访问令牌、私有绝对路径或未脱敏日志。

## 5. 报告边界与虚构来源项目

本轮报告能力要按状态分开写：

| 状态 | 含义 | 可否称为完整选校方案 |
| --- | --- | --- |
| 规则草稿 | 服务器规则生成的六段结构草稿；候选项目为空、来源待补或存在未解决冲突时保持 `NEEDS_REVIEW`/明确限制 | 不可以 |
| 顾问核验后的完整方案 | 顾问为虚构学生编辑项目，填入官方来源 URL、对应申请季、核验日期和匹配理由；顾问复核后由 Founder 批准/开放，学生能查看并导出同一版本 | 可以在“人工核验辅助版”范围内称为已核验 |
| `AUTO_SCHOOL_MATCHING` | 来源目录/检索、结构化匹配与自动生成尚未实现；人工审批继续保留 | 不可以写成已完成或自动报告 |

用虚构学生验证一条或多条有来源项目的完整链路：顾问编辑 → 顾问复核 → Founder 批准/开放 → 学生查看 → PDF/XLSX 导出；每个项目都必须有官方来源、申请季匹配和不晚于当前日期的核验日期。来源缺失、项目为空或冲突未解决时只能保留初评/待补标记。不要为了本轮解阻启用外部 AI、OCR、联网院校搜索或把原始附件发给外部模型。

## 6. 证据记录模板与停止位置

实际回报按候选版本填写：

```text
candidate_sha: <运行时新 HEAD_SHA>
repository: yvettfang-netizen/phoenix
branch: codex/masters-intake-p0
environment_owner: Jimson
environment_kind: disposable-test-only

config_preflight: CONFIG_PRESENT / BLOCKED_EXTERNAL
masters_postgres_migration: PASS / FAIL / BLOCKED_EXTERNAL / NOT_RUN
masters_http_on_postgres: PASS / FAIL / BLOCKED_EXTERNAL / NOT_RUN
database_backup_restore: PASS / FAIL / BLOCKED_EXTERNAL / NOT_RUN
private_storage_acl_retention: PASS / FAIL / BLOCKED_EXTERNAL / NOT_RUN
wechat_devtools: PASS / FAIL / BLOCKED_EXTERNAL / NOT_RUN
wechat_ios: PASS / FAIL / BLOCKED_EXTERNAL / NOT_RUN
wechat_android: PASS / FAIL / BLOCKED_EXTERNAL / NOT_RUN
real_code2session: PASS / FAIL / BLOCKED_EXTERNAL / NOT_RUN
report_assisted_reviewed: PASS / FAIL / BLOCKED_EXTERNAL / NOT_RUN
auto_school_matching: NOT_IMPLEMENTED
evidence_ids: <脱敏编号，不能放秘密值或学生资料>
remaining_blockers: <逐项写负责人和审批>
```

在数据库、授权、微信运行、安全和恢复证据齐全前，状态保持 `BLOCKED_EXTERNAL`，不申请 Founder 的受控 UAT。任何证据不应改变网站上线优先级或被解释为生产授权；本任务保持：

```text
MERGED: NO
PRODUCTION_DEPLOYED: NO
REAL_STUDENT_DATA_ENABLED: NO
```
