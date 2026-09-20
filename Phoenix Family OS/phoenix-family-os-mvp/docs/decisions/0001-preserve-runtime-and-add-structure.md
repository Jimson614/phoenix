# ADR 0001：保留运行入口，增量建立模块边界

日期：2026-09-08。状态：本次结构调整采用；未来运行迁移另行实施。

## 背景

V2.0 目标是 apps/packages/database/ai 等分层，但当前小程序在根目录使用固定路由、资源路径及 CommonJS 相对引用。
仓库还存在未合并的 Family OS 文档、契约和测试分支。直接整体搬迁会扩大冲突面。

## 决定

1. 在现有 Family OS 项目内只新增文件，保留原 110 个文件。
2. apps/mini-program 先记录原入口位置，其余应用先记录职责，不生成空壳运行页面。
3. packages 先定义依赖方向，不引入未经验证的 package exports、别名或总仓 workspace。
4. database 先映射原迁移，不生成并行 DDL；AI 仅建立设计目录。
5. GitHub workflow 放在 Git 仓库根目录，限定本项目路径并只执行检查。
6. 当前工作使用 codex/family-os-architecture-20260908。V2.0 的 develop/feature 分支策略尚未启用。

## 影响

第一阶段可单独审阅，不改变既有业务行为。旧目录与目标目录暂时共存，开发者应以 README 中的运行入口为准。
后续每次实体迁移必须同时更新路由、模块引用、测试、开发工具与打包排除配置。

## 基线

工作基线为 955a5cf169125dc4d864969edc022e5a50ea3bc2；GitHub main 核验为 846f77c120cd00a49d89635dd4297b020af7d03a。
二者 Family OS 子树均为 affb6103800d48421e0d89ccd4fd26e1745d74ce。完整仓库差异见审计。
