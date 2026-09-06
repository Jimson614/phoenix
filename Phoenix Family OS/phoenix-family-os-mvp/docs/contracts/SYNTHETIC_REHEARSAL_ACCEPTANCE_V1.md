# Family OS 合成契约演练验收 V1

执行日期：2026-09-06。结论：`SYNTHETIC_CONTRACT_TESTS_PASS / FOUNDER_REVIEW_PENDING / PRODUCTION_NO_GO`。

## 完成范围与修改

父提交：`39452d9cb1c15f96baabb5b887c86ab0afbb97ed`（Draft PR #10）。后续分支：`codex/family-os-synthetic-contract-validation-20260906`。文件指纹见 [校验清单](SYNTHETIC_REHEARSAL_MANIFEST.sha256)；最终代码提交以此文件所在 commit 为准，不以工作站路径识别。

新增 8 文件：`backend/contract-rehearsal/` 下 4 个 CJS 和 README；`docs/contracts/` 下审查说明、本验收报告、SHA-256 清单。无既有文件修改/删除；PR #10 原 6 文档、`main`、运行入口、数据模型、迁移、Logo、依赖与锁文件均不变。

实现：固定合成样例、最小 Mock Core、严格字段/值校验、内存交接、身份 Journey 原样保留、Timeline、主动顾问请求、分配验证、笔记引用、撤回/过期/失败回滚。仅用 Node 内置模块；没有任何产品 API、真实规则计算或外部连接。

## 测试证据

环境：Node.js `v24.19.0`、npm `11.9.0`、pnpm `11.19.0`；既有 TypeScript `5.9.3`。所有命令在 Family OS 项目根执行。

| 命令 | 退出码 | 结果与范围 |
|---|---:|---|
| `pnpm install --frozen-lockfile --ignore-scripts` | 0 | 既有锁文件通过供给链策略检查，安装 1 个已有开发依赖；未升级 |
| `node backend/contract-rehearsal/run.cjs` | 0 | 4 个 CJS 语法检查、导入/连接/打包静态边界；76/76 测试，0 fail/skip/todo |
| `npm test` | 0 | 既有领域、合作体验、Sprint 1、用户入口、提交安全、后端、同步、E2E 与结构验证 |
| `npm run backend:test` | 0 | 既有问卷、客户端、outbox、页面同步、HTTP→本地临时 SQLite E2E |
| `npm run typecheck` | 0 | 既有 tsconfig 的 2 文件检查；不覆盖新 CJS，不能声称全项目严格类型检查 |
| `npm run build` | 0 | 15 页结构/资源/JS/JSON 校验；不是微信平台编译 |
| `npm run validate` | 0 | 同上，原页面与数据模型保留；backend 继续排除打包 |

合成模型覆盖率（不是全项目覆盖率）：adapter 行/函数 100%，分支 99.14%；fixture 行/函数/分支 100%；合计行/函数 100%，分支 99.27%。入口要求行/函数至少 100%、分支至少 95%。

一次验证入口运行暴露缺少右花括号的语法错误，已修复并复跑入口及全部测试成功。此错误不涉及运行代码。执行环境仍打印 npm `http-proxy` 配置警告；退出码为 0，未更改工作站全局配置。

## 关键断言

- Education、Identity、Wealth 各自完成虚构交接→Timeline→顾问请求→开案→笔记引用。
- 缺少 family、跨家庭 subject/consent/entitlement、角色伪造、未授权顾问均拒绝。
- 已接受回执在撤回评测同意、纵向记录同意、成员资格、监护权、权益后也拒绝重放。
- 顾问同意撤回/分配撤销/到期后，原请求和 case 重放不能绕过权限。
- 请求、事件、journey、case、note 在模拟审计前/提交前失败时不部分写入；重试只生成一次。
- 同一进程调度 100 次相同请求，1 ACCEPTED / 99 DUPLICATE；不是分布式并发证明。
- 原始问卷、自由文本、敏感文件、公共报告 URL 和原始笔记被拒绝；拒绝审计不含请求内容。
- 返回快照不能反向修改内部证据；模拟数据不跨新实例保留。

## 未运行与未配置

| 项目 | 状态 |
|---|---|
| lint script | `NOT CONFIGURED`，未伪造 lint PASS；有 CJS 语法和源边界检查 |
| 正式 Core / PostgreSQL RLS / 真实账本 / 分布式事务 | `NOT IMPLEMENTED / NOT RUN` |
| 真实 Compass 业务题库与政策版本兼容 | `NOT RUN`，只用 SYNTHETIC_* |
| 微信开发者工具编译、iOS、Android、真人验收 | `NOT RUN` |
| 生产数据库、真实家庭、CRM/飞书/Notion 写回 | `NOT CONNECTED / NOT AUTHORIZED` |
| CI 工作流 | 本提交不新增；本报告为本机实际执行证据，不代表远端 CI PASS |

## 风险与待决项

P1/上线阻断：Core 权威身份、Consent/RBAC/RLS、Family Assignment、真实审计、保留/删除策略、微信认证及生产配置仍未实现/验收。本演练不降低该风险等级。

待审：多目的 consent_refs 设计、家庭级数据主体、领域 Journey schema、人工复核动作边界、权益要求及纵向记录政策、部分/作废/替代状态。演练的保守条件不是 Founder 产品政策批准。

## 回退与下一步

停止运行该独立演练不会影响现有应用或数据库。关闭未合并 Draft PR 不会改变 `main`；如需撤回后续已合并提交，另开审查的 revert PR，保留来源历史，不 reset 或删除工作树。

下一步唯一建议：审阅 PR #10 和本后续演练的待决项，再单独授权 Core 合成环境实现。当前不能宣布 Family OS 已接通正式 Compass 或可以上线。
