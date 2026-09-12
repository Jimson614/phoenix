# Application Compass｜香港硕士免费咨询 P0

## V1.1 接口、材料与验证边界

> 本文件记录 V1.1 实现、运行方式和验收边界。本轮变更与候选验收方法见 [MASTERS_PR9_ROUND2.md](MASTERS_PR9_ROUND2.md)；[MASTERS_P0_VERIFICATION.md](MASTERS_P0_VERIFICATION.md) 仅为上一轮归档。HTTP、私有文件、本地持久化和浏览器工作台与 PostgreSQL、微信真机分别验收。

## 0. 范围、基线和交付边界

本轮只覆盖 Application Compass 的“香港硕士免费咨询”建档与材料流转：进入咨询、上传或简短填写、核对、确认、提交、后台分配、规则稿报告、顾问复核、Founder 批准和学生查看已开放版本。它是现有教育产品旁边的独立 bounded context，不重写成长测评、39.9 元产品、支付、原 Agent 或家庭/未成年人模型。

当前审计工作树和 Git 边界如下：

| 项目 | 值或规则 |
| --- | --- |
| 仓库工作树 | `D:/CODEX/PhoenixNova/Phoenix Compass/masters-p0` |
| 本地分支 | `codex/masters-intake-p0` |
| 本地起点 | `846f77c120cd00a49d89635dd4297b020af7d03a`（`origin/main`） |
| 基线读取 | 已在独立 worktree 完成 `git fetch origin`；fetch 后 `origin/main` 仍为上述 SHA |
| Founder 参考分支 | `origin/codex/education-founder-final-alignment`，`6db8db05be630dbd56048c56b3b3741c97b6f101`；仅作基线审计，不合并、不 cherry-pick |
| PR #2 可读本地参考 | `origin/codex/weekend-engineering-closeout-2026-08-29`，`09cc6c8d79e1547dabd3ac7b254bdfc27c2fda02`；仅记录差异，不合并 |
| Founder 分支共同基线 | `955a5cf169125dc4d864969edc022e5a50ea3bc2` |
| 其他 fetch 新远端分支 | `website-v5`、`identity-gate2` 与本任务无关，不作为实现来源 |
| 适用规则 | `Phoenix Compass/education compass/AGENTS.md`；其中的 Next.js 文档规则只适用于修改 Next 代码，本文件是 Markdown 契约 |
| 生产边界 | 不改 `main`，不合并或部署，不做生产迁移，不改 DNS/微信审核，不开放真实材料 |

基线审计未授权把 Founder 分支或 PR #2 作为本轮实现来源。旧 Education Compass 的冻结规则仍适用，例如 `docs/product/EDUCATION_COMPASS_PRODUCT_FREEZE_V1.md` 的 `file_upload_enabled: false`、题库 RC 的 `no_file_upload: true` 和成绩/排名文件禁用规则；Masters 必须使用自己的 `/v1/masters`、`masters_*` 表和原生页面，不能改变旧本科测评上传或评分行为。

## 1. P0 开关和默认安全边界

所有 Masters 功能默认关闭。测试环境可以显式开启，但 `MASTERS_INTAKE_ENABLED=true` 在 `NODE_ENV=production` 会失败关闭并返回 `MASTERS_P0_TEST_ONLY`。`MASTERS_AI_ENABLED=true` 当前始终失败关闭并返回 `MASTERS_AI_NOT_APPROVED`；首版报告使用可追踪规则稿和人工核验，不能宣称已接入自定义 GPT、外部搜索或自动录取判断。

配置名称来自 `server/src/masters/config.ts` 和当前 `.env.example`。真实值只能由本机受控环境、CI secret 或部署系统注入，不能写入本文件、Git、日志、小程序包或截图：

| 配置 | P0 要求 |
| --- | --- |
| `MASTERS_INTAKE_ENABLED` | `false` 默认；测试才可为 `true` |
| `MASTERS_AI_ENABLED` | `false`；当前任何 `true` 都拒绝 |
| `MASTERS_WORKER_ENABLED` | `false` 默认；仅在 intake 已开启时有效 |
| `MASTERS_PRIVATE_STORAGE_DIR` | 开启时必须是源码和 release 目录之外的绝对路径；POSIX 创建模式为目录 `0700`、文件 `0600`；Windows 及部署主机还须核验操作系统 ACL |
| `DATABASE_URL` | 仅指向受控 PostgreSQL；不得把值写入仓库或文档 |
| `MASTERS_DEVELOPMENT_STORE_PATH` | 可用于本地开发文件 Store，但不能替代 PostgreSQL 集成验收 |
| `MASTERS_PDF_FONT_PATH` | PDF 导出必需；必须是已安装、获许可的 Unicode 中文字体绝对路径，不能把字体或客户材料提交到仓库 |
| `MASTERS_RETENTION_DAYS` | `1`—`90` 天，默认 `30`；撤回、过期清理仍须保留必要审计记录 |

