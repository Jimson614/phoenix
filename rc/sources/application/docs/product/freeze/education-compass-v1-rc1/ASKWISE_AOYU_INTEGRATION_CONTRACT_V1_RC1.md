# Education Compass → ASKWISE → Aoyu Integration Contract V1 RC1

> 产品合同状态：`FROZEN_BY_PRODUCT_MANIFEST`；运行激活为 `DISABLED_BLOCKED_EXTERNAL`。  
> 合同版本：`education_support_handoff_v1.0.0-rc1`  
> Scope 来源：2026-08-24 Founder 五日闭环决定；来源只批准集成方向，原文合同仍写“Review 后冻结”。

## 1. 权威与边界

```yaml
product_scope_authority: HANDOFF_SESSION_FIRST_TASK_AOYU_WRITEBACK
runtime_activation_status: DISABLED_BLOCKED_EXTERNAL
external_or_staging_execution_requires_separate_authorization: true
production_student_use_requires_founder_go: true
five_day_uat_payment_scope: EXCLUDED
```

当前仓库未发现 ASKWISE 实现仓库、API endpoint/Auth、真实 CRM connector 或鳌鱼资产。本文只冻结产品级合同，不证明已接通，也不授权连接外部系统或使用真实学生资料。

产品职责：

- Education Compass：生成经确定性规则支持的结构化学习信号、展示触发理由并取得授权。
- ASKWISE：唯一 Learning Engine；创建 Session、选择 `RECALL / TEACH / THINKING / TRANSFER / DEBUG`、从已审核模板生成 First Task、返回状态与最小摘要。
- Aoyu：纯事件驱动的视觉／点击语音表现层；不诊断、不选择 mode／task、不生成答案、不绕过 ASKWISE。
- Phoenix/CRM：只保存与展示最小状态摘要；不保存任务全文、聊天全文、Hint 轨迹或内部推理。

## 2. Compass → ASKWISE Request

```yaml
contract_version: education_support_handoff_v1.0.0-rc1
handoff_type: ASKWISE_LEARNING_SUPPORT
family_id: string, required
student_id: string, required
assessment_id: string, required
report_id: string, required
assessment_level: LEVEL_2
education_system: GAOKAO | DSE | IGCSE | A_LEVEL | AP_US | IB | OTHER
grade_stage: canonical code
subject_focus:
  - subject_code: canonical code
    status: SUPPORTED | NEEDS_VALIDATION
    reason_codes: [string]
    evidence_refs: [question_id]
learning_bottleneck:
  - code: canonical code
    status: SUPPORTED
    evidence_refs: [question_id]
learning_signals:
  - code: canonical code
    dimension: ACADEMIC_PERFORMANCE | LEARNING_PROCESS | THINKING_LEARNING_STYLE | INTEREST_DIRECTION
    status: SUPPORTED | NEEDS_VALIDATION | UNKNOWN
    evidence_refs: [question_id]
recommended_focus: [canonical code]
interest_signals:
  - code: canonical code
    status: SUPPORTED | NEEDS_VALIDATION
    evidence_refs: [question_id]
report_version: student_growth_discovery_report_v1.0.0
consent_bundle_id: string, required
source_entry: canonical code
idempotency_key: opaque string, required
```

限制：`subject_focus` 最多 3 项、`learning_bottleneck` 最多 3 项、`learning_signals` 最多 12 项、`recommended_focus` 最多 5 项、`interest_signals` 最多 2 项；数组不得含姓名或自由文本。IB／OTHER 仅允许通用学习任务，必须携带 `SYSTEM_BANK_PENDING` 上下文，禁止体系专属解释。

禁止出站：姓名、电话、学校、地址、生日、证件号、微信 OpenID、支付／订单资料、精确成绩、原始问卷答案、自由文本、Agent prompt/response、家长观察原文、顾问记录，以及 `education_pathway_target_codes`（或任何同义／旧版 pathway 字段）。学历路径属于后续教育路径背景，不是 ASKWISE 学习任务输入。

## 3. ASKWISE → Compass / CRM Writeback

