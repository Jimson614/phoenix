# T01｜Repository Preflight

执行日期：2026-08-16

## 结论

- 当前工作目录 `Phoenix Compass` 在预检时为空，且不是 Git 仓库；没有可直接修改的本地路由或组件。
- 相邻项目 `Phoenix Website` 是现有官方 Web 技术基线：Next.js 16.3.1、React 19.2.8、TypeScript strict、Tailwind CSS 4、Vitest。
- `Phoenix Website` 已有 `/compass` 与 `/compass/assessment-demo`，以及品牌 token、Brand Lockup、页头页尾和 Assessment Demo 组件；本项目复用了技术版本、正式色值与交互原则，没有复制历史 20 题 Demo 的产品逻辑。
- 正式品牌色已确认：Phoenix Navy `#0D1B2A`、Phoenix Gold `#C8A24A`、Ivory White `#FFFDF7`、Canvas `#F6F1E7`。
- 正式 Phoenix Nova™ Logo PNG 来自现有 `Phoenix Family OS` 品牌资产目录，按原文件复用；未重绘、未生成近似 Logo。
- 最新范围裁决覆盖附件中的旧商业化说明：当前版本只验证免费 30 秒探索、Growth Snapshot 与反馈闭环。
- 产品定义、价格、支付 CTA、购买跳转、相关环境变量和转化事件均不属于当前版本，已从实现与交付文档删除。

## 开发裁决

由于当前目录为空，本轮在该目录建立独立 Free MVP；架构保持可并入现有 Next.js 网站，但不建设账号、Family OS、顾问后台、CRM、长期数据库、Knowledge Hub 或后续 Agent 模块。未来模块仅保留纯类型适配器接口，不注册、不调用。

实现完成后已在当前目录初始化 `main` 分支的 Git 仓库；本轮未自动创建提交或推送远端。
