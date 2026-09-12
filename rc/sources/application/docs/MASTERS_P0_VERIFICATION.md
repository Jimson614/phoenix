# 香港硕士免费咨询 P0 / V1.1 历史验收记录

> 本文归档至上一轮提交 `29df2358718232294dcda4af9f2410fd0b32aab6`，包括 110/110 在内的下列记录不适用于后续 HEAD。本轮说明见 [PR #9 下一轮修正](MASTERS_PR9_ROUND2.md)，当前候选实际结果以绑定新 SHA 的验收输出及 PR 正文为准。

日期：2026-09-05。总状态：**BLOCKED**（代码与本地真实联调可审阅；PostgreSQL 和微信平台/真机验收缺外部条件）。所有身份、联系方式和材料均程序生成，不引用真实学生样板。

仓库 `yvettfang-netizen/phoenix`；原任务分支 `codex/masters-intake-p0`；基线 `846f77c120cd00a49d89635dd4297b020af7d03a`。沿用本任务工作树，不覆盖原工作目录成果，不合并 Founder 分支或 PR #2。该轮历史交付提交为 `29df2358718232294dcda4af9f2410fd0b32aab6`；不能跟随 Draft PR 当前 head 自动更新证据归属。

接口、测试配置、页面路径、角色与回滚操作见 [运行及接口说明](MASTERS_INTAKE_P0.md)。机器可读状态见 [MASTERS_P0_VERIFICATION.json](MASTERS_P0_VERIFICATION.json)。

## 1. 分层结果

| 层面 | 实际状态 | 已执行证据与限制 |
| --- | --- | --- |
| 小程序页面及交互 | 本地契约 PASS；微信运行时 BLOCKED | 六个原生页面，字段、七类上传调用、首次空草稿卡片、状态切换保留、服务规则、可选补充类别、文件错误、账号切换响应拒绝的单元/契约测试通过。wx 能力在测试中替身执行，不等于开发者工具或真机通过。 |
| HTTP 接口 | PASS（隔离本机服务） | 启动真实 HTTP server，使用现有鉴权签发的虚构会话；FormData 上传真实 DOCX/PDF/PNG/JPEG 字节；服务端返回持久附件 ID；错误和权限均由服务端检查。 |
| 本地持久存储 | PASS（FileStore + 私有磁盘目录） | 关闭并重启服务，从 FileStore 恢复资料和材料，再经鉴权下载并比较原始字节/hash。持久保存不依赖客户端临时路径。 |
| PostgreSQL | **BLOCKED_EXTERNAL** | 缺专用测试库连接；两个数据库测试命令明确未尝试连接。006 升级/回退、JSONB、约束、重连及并发测试已提供，但没有运行通过证据。 |
| 存储访问隔离 | PASS（本机 HTTP）；主机配置 BLOCKED | 跨学生、未分配顾问、改派旧顾问、已撤除/替换/撤回附件访问被拒；不返回公开 storage URL。部署主机 ACL、备份、静态加密仍需实际配置验证。 |
| 内部工作台 | PASS（真实浏览器） | 本机 Edge/Chromium 打开真实工作台，学生拒绝、未分配顾问空列表、七类分组、毕业/学位分开、分配、鉴权下载字节相等、顾问复核、Founder 批准开放、XLSX 下载、浏览器无 token 持久存储。 |
| 报告和任务 | PASS（规则稿/人工审核） | 持久入队；重复提交仅一任务；租约过期和旧 token 拒绝写回；编辑新版本、材料更新使旧报告过期、顾问与 Founder 分权。无外部 AI/OCR/学校搜索。 |
| PDF / XLSX | PASS（本机实文件） | PDFKit 中文 PDF，读取导出正文覆盖六部分；真实 OOXML XLSX，无公式/外链。报告版本、资料版本、完整候选 JSON 与内容 digest 一致。草稿/未开放/过期版本拒绝导出。中文字体为系统已安装字体，不入库。 |
| 旧产品回归 | PASS | 旧测评、支付、权益、Agent、家庭/未成年人权限等现有测试通过；本模块无支付入口、无自动建家庭。 |
| 生产/真实客户 | **未开放** | 功能和 worker 默认关闭；生产环境开启 P0 被拒；外部 AI 开启也被拒。没有合并、生产迁移、生产部署或真实学生数据开放。 |

## 2. V1.1 第 2.1—2.3 节逐项证据

| 场景 | 证据位置 | 结果 |
| --- | --- | --- |
| 有简历在读者 DOCX 简历、PDF 成绩单 | `server/tests/masters-http.test.ts` + `tests/masters-client.test.js` | 真实字节上传、分类和附件 ID；在读卡显示，毕业/学位卡按状态隐藏。微信点选链路仍需真机。 |
| 已毕业者分别上传毕业证、学位证 | HTTP graduate case + `scripts/test-masters-workbench.js` | PNG 和 JPEG 两份不同文件；刷新/读取后类别分开，获授权后台可下载。 |
| 无简历引导填写 | `models/masters-intake.js`、确认页、客户端测试 | 按已提供事实生成可核对草稿；未知标记待补；不要求再上传简历原件。 |
| 缺成绩/语言/证明先提交 | HTTP 和 domain 测试 | 提交并持久入队；`missingFields`、`missingDocuments`、`NEEDS_REVIEW` 保留，规则稿限制说明不补造信息。 |
| 多页/中英文成绩单追加 | HTTP restart case | 同类两份附件均保留，未被后一次上传覆盖。 |
| 上传失败与文件边界 | files / HTTP / client 测试 | 取消选择、旧 DOC、MIME/magic 错配、超 10 MB、20 份上限、真实连接中断、重复请求、替换/撤除、解析失败和重试；已保存资料保留。满额时可替换一份旧件。 |
| 字段保真与冲突 | domain / HTTP / client 测试 | 均分/GPA/分制/排名/语言小分日期/意向往返；不把空值变零；来源候选保留，接受/拒绝留痕，冲突未解决不能确认。 |
| 后台分类及权限 | workflow HTTP + browser | 同咨询七类分组，可填写及读取补充说明；未授权人员无法读取附件；改派即时撤销旧顾问权限。 |
| 撤回、过期与孤儿文件 | HTTP retention case | 撤回取消未完成任务并删除原件；清除敏感文件名/提取数据；过期清理测试；旧崩溃孤儿文件清理，保护新近写入文件。 |
| 公共/学生响应隔离 | HTTP + client + release tests | 不暴露私有路径、其他学生资料或内部未开放报告；切换账户时清除页面状态并拒绝旧 token 响应；分享只带白名单渠道。 |

## 3. 实际命令

工作目录为本任务 `Phoenix Compass/education compass`。Node 24.19.0，npm 11.17.0。

| 命令 | 真实结果 |
| --- | --- |
| `npm run test:all` | PASS：客户端及项目/界面/包检查、服务端 typecheck；服务端 **110/110 PASS，0 fail、0 skip**。 |
| `node scripts/test-masters-workbench.js` | PASS：配置已安装 Playwright 与本机 Edge，真实浏览器 + HTTP + 私有 FileStore；没有声称微信真机通过。 |
| `npm run test:release` | PASS：相对模块解析、包大小、生产包不含服务端和 demo 管理页。最终字节见 JSON。 |
| `npm run scan:release-secrets` | PASS：0 findings。 |
| `npm run test:education-postgres` | **BLOCKED_EXTERNAL**：缺 `EDUCATION_TEST_DATABASE_URL`，未连接数据库。命令退出 0 是明确阻塞结果，不解释为数据库通过。 |
| `npm run test:masters-postgres` | **BLOCKED_EXTERNAL**：缺 `MASTERS_TEST_DATABASE_URL`，未连接数据库。 |
| `npm run build:release` | 退出 0，输出 **OFFLINE_TEST_ONLY** 到 `dist/offline-test`；没有生成可声称已上线的生产包。 |
| 测试引导 + `server/dist/src/index.js` 实际启动 | PASS：临时虚构 FileStore/私有目录；实际主入口启动，capabilities 返回保留 30 天/AI 关闭，Founder 受控角色接口可用；结束后清理临时环境。 |
| `git diff --check` | PASS；提交前重查。 |

原始本机日志位于被 Git 忽略的 `outputs/masters-verification/`。入库 JSON 只记录无敏感信息的结果及日志 SHA-256；测试可从源码重跑。未执行的外部项目不报 PASS。

## 4. 基线与提交检查

- 2026-09-05 通过 GitHub API 核验 main 仍为本任务基线；仓库可见 webhook 0、deployments 0，本任务分支暂无已有 PR。
- 当前 main/任务基线不含 `.github`、`.openai/hosting.json`、Vercel/Netlify 配置。仓库 API 可见的 Identity 与 Website 工作流来自其他分支，本任务不新增这些工作流。未发现本分支推送或 PR 触发部署的可见配置。
- Windows `autocrlf` 曾使旧冻结文档字节哈希检查失败；核对 Git blob 后只恢复原始 LF，添加 `.gitattributes` 保持冻结文件与旧 migration 字节。没有修改冻结内容、expected hash 或 001–005 SQL。
- 根客户端 lock 保持原始内容。服务端新增 multipart/格式解析/PDF 依赖已锁定；旧核心包版本保持不变。UI-only 的服务端 lock 全文件哈希断言改为核对 manifest/新增依赖范围及旧核心锁定版本，以适配本轮已授权后端功能；未跳过原有安全/业务测试。
- 只提交本任务项目路径；`node_modules`、`dist`、私有文件、真实配置、字体和运行日志不入库。只创建 Draft PR，停止在人工审阅位置。

## 5. 尚需外部条件

1. 安全注入专用 PostgreSQL 测试连接和 `MASTERS_TEST_DATABASE_ALLOW_MUTATION=YES`，执行 006 up/down/up、旧表保留、重连和并发/worker fencing 测试；不得使用生产或共享业务库。
2. 提供测试 AppID、受控 HTTPS 服务和 request/uploadFile/downloadFile 合法域名；在微信开发者工具和真机检查文件/相册/拍照、隐私授权、预览、重登恢复及全部权限场景。
3. 在测试部署主机核验私有目录 ACL、备份、静态加密、清理计划和中文字体许可。当前本机文件持久化通过不代替主机验收。
4. 扫描件和未带明确标签的自然语言简历需人工核验。AI/OCR/官网搜索未接入；候选学校默认留空，不能将规则稿视为已核验的选校结论。
5. 后续部署、生产迁移、合并、真实材料试点仍须沿用原审批边界，本 Draft PR 不批准或执行这些动作。

MERGED：NO

PRODUCTION_DEPLOYED：NO

REAL_STUDENT_DATA_ENABLED：NO
