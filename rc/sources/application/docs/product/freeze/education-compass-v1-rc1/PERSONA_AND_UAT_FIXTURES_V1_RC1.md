# Persona & UAT Fixtures V1 RC1

> 状态：`FROZEN_AS_ACCEPTANCE_CONTRACT`；这些是验收合同，执行状态仍为 `NOT_RUN`。  
> 版本：`education_compass_persona_uat_v1.0.0-rc1`

## 1. Fixture 通用规则

- 所有数据使用合成 ID、合成答案与 `source_entry=INTERNAL_UAT`。
- Level 2 正例均有已完成的合成 Level 1 source assessment、`EGD01=CONFIRM_STUDENT_SELF` 与测试权益。
- 未列出的公共必答题由 `VALID_NEUTRAL_COMMON_V1` 补齐；中性值不得制造额外瓶颈。
- 每个预期结果都只能使用 `SUPPORTED / NEEDS_VALIDATION / UNKNOWN`，不得输出分数、band、排名、诊断、院校匹配或录取概率。
- 未真正执行时，状态只能是 `NOT_RUN`；外部依赖缺失时为 `BLOCKED_EXTERNAL`，不能写 PASS。

## 2. Founder 五日三类 Persona

### `P1_TRANSFER_KNOWS_CANNOT_APPLY`

```yaml
system: GAOKAO
overrides:
  EGD06: [KNOWLEDGE_TRANSFER, SUBJECT_FOCUS]
  EGD10: TRY_THEN_STUCK
  EGD11: SOMETIMES
  EGD13: READ_ANSWER_LITTLE_REVIEW
  EGD17: [TIME_CONSTRAINT]
expected:
  learning_bottleneck: KNOWLEDGE_TRANSFER_GAP/SUPPORTED
  learning_mode: TRANSFER
  first_task_behavior: ask student to attempt independently, then provide layered hints without the answer
  aoyu_sequence: [WELCOME, FOCUS, WAITING, HINT]
forbidden: [DIRECT_ANSWER, LOW_ABILITY_LABEL]
```

### `P2_THINKING_NO_FIRST_STEP`

```yaml
system: DSE
overrides:
  EGD06: [PROBLEM_SOLVING]
  EGD10: NO_FIRST_STEP
  EGD11: SOMETIMES
  EGD13: ATTRIBUTE_AND_RETRY
  EGD17: [INFORMATION_GAP]
expected:
  learning_bottleneck: FIRST_STEP_CLARITY_GAP/SUPPORTED
  learning_mode: THINKING
  first_task_behavior: identify conditions, target and first method; do not show a full worked solution
  aoyu_sequence: [WELCOME, FOCUS, WAITING, HINT]
forbidden: [FULL_SOLUTION, FIXED_TRAIT_LABEL]
```

### `P3_TEACH_FOUNDATION_GAP`

```yaml
system: A_LEVEL
overrides:
  EGD06: [FOUNDATION]
  EGD10: SEARCH_FAMILIAR_PATTERN
  EGD11: OFTEN
  EGD17: [FOUNDATION_GAP]
expected:
  learning_bottleneck: FOUNDATION_GAP/SUPPORTED
  learning_mode: TEACH
  first_task_behavior: state that a small prerequisite will be reviewed first, then give a short verified foundation task
  aoyu_sequence: [WELCOME, FOCUS, WAITING]
forbidden: [BAD_STUDENT_LABEL, UNVERIFIED_CONTENT]
```

## 3. 正式体系与 fallback 覆盖

| Fixture ID | Route | 关键条件 | 预期 |
|---|---|---|---|
| `SYS_GAOKAO_VALID` | GAOKAO | GK01/GK02 有效，成绩区间空 | 可提交；不因成绩空缺降为失败 |
| `SYS_DSE_VALID` | DSE | DSE01 有效，DSE04=`UNSURE` | 可提交；不自动判定申请资格 |
| `SYS_IGCSE_VALID` | IGCSE | IG01/IG03 有效 | 可提交；不把 IGCSE 当最终升学结论 |
| `SYS_A_LEVEL_VALID` | A_LEVEL | AL01–AL03 有效 | 可提交；考试局上下文保留但不自动等值 |
| `SYS_AP_US_VALID` | AP_US | AP02/AP03 有效，GPA 不提供 | 可提交；不因 GPA 空缺阻断 |
| `SYS_IB_FALLBACK` | IB | 只有公共题 | `SYSTEM_BANK_PENDING`；无 IB 专属结论；允许通用 ASKWISE handoff（证据足够时） |
| `SYS_OTHER_FALLBACK` | OTHER | 只有公共题 | `SYSTEM_BANK_PENDING`；不映射为五体系；允许通用学习支持 |
| `SYS_UNKNOWN_INVALID` | unknown code | `education_system=CAMBRIDGE_GENERIC` | 422；不得静默映射 IGCSE/A_LEVEL |

每个正式体系还必须有无效 fixture：缺必答体系题、非法 option、跨体系 subject code、切换体系后残留旧分支答案，预期均为明确拒绝或清除旧答案并生成审计事件。

## 4. 结果与路由边界 Persona

