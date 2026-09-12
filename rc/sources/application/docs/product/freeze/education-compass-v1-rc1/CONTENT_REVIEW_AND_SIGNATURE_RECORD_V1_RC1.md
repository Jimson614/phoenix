# Content Review & Signature Record V1

> 当前状态：`FOUNDER_SIGNED_ENGINEERING_REVIEW_PENDING`  
> 用途：记录产品批准与独立专业／工程审核；Founder 行已按当前用户明确授权填写，其他 Reviewer 不代填。

## 1. Founder 最终批准

| 字段 | 记录值 |
|---|---|
| Freeze version | `education_compass_product_freeze_v1.0.0` |
| Approved by | `Jim` |
| Role | `Founder` |
| Approved at | `2026-08-25T15:57:29+08:00` |
| Approved at source | `SYSTEM_CAPTURE_TIME_OF_APPROVAL_MESSAGE` |
| Approval evidence 路径 | `docs/product/freeze/education-compass-v1-rc1/FOUNDER_APPROVAL_EVIDENCE_V1.md` |
| Approval evidence SHA-256 | `BC92E23E99BA68077A3F2FBF188B35FBFFE036FB38C3EBE305BCD84A73BFE7AF` |
| Identity assurance | `USER_ASSERTED_IN_CURRENT_CODEX_SESSION` |
| 结论 | `APPROVE_WITH_CHANGES` |
| 生效范围 | `PRODUCT_SPECIFICATION_ONLY` |

“Changes” 指：将 Founder 同行给出的五个学历路径从 `education_system` 中拆分，冻结为 EGD19 的 `education_pathway_target_codes`；不改变 Founder 给出的业务含义。

## 2. 教育内容审核

| 范围 | Reviewer | 日期 | 结论 | 备注／证据 |
|---|---|---|---|---|
| FP01–FP08 与 Family Snapshot | — | — | `PENDING` | 未声明 Reviewer |
| EGD01–EGD19 与六项结果 | — | — | `PENDING` | EGD19 为选填路径背景 |
| GAOKAO 分支／科目 registry | — | — | `PENDING` | 未声明 Reviewer |
| DSE 分支／科目 registry | — | — | `PENDING` | 未声明 Reviewer |
| IGCSE 分支／科目 registry | — | — | `PENDING` | 未声明 Reviewer |
| A_LEVEL 分支／考试局／科目 registry | — | — | `PENDING` | 未声明 Reviewer |
| AP_US 分支／课程／GPA range | — | — | `PENDING` | 未声明 Reviewer |
| IB／OTHER fallback 限制说明 | — | — | `PENDING` | 未声明 Reviewer |
| Evidence → signal → mode 规则 | — | — | `PENDING` | 未声明 Reviewer |
| ASKWISE UAT synthetic task pack | — | — | `PENDING` | 生产内容包仍缺失 |

## 3. 隐私／未成年人审核

| 范围 | Reviewer | 日期 | 结论 | 备注／证据 |
|---|---|---|---|---|
| 双授权年龄／监护矩阵 | — | — | `PENDING` | 未声明 Reviewer |
| Consent 精确文案与撤回后果 | — | — | `PENDING` | 未声明 Reviewer |
| 第三方处理方与数据出境／共享说明 | — | — | `PENDING` | 未声明 Reviewer |
| ASKWISE 出站／写回 allowlist | — | — | `PENDING` | 未声明 Reviewer |
| OpenAI Agent allowlist | — | — | `PENDING` | 未声明 Reviewer |
| 飞书 Profile/Assessment allowlist | — | — | `PENDING` | 未声明 Reviewer |
| 30 天候选删除 SLA | — | — | `PENDING` | 需隐私负责人确认最终值 |
| 免责声明与压力信号处置 | — | — | `PENDING` | 未声明 Reviewer |

## 4. 工程审核

| 范围 | Reviewer | 日期 | 结论 | 备注／证据 |
|---|---|---|---|---|
| Manifest 与附件 hash/bytes | — | — | `PENDING` | Freeze seal 只证明文档完整性，不等于代码实现 |
| 题号唯一、required/optional 完整 | — | — | `PENDING` | 待工程实施前复核 |
| 五体系 + IB/OTHER fallback 路由 | — | — | `PENDING` | 待工程实施 |
| 新旧 SKU、报告与 entitlement 隔离 | — | — | `PENDING` | 待工程实施 |
| locked 零泄露 | — | — | `PENDING` | 待工程实施与测试 |
| Consent 生命周期/outbox fence | — | — | `PENDING` | 待工程实施与测试 |
| ASKWISE schema/幂等/状态/错误码 | — | — | `PENDING` | 外部依赖缺失 |
| Aoyu asset/audio/fallback manifest | — | — | `PENDING` | 外部资产缺失 |
| Legacy 001–004 / V0.4.1 兼容计划 | — | — | `PENDING` | 待工程实施 |

## 5. 外部依赖登记

| 依赖 | 当前值 | Owner | 截止日期 | 状态 |
|---|---|---|---|---|
| ASKWISE repository + branch + commit | 未提供 | — | — | `BLOCKED_EXTERNAL` |
| ASKWISE API endpoint/Auth/webhook 签名 | 未提供 | — | — | `BLOCKED_EXTERNAL` |
| ASKWISE staging tenant / synthetic data policy | 未提供 | — | — | `BLOCKED_EXTERNAL` |
| Approved First Task production content pack | 未提供 | — | — | `BLOCKED_EXTERNAL` |
| Aoyu asset root / files / owner / license / SHA | 未提供 | — | — | `BLOCKED_EXTERNAL` |
| Aoyu approved static fallback | 未提供 | — | — | `BLOCKED_EXTERNAL` |
| Real CRM connector | 当前不存在；V1 默认 Phoenix/AdvisorRequest 最小投影 | — | — | `DEFERRED` |

## 6. 当前闸门状态

```yaml
product_status: FROZEN
package_readiness: SIGNED
effective: true
effective_scope: PRODUCT_SPECIFICATION_ONLY
content_review_gate: PENDING
privacy_minor_review_gate: PENDING
engineering_validation_gate: PENDING_ENGINEERING_VALIDATION
askwise_aoyu_activation: BLOCKED_EXTERNAL
payment_activation: NOT_AUTHORIZED
production_db_migration: NOT_AUTHORIZED
miniprogram_release: NOT_AUTHORIZED
real_student_use: NOT_AUTHORIZED
```

任何产品字段变更都必须新建 freeze version、更新附件 hash 并重新取得 Founder 批准。当前 `FROZEN` 不自动授权外部连接、真实支付、生产 migration、小程序发布或真实学生使用。
