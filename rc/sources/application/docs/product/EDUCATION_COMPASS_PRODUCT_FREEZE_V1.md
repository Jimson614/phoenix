# Phoenix Education Compass Product Freeze V1 — Signed Package

> 当前状态：`FROZEN`  
> 包就绪度：`SIGNED`  
> 工程闸门：`PENDING_ENGINEERING_VALIDATION`  
> 生效：`true`  
> 批准：`Jim / Founder / 2026-08-25T15:57:29+08:00`  
> 说明：产品语义已由 Founder 冻结。该批准不等于真实支付、外部接口、生产数据库、发布或真实学生使用授权；ASKWISE/Aoyu 与专业审核仍受独立闸门约束。

## 1. 适用范围

本包覆盖 Education Compass V0.5.0 的 Level 1 免费家长罗盘、Level 2 ¥39.90 学生成长发现、Level 3 入口预留、OpenAI/飞书边界，以及 2026-08-24 决定的 Education Compass → ASKWISE → Aoyu 五日受控集成目标。

本包不覆盖完整 Level 3、Family Passport 20 题／199 会员、旧院校与专业匹配引擎、Nova Agent、Wealth/Identity Compass、实时语音、自由聊天或生产发布。

## 2. 来源与权威

| 来源 | SHA-256 | 权威用途 |
|---|---|---|
| `EDUCATION_COMPASS_CURRENT_BUILD_AUDIT.md` | `21684CAD039EB54F705ED998965912974D21EF9AE9210857AB05B544A9280C64` | 当前代码事实 + 草案参考；审计草案不等于批准 |
| `Phoenix Education Compass 三层产品与题库结构 V1.0｜Founder Review Draft` | `5F0EB5A84F285BBF773C9D330F2DFD0191647E386D90D25BC6E3BBF1BA87C8F1` | 三层产品意图与 FP/EGD 题目基线；源文件明确未冻结 |
| `Education Compass × ASKWISE × 鳌鱼｜五日功能闭环MVP｜8/25–8/29` | `4364ECDDF372283C1D0D139ABAF490F992532590B4F4DA210D1CD8E9A3F1A984` | Founder 集成 scope/DoD 决定；产品级 handoff 合同纳入本次冻结，运行激活仍受外部闸门约束 |
| 九份 Word 历史／平台文档 | 逐份 hash 见 Source Decision Log | 只继承稳定 ID、Consent、最小权限、版本与历史价格流程等原则；不覆盖新三层语义 |
| Founder 当前批准消息 | `BC92E23E99BA68077A3F2FBF188B35FBFFE036FB38C3EBE305BCD84A73BFE7AF` | `Jim / Founder / APPROVE_WITH_CHANGES`；冻结推荐方案并加入五项学历路径背景 |

详细来源、九份完整 hash 与冲突处理见附件 `SOURCE_DECISION_AND_CONFLICT_LOG_V1_RC1.md`。

## 3. Freeze Manifest