没有私有目录、数据库、中文字体、合法 HTTPS/AppID 或真机条件时，相关验收项只能记为 `BLOCKED_EXTERNAL`。P0 交付不等于上线。

## 2. V1.1 版本、身份和状态契约

版本常量在 `server/src/domain/masters/contracts.ts`：

| 常量 | 值 | 用途 |
| --- | --- | --- |
| `MASTERS_CONTRACT_VERSION` | `masters-intake-v1.1` | capabilities 和客户端契约锚点 |
| `MASTERS_SERVICE_CONSENT_VERSION` | `masters_service_consent_v1.1` | 咨询资料处理授权副本 |
| `MASTERS_REPORT_TEMPLATE_VERSION` | `masters_application_report_v1.1` | 规则稿/报告模板版本 |

所有 HTTP 路由先经过现有可信登录会话。服务端从 bearer 会话得到 `userId`，不相信客户端传来的 `user_id`、`role`、`approved` 或 `advisor_id`。学生只能访问自己的咨询；顾问还必须有活动分配；Founder 和 `assignment_manager` 才能执行对应的全局工作台操作。错误沿用现有错误 envelope，返回可追踪的 `request_id`，不泄露堆栈、密钥、内部提示词或其他学生资料。

### 2.1 咨询、报告和任务状态

| 对象 | 状态 | 规则 |
| --- | --- | --- |
| 咨询 | `DRAFT`、`SUBMITTED`、`NEEDS_INFO`、`IN_REVIEW`、`CLOSED`、`WITHDRAWN` | 缺材料不阻止提交；撤回后不能继续操作或取报告 |
| 附件上传 | `UPLOADED`、`FAILED`、`REMOVED` | 只有服务端持久化并返回 `document.id` 后才能展示“已上传” |
| 附件解析 | `PENDING`、`PROCESSING`、`SUCCEEDED`、`NEEDS_CONFIRMATION`、`MANUAL_REVIEW`、`FAILED` | 与上传状态分开；解析失败保留原件并进入人工处理 |
| 报告 | `NOT_STARTED`、`QUEUED`、`RUNNING`、`NEEDS_REVIEW`、`APPROVED`、`RELEASED`、`FAILED`、`STALE` | 学生端只返回当前资料版本对应的 `RELEASED` |
| 报告任务 | `QUEUED`、`RUNNING`、`NEEDS_REVIEW`、`FAILED`、`STALE` | 记录尝试次数、租约 token/owner/expiry、重试时间和错误 |
| 分配 | `ACTIVE`、`ENDED` | 独立于报告；改派结束旧分配并建立新版本 |

`profileVersion` 是资料的乐观并发版本。PATCH、材料增补/替换/撤除和提取冲突处理会使受影响草稿或报告失效；确认创建包含资料版本和当前有效材料 ID 的快照。旧任务不能覆盖新版本，已开放报告若资料版本变化则不再作为当前有效报告。

草稿 PATCH 可在 `version`、`profile` 之外携带可选 `path: RESUME | GUIDED`，用于持久保存学生切换的填写路径；不接受其他路径值。它使用同一本人、有效同意、版本检查和旧报告失效规则，不改变权限或审核状态。

### 2.2 幂等契约

需要重试保护的写请求使用 `Idempotency-Key` 请求头，格式为 `[A-Za-z0-9._:-]{8,128}`。服务端按可信用户、操作域和 key digest 记录请求，并比较 input digest：同一 key 的同一输入重放原资源；同一 key 改输入返回冲突；尚在处理返回 `IDEMPOTENCY_IN_PROGRESS`，不能重复建档、附件、分配或报告任务。

当前持久化幂等域为：`CREATE`、`CONSENT`、`CONFIRM`、`SUBMIT`、`DOCUMENT_ADD`、`ASSIGN`、`ENQUEUE_REPORT`。报告编辑/复核/决策使用版本及状态检查和审计；编辑产生新报告版本，重放旧版本返回冲突。这些操作不宣称具有幂等键重放能力，网络结果不确定时先重新读取当前状态。

## 3. 咨询字段契约（V1.1 第 2.1 节）

`MastersProfile` 的所有字段在空草稿中可以为空；服务端只对提交要求最小集合。未知值标记为待补/待核验，不能保存成 `0`、猜测的学位、换算后的分数或虚构经历。

