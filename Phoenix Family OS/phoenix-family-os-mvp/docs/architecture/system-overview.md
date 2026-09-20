# Phoenix Family OS 2026 工程结构

参考：《Phoenix Family OS 2026 GitHub Repository Architecture V2.0》。
这是与现有代码兼容的第一阶段落地，状态为 STRUCTURE_FOUNDATION。

## 仓库边界

沿用 yvettfang-netizen/phoenix；Family OS 目录保持 Phoenix Family OS/phoenix-family-os-mvp。
Phoenix Compass、Askwise、feishu 各有现有边界。单仓组织不代表统一运行或自动共享数据库。
本阶段不创建新的 Git 仓库，不引入总仓工作区配置，不将其他项目搬入 Family OS。

## 目标与当前入口

~~~text
phoenix/
├── .github/workflows/family-os-foundation.yml
└── Phoenix Family OS/phoenix-family-os-mvp/
    ├── apps/{web,mini-program,advisor-dashboard,admin-console}/
    ├── packages/{family-core,timeline-engine,permissions,auth,ui,types,utils}/
    ├── database/{schema,migrations,seeds,docs}/
    ├── ai/{agents,context,memory,prompts,evaluation}/
    ├── docs/{architecture,product,decisions,security,api,roadmap,governance}/
    ├── infrastructure/{docker,cloud,deployment,monitoring,security}/
    ├── tests/{unit,integration,ai,security}/
    ├── scripts/
    ├── .env.example
    ├── README.md
    ├── package.json                # 保留原文件与 scripts
    └── app.*, pages/, backend/, services/, models/  # 当前运行入口
~~~

apps 及 packages 的目录只有职责与迁移说明。没有新增可运行页面或第二套业务实现。
未来 apps/web/src 和小程序 pages 的细分目录，在真实实现与引用迁移时创建，避免伪装成已可运行的应用。

## 五层映射

| 层 | 当前实现 | 目标 |
| --- | --- | --- |
| Experience | 微信 app.*、pages/、components/ | apps/ 下应用 |
| AI | services/ai-provider.js → 本地规则 insight.js | ai/；模型调用尚未接入 |
| Family Graph | models/schema.js、services/repository.js、services/store.js | packages/family-core 与 timeline-engine |
| Trust | Demo 登录、客户端检查、后端会话与审计 | Core 契约约束下的 auth/permissions 适配 |
| Infrastructure | Node HTTP、node:sqlite、本地文件 | database/ 与 infrastructure/ |

目标采用模块化单体。业务共享模块不得依赖微信 wx 全局、页面或组件；平台能力通过适配器注入。
当前尚未完成拆分，不将这些目标约束描述为已经实施的运行保障。

## 唯一来源

- Family 作为业务根实体；现有 fam/stu 等本地 ID 不自动升级为共享 Core ID。
- SQLite 的唯一可执行迁移仍在 backend/migrations/，由 backend/database.js 读取。
- 不复制已有 SQL 到 database/migrations，不创建第二套 users/families/consent 定义。
- 共享 Core 的身份、授权、映射设计另见 PR #5；Family OS 契约草稿见 PR #10，合成演练见 PR #11。未合并草稿不作为当前运行能力。
- 顾问默认不能访问所有家庭资料；财富与健康不会因新增目录而得到访问或写入权限。

后续落地顺序及验收条件见 [迁移计划](../roadmap/structure-migration.md)。
