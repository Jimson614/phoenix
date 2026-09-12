# Routing, Profile, Source Entry & Level 3 Policy V1 RC1

> 产品策略状态：`FROZEN_BY_PRODUCT_MANIFEST`；工程验证仍为 `PENDING`。  
> 版本：`education_compass_routing_profile_policy_v1.0.0-rc1`

## 1. ID 与 Student Profile

- `family_id`、`student_id`、`assessment_id`、`report_id` 均为稳定、不可复用、不可由姓名推导的业务 ID。
- Family 与 Student 是 1:N；同一学生只维护一个 Student Profile，不为 Level 1、Level 2、ASKWISE 或飞书重复建学生。
- 飞书 `record_id`、微信 `openid`、手机号和姓名不得作为跨系统业务主键。
- Level 1 与 Level 2 必须使用两个不同的 Assessment ID；Level 2 的 `source_assessment_id` 指向 Level 1。
- 生产漏斗默认要求先完成 Level 1，再开始 Level 2。`INTERNAL_UAT` 可使用经标记的合成 source assessment；不能伪装为真实用户记录。
- Assessment 提交后形成不可变快照；用户修改资料时建立新版本，不覆盖已交付报告的来源版本。

## 2. Profile 状态

```yaml
profile_status:
  PROVISIONAL:
    required: [family_id, student_id]
    nullable: [student_display_name, grade_stage, education_system]
    allowed_actions: [START_LEVEL_1, SAVE_DRAFT]
  COMPLETE_FOR_LEVEL_2:
    required: [family_id, student_id, grade_stage, education_system]
    nullable: [student_display_name, birth_date, school_name]
    allowed_actions: [START_LEVEL_2, SUBMIT_LEVEL_2]
```

- 不使用“未命名孩子”、假生日、假电话或默认学校填补空值。
- Level 1 已得到的 grade/stage 与 system 写入同一 Profile，Level 2 只要求学生确认或更新，不重复询问同一事实。
- Level 2 `respondent = STUDENT` 不等于必须新增学生登录账号；可以在监护人会话中把设备交给学生本人。
- 家长可协助触屏、朗读或解释题意，但不得替学生选择答案；协助只记录为 `assistance_mode = OPERATIONAL_OR_LANGUAGE_CLARIFICATION`。
- `EXIT_NOT_STUDENT`、学生拒绝或撤回 assent：保存草稿并退出，不生成结果、不允许购买、不形成负面信号。

## 3. Level 1 → Level 2 路由

| 条件 | `next_step_status` | reason code | CTA |
|---|---|---|---|
| FP06=`WILLING` | `AVAILABLE` | `STUDENT_READY_FOR_SELF_ASSESSMENT` | `开始学生成长发现` |
| FP06=`MAYBE_NEEDS_EXPLANATION` | `CONSIDER` | `STUDENT_NEEDS_EXPLANATION` | `先向学生解释测评用途` |
| FP06=`UNSURE` | `DEFERRED` | `STUDENT_READINESS_UNKNOWN` | `稍后再决定` |
| FP06=`NOT_WILLING` | `NOT_RECOMMENDED` | `STUDENT_DECLINED` | 不展示购买 CTA；只提供退出与中性说明 |

FP03–FP05、FP07–FP08 只用于解释家庭关注和建议，不得覆盖学生拒绝。Level 1 结果不可直接购买或替代 Level 2。

## 4. Level 2 提交、付款与报告路由

```text
STUDENT self-confirmed
→ complete common + applicable required system questions
→ SUBMITTED
→ deterministic result generated as LOCKED
→ ¥39.90 purchase
→ entitlement confirmed by server
→ full Student Growth Discovery report
```

- 付款失败、状态未知或退款后，报告访问 fail closed。
- IB／OTHER 可提交并购买，但购买前必须明确展示“首版仅提供公共题成长发现，不提供体系专属分析”；结果写 `SYSTEM_BANK_PENDING`。
- 生产 ASKWISE CTA 只在完整报告已解锁后评估；五日集成 UAT 使用独立 `TEST_ENTITLEMENT`，不运行真实支付。

## 5. ASKWISE 触发

`ASKWISE_AVAILABLE` 需要同时满足：

1. Level 2 已完成，报告由冻结结果规则生成；
2. 生产为有效付费报告权益，UAT 为显式测试权益；
3. 至少一个 `subject_focus` 为 `SUPPORTED`，或至少一个 `learning_bottleneck` 为 `SUPPORTED`；
4. `recommended_focus` 中存在可由已批准 First Task 模板支持的学习重点；
5. 学生主动选择学习支持，并满足 Consent Policy；
6. ASKWISE capability 开关、目标环境和内容包均可用。

允许 reason codes：