| 字段组 | 接口字段 | 类型和规则 |
| --- | --- | --- |
| 身份与联系 | `name`、`adultConfirmed`、`contact` | `name` 为称呼；`adultConfirmed` 必须明确为 `true`；`contact={type,value}`，`type` 为 `email`/`phone`/`wechat`，提交至少一种有效联系方式。联系方式不是登录或归属凭证 |
| 学籍状态 | `educationStatus`、`graduationYear`、`graduationDate` | `educationStatus` 为 `ENROLLED`/`GRADUATED`；日期接受 `YYYY-MM` 或 `YYYY-MM-DD`；不确定可留空/待补 |
| 教育背景 | `institution`、`major`、`degree` | 本科院校、专业、学位名称；`degree` 可待核验，不由专业名推断 |
| 学业成绩 | `averageScore`、`gpa`、`gpaScale`、`classRank` | 均以原始字符串保存；百分制与 GPA 不要求同时填写；保留 GPA 满分制；排名可选，不把空值当零 |
| 语言情况 | `languageStatus`、`languageType`、`languageScores` | `languageStatus` 为 `NONE`/`AVAILABLE`；类型为 `IELTS`/`TOEFL`/`OTHER`/`NONE`；总分、小分、考试日期和 `raw` 原样保存，缺小分/日期可待核验。选 `NONE` 时不要求成绩 |
| 申请意向 | `targetYear`、`targetMajors`、`targetInstitutions`、`targetPreference` | `targetYear` 为四位年份或 `UNDECIDED`；专业/院校可字符串或数组；允许“尚未确定，希望顾问建议” |
| 相关经历 | `experiences` | 可选数组，类型为 `INTERNSHIP`、`RESEARCH`、`COMPETITION`、`STUDENT_WORK`、`OTHER`；可含标题、机构、描述、起止日期、事实和证明附件 ID，不补造结果 |
| 准确性 | `accuracyConfirmed` | 与服务授权独立；确认快照/提交前必须由申请人明确确认为 `true` |

建议入口路径固定为 `path=RESUME`（有简历，先上传再补缺）或 `path=GUIDED`（无简历，四组短表单：教育背景、成绩与语言、申请目标、经历可跳过）。不进入成长测评长题库，不展示套餐价格或付费按钮。

材料页先读取 `/v1/masters/capabilities` 返回的版本、格式、上限、保留天数和完整用途说明；规则未读到时不能勾选授权或选择文件。服务端记录实际说明文本（含保留天数）的 SHA-256 和授权版本。首次进入尚无咨询编号也显示材料卡片；有简历路径顶部优先上传，切换为引导填写保留已有字段与材料。补充证明允许填写类别/说明，该说明随附件持久化并在后台显示。

提交前最小服务端检查为：`name`、`adultConfirmed=true`、有效 `contact.value`、`educationStatus`、`institution`、`major`、合法 `targetYear`，当前资料版本未冲突，存在活动 `masters_service_consent_v1.1`，且准确性确认快照与当前版本一致。成绩、语言、毕业证、学位证等材料缺失进入 `missingDocuments`，不会把咨询拦成“材料完整”；响应必须同时带 `missingFields`、`missingDocuments` 和 `verificationStatus`（`NEEDS_REVIEW`/`READY`，撤回时为 `WITHDRAWN`）。

## 4. 七类独立上传卡片（V1.1 第 2.1—2.2 节）

前台必须是七张有标题、说明、按钮、文件列表、上传状态和后续操作的原生卡片。底层可以复用安全上传组件，但不提供一个含糊的“上传全部材料”入口。接口/数据库使用 canonical `type` 值；为了兼容 V1.1 文案的 `document_type` 建议值，服务端可接受下列别名并立即归一化，返回只使用 canonical 值。

| 卡片标题 | 按钮 | V1.1/历史别名 | 持久化 canonical `type` | 显示条件 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 个人简历 | `点击上传简历` | `CV` | `RESUME` | 全部状态 | 有简历路径优先；上传原件与生成的事实草稿分开标识；无简历可改走引导填写，不强制再传简历 |
| 本科成绩单 | `点击上传成绩单` | `TRANSCRIPT` | `TRANSCRIPT` | 全部状态 | 支持多学期、多页和中英文版本；连续追加不得覆盖前页 |
| 语言成绩 | `点击上传语言成绩` | `LANGUAGE_SCORE` | `LANGUAGE` | 全部状态 | 没有语言成绩选择“暂无”，不伪造文件或分数 |
| 在读证明 | `点击上传在读证明` | `ENROLMENT_CERTIFICATE` | `ENROLLMENT` | `educationStatus=ENROLLED` | 尚未开具可后补；状态切换不静默删除已有材料 |
| 毕业证书 | `点击上传毕业证` | `GRADUATION_CERTIFICATE` | `GRADUATION` | `educationStatus=GRADUATED` | 与学位证独立卡片、独立附件 ID |
| 学位证书 | `点击上传学位证` | `DEGREE_CERTIFICATE` | `DEGREE` | `educationStatus=GRADUATED` | 不能用毕业证代替；未取得/无电子版可待补 |
| 补充证明 | `点击上传补充材料` | `SUPPORTING_DOCUMENT` | `SUPPLEMENTAL` | 全部状态，默认折叠 | 实习、科研、竞赛、学生工作等可选证明；需显示类别/说明 |