```yaml
schema_version: education_compass_product_freeze_manifest_v1
status: FROZEN
package_readiness: SIGNED
engineering_gate: PENDING_ENGINEERING_VALIDATION
effective: true
effective_scope: PRODUCT_SPECIFICATION_ONLY
source_candidate_version: education_compass_product_freeze_v1.0.0-rc1
freeze_version: education_compass_product_freeze_v1.0.0
product_target_version: 0.5.0
approved_by: Jim
approved_role: Founder
approved_at: 2026-08-25T15:57:29+08:00
approved_at_source: SYSTEM_CAPTURE_TIME_OF_APPROVAL_MESSAGE
approved_decision: APPROVE_WITH_CHANGES
identity_assurance: USER_ASSERTED_IN_CURRENT_CODEX_SESSION
approval_evidence_path: docs/product/freeze/education-compass-v1-rc1/FOUNDER_APPROVAL_EVIDENCE_V1.md
approval_evidence_sha256: BC92E23E99BA68077A3F2FBF188B35FBFFE036FB38C3EBE305BCD84A73BFE7AF
content_review_gate: PENDING
privacy_minor_review_gate: PENDING
askwise_aoyu_activation: BLOCKED_EXTERNAL
payment_activation: NOT_AUTHORIZED
production_db_migration: NOT_AUTHORIZED
miniprogram_release: NOT_AUTHORIZED
real_student_use: NOT_AUTHORIZED

level_1:
  assessment_kind: FREE_PARENT_COMPASS
  respondent_roles: [PARENT_GUARDIAN]
  questionnaire_version: free_parent_compass_v1.0.0-rc1
  bank_version: free_parent_compass_v1.0.0-rc1
  question_ids: [FP01, FP02, FP03, FP04, FP05, FP06, FP07, FP08]
  required_question_ids: [FP01, FP02, FP03, FP04, FP05, FP06, FP07, FP08]
  optional_question_ids: []
  result_kind: FAMILY_EDUCATION_SNAPSHOT
  result_version: family_education_snapshot_v1.0.0
  amount_fen: 0
  estimated_minutes: 3-5

level_2:
  assessment_kind: STUDENT_GROWTH_DISCOVERY
  assessment_level: LEVEL_2
  product_name: Education Growth Discovery
  questionnaire_version: education_growth_discovery_v1.0.0-rc1
  common_bank_version: education_growth_discovery_v1.0.0-rc1
  common_question_ids: [EGD01, EGD02, EGD03, EGD04, EGD05, EGD06, EGD07, EGD08, EGD09, EGD10, EGD11, EGD12, EGD13, EGD14, EGD15, EGD16, EGD17, EGD18, EGD19]
  required_common_question_ids: [EGD01, EGD02, EGD03, EGD04, EGD05, EGD06, EGD07, EGD08, EGD09, EGD10, EGD11, EGD12, EGD13, EGD14, EGD15, EGD16, EGD17, EGD18]
  optional_common_question_ids: [EGD19]
  allowed_respondents: [STUDENT]
  respondent_gate:
    question_id: EGD01
    accepted_option_codes: [CONFIRM_STUDENT_SELF]
    rejected_option_codes: [EXIT_NOT_STUDENT]
    rejected_behavior: EXIT_WITHOUT_NEGATIVE_SIGNAL_OR_PURCHASE
    guardian_session_assistance: OPERATIONAL_OR_LANGUAGE_CLARIFICATION_ONLY
  source_assessment_kind: FREE_PARENT_COMPASS
  source_assessment_required_in_production: true
  result_kind: STUDENT_GROWTH_DISCOVERY
  result_version: student_growth_discovery_report_v1.0.0
  formal_system_routes: [GAOKAO, DSE, IGCSE, A_LEVEL, AP_US]
  system_question_ids:
    GAOKAO: [GK01, GK02, GK03, GK04, GK05]
    DSE: [DSE01, DSE02, DSE03, DSE04]
    IGCSE: [IG01, IG02, IG03]
    A_LEVEL: [AL01, AL02, AL03, AL04]
    AP_US: [AP01, AP02, AP03, AP04, AP05]
  fallback_routes:
    IB:
      mode: COMMON_ONLY
      system_question_ids: []
      result_marker: SYSTEM_BANK_PENDING
      system_specific_claims: false
      purchase_allowed: true
      generic_askwise_handoff_allowed_if_supported: true
    OTHER:
      mode: COMMON_ONLY
      system_question_ids: []
      result_marker: SYSTEM_BANK_PENDING
      system_specific_claims: false
      purchase_allowed: true
      generic_askwise_handoff_allowed_if_supported: true
  estimated_minutes: 15-20

education_pathway_context:
  question_id: EGD19
  field: education_pathway_target_codes
  taxonomy_version: education_compass_taxonomy_v1.0.0-rc1
  allowed_codes: [MAINLAND_TERTIARY_DIPLOMA, MAINLAND_BACHELOR_DUAL_CREDENTIAL_PART_TIME, MAINLAND_BACHELOR_SINGLE_CREDENTIAL, OVERSEAS_BACHELOR_FULL_TIME, HONG_KONG_ASSOCIATE_DEGREE, OTHER_PATHWAY, UNSURE]
  respondent: STUDENT
  required: false
  min_selections: 0
  max_selections: 3
  intent: CONSIDERING
  status: USER_STATED_CONTEXT
  question_bank_router: false
  scored: false
  sent_to_askwise: false
  automatic_equivalence_recognition_eligibility_or_admission_claims: forbidden

commercial:
  product_code: EDUCATION_GROWTH_DISCOVERY_SINGLE_V1
  amount_fen: 3990
  currency: CNY
  display_price: "¥39.90"
  display_price_derived_from_amount: true
  payment_timing: AFTER_SUBMIT_BEFORE_REPORT
  submit_before_payment: true
  submitted_result_state: LOCKED
  locked_response_policy: ZERO_SIX_SECTION_CONTENT_SIGNALS_EVIDENCE
  entitlement_deliverable: STUDENT_GROWTH_DISCOVERY_REPORT_V1
  legacy_product_code: COMPASS_REPORT_SINGLE_39_9
  cross_sku_entitlement: DENY
  five_day_askwise_uat_payment_mode: TEST_ENTITLEMENT_NO_REAL_PAYMENT

scoring:
  mode: NONE
  rule_version: scoring_none_and_evidence_status_v1.0.0-rc1
  all_questions_scored: false
  numeric_score: false
  weights: []
  thresholds: []
  dimension_bands: false
  allowed_signal_statuses: [SUPPORTED, NEEDS_VALIDATION, UNKNOWN]
  completeness_is_coverage_not_ability: true

data_collection:
  achievement_mode: RANGE_INPUT
  achievement_required: false
  exact_score_collection: false
  exact_rank_collection: false
  file_upload_enabled: false
  budget_amount_collection: false
  household_income_collection: false
  achievement_use: CONTEXT_AND_EVIDENCE_ONLY

profile_policy:
  family_student_cardinality: ONE_TO_MANY
  one_student_profile_per_student: true
  stable_ids: [family_id, student_id, assessment_id, report_id]
  feishu_record_id_as_business_key: false
  fake_placeholder_values: forbidden
  level_1_and_level_2_assessment_ids_are_distinct: true
  level_2_source_assessment_link_required: true

consent:
  bundled_consent: false
  core_guardian_consent_version: guardian_core_assessment_v1.0.0-rc1
  student_assent_version: student_assent_growth_discovery_v1.0.0-rc1
  askwise_handoff_opt_in_version: askwise_handoff_opt_in_v1.0.0-rc1
  agent_analysis_opt_in_version: agent_analysis_opt_in_v1.0.0-rc1
  feishu_profile_opt_in_version: feishu_profile_mirror_opt_in_v1.0.0-rc1
  advisor_contact_opt_in_version: advisor_contact_opt_in_v1.0.0-rc1
  marketing_contact_opt_in_version: marketing_contact_opt_in_v1.0.0-rc1
  student_refusal_overrides_guardian: true
  minor_required_bundle: [guardian_consent, student_assent]
  age_or_guardianship_unknown_bundle: [guardian_consent, student_assent]

openai_agent:
  core_result_depends_on_agent: false
  separate_opt_in_required: true
  input: PSEUDONYMOUS_STRUCTURED_RESULT_ONLY
  raw_answers_allowed: false
  output_role: EXPLANATION_ONLY

feishu:
  role: CONSENT_GATED_OPERATIONS_MIRROR
  primary_system_of_record: POSTGRESQL
  direct_miniprogram_write: false
  user_profile_interface_required: true
  exact_allowlist_attachment_required: true
  raw_answers_or_agent_or_payment_data: forbidden

askwise_aoyu:
  scope_decision_source: FOUNDER_FIVE_DAY_MVP_2026_08_24
  product_scope_authority: HANDOFF_SESSION_FIRST_TASK_AOYU_WRITEBACK
  runtime_activation_status: DISABLED_BLOCKED_EXTERNAL
  contract_version: education_support_handoff_v1.0.0-rc1
  explicit_handoff_consent_required: true
  idempotency_natural_key: [student_id, assessment_id, report_version, contract_version, handoff_type]
  duplicate_same_payload_behavior: RETURN_EXISTING_SESSION_AND_TASK
  aoyu_role: EVENT_DRIVEN_PRESENTATION_LAYER_ONLY
  aoyu_states: [WELCOME, FOCUS, WAITING, HINT, ENCOURAGE, CELEBRATE, SAFE_ERROR]
  realtime_voice_or_free_chat: false
  production_student_use_requires_founder_go: true
  integration_activation_readiness: BLOCKED_EXTERNAL

level_3:
  entry_only: true
  question_ids: []
  product_payment_enabled: false
  states: [AVAILABLE, CONSIDER, NOT_RECOMMENDED, DEFERRED]
  trigger_codes: [USER_REQUESTED_DEEP_ASSESSMENT, COMPLEX_MULTI_FACTOR_NEEDS_REVIEW, FAMILY_STUDENT_GOAL_MISALIGNMENT, MULTI_EDUCATION_SYSTEM_COMPARISON_REQUESTED, MULTI_PATHWAY_COMPARISON_REQUESTED]
  forbidden_single_triggers: [LEARNING_PRESSURE, EMOTIONAL_SIGNAL, STUDENT_REFUSAL, INSUFFICIENT_EVIDENCE]
  advisor_intent: DEEP_ASSESSMENT
  cta_mode: ADVISOR_INFORMATION_OR_APPOINTMENT_ONLY

approved_empty_fields:
  - level_1.optional_question_ids
  - level_2.fallback_routes.IB.system_question_ids
  - level_2.fallback_routes.OTHER.system_question_ids
  - scoring.weights
  - scoring.thresholds
  - level_3.question_ids
```

