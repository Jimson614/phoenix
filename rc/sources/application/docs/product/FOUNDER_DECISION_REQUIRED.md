# Phoenix Education Compass Founder Decision Record — Signed

> 产品状态：`FROZEN`  
> 决定：`APPROVE_WITH_CHANGES`  
> 批准人：`Jim`  
> 角色：`Founder`  
> 批准时间：`2026-08-25T15:57:29+08:00`（系统捕获批准消息的时间）  
> 生效范围：`PRODUCT_SPECIFICATION_ONLY`

本文件保留原路径，作为 Founder 决策索引。完整批准原文、身份保证边界和规范化说明见 `docs/product/freeze/education-compass-v1-rc1/FOUNDER_APPROVAL_EVIDENCE_V1.md`。

## 1. 已批准产品决定

| # | 决策 | 冻结值 | 关键边界 | 状态 |
|---:|---|---|---|---|
| D01 | Level 1 题库 | `FP01–FP08`，8 题全必答 | 不混入 Audit 的 FPC-01–11；3–5 分钟；家长观察不等于学生结论 | `APPROVED` |
| D02 | Level 2 公共题 | `EGD01–EGD18` 必答；`EGD19` 学历路径选填 | 不拼接 Audit 34 题；EGD01 为学生本人确认；EGD19 空值不阻断提交、购买或报告 | `APPROVED_WITH_CHANGE` |
| D03 | 答题主体 | 仅 `STUDENT` | 家长只协助操作／语言解释；拒绝即退出，不形成负面信号 | `APPROVED` |
| D04 | 正式教育体系 | `GAOKAO / DSE / IGCSE / A_LEVEL / AP_US` | 五项只负责题库路由，各有独立分支 bank、registry 与 fixture | `APPROVED` |
| D05 | fallback | `IB / OTHER = COMMON_ONLY` | system IDs 为空；结果 `SYSTEM_BANK_PENDING`；不伪装体系分析 | `APPROVED` |
| D06 | 学历路径背景 | `MAINLAND_TERTIARY_DIPLOMA / MAINLAND_BACHELOR_DUAL_CREDENTIAL_PART_TIME / MAINLAND_BACHELOR_SINGLE_CREDENTIAL / OVERSEAS_BACHELOR_FULL_TIME / HONG_KONG_ASSOCIATE_DEGREE` | 对应 Founder 给出的五个中文选项；另有系统中性 `OTHER_PATHWAY / UNSURE`；仅为学生“正在考虑”的自述背景 | `APPROVED_WITH_CHANGE` |
| D07 | 价格／SKU | `EDUCATION_GROWTH_DISCOVERY_SINGLE_V1`，3990 分／¥39.90 | 与旧同价 SKU、199 会员、¥980 完全隔离 | `APPROVED` |
| D08 | 支付时点 | `AFTER_SUBMIT_BEFORE_REPORT` | 学生先提交；报告为 `LOCKED`；付款前不得泄露六项结果、signals 或 evidence | `APPROVED` |
| D09 | 评分 | `NONE` | 全题不计分；无权重、阈值、总分或 band；只用 `SUPPORTED / NEEDS_VALIDATION / UNKNOWN` | `APPROVED` |
| D10 | 成绩资料 | `RANGE_INPUT`，选填 | 不收精确分、精确位次、文件；不做跨体系等值换算 | `APPROVED` |
| D11 | Level 3 | `ENTRY_ONLY` | 只保留状态、reason code 与顾问意向；不建 ¥980 商品／题库／报告 | `APPROVED` |
| D12 | Consent／数据 | 分 scope、不可捆绑 | 未成年人／未知监护状态采用监护人同意 + 学生 assent；OpenAI、飞书、ASKWISE、顾问分别 opt-in | `APPROVED` |
| D13 | ASKWISE／Aoyu 产品合同 | `HANDOFF_SESSION_FIRST_TASK_AOYU_WRITEBACK` | 只冻结产品合同；运行激活为 `DISABLED_BLOCKED_EXTERNAL`，不代表已接通 | `APPROVED` |

## 2. 学历路径的语义规范化

Founder 在“正式体系”行同时列出了五个考试／课程体系和五个学历路径。为避免后端把“内地大专”误当成题库路由，冻结包将两类字段分开：

- `education_system`：`GAOKAO / DSE / IGCSE / A_LEVEL / AP_US`，决定加载哪套体系题；
- `education_pathway_target_codes`：由 `EGD19` 选填，最多三项，只作为报告中的学生自述背景。

学历路径不计分、不发送 ASKWISE、不自动判断学历等值、认可、报读资格或录取结果。`OTHER_PATHWAY / UNSURE` 是推荐 schema 的中性操作项，不声称由 Founder 原文逐项提供。

## 3. 已批准的共同边界

1. `EGD17` 不收预算金额、收入或资产，改为学习／行动限制。
2. OpenAI Agent 只解释去标识化结构化结果；核心结果不依赖 Agent，原始答案和个人资料不得出站。
3. PostgreSQL 为事实源；飞书只能是独立授权、字段白名单、可撤回的运营镜像。
4. 正式商品支付规则与五日 ASKWISE UAT 分轨；UAT 只使用测试权益，不进行真实扣款。
5. Level 3 仅预留入口；不在本冻结包中开发完整 ¥980 产品。

## 4. 签署证据

```yaml
approval_evidence_path: docs/product/freeze/education-compass-v1-rc1/FOUNDER_APPROVAL_EVIDENCE_V1.md
approval_evidence_sha256: BC92E23E99BA68077A3F2FBF188B35FBFFE036FB38C3EBE305BCD84A73BFE7AF
identity_assurance: USER_ASSERTED_IN_CURRENT_CODEX_SESSION
decision: APPROVE_WITH_CHANGES
```

## 5. 独立闸门

Founder 产品批准不替代专业审查、工程验证或上线授权：

```yaml
content_review_gate: PENDING
privacy_minor_review_gate: PENDING
engineering_validation_gate: PENDING_ENGINEERING_VALIDATION
askwise_aoyu_activation: BLOCKED_EXTERNAL
payment_activation: NOT_AUTHORIZED
production_db_migration: NOT_AUTHORIZED
miniprogram_release: NOT_AUTHORIZED
real_student_use: NOT_AUTHORIZED
```

ASKWISE repo/API/Auth/tenant、生产 First Task 内容包、鳌鱼资产与授权、飞书字段映射、OpenAI 出站规则、微信支付商户配置及真机测试仍需后续真实证据。不得把本次产品冻结表述为“已接通”或“可上线”。