支持的扩展名和真实 MIME 为 PDF、DOCX、JPG/JPEG、PNG；旧 `.doc` 明确拒绝。前后端都执行单文件上限 `10 MiB`、咨询附件上限 `20`、扩展名/MIME/magic bytes 检查。材料卡片显示文件名、大小、类别、版本、`上传中`/`已上传`/`上传失败`/重试/撤除/替换/继续补充；网络失败或用户取消不能显示成功，也不能清空已经保存的文件。多页或中英文版本通过多次新增保留全部行，替换只标记旧行 `REMOVED` 并保留审计历史。

学籍状态切换只改变卡片可见性：在读显示在读证明，毕业显示毕业证和学位证。隐藏的历史材料仍可在服务端详情中看到并由学生确认保留、撤除或重新分类；不能用切换删除附件。底部“保存，稍后继续”和“核对并提交免费咨询”分开，未完成的临时上传必须允许等待或撤下后再提交。

## 5. HTTP v1.1 契约

当前实现文件为 `server/src/masters/http.ts`、`server/src/services/masters-service.ts`，应用入口为 `server/src/http/app.ts`。实际部署前缀是 `/v1/masters` 和 `/v1/internal/masters`；V1.1 指令中的无版本示例需按此调整。

### 5.1 学生端

| 方法和路径 | 请求 | 成功响应/规则 |
| --- | --- | --- |
| `GET /v1/masters/capabilities` | 可信会话 | 返回 `contractVersion`、`maxFileBytes=10485760`、`maxDocuments=20`、`extensions=[pdf,docx,jpg,jpeg,png]`、`aiEnabled=false` |
| `POST /v1/masters/consultations` | `Idempotency-Key`；JSON 仅允许 `targetYear`、`channel`、`path`、`serviceConsent` | `201`，创建或幂等恢复本人申请季咨询；`serviceConsent={accepted:true,...}` 单独落 consent 行；不接收客户端 `userId` |
| `GET /v1/masters/consultations` | 可信会话 | 只列本人咨询，带资料版本、缺项、材料分类和状态 |
| `GET /v1/masters/consultations/:id` | 可信会话 | 只读本人详情；学生 DTO 隐去 `userId`、`serviceConsentId`、`storageKey` 和私有审计字段 |
| `PATCH /v1/masters/consultations/:id` | JSON `{version,profile}` | 乐观版本保存字段；要求活动服务授权；冲突返回 `409` 和当前版本，不能覆盖新资料 |
| `POST /v1/masters/consultations/:id/documents` | `Idempotency-Key`；multipart 单字段 `file`，表单 `version,type,description,replaceDocumentId` | 真实存入私有目录后才返回 `201` 和 `document.id`；服务端生成/读取文件名、MIME、大小、SHA-256；替换原子地标记旧附件为 `REMOVED` |
| `GET /v1/masters/consultations/:id/documents/:docId` | 可信会话；每次检查 owner 或已授权内部角色 | 鉴权后返回文件流；不返回公开对象 URL、storage key 或别的学生材料 |
| `DELETE /v1/masters/consultations/:id/documents/:docId?version=N` | 可信会话；当前资料版本 | 撤除本人附件、保留版本/审计关系、清理私有原件；不能删除别人的附件 |
| `GET /v1/masters/consultations/:id/extraction` | 可信会话 | 每个附件的解析状态、字段、来源文件、位置/片段、置信标记和冲突；提取正文当作不可信数据 |
| `POST /v1/masters/consultations/:id/extraction/resolve` | JSON `{version,documentId,field,value,accepted}` | 解决提取冲突并记录确认，仍与上传状态分离 |
| `POST /v1/masters/consultations/:id/confirm` | `Idempotency-Key`；JSON `{version,accuracyConfirmed:true,consent?}` | 创建确认快照；服务授权与准确性确认分开存储 |
| `POST /v1/masters/consultations/:id/submit` | `Idempotency-Key`；JSON `{version}` | 幂等提交，可靠建立工作队列；缺附件只形成缺件清单，不阻止满足最小字段的咨询 |
| `POST /v1/masters/consultations/:id/withdraw` | 可选 JSON `{version}` | 撤回咨询、取消未完成处理并撤销附件访问；撤回后状态为 `WITHDRAWN` |
| `GET /v1/masters/consultations/:id/report` | 可信会话 | 仅本人可取当前资料版本的 `RELEASED` 报告；草稿、待复核、已批准未开放均拒绝 |
| `GET /v1/masters/consultations/:id/report/export?format=pdf\|xlsx` | 可信会话 | 仅导出当前 `RELEASED`；导出前后比较报告 ID、版本、资料版本和内容 digest，变化则 `REPORT_STALE` |