## 4. 决策覆盖说明

- Level 1 只采用 FP01–FP08，不混入 Audit 的 FPC-01–11。
- Level 2 采用 EGD01–EGD18 必答、EGD19 学历路径选填，以及本包五个正式体系分支；不拼接 Audit 的 34 题草案。
- `GAOKAO / DSE / IGCSE / A_LEVEL / AP_US` 是题库路由；内地大专等五项是 `education_pathway_target_codes`，只表示学生正在考虑的学历路径。
- `NONE` 覆盖 Audit 的 evidence bands；只保留证据支持状态。
- EGD01 从“学生／共同／家长代填”改为学生本人确认闸门。
- EGD17 删除预算金额／家庭收入采集，改为学习与行动限制。
- ASKWISE 产品 scope 冻结为 session/task/Aoyu/writeback；运行激活保持 `DISABLED_BLOCKED_EXTERNAL`，直到外部依赖、测试与独立授权齐全。

## 5. 冻结附件清单

Hash policy：`SHA-256`，作用域为 `RAW_FILE_BYTES`。RC1 目录名和附件文件名为审计追溯而保留；本 Manifest 通过固定 bytes/hash 将其提升为最终 Product Freeze V1。主文件不自引用 hash，主文件 hash 记录在 detached receipt。

| ID | 路径 | Bytes | SHA-256 |
|---|---|---:|---|
| `QUESTION_BANKS` | `docs/product/freeze/education-compass-v1-rc1/QUESTION_BANKS_V1_RC1.json` | 41206 | `EFAE34EE595FC5E4A2FE8B6C5B89B1F182625BF15518620AC475320E4FD978F9` |
| `TAXONOMY_REGISTRY` | `docs/product/freeze/education-compass-v1-rc1/TAXONOMY_REGISTRY_V1_RC1.json` | 8889 | `53691402AA191489317E013CFC5BBE121339301EECFD43F7C6430415B11E2231` |
| `RESULT_SCORING_ACHIEVEMENT` | `docs/product/freeze/education-compass-v1-rc1/RESULT_SCORING_ACHIEVEMENT_POLICY_V1_RC1.md` | 6970 | `A01A07747C6EAEC3D137696E84990F106C6BD7821EC79DEDDA29770CA3341162` |
| `ROUTING_PROFILE_SOURCE_LEVEL3` | `docs/product/freeze/education-compass-v1-rc1/ROUTING_PROFILE_SOURCE_LEVEL3_POLICY_V1_RC1.md` | 7586 | `E6B16F1BF4947856C535334A05C200A882D440CA894AF14A519F9D1E35F01282` |
| `COMMERCIAL_POLICY` | `docs/product/freeze/education-compass-v1-rc1/COMMERCIAL_POLICY_V1_RC1.md` | 3051 | `C6A6A80046E4BCA513938AB4845867148981D20C415E728F5BB516853A482DF1` |
| `CONSENT_PRIVACY_AGENT_FEISHU` | `docs/product/freeze/education-compass-v1-rc1/CONSENT_PRIVACY_AGENT_FEISHU_POLICY_V1_RC1.md` | 7695 | `47810BEC41F9803F303AA89A3399F8C09C259CFC2F43F7A9287F0A3BC1A43445` |
| `ASKWISE_AOYU_CONTRACT` | `docs/product/freeze/education-compass-v1-rc1/ASKWISE_AOYU_INTEGRATION_CONTRACT_V1_RC1.md` | 10142 | `0CDB636F12E1637D2675583304DE3FD8AC8C7BFE84303949CB1FADC4AC776038` |
| `PERSONA_UAT` | `docs/product/freeze/education-compass-v1-rc1/PERSONA_AND_UAT_FIXTURES_V1_RC1.md` | 7984 | `470C8E0A67AD60F196731F1E80325F33929B6AE62DC03C069AB292E9458C1A74` |
| `SOURCE_DECISION_LOG` | `docs/product/freeze/education-compass-v1-rc1/SOURCE_DECISION_AND_CONFLICT_LOG_V1_RC1.md` | 6703 | `04ED2A1D10EF42C3E17AB33004A139953E8F6D051467D405E9F75B454E87DAEC` |
| `REVIEW_SIGNATURE_RECORD` | `docs/product/freeze/education-compass-v1-rc1/CONTENT_REVIEW_AND_SIGNATURE_RECORD_V1_RC1.md` | 5172 | `3F11BBD17BE429FFBB68A3593DE184136FC4D8C5F8117AB07251EC57BF68BBCA` |
| `FOUNDER_APPROVAL_EVIDENCE` | `docs/product/freeze/education-compass-v1-rc1/FOUNDER_APPROVAL_EVIDENCE_V1.md` | 3157 | `BC92E23E99BA68077A3F2FBF188B35FBFFE036FB38C3EBE305BCD84A73BFE7AF` |

