# Phoenix Family OS™

凤启家庭 OS 的现有微信小程序与 2026 模块化架构基础。

状态：现有 Local Demo + 第一阶段目录基础。新增目录是工程预留，不代表新功能已经上线。
本项目位于 phoenix 单仓的 Phoenix Family OS/phoenix-family-os-mvp；本次不改仓库名称或现有入口。

## 开发入口

在本目录执行（Node.js 24，现有 TypeScript 5.9.3）：

~~~sh
pnpm install --frozen-lockfile --ignore-scripts
node scripts/check-architecture.cjs
npm test
npm run typecheck
npm run build
~~~

微信开发者工具仍导入本目录的 project.config.json；apps/mini-program 暂为迁移说明。
npm run build 仅执行现有静态验证，不是微信编译或上传。项目尚未配置 lint。
后端 npm run backend:start 仅用于本机合成数据演示；实际配置见 [.env.example](.env.example)。

## 目录

| 目录 | 本阶段用途 |
| --- | --- |
| apps/ | 四个应用的预留边界；小程序仍从原目录运行 |
| packages/ | family-core、timeline-engine、permissions、auth、ui、types、utils 职责 |
| database/ | 当前持久化映射、未来 schema 与 migration 边界 |
| ai/ | agents、context、memory、prompts、evaluation 设计预留 |
| docs/ | 架构、产品、决策、安全、API、路线与治理 |
| infrastructure/ | 容器、云、部署、监控、安全的职责预留 |
| tests/ | 现有回归测试，以及分类目录说明 |
| scripts/ | 不依赖第三方包的架构检查 |
| app.*、pages/、backend/、services/、models/ | 保留的现有运行代码 |

详见 [系统架构](docs/architecture/system-overview.md)、[差异审计](docs/architecture/repository-audit-2026-09-08.md)、[迁移计划](docs/roadmap/structure-migration.md)。
GitHub 检查文件位于 Git 仓库根目录的 .github/workflows/family-os-foundation.yml。
