# 仓库结构审计 · 2026-09-08

## 已读取状态

- 仓库：[yvettfang-netizen/phoenix](https://github.com/yvettfang-netizen/phoenix)，默认分支 main。
- 原本地分支：codex/phoenix-main-post-merge-audit-2026-08-28。
- 原本地 HEAD：955a5cf169125dc4d864969edc022e5a50ea3bc2；有未跟踪 docs/audits 文档，本次保留。
- GitHub main：846f77c120cd00a49d89635dd4297b020af7d03a。
- Git fetch 因连接失败未完成；远端基线通过 GitHub commit、完整 tree 和 compare 接口读取。
- [远端比较](https://github.com/yvettfang-netizen/phoenix/compare/955a5cf169125dc4d864969edc022e5a50ea3bc2...846f77c120cd00a49d89635dd4297b020af7d03a)：远端多 3 个提交，仅新增 Wealth Compass 的 46 个文件。
- Family OS 的 110 个文件与远端完全相同，子树均为 affb6103800d48421e0d89ccd4fd26e1745d74ce。
- 实施分支：codex/family-os-architecture-20260908，独立工作区，基于本地已核验提交；不声称完整工作区已同步最新 main。

## 现有项目分类

| 内容 | 当前位置 | 本次处理 |
| --- | --- | --- |
| Family OS | Phoenix Family OS/phoenix-family-os-mvp | 本次目标；保留原代码 |
| Education Compass | Phoenix Compass/education compass | 独立现有模块，不搬迁 |
| Identity Compass | Phoenix Compass/Identity Compass | 独立现有模块，不搬迁 |
| Wealth Compass | Phoenix Compass/Wealth Compass，远端 main 已有 | 不纳入本次本地工作区，不产生删除 |
| Askwise | askwise/ | 学习支持代码与资产，不并入 Family Core |
| Feishu | feishu/ | 集成工具，不执行外部写入 |
| Website | 当前 main 无 website/；另有网站开发 PR | 不从其他仓库或草稿复制 |
| 历史缓存与归档候选 | Education Compass 中已有被跟踪的 .npm-cache；其他历史材料 | 仅记录，未删改或判定为可安全删除 |

## 技术栈与运行状态

原生微信小程序，15 个声明页面；JavaScript/CommonJS；TypeScript 5.9.3 仅检查 tsconfig.json 指定的两个数据/类型文件。
后端为 Node.js HTTP + 内置 node:sqlite，会话认证与合成问卷存储仅供本地 Demo。
成长洞察来自确定性本地规则。项目不是已上线的生成式 AI 平台。
已有完整 npm test、backend:test、typecheck、build、validate；build 是静态结构检查，未配置 lint。

## 与 V2.0 的差异和本次措施

| 目标 | 原状态 | 本次落实 | 后续 |
| --- | --- | --- | --- |
| apps 四入口 | 小程序位于项目根，顾问/Admin 在 pages | 新增四个目录与映射说明 | 分阶段迁移和真机验收 |
| packages 七模块 | 逻辑在 services/models/utils | 新增模块边界 README | 按调用链拆分并注入平台适配器 |
| database 集中层 | backend/migrations 单一执行源 | schema/migrations/seeds/docs 说明及运行数据忽略规则 | 数据模型审批后再迁移 |
| AI 独立层 | 本地规则 provider | 三个 agent、context、三层 memory、prompts、evaluation | 契约与评测通过后再实现 |
| 文档分层 | main 下无 Family OS 文档目录 | 新增系统、决策、产品、API、安全、路线、治理文档 | 协调现有草稿 PR |
| 基础设施 | 本地 HTTP/SQLite | 五个职责目录 | 目标环境确定后实现 |
| 测试分类 | tests 下已有扁平回归套件 | 新增四类索引；保留旧测试 | 随模块迁移调整测试位置 |
| 工程检查 | Family OS 无 workflow | 新增一个 scoped workflow 与结构检查脚本 | 推送后才可能产生远端执行证据 |
| 根配置 | package.json、lockfile、.gitignore 已有 | 保留原文件，补 .env.example/README | 不切换包管理或新建总仓工作区 |

## 现有未合并工作

- [PR #4](https://github.com/yvettfang-netizen/phoenix/pull/4)：Sprint 2 文档整合，包含 README 与架构文档；后续集成需人工合并文档内容。
- [PR #10](https://github.com/yvettfang-netizen/phoenix/pull/10)：Family OS 跨域契约草稿。
- [PR #11](https://github.com/yvettfang-netizen/phoenix/pull/11)：叠加于 #10 的合成契约演练。
- [PR #5](https://github.com/yvettfang-netizen/phoenix/pull/5)：Core Gate 0/1 设计依赖。
- codex/family-os-doc-baseline-and-ux-v0.2 另有文档和 UI 修改。本次不将其与 main 自动合并。

上述均作为并行工作登记；本次未复制草稿内容、运行其测试或替代其验收。