JSON 详情中的附件至少含 `id`、`consultationId`、canonical `type`、`originalName`、`mimeType`、`sizeBytes`、`profileVersion`、`uploadStatus`、`extractionStatus`、上传/更新/撤除时间；学生响应不含私有 `storageKey`。文件选择在原生端完成后仍须走 `wx.uploadFile`，仅有临时路径不算成功。

### 5.2 内部工作台

| 方法和路径 | 请求 | 权限/规则 |
| --- | --- | --- |
| `GET /v1/internal/masters/me` | 可信会话 | 仅活动 `masters_staff` 返回自己的 Masters 角色 |
| `GET /v1/internal/masters/advisors` | 可信会话 | 活动员工可查看可分配顾问的用户 ID 列表；不返回不必要个人资料 |
| `GET /v1/internal/masters/consultations` | 可信会话 | Founder/分配管理员看全量；顾问只看自己的活动分配 |
| `GET /v1/internal/masters/consultations/:id` | 可信会话 | 按下方权限矩阵返回内部详情和按 canonical 类别分组的材料 |
| `POST /v1/internal/masters/consultations/:id/assignment` | `Idempotency-Key`；`{advisorUserId,version}` | 仅 Founder/分配管理员；服务端确认目标是活动顾问，改派结束旧分配 |
| `POST /v1/internal/masters/consultations/:id/request-documents` | `{types,note}` | 仅已授权内部成员；canonical 缺件清单，状态转 `NEEDS_INFO` |
| `POST /v1/internal/masters/consultations/:id/reports` | `Idempotency-Key`；`{version}` | 已确认快照后入队；规则稿默认空候选，必须进入人工核验 |
| `POST /v1/internal/masters/consultations/:id/report/edit` | `{version,reportId,payload,note?}` | 已授权内部成员编辑允许状态的草稿；必须版本检查和审计 |
| `POST /v1/internal/masters/consultations/:id/report/review` | `{version,reportId,note}` | 仅被分配顾问或 Founder 可复核 |
| `POST /v1/internal/masters/consultations/:id/report/return` | `{version,reportId,note}` | 仅 Founder；退回到 `NEEDS_REVIEW` |
| `POST /v1/internal/masters/consultations/:id/report/approve` | `{version,reportId,note}` | 仅 Founder；`NEEDS_REVIEW → APPROVED` |
| `POST /v1/internal/masters/consultations/:id/report/release` | `{version,reportId,note}` | 仅 Founder；当前资料版本一致且已批准才可 `RELEASED` |
| `GET /v1/internal/masters/consultations/:id/documents/:docId` | 可信会话 | 复用附件 owner、咨询和内部角色检查；不分发公开 URL |
| `GET /v1/internal/masters/consultations/:id/report/export?format=pdf\|xlsx` | 可信会话 | 内部也只能导出已开放版本；不绕过审批下载草稿 |

内部报告编辑/复核/决策必须由最终实现补充网络重试下的幂等证据（当前路由明确要求版本和审计，`assignment`/`reports` 已有幂等头）。普通 `admin` 用户角色不等于 `masters_staff` 授权；隐藏按钮不构成权限控制。

## 6. 持久化、归属、版本和分类

新增迁移为 `server/migrations/006_masters_intake.sql`，只增量创建 `masters_*` 表，不修改旧 Education Compass 表。当前表集合为：

- `masters_consultations`：申请季、可信 `user_id`、可选 `linked_student_id`、状态、profile、版本、授权/确认快照引用。
- `masters_staff`、`masters_consultation_assignments`：工作台角色、活动状态、顾问分配和改派历史。
- `masters_consultation_consents`：授权副本版本、文本 hash、locale、授予/撤回时间；不能和准确性确认或营销授权混成一项。
- `masters_consultation_documents`：附件 ID、咨询 ID、可信 owner、canonical `type`、文件名、真实 MIME、大小、SHA-256、私有存储引用、资料版本、上传/解析状态、时间和撤除时间。
- `masters_consultation_snapshots`：准确性确认时固化的 profile、profileVersion、document IDs、确认人和时间。
- `masters_reports`、`masters_report_jobs`：来源快照/资料版本、模板版本、报告 payload、审核人/时间、任务重试和租约字段。
- `masters_audit_logs`、`masters_idempotency_records`：操作审计和重试防重。