```yaml
contract_version: education_support_writeback_v1.0.0-rc1
askwise_session_id: string
first_task_id: string
learning_mode: RECALL | TEACH | THINKING | TRANSFER | DEBUG
session_status: CREATED | READY | STARTED | PAUSED | COMPLETED | FAILED | NEXT_ACTION_READY
task_status: CREATED | READY | STARTED | WAITING_INPUT | HINT_AVAILABLE | PAUSED | COMPLETED | FAILED | EXITED_SAVED
started_at: ISO-8601 with timezone | null
completed_at: ISO-8601 with timezone | null
outcome:
  code: TASK_COMPLETED | TASK_PAUSED | TASK_EXITED_SAVED | TASK_FAILED | NO_OUTCOME
  safe_summary: string max 280 | null
next_action:
  code: CONTINUE_TASK | RETRY_LATER | REVIEW_COMPLETED_TASK | START_NEXT_TASK | CONTACT_SUPPORT | NONE
  available_at: ISO-8601 with timezone | null
error_code: frozen error code | null
updated_at: ISO-8601 with timezone
event_id: globally unique string
event_sequence: positive integer
```

`safe_summary` 只能描述是否完成、使用的支持模式和下一步；不得包含学习过程原文、完整答案、诊断标签或内部推理。

## 4. ID 映射与幂等

- Phoenix 保存 `family_id / student_id / assessment_id / report_id ↔ askwise_session_id / first_task_id` 映射；不重复创建学生。
- 幂等自然键：`student_id + assessment_id + report_version + contract_version + handoff_type`。
- `idempotency_key` 由服务端对规范化自然键生成 opaque HMAC；不得把原 ID 直接暴露在 key 中。
- 数据库对自然键和 idempotency key 建唯一约束。
- 同 key、同 payload digest 的重复请求返回 `200` 与原 session/task，`idempotent_replay=true`；这不是错误。
- 同 key、不同 payload digest 返回 `409 EC_DUPLICATE_REQUEST`，不得创建第二个 session/task。
- 网络超时重试必须复用同一 key；禁止客户端自行随机换 key。

## 5. 状态机

Session 合法转换：

```text
CREATED → READY → STARTED → PAUSED → STARTED
                         ├→ COMPLETED → NEXT_ACTION_READY
                         └→ FAILED
```

Task 合法转换：

```text
CREATED → READY → STARTED → WAITING_INPUT ↔ HINT_AVAILABLE
                         ├→ PAUSED → STARTED
                         ├→ EXITED_SAVED → STARTED
                         ├→ COMPLETED
                         └→ FAILED
```

- 乱序或重复 event 由 `event_sequence + event_id` 去重；旧序号不能覆盖新状态。
- `EXITED_SAVED` 表示可恢复，不是失败。
- Aoyu asset/audio 故障只生成可降级 warning，不得把 ASKWISE task 标为 FAILED。

## 6. Error Catalog

| Code | HTTP/类别 | 是否重试 | 语义 |
|---|---|---|---|
| `EC_INCOMPLETE_INPUT` | 422 | 否 | 缺必填结构化字段 |
| `EC_INVALID_FORMAT` | 422 | 否 | enum、长度或 schema 无效 |
| `EC_IDMAP_MISSING` | 409 | 人工修复后 | ID 所有权／映射缺失 |
| `EC_CONSENT_REQUIRED` | 403 | 取得新同意后 | Consent 缺失、过期或已撤回 |
| `EC_DUPLICATE_REQUEST` | 409 | 否 | 同幂等键但 payload 不同；相同重复请求应 200 replay |
| `AW_SESSION_CREATE_FAILED` | 502/503 | 是 | ASKWISE session 创建失败 |
| `AW_TASK_CREATE_FAILED` | 422/502 | 视原因 | 无批准模板或任务创建失败 |
| `AW_STATUS_WRITEBACK_FAILED` | 502/503 | 是 | 状态回写失败，进入 outbox |
| `AOYU_ASSET_MISSING` | warning | 否 | 使用文字／安全静态图降级，不中断任务 |
| `AOYU_AUDIO_UNAVAILABLE` | warning | 否 | 使用字幕继续，不中断任务 |