| Fixture ID | 输入 | 预期 | 禁止 |
|---|---|---|---|
| `RESPONDENT_PARENT_PROXY` | EGD01=`EXIT_NOT_STUDENT` | 保存草稿并退出；无结果、无订单 | 不得当成低意愿／低能力 |
| `STUDENT_DECLINES_AFTER_L1` | FP06=`NOT_WILLING` | L2=`NOT_RECOMMENDED`；无购买 CTA | 不强推付费或顾问 |
| `UNSURE_EVIDENCE` | 多项 `UNSURE/NOT_PROVIDED` | 相关结果 `UNKNOWN` | 不补猜、不调用 AI 造信号 |
| `SINGLE_SUBJECT_SELF_REPORT` | 仅 EGD09 指向一科 | Subject Focus=`NEEDS_VALIDATION` | 不标 SUPPORTED |
| `FAMILY_STUDENT_GOAL_CONFLICT` | FP03/FP07 与学生 EGD15/18 明显不同 | Level 3=`CONSIDER`，reason=`FAMILY_STUDENT_GOAL_MISALIGNMENT` | 不替任何一方下结论 |
| `PRESSURE_ONLY` | EGD17=`STRESS_AFFECTS_LEARNING`，无学习瓶颈证据 | 中性支持提示；ASKWISE/Level3 不因该信号触发 | 不诊断、不恐吓、不商业强推 |
| `PATHWAY_CONTEXT_ONLY` | EGD19=`HONG_KONG_ASSOCIATE_DEGREE` | 保存为学生“正在考虑”的背景；不改变 education_system、题库、评分或 ASKWISE mode | 不自动判断学历认可、适合性或录取 |
| `MULTI_PATHWAY_USER_REQUESTS_COMPARISON` | EGD19 选择两个 pathway 且 EGD18=`PATH_CONSULTATION` | Level 3=`CONSIDER`，reason=`MULTI_PATHWAY_COMPARISON_REQUESTED` | 仅多选路径但未请求比较时不得自动触发 |
| `LEGACY_V1_READ_ONLY` | 历史 assessment/report/order | 原样可读 | 不回填新题库、不授予新 SKU 权益 |

## 5. ASKWISE 幂等与失败测试

| Test ID | 操作 | 预期 |
|---|---|---|
| `AW_NO_CONSENT` | 无有效 consent bundle 发起 handoff | 403 `EC_CONSENT_REQUIRED`；零外发、零 session |
| `AW_REPLAY_SAME_PAYLOAD` | 相同 key/digest 重复提交 | 200 原 session/task；`idempotent_replay=true` |
| `AW_REPLAY_DIFFERENT_PAYLOAD` | 相同 key、不同 digest | 409 `EC_DUPLICATE_REQUEST`；不创建新记录 |
| `AW_CROSS_FAMILY` | owner/family/student 不一致 | 拒绝；不泄露记录是否存在 |
| `AW_IDMAP_MISSING` | 无 report/student 映射 | `EC_IDMAP_MISSING`；人工修复任务 |
| `AW_SESSION_FAILURE_RETRY` | 可重试 503 | 同 key bounded retry；最终成功或 dead-letter |
| `AW_WRITEBACK_OUT_OF_ORDER` | event_sequence 旧于当前 | 忽略旧事件并审计；状态不回退 |
| `AW_EXIT_AND_RESUME` | task `EXITED_SAVED` 后恢复 | 返回同 task，进度保留 |
| `AW_NO_APPROVED_TEMPLATE` | mode 已选但内容包缺失 | `AW_TASK_CREATE_FAILED`；不让 LLM 临时编题 |

## 6. Aoyu 状态与降级测试

- 由真实 ASKWISE event 分别触发 `WELCOME / FOCUS / WAITING / HINT / ENCOURAGE / CELEBRATE / SAFE_ERROR`；预览页手动轮播不能代替事件测试。
- 默认静音；未点击不播放；点击后有音频或同步字幕；支持重播。
- `AOYU_AUDIO_UNAVAILABLE`：字幕流程继续，task 状态不变。
- `AOYU_ASSET_MISSING`：批准的静态 fallback／文字流程继续；若没有批准 fallback，标 `BLOCKED_EXTERNAL`。
- Hint 1–3 不含答案；FAILED 文案不责怪学生；完成状态只做轻庆祝。

## 7. 商业、Agent、飞书负向测试

- locked response、PDF、Timeline、Agent、飞书、日志和 error 均零六项结果泄露。
- 旧 `COMPASS_REPORT_SINGLE_39_9` 权益不能打开新报告；新 SKU 也不能打开旧六模块报告。
- 无 `AI_ANALYSIS` opt-in：核心结果正常，Agent 不运行。
- 无 `FEISHU_PROFILE_MIRROR` opt-in：Profile/Assessment 不入 outbox；环境开关不能绕过。
- 飞书 payload 只含冻结 allowlist；raw answers、signals、Agent、支付、openid、ASKWISE 过程正文出现即 FAIL。
- Consent 撤回后，未发送 outbox 被取消，已发第三方进入删除／最小化 SOP。

## 8. UAT 证据清单

```yaml
required_evidence:
  - repository_path
  - branch
  - full_commit_sha
  - freeze_manifest_sha256
  - build_command_and_exit_code
  - test_command_discovered_executed_pass_fail
  - redacted_request_response_samples
  - idempotency_and_failure_retry_evidence
  - seven_event_driven_aoyu_state_capture
  - ios_or_android_mobile_recording
  - accessibility_check
  - p0_p1_p2_issue_register
  - founder_go_record_for_real_students
status_enum: [PASS, FAIL, BLOCKED_EXTERNAL, BLOCKED_MANUAL, NOT_RUN]
```

当前没有真实 ASKWISE repo/API、Git branch/commit 或 Aoyu assets，因此相应项应保持 `BLOCKED_EXTERNAL / NOT_RUN`；本文不写虚假结果。