接口语义中的 `document_type` 映射到当前 domain/SQL canonical `type`；别名 `CV`、`LANGUAGE_SCORE`、`ENROLMENT_CERTIFICATE`、`GRADUATION_CERTIFICATE`、`DEGREE_CERTIFICATE`、`SUPPORTING_DOCUMENT` 只在输入边界归一化，不能泄露到后台分类或报告。后台详情必须按七类分组，至少显示已上传、待补、待核验、失败和撤除状态。

归属约束：

1. `userId` 只能从服务端登录身份取得；`consultationId`、`documentId`、`linkedStudentId` 均需在服务端查询并确认关系。
2. 学生下载需同时满足咨询 owner、附件属于该咨询、附件未撤除；内部下载还需 Founder/分配管理员或该咨询活动顾问授权。
3. `linkedStudentId` 只是现有家庭/学生档案的受控映射；不以手机号单独合并成人申请主体，不伪造 guardian consent。
4. 替换或撤除不静默覆盖历史；旧行保留 `REMOVED`/版本关系，受影响快照和报告标记为过期并要求复核。
5. `PostgresStore` 的 JSONB、canonical `type` 和 `sizeBytes` 必须经过真实 PG 往返验证；只看到表存在不能报告持久化 PASS。

## 7. 上传、解析和原生导入边界

### 7.1 上传不等于解析

真实生命周期为：原生选择 → 服务端 multipart 检查 → 受限子进程解析（最长 8 秒）→ 私有文件原子写入和附件元数据事务 → 返回 document.id。上传和解析分别保存状态：格式有效但解析失败的原件仍持久保存为 UPLOADED / FAILED；图片保留为 UPLOADED / MANUAL_REVIEW。当前解析在上传请求内有界执行，未把未实现的异步解析队列宣称为已运行。

`server/src/masters/documents.ts` 检查扩展名、MIME、magic bytes、大小和 multipart 字段；解析器必须有限时、有限解压/resource budget，禁止宏、脚本和文档指令。原件由 `server/src/masters/private-files.ts` 使用随机 UUID opaque key、`.pending` 原子写入、fsync、rename 保存，目录在源码和 release 外，不生成公开 URL。正文、解析字段和证据片段都是不可信输入，不能触发模型工具或改变系统指令。

文本 PDF/DOCX 可走受限直接解析；扫描图片没有经过验证和批准的识别能力时保留原件并转人工核验，不猜测分数/小分/经历。证据需带来源文件、位置/片段、置信标记和用户确认记录。

### 7.2 原生小程序导入和路径

当前实现对应文件为：

- `pages/masters-intake/index.*`：介绍、`RESUME`/`GUIDED` 两条路径、登录和咨询列表入口。
- `pages/masters-materials/index.*`：授权、字段保存、七类独立卡片、选择/上传、材料状态和继续流程。
- `pages/masters-confirm/index.*`：资料核对、冲突和准确性确认。
- `pages/masters-status/index.*`：提交、缺件、补件和进度。
- `pages/masters-list/index.*`：本人咨询记录。
- `pages/masters-report/index.*`：只展示已开放报告/导出。
- `services/masters.js`、`models/masters-intake.js`、`config/masters.js`：API、卡片模型、上限和 fail-closed 客户端开关。

`services/masters.js` 应在文件选择前调用 `wx.requirePrivacyAuthorize()`；普通文件使用 `wx.chooseMessageFile`，图片提供 `wx.chooseMedia`/`wx.chooseImage` 的相册/拍照入口；上传使用带 bearer 身份和 `Idempotency-Key` 的 `wx.uploadFile`，查看/导出使用带身份的 `wx.downloadFile`。客户端必须从服务端重新加载咨询和文件清单，不能以短期本地路径恢复永久附件。

六个 Masters 页面已注册在 app.json。导入目录为当前 education compass（原生小程序，不是旧 Next.js 工程）。客户端 config/masters.js 默认关闭；仅在隔离开发副本显式启用 MASTERS_ENABLED，同时在 config/runtime.js 配置获批准的测试 HTTPS 地址并打开 FORCE_REMOTE_IN_DEVELOPMENT。不能用关闭 urlCheck 绕过域名验收。开发工具和真机的隐私授权、文件选择、拍照、上传、下载尚未执行，保持 BLOCKED_EXTERNAL。

## 8. 服务授权、隐私和 AI 边界

服务授权使用 `masters_service_consent_v1.1`，保存副本版本、hash、locale、授予和撤回时间。它与以下内容分别处理：

- 申请人资料处理/建档的必要授权；
- 外部 AI 或第三方解析的用途授权；
- 营销/联系授权。

外部 AI 默认关闭且当前未完成；没有独立批准和用途授权时，原件、姓名、电话、证件、成绩正文不得外发。日志、埋点、分享参数、Git、release 和错误响应不得包含敏感正文、联系人、私有路径或密钥。撤回后停止未完成处理、撤销附件和报告访问，按保留策略清理原件；审计记录仍要能证明发生过什么。