- `SUPPORTED_SUBJECT_FOCUS`
- `SUPPORTED_KNOWLEDGE_RETRIEVAL_GAP`
- `SUPPORTED_FOUNDATION_GAP`
- `SUPPORTED_FIRST_STEP_GAP`
- `SUPPORTED_KNOWLEDGE_TRANSFER_GAP`
- `SUPPORTED_ERROR_REVIEW_GAP`
- `USER_REQUESTED_LEARNING_SUPPORT`

排除 codes：

- `STUDENT_DECLINED`
- `CONSENT_MISSING_OR_WITHDRAWN`
- `INSUFFICIENT_EVIDENCE`
- `NO_APPROVED_FIRST_TASK_TEMPLATE`
- `ASKWISE_CAPABILITY_UNAVAILABLE`
- `ONLY_STRESS_OR_EMOTIONAL_SIGNAL`

IB／OTHER 仅在公共题产生足够学习证据时允许通用学习支持，不得生成体系专属任务或暗中映射到五个正式体系。

## 6. 教育体系与学历路径分轨

- `education_system` 只允许 `GAOKAO / DSE / IGCSE / A_LEVEL / AP_US / IB / OTHER`，用于选择公共题与体系分支题库。
- `education_pathway_target_codes` 是 EGD19 的可选背景字段，允许：`MAINLAND_TERTIARY_DIPLOMA / MAINLAND_BACHELOR_DUAL_CREDENTIAL_PART_TIME / MAINLAND_BACHELOR_SINGLE_CREDENTIAL / OVERSEAS_BACHELOR_FULL_TIME / HONG_KONG_ASSOCIATE_DEGREE / OTHER_PATHWAY / UNSURE`。
- 学历路径不改变题库、价格、评分、报告解锁或 ASKWISE mode；不得将“内地大专／香港副学士”等值转换为考试体系。
- 选择一个路径只形成 `USER_STATED_CONTEXT`。只有学生主动选择路径咨询，或选择两个以上路径并同时出现 `SYSTEM_RULE_UNCERTAINTY / PATH_CONSULTATION` 等复合证据时，才可让 Level 3 进入 `CONSIDER`；不能仅凭路径名称自动强推服务。
- 路径与地区看似不一致时只提示学生确认并标 `NEEDS_VALIDATION`，不得自动改答案或阻止提交。
- 任何学历认可、双证／单证含义、授予资格或地区规则必须以后续人工与最新官方资料复核；Level 2 不给确定结论。

## 7. Level 3 入口预留

```yaml
entry_only: true
states: [AVAILABLE, CONSIDER, NOT_RECOMMENDED, DEFERRED]
trigger_codes:
  - USER_REQUESTED_DEEP_ASSESSMENT
  - COMPLEX_MULTI_FACTOR_NEEDS_REVIEW
  - FAMILY_STUDENT_GOAL_MISALIGNMENT
  - MULTI_EDUCATION_SYSTEM_COMPARISON_REQUESTED
  - MULTI_PATHWAY_COMPARISON_REQUESTED
advisor_intent: DEEP_ASSESSMENT
cta_mode: ADVISOR_INFORMATION_OR_APPOINTMENT_ONLY
question_ids: []
payment_enabled: false
```

- Level 3 只显示“了解／预约深度评估”，不创建 ¥980 SKU、订单、题库、报告或 AI Comprehensive Profile。
- `LEARNING_PRESSURE`、`EMOTIONAL_SIGNAL`、`STUDENT_REFUSAL`、`INSUFFICIENT_EVIDENCE` 不得单独触发 Level 3 商业推荐。
- ASKWISE 与 Level 3 可以同时为 `AVAILABLE`，但必须分别说明理由：ASKWISE 解决近期学习任务；Level 3 处理复杂目标、家庭对齐或多路线问题。

## 8. Source Entry

允许值：

```text
MINIPROGRAM_HOME
LEVEL_1_RESULT
DIRECT_LEVEL_2
XIAOHONGSHU_CONTENT
ADVISOR_REFERRAL
INTERNAL_UAT
```

- 未知值不得静默映射为营销渠道；拒绝请求或写入 `MANUAL_REVIEW_REQUIRED`，且不计渠道归因。
- `DIRECT_LEVEL_2` 只允许已有有效 Level 1 source assessment 的返回用户；否则先转 Level 1。
- `INTERNAL_UAT` 只能使用合成数据、测试 ID 和测试权益。
- source entry 不改变题库、价格、结果、Consent 或安全规则。

## 9. Advisor / CRM 最小投影

允许顾问或家长看到：是否进入 ASKWISE、当前 session/task 状态、允许的 `outcome_code`、`next_action_code`、更新时间和错误状态。禁止展示原始作答、自由文本、学习过程全文、聊天全文、提示轨迹或 ASKWISE 内部推理。顾问无权修改 Compass 结果规则、ASKWISE learning mode 或任务答案策略。
