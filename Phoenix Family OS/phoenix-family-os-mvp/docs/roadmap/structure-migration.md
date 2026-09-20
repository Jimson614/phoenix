# 结构迁移计划

## 本次已实施范围

新增 apps/packages/database/ai/docs/infrastructure 分类、测试索引、配置示例和架构检查。
不修改现有 package.json、lockfile、运行代码、路由或 SQL；不移动旧文件。

## 下一阶段的可执行顺序

| 批次 | 改动 | 必须一同处理 | 验收 |
| --- | --- | --- | --- |
| 1 · 对齐基线 | 在最新 main 上接入本次新增内容 | 重读 PR #4/#10/#11 与 README 冲突；核对远端 SHA | 只出现批准范围差异，无其他项目删除 |
| 2 · 小程序实体迁移 | app.*、pages、components、assets 移入 apps/mini-program | services/models/data/utils 的打包可达性、project.config、sitemap、路径大小写、packOptions、测试扫描根 | 15 路由、资源、登录/档案/问卷/报告/时间线通过；微信开发工具与真机验收 |
| 3 · 共享逻辑抽取 | family-core、timeline-engine、types、utils | wx 存储与时间/ID 适配器，现有数据兼容；避免跨小程序打包根读取 | 旧数据保留、排序/归属校验、提交幂等回归 |
| 4 · 数据与信任 | 按获批 Core 契约接 auth/permissions；迁移数据库目录 | 单一 schema/migration 注册源、版本兼容、已有迁移记录、测试回滚 | 跨家庭隔离、撤回授权、顾问分配、审计与数据恢复 |
| 5 · 其他应用与 AI | web/advisor/admin；context 与 insight agent | 服务端授权先于 UI；敏感数据最小化与评测 | 明确权限与模型边界后才进入真实实现 |

上述批次是后续计划，本次仅完成第一阶段结构。每批单独评审；不用一次大搬迁处理所有内容。
共享身份/权限不能等到客户接入后补建；AI 不得在缺少身份与授权验证时读取家庭上下文。

## 回退与协作

当前仅新增文件；回退时仅处理本次新增清单，不触碰原 110 个文件或其他工作区。
不预先执行删除、reset、强推、合并或部署。
后续变更须保留原始路径到目标路径映射和数据兼容说明。

## 未来范围

Education、Identity、Wealth、Health、Heritage 的扩展点只登记在设计中。
本次不创建新的 modules 运行代码；Health 不接入 Family OS。
develop 分支、仓库改名和跨项目 workspace 均不在本次执行范围。
