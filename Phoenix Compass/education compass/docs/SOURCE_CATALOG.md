# 正式来源目录（Source Catalog）

## 它是什么

报告正文由规则引擎从问卷算出来，**来源目录是这些结论背后的证据清单**。每份生成的报告都会把目录里的条目写进自己的 provenance，和 `USER_INPUT:<测评ID>`、`PHOENIX_RULESET:EDUCATION_V1` 并列。

它同时是**收费的硬闸门**：`SOURCE_CATALOG_MODE=verified` 且文件校验通过，报告才可能 `qaPassed=true`；否则任何环境都下不了单。生产环境只接受 `verified`。

现状：`SOURCE_CATALOG_MODE=placeholder`、`SOURCE_CATALOG_PATH` 为空，生产和联调都还没有正式目录。

## 文件长什么样

一个 JSON 文件。模板见 [source-catalog.template.json](source-catalog.template.json)。

| 字段 | 含义 | 约束 |
| --- | --- | --- |
| `version` | 这一版目录的版本号，会写进每份报告 | 非空，≤80 字符，不能含 `DEMO_ONLY` |
| `dataAsOf` | 目录内容的数据截止日期 | 可被 `Date.parse` 解析，如 `2026-09-01` |
| `reviewedAt` | 本版的复核时间 | ISO 时间戳 |
| `reviewedBy` | 复核人（对内容负责的人或小组） | 非空，≤120 字符 |
| `entries[]` | 来源条目，**不能为空** | 至少一条 |
| `entries[].sourceId` | 稳定且唯一的来源标识 | 唯一，≤120 字符，不能含 `DEMO_ONLY` |
| `entries[].title` | 来源全称 | 非空，≤300 字符 |
| `entries[].applicableYear` | 适用年份 | 非空，≤20 字符 |
| `entries[].verifiedAt` | 这一条**核验过**的时间 | ISO 时间戳 |

`sourceId` 要稳定：它会进历史报告的证据链，改了会让旧报告的引用对不上。建议用 `机构:文件代号` 这种形式，例如 `MOE:CURRICULUM_PLAN_2026`。

## 怎么做

1. 列出教育规划结论实际依赖的权威文件——课程方案与课程标准、各省考试院当年招生规定、高校招生章程、官方统计口径等。**只放你真正核对过原文的**。
2. 每条记下 `sourceId`、全称、适用年份、核验日期。
3. 填 `version`、`dataAsOf`、`reviewedAt`、`reviewedBy`。
4. 本地校验：

   ```bash
   npm run validate:source-catalog -- path/to/source-catalog.json
   ```

   校验用的是服务端编译产物里那一份 `validateSourceCatalog`，和线上启动时跑的是同一段代码，另外会拦下没替换干净的模板占位值。

5. 放到服务器上（不进仓库，内容受控），把 `SOURCE_CATALOG_PATH` 指过去，`SOURCE_CATALOG_MODE` 改成 `verified`，重启后端。

## 维护

适用年份和内容时效由发布审批另行核验。招生政策按年更新，每年新政策出来后要出新版本：改 `version`、`dataAsOf`、`reviewedAt`，更新受影响条目的 `verifiedAt`。

目录被撤回或发现事实错误时，不能靠拒绝交付代替退款——按 [WECHAT_PAY_RUNBOOK.md](WECHAT_PAY_RUNBOOK.md) 第 6 节的事故流程走。
