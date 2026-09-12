# Wealth Compass 复用审计（基于 Phoenix Nova Education Compass）

## 结论含义

- **REUSE**：可以直接复用到 Wealth Compass
- **ADAPT**：可复用但需轻量修改
- **NEW**：Education Compass 中没有，Wealth Compass 需新增
- **BLOCKED**：需 Jimmy 决定（范围/合规/产品策略）

## 复用审计结论

| 模块 | 结论 | 依据（文件） | 说明 |
|---|---|---|---|
| 问卷页面与每屏一题组件 | ADAPT | [src/components/assessment-experience.tsx](/D:/CODEX/PhoenixNova/Phoenix%20Compass/education%20compass/src/components/assessment-experience.tsx), [src/lib/compass/questions.ts](/D:/CODEX/PhoenixNova/Phoenix%20Compass/education%20compass/src/lib/compass/questions.ts) | 已有固定 5 屏流转逻辑、step 校验与分步渲染；复用骨架较高，但问题文案、字段和筛选规则需按 Wealth Compass 题库调整。 |
| 保存进度、返回修改、恢复答题 | REUSE | [src/components/assessment-experience.tsx](/D:/CODEX/PhoenixNova/Phoenix%20Compass/education%20compass/src/components/assessment-experience.tsx) | 已基于 `sessionStorage` 保存 `draft` 和 `step`（恢复）、支持返回修改；提交前可以回到前序页，符合“可恢复、可回改”基本闭环。 |
| 评分引擎 | ADAPT | [src/lib/ai/openai.ts](/D:/CODEX/PhoenixNova/Phoenix%20Compass/education%20compass/src/lib/ai/openai.ts), [src/lib/ai/prompt.ts](/D:/CODEX/PhoenixNova/Phoenix%20Compass/education%20compass/src/lib/ai/prompt.ts), [src/lib/compass/validation.ts](/D:/CODEX/PhoenixNova/Phoenix%20Compass/education%20compass/src/lib/compass/validation.ts), [src/lib/compass/result.ts](/D:/CODEX/PhoenixNova/Phoenix%20Compass/education%20compass/src/lib/compass/result.ts) | 已有 AI 生成 + 双次重试 + JSON Schema 校验 + 降级模板；可复用调用链与安全校验模式，但评分维度与输出规则为“成长探索”模型，需改造为 Wealth Compass 评分规则。 |
| 报告模板 | ADAPT | [src/components/result-experience.tsx](/D:/CODEX/PhoenixNova/Phoenix%20Compass/education%20compass/src/components/result-experience.tsx), [src/app/result/page.tsx](/D:/CODEX/PhoenixNova/Phoenix%20Compass/education%20compass/src/app/result/page.tsx), [src/lib/compass/result.ts](/D:/CODEX/PhoenixNova/Phoenix%20Compass/education%20compass/src/lib/compass/result.ts) | 已有结果展示模版（含标题、信号、方向、行动、免责声明、反馈入口）；若 Wealth Compass 需要新的报告字段结构，需要轻量改造数据结构与渲染模板。 |
| Consent 组件 | NEW |（未检索到） | 当前代码未出现 `consent`、`同意`、`隐私授权` 组件。可直接新增（或对接现有隐私框架）新组件。 |
| 飞书/CRM adapter | BLOCKED | [docs/T01_REPOSITORY_PREFLIGHT.md](/D:/CODEX/PhoenixNova/Phoenix%20Compass/education%20compass/docs/T01_REPOSITORY_PREFLIGHT.md), [docs/IMPLEMENTATION.md](/D:/CODEX/PhoenixNova/Phoenix%20Compass/education%20compass/docs/IMPLEMENTATION.md) | 文档已明确说明当前基线不包含 CRM / 长期数据库 / 后续商业化运行时。是否接入飞书/CRM 为产品决策项，需要 Jimmy 明确范围与账号体系。 |
| ID 生成、幂等和重复提交 | NEW | [src/components/assessment-experience.tsx](/D:/CODEX/PhoenixNova/Phoenix%20Compass/education%20compass/src/components/assessment-experience.tsx), [src/lib/analytics.ts](/D:/CODEX/PhoenixNova/Phoenix%20Compass/education%20compass/src/lib/analytics.ts), [src/app/api/growth-snapshot/route.ts](/D:/CODEX/PhoenixNova/Phoenix%20Compass/education%20compass/src/app/api/growth-snapshot/route.ts) | 现阶段仅有客户端层 `generating` 防抖（防重复提交按钮级），无服务端 `request_id`、幂等键或防重放机制。需要新增 ID 与去重策略（含重复提交与重试恢复）。 |
| 测试框架 | REUSE | [package.json](/D:/CODEX/PhoenixNova/Phoenix%20Compass/education%20compass/package.json), [vitest.config.mts](/D:/CODEX/PhoenixNova/Phoenix%20Compass/education%20compass/vitest.config.mts), [src/lib/compass/validation.test.ts](/D:/CODEX/PhoenixNova/Phoenix%20Compass/education%20compass/src/lib/compass/validation.test.ts), [src/lib/compass/result.test.ts](/D:/CODEX/PhoenixNova/Phoenix%20Compass/education%20compass/src/lib/compass/result.test.ts), [src/lib/analytics.test.ts](/D:/CODEX/PhoenixNova/Phoenix%20Compass/education%20compass/src/lib/analytics.test.ts) | 已有 Vitest（jsdom）完整测试配置与模块级单测；可直接复用测试框架与组织方式。Wealth 模块可在此上新增规则化测试。 |

## 额外说明（建议落地顺序）

1. 先复用 `assessment-experience` + `analytics` + `result-experience`，实现“快速闭环可运行”版本（减少开发路径风险）。
2. 同步定义 Wealth Compass 的题目合约与评分输出契约（版本号/字段白名单），再对 `validation` 与 `result` 进行 ADAPT。
3. 再补齐 `CONSENT` 与 `CRM/飞书` 的产品决策节点；如确认接入，按 BLOCKED 条目推进。
4. 最后补齐 ID 生成与幂等：建议先在 API 层加 `submission_id`，再在结果查询/提交链路加去重记录与失败重试保护。
