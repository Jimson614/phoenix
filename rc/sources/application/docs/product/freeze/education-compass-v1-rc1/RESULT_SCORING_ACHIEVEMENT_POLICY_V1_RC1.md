# Result, Scoring & Achievement Policy V1 RC1

> 产品策略状态：`FROZEN_BY_PRODUCT_MANIFEST`；工程验证仍为 `PENDING`。  
> 版本：`education_compass_result_policy_v1.0.0-rc1`

## 1. 冻结结论

- `scoring.mode = NONE`。
- 所有题目均为 `scored: false`；不设置权重、阈值、总分、能力分、排名或维度高低档。
- `completeness` 只表示已回答的适用必答题覆盖率，不表示学生能力。
- 结果只允许使用 `SUPPORTED / NEEDS_VALIDATION / UNKNOWN` 三种证据状态。
- 成绩资料使用 `RANGE_INPUT`、全部选填；不收精确分数、精确位次、成绩单文件或截图。
- 旧版院校／专业适配的 30/25/20/15/10 或其他加权模型仅用于历史记录，禁止用于本版本。

## 2. Level 1 结果合同

`FamilyEducationSnapshotV1` 只能包含：

```yaml
result_kind: FAMILY_EDUCATION_SNAPSHOT
result_version: family_education_snapshot_v1.0.0
family_id: stable business id
student_id: stable business id
assessment_id: stable business id
education_system: canonical code
grade_stage: canonical code
family_concerns: option codes from FP03
observed_strength_signals: option codes from FP04
observed_difficulty_signals: option codes from FP05
student_readiness: option code from FP06
family_priorities: option codes from FP07
preferred_next_support: option code from FP08
next_step_status: AVAILABLE | CONSIDER | NOT_RECOMMENDED | DEFERRED
next_step_reason_codes: []
questionnaire_version: free_parent_compass_v1.0.0-rc1
disclaimer_version: education_compass_disclaimer_v1.0.0-rc1
```

Level 1 不输出学生能力判断、院校／专业推荐、录取概率、诊断、完整升学路线或付费报告片段。家长观察必须在前台标注为“家长观察”，不能伪装成学生自述。

## 3. Level 2 结果合同

`StudentGrowthDiscoveryReportV1` 固定为六项结果：

```yaml
result_kind: STUDENT_GROWTH_DISCOVERY
result_version: student_growth_discovery_report_v1.0.0
education_pathway_context:
  selected_codes: []
  respondent: STUDENT
  intent: CONSIDERING
  status: USER_STATED_CONTEXT
  evidence_refs: [EGD19]
  taxonomy_version: education_compass_taxonomy_v1.0.0-rc1
student_snapshot: {}
strength_signals: []
learning_bottlenecks: []
subject_focus: []
growth_direction: []
action_plan_30d: {}
learning_signals: []
interest_signals: []
recommended_focus: []
system_result_marker: FULL_SYSTEM_BANK | SYSTEM_BANK_PENDING
evidence_refs: []
questionnaire_versions: []
disclaimer_version: education_compass_disclaimer_v1.0.0-rc1
```

每条结构化信号的最小结构为：

```yaml
code: canonical taxonomy code
dimension: ACADEMIC_PERFORMANCE | LEARNING_PROCESS | THINKING_LEARNING_STYLE | INTEREST_DIRECTION
status: SUPPORTED | NEEDS_VALIDATION | UNKNOWN
evidence_refs: [question_id]
source: STUDENT_SELF_REPORT | OPTIONAL_RANGE_CONTEXT
```

禁止再使用旧审计草案里的 `EMERGING / DEVELOPING / ESTABLISHED`，也禁止把它们映射成 `LOW / MEDIUM / HIGH`。

## 4. 确定性证据规则