## 9. 后台权限矩阵

权限在服务端通过 `masters_staff` 和活动分配执行，角色为 `founder`、`assignment_manager`、`advisor`；`SUSPENDED` 员工一律拒绝。

| 操作 | Founder | Assignment manager | Advisor（仅活动分配） | 普通学生/普通 admin |
| --- | --- | --- | --- | --- |
| 查看全量咨询、材料缺口和内部状态 | ✓ | ✓ | ✗（仅已分配） | ✗ |
| 查看自己被分配的咨询和鉴权附件 | ✓ | ✓ | ✓ | ✗ |
| 分配/改派活动顾问 | ✓ | ✓ | ✗ | ✗ |
| 请求补件 | ✓ | ✓ | ✓ | ✗ |
| 入队生成规则稿 | ✓ | ✓ | ✓（在授权个案） | ✗ |
| 编辑草稿 | ✓ | ✓（在授权个案） | ✓（在授权个案） | ✗ |
| 提交报告复核 | ✗ | ✗ | ✓ | ✗ |
| 退回/批准/开放报告 | ✓ | ✗ | ✗ | ✗ |
| 学生查看报告 | 通过内部鉴权查看；学生只看本人已开放版本 | 通过内部鉴权查看；学生只看本人已开放版本 | 通过内部鉴权查看；学生只看本人已开放版本 | 仅本人已开放版本 |
| 读取其他学生原件/公开 storage URL | ✗ | ✗ | ✗ | ✗ |

“管理员能分配”不等于“能批准正式报告”；Founder 决策还要检查报告状态、报告版本和当前资料版本一致。每次分配、补件、编辑、复核、批准、退回、开放和下载授权都留下最小审计事件。

## 10. 规则稿报告和导出

规则模板包含：背景摘要、优势与资料缺口、建议方向、候选学校/专业表、准备计划、下一步及限制说明。资料不足时先输出缺件和有限初评。`candidatePrograms` 默认必须为空并标记人工核验；任何候选项目在对外前都要有官方项目名、入学年份、要求、匹配理由、风险、HTTPS 官网 URL、核验日期、`sourceStatus`（`NEEDS_REVIEW`/`VERIFIED`）和学生接受状态。没有可核验来源时保持 `NEEDS_REVIEW`，不得补造官网要求、录取概率、保录或保证性结论。

报告绑定 `snapshotId`、`sourceProfileVersion`、`templateVersion` 和内容 digest。材料或字段更新会使旧报告 `STALE`，旧 worker 不能写回新版本。只有 Founder 批准后才可开放；学生端和导出端均拒绝草稿/待复核/仅批准版本。

批准和开放都校验非空项目的官网 HTTPS 来源、顾问 `VERIFIED` 标记、非未来核验日期以及与咨询一致的入学年份。服务端派生 `assistance`，编辑器不能用改标签将草稿提升为完整方案：未复核为规则草稿；已复核但没有项目或方向/计划/下一步不完整为初评／待补报告；来源合格且内容完整、经活动顾问复核后才称顾问核验后的申请方案。自动选校始终 `NOT_IMPLEMENTED`。来源门禁检查人工核验记录与格式，不自动抓取或鉴定官网。

PDF 由 `renderMastersPdf` 生成，必须传入 `MASTERS_PDF_FONT_PATH` 指向已安装许可的中文 Unicode 字体；没有字体时是 `PDF_FONT_REQUIRED` 阻塞。XLSX 由真实 OOXML 生成，所有单元格按字符串写入以避免公式/外链，且必须绑定获批报告的完整 `version`、`sourceProfileVersion`、`templateVersion`、content digest 和完整 `approved_candidates_json`；不能只导出候选名称或脱离获批版本的表格。

## 11. 测试配置、命令和回滚

### 11.1 本地可运行检查

以下命令只在本任务工作树执行；它们不能代替外部条件验收：

```text
npm run test:masters
npm --prefix server run build
npm --prefix server run test:masters
npm run test:masters-postgres
```

`test:masters-postgres` 调用 `scripts/test-masters-postgres.js`，并运行 `server/tests/masters-postgres.test.ts` 编译产物。测试脚本只读取 `MASTERS_TEST_DATABASE_URL`，不会把现有 `DATABASE_URL` 偷渡为测试连接，也不会打印连接 URL；没有专用连接时输出一行机器可读 JSON：

```json
{"status":"BLOCKED_EXTERNAL","suite":"masters-postgres","databaseConnectionAttempted":false}
```

有变更权限时还必须设置 `MASTERS_TEST_DATABASE_ALLOW_MUTATION=YES`。连接数据库名必须含有明确分隔的 `test`、`testing`、`ci` 或 `sandbox` 标记；禁止使用生产库、共享业务库或从 `.env` 搜索秘密。主代理应将真实运行结果、命令、时间、commit 和无敏感日志摘要补到本文件的“保留证据”表。

