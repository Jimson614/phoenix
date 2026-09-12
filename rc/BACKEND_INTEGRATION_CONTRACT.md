# Phoenix Nova RC — Backend Integration Contract

状态：FRONTEND DEMO READY / BACKEND AND DEPLOYMENT DEFERRED。
本契约整理现有候选的接入边界与缺口，不声称后台已运行、数据库已验证或 V7 已对齐。所有下述 gap 均不阻塞前端 RC 演示。

## 当前运行边界

- 唯一 origin：127.0.0.1:4300，gateway 只连接两个 Next renderer。
- Family/Application 只有标签页演示状态，无真实登录、跨模块家庭关联、DB、外部上传、顾问提交或支付。
- Education POST /education/api/growth-snapshot 只做本机输入校验与规则计算，generation_status 固定 fallback，不是业务后台或在线 AI。
- rc_demo_*、示例邮箱、示例材料均属虚构数据，后端接入时丢弃，不能导入成 Core 身份或生产客户。
- 无新真实 .env；.env.example 只作为来源，不复制私密 .env、不旋转 secret。

## Family / identity authority

来源：rc/sources/family/docs/family-core/FAMILY_CORE_API_CONTRACT_SKELETON_V1.yaml（0.1.0-synthetic，servers 为空）及 backend/family-core-sandbox/README.md。
已描述 GET /v1/families/{familyId}、GET /v1/families/{familyId}/members/{subjectType}/{subjectId} 等操作；这是 review-only skeleton，不是已部署服务。

接入要求：

- Phoenix Core 负责 user_id / family_id / student_id / guardian_id、身份映射、家庭关系、Guardian、Consent、RBAC、entitlement、audit；浏览器不能签发权威 ID 或决定授权。
- 每次家庭读写从已验证会话获得服务器授权；RC storage 对象不能作为授权载荷。
- members/timeline/compass result/journey handoff 沿用 docs/contracts 中 schema，明确版本与映射。当前模块仅以导航相连，无真实 handoff。
- 在隔离测试环境验证 401/403、跨家庭拒绝、过期/撤回 consent、幂等与并发冲突。

缺口：auth issuer、部署 API origin、正式 ID 映射、端到端 RLS 证据未在本次 Jimson 验收；Legal/Privacy 参数不补造。

## Application intake

来源：rc/sources/application/server/src/masters/http.ts 及 DTO/schema/service。以下为已有路由，当前均未调用：

| Existing route | Existing boundary | RC 状态 |
| --- | --- | --- |
| GET /v1/masters/capabilities | 文件上限/扩展名/能力 | deferred |
| GET/POST /v1/masters/consultations | 查询/创建，create 的 targetYear、channel、path、serviceConsent 与幂等 key | deferred |
| GET/PATCH /v1/masters/consultations/{id} | 授权查询与 version/profile/path 更新 | deferred |
| POST .../{id}/documents | 授权上传、解析限制 | 只有示例元数据，不读取文件 |
| GET .../{id}/extraction、POST .../{id}/extraction/resolve | 提取/用户核实 | deferred |
| POST .../{id}/confirm、POST .../{id}/submit | 确认/提交 | 明确没有发送资料 |
| report、report/export、internal masters | 顾问/报告/staff 鉴权 | deferred |

UI 模型包含 name、adultConfirmed、contact、educationStatus、institution、major、targetYear；材料按在读/毕业分支，草稿不编造成绩。这个前端模型不能直接当作完整 POST DTO，接入必须通过原 schema/version/consent/auth/idempotency。
缺口：受控 auth、隔离测试 DB、私有文件目录、上传/下载授权、解析失败/retry、Unicode PDF 字体、retention/删除政策、顾问权限与 E2E 证据。MASTERS_INTAKE/AI/worker 默认关闭，本次不启用。

## Education snapshot

Schema：rc/education-web/src/lib/compass/types.ts、validation.ts。
输入仅接受 assessment_version=free-mvp-v1.0、age_band、grade_band、location、identity_status、curriculum、interests、family_goal、language=zh-CN。
输出 {result, generation_status}；result_version=growth-snapshot-v1.0，含 growth_type、strength_signals、possible_directions、today_action、disclaimer。
RC 保留 16 KiB body 上限、字段校验、400/413/415 与 no-store。反馈只写标签页事件，不代表服务器收到。
后续需确认 result ownership、同意、存储/删除和 Core timeline handoff；若开启 AI，server-side key、模型、超时和回退需另验，不向浏览器暴露 key。

## 环境 / PostgreSQL / staging 缺口

| Gap | 本机证据与接入条件 | 影响层 |
| --- | --- | --- |
| PostgreSQL | 审计发现旧任务 runtime 有 PostgreSQL 17.11 client；唯一常用工具路径、可销毁测试 DB、role/connection 合约未建立。本轮不启动、不迁移、不写 DB | 后端 DB gate |
| DB/auth env | 目标 DATABASE_URL、SESSION_SECRET 未验证；Family sandbox 需要 FAMILY_CORE_PG_URL / 可选 FAMILY_CORE_PG_BIN，测试库与生产隔离 | 后端接入 |
| Application env | MASTERS_PRIVATE_STORAGE_DIR、测试 DB/role、MASTERS_PDF_FONT_PATH 未验；retention 不能自行决定 | 真实文件/intake |
| Docker/WSL | Docker engine 不可用、WSL 未安装；只有选定容器化后端时才是前置项，当前前端不依赖 | 可选后端方案 |
| staging/deploy | 域名/TLS、secret 注入、API origin、数据库、回滚/监控无本次证据；原 Vinext/Cloudflare 与本地 native Next 的部署等价性未验 | staging/deploy |
| V7 | 共享目录/当前源码 SHA 未验证，不用文件同步或假定 V7 状态 | 跨机来源确认 |

## 后续接入验收（本轮未执行）

先确定测试环境、Backend owner、API origin 与 backend branch/exact SHA；仅使用专用可销毁库与虚构数据。证明 auth/跨家庭拒绝、幂等/版本冲突、文件权限、失败回退、DTO 兼容和完整 handoff 后，才将 UI 标记为“已接入”。DB 与部署操作需独立任务范围。
Jimson 以本 RC branch+SHA 交接；V7 后续通过已验证同一 Git remote 的 commit/PR 对齐并核验 SHA，不用共享盘覆盖工作树。本次没有 push、merge 或发布远端 RC。
