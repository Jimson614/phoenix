# Family OS 契约审查与合成演练范围 V1

状态：`SYNTHETIC-ONLY REFERENCE PROFILE / FOUNDER DECISIONS PENDING`

## 基线与非目标

- 仓库：`yvettfang-netizen/phoenix`。
- 当前主线核验值：`846f77c120cd00a49d89635dd4297b020af7d03a`。
- 本次开发父提交：PR #10 的 `39452d9cb1c15f96baabb5b887c86ab0afbb97ed`。
- 后续分支：`codex/family-os-synthetic-contract-validation-20260906`。
- 新增文件仅在 `backend/contract-rehearsal/` 与 `docs/contracts/`；不修改已有 6 份契约、运行代码、依赖清单、打包配置、数据库迁移或任何其他项目。

这是 PR #10 的独立后续演练，不是 Founder 批准 PR #10。不能凭“自动跑完”宣称生产权限、安全机制、业务规则或未决产品政策已经生效。

## 审查发现与受限处理

| 发现 | 本次可验证处理 | 仍待批准/实现 |
|---|---|---|
| 单个 `consent_id` 不能表达多个独立目的 | 测试 profile 保留主 `consent_id`，另加按目的索引的 `consent_refs`；逐条校验 | 正式多目的 wire schema、政策版本来源与生效决定 |
| Family Context 提案包含 FAMILY，但 Core 同意主体是 User/Guardian/Student | 演练只接收三个已支持主体，不把家庭自身当作同意主体 | 家庭级财富评测应由谁作为数据主体，需要明确映射 |
| 通用 `journey_seed` 和 Identity PR #8 的字段不完全相同 | Identity 样例保留 `current_scheme/current_status/limit_of_stay_expiry` 等上游键，未任意改写为通用 current_state | 正式按领域区分的 schema 与转换规则 |
| `HUMAN_REVIEW_REQUIRED` 同时出现在失败列表和结果结构中 | 模拟接收 `human_review.required=true`，保留待审，不自动给结果、排路径或联系顾问 | 业务上哪些人工复核应阻断接收、展示或仅阻断后续动作 |
| PARTIAL/INVALIDATED/SUPERSEDED 没有完整交接语义 | 演练仅支持 COMPLETED，其他状态拒绝 | 作废、替代、部分提交与历史更正流程 |
| 权益与纵向记录同意要求尚未定稿 | 演练采用最严格样例：明确的有效权益 + 评测同意 + 纵向记录同意 | 不把保守测试配置升级为正式免费/付费或用户授权政策 |
| 现有本地前缀与 Core ID 外形可能重合 | 只使用固定虚构 ID 常量和模拟映射；不存在签发/迁移 API | 真正 Core identity mapping、角色与监护权验证 |
| 已成功提交的重放可能绕过新撤回 | 在查重复回执之前重验全部当前授权；模拟撤回后拒绝读取 Timeline | 真实账本、RLS、撤回传播、缓存失效与保留/删除规则 |

## 验收矩阵的对应关系

- FC-01～05：合成成功、缺少家庭上下文、跨家庭主体、映射冲突、缺失/撤回监护权。
- CH-01～05：相同输入重放、修改内容冲突、未知版本、Health 拒绝、超范围数据拒绝。
- TL-01～02：注册事件对、快照不可反向修改。通用事件摄取/更正、独立账本不可变性未实现。
- AF-01～04：主动跟进、分离同意、顾问分配撤回/过期、笔记不得进入 Timeline。
- 新增：每种写操作在模拟审计前/提交前失败，业务状态不得部分写入；重试只产生一份逻辑记录。

固定样例覆盖完整的“合成输入 → 交接回执 → Timeline → 主动跟进 → 分配顾问 → 笔记引用”流程，不等于任何正式 Compass、真实家庭或微信环境的 E2E 验收。

## 工程决定与后续唯一入口

本次只新增隔离测试模型，没有新增产品 API 或更改 Core 架构。开发前父提交 `39452d9c` 是可追踪 checkpoint。无需数据库回退：停止运行演练即可；若后续要撤回代码，用独立审查的 revert 提交，不删除目录或重置工作树。

下一步：Founder/工程共同审阅 PR #10 与本后续 PR 的差异和待决项，再单独授权 Core 的合成环境实现。真实家庭、生产迁移、部署、公开小程序、CRM/飞书/Notion 写回仍为 `NO-GO`。
