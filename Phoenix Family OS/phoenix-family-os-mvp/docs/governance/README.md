# 工程治理

本阶段为增量结构变更。只在独立任务分支工作，不直接修改 main。
提交说明可使用 type(scope): message。当前 package.json 与 lockfile 保持原样。
未启用 develop，也未改动分支保护、其他工作流或自动部署。

每次变更记录仓库、分支、基线、文件清单、测试结果与未运行的验收。
GitHub 检查仅检查 Family OS 路径；push/PR 发布、合并与部署各自依据用户授权执行。
PR #4 与本次 README 可能发生新增文件冲突，后续应保留双方有效内容，不以整文件覆盖处理。

工作流配置依据：[GitHub Actions 语法](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)、[setup-node](https://github.com/actions/setup-node)、[pnpm/action-setup](https://github.com/pnpm/action-setup)。本地检查通过不等于 GitHub Actions 已执行。
