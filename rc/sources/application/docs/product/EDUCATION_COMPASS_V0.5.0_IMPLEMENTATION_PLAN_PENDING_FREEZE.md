# Education Compass V0.5.0 Implementation Plan — Product Frozen

> 状态：`READY_FOR_ENGINEERING_VALIDATION`  
> 实施执行：`NOT_STARTED_BY_THIS_FREEZE_TASK`  
> 执行规则：产品定义已冻结；进入代码修改前仍须核验 detached receipt、附件 hash、现有代码基线和授权边界。本次冻结动作本身不创建 migration 或修改运行代码。

## 1. 启动条件

Phase B 只有在以下条件全部满足后开始；其中 1–3 已由签署冻结包满足，4–5 仍由实施任务现场验证：

1. `EDUCATION_COMPASS_PRODUCT_FREEZE_V1.md` 为 `status: FROZEN`，含版本、批准人、含时区日期。
2. Manifest 所有待决值非空，完整题库/结果/路由/Consent/商业附件存在且 hash 一致。
3. `FOUNDER_DECISION_REQUIRED.md` 每一项已批准。
4. 工程 Gate 测试能证明实现目标可由冻结合同唯一确定；否则即使文案写 FROZEN 也保持 P0 FAIL。
5. 重新记录 Git 状态、Node/npm、版本、migration 与来源 hash，并重跑 V0.4.1 baseline。

## 2. 三个 Sprint 的纵向切片

### Sprint 1：服务端合同 + Level 1 可填写闭环

目标：在不破坏 legacy 的前提下，实现 Free Parent Compass 从 HTTP 创建到完整 Snapshot。

- 先写 Freeze manifest validator、题库/fixture validator、OpenAPI skeleton 和 contract tests。
- 新增向前 migration 005：kind/respondent/source/system/bank/digest/assent/result；明确 legacy backfill、约束和索引。
- 同步更新 domain model、Store interface、memory/file/PostgreSQL adapters。
- 建服务端 versioned registry、严格 answers validator、completeness、schema digest、确定性 Level 1 result builder。
- 实现 state、bank、free create、assessment questionnaire、draft、submit、result 新路由与 owner/idempotency 检查。
- 新增 `services/education-compass.js` 和通用 renderer 适配；保留 legacy service。
- 前端完成 Level 1 创建、自动保存/恢复/提交、Snapshot、页面级 loading/empty/error/retry。
- 使用真实启动的 API + mock provider 跑 Level 1 HTTP 闭环；完成初步 OpenAPI/fixture/client DTO 一致性。
- 对所有 V0.5 请求体使用 exact-object validator；create/submit 使用 header Idempotency-Key、输入摘要和冲突 409。

Sprint 1 出口：L1 合同和 Level 1 mock HTTP P0 全 PASS；legacy 测试不退化。

### Sprint 2：Level 2、体系路由、结果与支付隔离

目标：实现冻结体系的学生问卷、锁定/交付报告及新 SKU mock 支付闭环。

- 增加 Level 2 common/system registry、体系切换清理规则、source Assessment 与 respondent/assent 校验。
- 实现确定性六项结果和 evidence refs；严格输出 UNKNOWN/NEEDS_VALIDATION；加入禁用结论 QA。
- 实现 locked/full discriminated result；locked 响应做结构泄露测试。
- 按冻结 payment timing 实现流程；只从服务端目录读取 `EDUCATION_GROWTH_DISCOVERY_SINGLE_V1` 金额。
- 复用微信 provider/webhook/refund/entitlement；验证新旧 SKU 双向不越权、重复回调恰好一次、退款撤权。
- 前端实现受控 system route、草稿恢复、locked offer、订单轮询和新版六项 report renderer。
- 完成每个正式体系的可提交 fixture 和 fallback/unsupported fixture。

Sprint 2 出口：全部冻结体系 mock HTTP 闭环、新旧支付/退款回归、零付费内容泄露均 PASS。

### Sprint 3：Agent、飞书 Consent、ASKWISE/Aoyu 受控闭环、L3 入口与发布验证