重试采用 bounded exponential backoff、最大次数和死信人工任务；日志只记 code、attempt、脱敏 ID 和时间。

## 7. Learning Mode 与 First Task

按以下优先级选择首个 mode；每项必须由冻结 evidence refs 支持：

1. `FOUNDATION_GAP` → `TEACH`
2. `NO_FIRST_STEP / PROBLEM_DECOMPOSITION_GAP` → `THINKING`
3. `KNOWS_BUT_CANNOT_APPLY / KNOWLEDGE_TRANSFER_GAP` → `TRANSFER`
4. `REPEATED_ERROR_PATTERN / ERROR_REVIEW_GAP` → `DEBUG`
5. `KNOWLEDGE_RETRIEVAL_GAP` → `RECALL`

同优先级冲突时返回 `NEEDS_TASK_REVIEW`，不得让 LLM 自行决定。First Task 必须来自版本化、教育内容负责人批准的模板包；没有批准模板时返回 `AW_TASK_CREATE_FAILED`，不能自动生成未经验证的教学内容。

五日 UAT 候选内容包：`askwise_first_task_synthetic_uat_v1.0.0-rc1`，仅合成题目，不可用于真实学生。生产内容包当前为 `MISSING / BLOCKED_EXTERNAL`。

## 8. Aoyu 状态映射

| ASKWISE event/state | Aoyu state | 行为 | 点击语音／字幕 |
|---|---|---|---|
| session `READY` | `WELCOME` | 现有母版轻微呼吸／眨眼 | 解释今天为何做此任务 |
| task `STARTED` | `FOCUS` | 专注陪伴 | 提醒先独立尝试 |
| task `WAITING_INPUT` | `WAITING` | 等待 | “想好再回答，不着急” |
| task `HINT_AVAILABLE`, level 1–3 | `HINT` | 指引 | 分层提示，不给答案 |
| task `PAUSED` / `EXITED_SAVED` | `ENCOURAGE` | 鼓励 | 可稍后继续，进度已保存 |
| task `COMPLETED` | `CELEBRATE` | 轻庆祝 | 总结完成内容与下一步 |
| technical failure | `SAFE_ERROR` | 安静等待 | 只说明保存／连接失败并建议重试 |

- 默认静音；只有用户点击后播放；始终有同义字幕与重播。
- 音频失败用文字继续；视觉资源失败用经批准的安全静态 fallback。
- 不做实时语音、自由聊天、长期记忆、答案生成或第二套 Learning Engine。
- 只能使用现有、已确认并有授权的鳌鱼母版／姿态；不得重画脸、眼睛、身体比例、角、鳍、颜色或风格。

## 9. Asset Manifest 闸门

```yaml
asset_manifest_status: BLOCKED_EXTERNAL
verified_asset_root: null
verified_png_or_sprite_paths: []
verified_motion_paths: []
verified_audio_paths: []
license_or_owner_evidence: null
asset_sha256: []
approved_static_fallback: null
```

当前工作区没有找到 ASKWISE/Aoyu 实现或鳌鱼资产。真实路径、格式、授权人与 SHA-256 补齐前，Day 3 只能标 `BLOCKED_EXTERNAL`；禁止生成替代形象冒充母版。

## 10. 五日集成 DoD

- 真实受控入口、冻结 payload、Consent gate、幂等 replay、First Task、7 个真实事件驱动状态、字幕／点击语音／文字降级、暂停／完成／失败／next action 写回均有证据。
- 三类 Persona 与负向测试全部 PASS；手机端无阻断；P0/P1 清零，P2 有 owner 和日期。
- Repository、branch、完整 commit SHA、构建／测试结果必须真实可复核。当前目录不是 Git 仓库时不得伪造。
- 只有 Founder 单独记录 `GO_FOR_CONTROLLED_STUDENT_USE` 后才可用于真实学生；Freeze 签署、代码完成或 UAT 通过三者不能互相替代。