## 6. 已冻结与后续闸门

产品定义已由 `Jim / Founder` 批准并冻结。以下事项不阻止产品语义生效，但继续阻止相应的工程、集成或发布动作：

1. 教育内容、隐私／未成年人和工程 Reviewer 尚未完成独立审核。
2. ASKWISE repository/API/Auth/staging tenant 与生产 First Task 内容包未提供。
3. 鳌鱼资产路径、授权证据、静态 fallback 和 SHA-256 未提供。
4. 飞书字段映射与 OpenAI 出站规则尚未完成专业／工程验证。
5. 微信支付商户配置、回调安全与 iOS/Android 真机扣款／退款测试未完成。
6. 当前目录不是 Git 仓库，无法提供真实 branch/commit SHA。
7. 生产 migration、小程序发布、真实学生使用仍需各自的明确授权。

因此，当前可陈述“产品定义已冻结”，不可陈述“代码已实现”“支付已启用”“外部系统已接通”或“可上线”。

## 7. 签署记录与变更控制

```yaml
approved_by: Jim
approved_role: Founder
approved_at: 2026-08-25T15:57:29+08:00
approved_at_source: SYSTEM_CAPTURE_TIME_OF_APPROVAL_MESSAGE
decision: APPROVE_WITH_CHANGES
approval_evidence: docs/product/freeze/education-compass-v1-rc1/FOUNDER_APPROVAL_EVIDENCE_V1.md
effective_scope: PRODUCT_SPECIFICATION_ONLY
```

Founder 只签署产品定义；教育内容、隐私／未成年人和工程 Reviewer 仍在签署记录中明确为 `PENDING`。任何冻结字段变更都必须创建新 freeze version、重新计算附件 hash 并再次取得 Founder 批准。真实外部调用、扣款、生产数据、发布和真实学生使用继续由各自闸门控制。