目标：完成非阻断集成、真实 PostgreSQL 证据与候选交付准备。

- 复用 Agent provider/worker，新增 versioned context/prompt；Free 与 Paid 都使用脱敏结构化确定性结果。
- 调整 kind-specific Agent 资格与 worker claim；为 L2 mock HTTP 提供共享注入 store 的测试 bootstrap，避免用 service 直调冒充独立 worker。
- 前端轮询真实 run，latest 可恢复；Agent disabled/failure 不阻核心链路。
- 增加用户级 Feishu profile Consent；环境 flag + opt-in 双闸门；provisional/null 与禁止字段测试。
- 先按已签署的 Integration Contract 实现 Askwise DTO/validator/builder、Consent/幂等/状态/错误合同；只有真实 ASKWISE repo/API/Auth、批准任务内容包与 Aoyu 资产齐全且另获外部授权后，才实现 route/network/session/first-task/writeback 与 7 个事件驱动 Aoyu 状态。缺依赖时必须 `BLOCKED_EXTERNAL`，不得退回“假按钮”或 mock 冒充接通。
- Level 3 仍只实现 entry state/Advisor intent，不开发完整题库、报告或 ¥980 支付。
- 运行 L1/L2 全套、故障注入、OpenAPI/fixture/DTO、storage、release allowlist 和 secret scan。
- 在显式测试 PostgreSQL 运行 001→005、004→005、重启恢复与并发幂等；不 reset 用户数据库。
- 只在具备专用 staging 凭据和批准后依次运行 OpenAI、飞书、RDS TLS、微信 prepay L4。
- 真实扣款/退款必须另获金额、测试者真机和财务授权；否则保持 `BLOCKED_MANUAL`。

Sprint 3 出口：最高结论按真实证据选择，绝不越级。

## 3. 计划中的代码/合同边界

| 类别 | 计划新增或增量修改 | 必须保持 |
|---|---|---|
| 数据库 | `005_education_compass_levels.sql`（名称可按实际调整） | 001—004 内容和 checksum 不变；只向前升级 |
| 后端 | registry/result rules/API/adapters/new SKU/consent | legacy route、历史可读/可退款/PDF/Agent |
| 前端 | V0.5 adapter/model/navigation、版本化 renderer | 原生框架、品牌、TabBar、legacy service |
| Agent | context/prompt version、kind routing | 同一 Agent 体系、独立 worker、非阻断 |
| 飞书 | versioned user opt-in、allowlist mapping | PostgreSQL 事实源、outbox/reconcile、失败不阻主链 |
| Askwise/Aoyu | 签署后：DTO/schema、Consent、幂等、adapter、session/first task、writeback、Aoyu 7 状态与降级；五日 UAT 使用合成数据/测试权益 | ASKWISE 是唯一 Learning Engine；Aoyu 不是第二引擎；外部调用和真实学生另行授权；缺 repo/API/assets 时 BLOCKED_EXTERNAL |
| Level 3 | entry state/reason/intent | 不做完整题库、报告、¥980 支付 |

## 4. 回滚策略

- 代码：V0.5 功能使用独立 fail-closed flags；先关闭入口、新支付、Agent/飞书镜像，再回退应用版本。
- 数据：005 只做 additive schema；保留历史数据，不自动执行生产 down migration。
- 支付：订单和权益按 SKU/version 隔离；回退不能删除账务记录，退款走既有受控流程。
- 题库/报告：Assessment 固定 bank versions/digest，历史版本保持只读；不得原地覆盖。
- 飞书/Agent：停 worker/flag 不回滚主业务；待处理 outbox/run 保留可审计状态。

## 5. 本轮明确未执行

- 未新增或修改题库；
- 未创建 migration 005；
- 未改变价格、SKU、支付时点或权益；
- 未改变 Consent、评分或结果规则；
- 未修改小程序/服务端运行代码；
- 未调用 OpenAI、飞书、微信真实环境；
- 未生成 V0.5.0 verified ZIP。