真实 PostgreSQL 套件必须覆盖：

1. 从所有迁移升级，006 建立完整 Masters 表和校验；
2. 在同一 UUID schema 运行 006 down.sql，检查 001–005 记录及旧表保留，再重新升级 006；
3. 普通 `PostgresStore` 对咨询、profile JSONB、七类材料、解析状态、快照、报告和 job 的持久化及重连；百分制/GPA/满分制保真，`type`/`sizeBytes` 类型正确；
4. 外键、咨询/材料 owner 关系和跨学生读取拒绝；
5. 同一用户/申请季并发建档只产生一个持久记录；
6. worker 旧 lease token/owner 不能完成或覆盖新 lease，失败可按策略重试；
7. 测试结束只 `DROP SCHEMA <本次 UUID schema> CASCADE`，不能删除数据库或旧表。

### 11.2 回滚边界

`server/migrations/rollback/006_masters_intake.down.sql` 只能在停掉 Masters worker 后，对专用测试 schema/测试库执行。它按 Masters 表依赖顺序删除 `masters_*`，不得在共享或生产库运行；不得修改、重写、下迁移旧 Education Compass migration。回滚应证明“Masters 表已移除，001–005 记录和旧表仍在”，再在同一隔离 schema 升级 006。最终清理才删除本轮 UUID schema。专用 PostgreSQL 尚未配置，因此上述 SQL 往返尚未执行。

## 12. 隔离测试启动与工作台

在项目目录先执行 npm --prefix server ci，再执行 npm --prefix server run build。Node.js 要求 22.13 或更新；本轮使用 Node 24.19.0。

测试引导脚本 server/scripts/masters-bootstrap-test.js 仅接受 NODE_ENV=test、MASTERS_BOOTSTRAP_SYNTHETIC=YES 且没有 DATABASE_URL。它在系统临时目录新建虚构身份、私有会话文件、持久 FileStore 和 runtime-environment.json；不会改写运行中的数据库或创建生产管理员。脚本只输出文件路径，不打印会话。

PowerShell 示例（不要把会话文件提交到 Git）：

```powershell
$env:NODE_ENV = 'test'
$env:MASTERS_BOOTSTRAP_SYNTHETIC = 'YES'
node server/scripts/masters-bootstrap-test.js
# 从输出的 runtime-environment.json 逐项注入本进程环境；不填写生产地址。
# 正式 PDF 另设置 MASTERS_PDF_FONT_PATH 为已获许可的中文字体路径。
npm --prefix server start
```

服务默认端口 3000；内部工作台在 http://127.0.0.1:3000/internal/masters。使用临时私有会话文件中的 founder / advisor / assignment_manager 会话完成测试；学生会话不能进入后台。页面只在内存保留会话，刷新或退出会清空。此处 loopback HTTP 仅用于后台本地验收，小程序仍要求测试 HTTPS 和合法域名。

自动浏览器回归脚本 scripts/test-masters-workbench.js 在临时目录建立独立虚构个案，启动 loopback HTTP，执行真实浏览器点击和文件下载，然后关闭服务并清理临时数据。设置 MASTERS_BROWSER_TEST_MODULE 为已安装 Playwright 模块路径；必要时设置 MASTERS_BROWSER_EXECUTABLE 为本机 Chromium/Edge 路径。执行 node scripts/test-masters-workbench.js。它不依赖生产登录，也不会把 token 打印或写入浏览器存储。

## 13. 实测与外部阻塞

详见 [最终验收记录](MASTERS_P0_VERIFICATION.md) 和其同目录机器可读结果。仅使用程序生成的完全虚构材料。

- 未提供 MASTERS_TEST_DATABASE_URL：PostgreSQL 迁移、回退、重连、并发仍为 BLOCKED_EXTERNAL；FileStore 重启成功不代替此项。
- 微信开发工具、真机、实际 AppID 权限、request/uploadFile/downloadFile 合法 HTTPS 域名及平台隐私配置尚未验证。
- 私有文件字节持久化和接口访问隔离已可本地验证；部署主机 ACL、备份/加密配置尚未验证。
- 文本 PDF/DOCX 只提取显式标签字段；扫描材料和一般自然语言简历仍需人工核验。外部 OCR、模型、院校搜索未启用；候选院校默认为空，顾问补入并标记已核验后才能正式开放。
- PDF 未配置中文字体时保持 PDF_FONT_REQUIRED；本机测试使用系统安装字体，不把字体文件入库。
- 原有免费/付费测评、支付、家庭和未成年人模型继续独立运行；没有本轮生产迁移、合并、部署或真实学生数据开放。