1. `SUPPORTED`：至少有两个不同题号的同方向证据；或者一项学生明确自选重点，加上一项不同题号的交叉证据。
2. `NEEDS_VALIDATION`：只有一项明确自述，或只有成绩区间而没有学习过程证据。
3. `UNKNOWN`：适用证据缺失、只选择 `UNSURE / NOT_PROVIDED`、答案互相矛盾且无法由规则消解，或题库分支未覆盖。
4. Strength Signal 必须有两个正向、不同题号的 evidence ref；不能从单题推断“天赋”。
5. Learning Bottleneck 必须有两个同方向 evidence ref，或 EGD06/EGD17 的明确自选项加一个 EGD10–EGD13 的交叉证据。
6. Subject Focus 最多三科。EGD09 单独出现时为 `NEEDS_VALIDATION`；若再有 EGD18、体系题或选填成绩区间支持，可为 `SUPPORTED`。
7. Interest Direction 最多两个探索方向。EGD15 与 EGD16 同向时可为 `SUPPORTED`；否则为 `NEEDS_VALIDATION`，并必须提示用真实项目继续验证。
8. 30-Day Action Plan 只依据 `recommended_focus`、EGD18 和可执行的学习证据形成 1–3 个目标；不得扩展为 6–24 个月升学规划。
9. 压力／情绪信号只触发中性支持提示，不计分，不单独触发 ASKWISE、Level 3 或顾问销售。
10. AI 只能解释已由本规则生成的结构化结果；不得创造新证据、诊断、能力排名、院校事实或录取判断。
11. `education_pathway_context` 只原样保存 EGD19 的可选标准 code，作为学生本人表达的“正在考虑”背景；它不计分、不选择体系题库、不发送 ASKWISE，也不自动产生学历等值、认可、证书取得、申请资格、录取或适合性结论。前台只在付款解锁后的 Student Snapshot 中以中性背景展示。

## 5. 结果完整度

- Level 1：FP01–FP08 全部有效回答后方可提交。
- Level 2：EGD01 必须为 `CONFIRM_STUDENT_SELF`；EGD01–EGD18 全部有效回答，并完成所选正式体系的必答分支题后方可提交。EGD19 为选填，空值不影响提交、购买或结果生成。
- IB／OTHER 不加载体系分支，允许只用公共题完成，但结果必须写 `SYSTEM_BANK_PENDING`，且不得生成体系专属结论。
- 选填成绩区间为空不降低可提交性；只降低相关学科信号的证据强度。
- 学生拒绝、非学生本人或退出不生成结果，也不形成“低能力／低意愿”信号。

## 6. 付款前锁定响应

Level 2 提交后、付款前只允许返回：

```yaml
assessment_id: id
result_state: LOCKED
product_code: EDUCATION_GROWTH_DISCOVERY_SINGLE_V1
amount_fen: 3990
currency: CNY
next_action: PURCHASE_TO_UNLOCK_REPORT
system_result_marker: FULL_SYSTEM_BANK | SYSTEM_BANK_PENDING
```

锁定响应、错误对象、日志、缓存、Timeline、Agent、飞书和 PDF 均不得包含六项结果、signals、evidence refs、摘要句或可推断结论。

## 7. 成绩资料边界

- 用途仅为上下文与证据交叉验证，不作录取预测或院校匹配。
- 区间值必须来自 `TAXONOMY_REGISTRY_V1_RC1.json`。
- 不上传文件，不保存原始成绩单，不要求学校名称。
- 不把不同考试局、课程体系或 GPA 制度做自动等值换算。
- `NOT_PROVIDED` 与 `UNSURE` 是合法选项，不能被解释为学业较弱。

## 8. 固定免责声明

前台完整文案：

> 本结果基于本次学生自我报告、家长观察（如有）及用户自愿提供的区间资料形成成长快照，不是心理、医疗或学业能力诊断，也不构成提分、升学或录取承诺。教育体系、成绩与兴趣信息可能随时间变化；重要决定请结合学校、合格专业人士及最新官方信息复核。

短版文案：

> 成长快照仅供教育支持参考，不是诊断、排名、录取预测或结果保证。

两段文案共同版本为 `education_compass_disclaimer_v1.0.0-rc1`；任何字词修改都必须升版并重新计算附件 SHA-256。
