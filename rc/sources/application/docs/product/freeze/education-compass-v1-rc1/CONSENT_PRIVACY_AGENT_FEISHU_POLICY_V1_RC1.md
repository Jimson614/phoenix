# Consent, Privacy, Agent & Feishu Policy V1 RC1

> 产品策略状态：`FROZEN_BY_PRODUCT_MANIFEST`；隐私／未成年人专业审核为 `PENDING`，真实学生使用为 `NOT_AUTHORIZED`。  
> 版本：`education_compass_consent_privacy_v1.0.0-rc1`

## 1. Consent 不得捆绑

| Scope code | 版本 | 主体 | 是否为相应功能前置 | 用途 |
|---|---|---|---|---|
| `CORE_ASSESSMENT` | `guardian_core_assessment_v1.0.0-rc1` | 家长／监护人 | Level 1 必需 | 建档、保存和生成家庭教育快照 |
| `STUDENT_ASSESSMENT_ASSENT` | `student_assent_growth_discovery_v1.0.0-rc1` | 学生 | Level 2 必需 | 学生本人自愿完成测评并生成结果 |
| `ASKWISE_HANDOFF` | `askwise_handoff_opt_in_v1.0.0-rc1` | 学生；未成年另需监护人 | ASKWISE 必需 | 将最小结构化学习信号发送给 ASKWISE 并接收状态摘要 |
| `AI_ANALYSIS` | `agent_analysis_opt_in_v1.0.0-rc1` | 学生；未成年另需监护人 | OpenAI 分析必需 | 对已生成的结构化结果作解释；不决定核心结果 |
| `FEISHU_PROFILE_MIRROR` | `feishu_profile_mirror_opt_in_v1.0.0-rc1` | 家长／监护人；成年学生本人 | 飞书资料镜像必需 | 把明确白名单中的客户资料同步到凤启运营表 |
| `ADVISOR_CONTACT` | `advisor_contact_opt_in_v1.0.0-rc1` | 家长／监护人或成年学生 | 顾问联系必需 | 顾问查看最小摘要并联系 |
| `MARKETING_CONTACT` | `marketing_contact_opt_in_v1.0.0-rc1` | 联系方式所有人 | 营销必需 | 非服务必要的营销触达；默认关闭 |

- 每个 scope 单独显示、单独同意、单独撤回，不能用环境变量、总开关或支付行为代替用户同意。
- 每条 grant 保存 `consent_grant_id / subject_id / subject_role / scope / copy_version / granted_at / withdrawn_at / source_entry / audit_metadata`。
- 对外 handoff 使用 `consent_bundle_id`；bundle 必须能解析到当时有效的学生 assent 与监护人 ASKWISE consent，不能只存一个布尔值。

## 2. 年龄／监护矩阵

```yaml
minor_or_guardianship_required:
  required: [guardian_consent, student_assent]
adult_student:
  required: [student_consent]
age_or_guardianship_unknown:
  required: [guardian_consent, student_assent]
student_refusal:
  overrides_guardian: true
  behavior: EXIT_WITHOUT_NEGATIVE_SIGNAL_OR_PURCHASE
```

年龄／监护状态来自受控 Profile，不在问卷自由文本收集。未经合规负责人确认的年龄判断不得放宽双授权要求。

## 3. 固定展示文案

监护人核心同意：

> 我已了解本测评用于形成教育成长快照与下一步支持建议。我确认有权为该家庭／未成年学生管理必要资料，并同意系统按隐私说明保存版本化问卷与结果。我可以撤回非必要授权；撤回不会被解释为学生能力或意愿不足。

学生 assent：

> 这份测评需要由我本人作答。我知道可以暂停、退出或不回答选填成绩区间，也不会因此得到负面评价。我同意系统用本次回答生成成长快照；如果不愿继续，我可以现在退出。

ASKWISE 同意：

> 我同意将本报告中最小必要的学科重点、学习瓶颈、结构化学习信号与建议重点发送给 ASKWISE，用于创建一次学习支持 Session 和首个任务，并把任务状态与最小结果摘要返回 Phoenix。不会发送姓名、电话、学校、地址、支付资料、原始问卷答案或聊天全文。

AI 分析同意：

> 我同意将去标识化的结构化测评结果发送给受控 AI 服务作解释。AI 不会决定核心结果，也不得生成诊断、排名、录取概率或无来源事实。我可以不启用或之后撤回该功能。

飞书资料镜像同意：

> 我同意将下方列明的客户资料同步到凤启受控的飞书多维表格，用于运营与顾问跟进。问卷原始答案、学习过程全文、支付资料和证件资料不会同步；我可以申请撤回和停止后续同步。

顾问联系同意：

> 我同意授权的凤启顾问查看必要摘要并就我选择的教育支持联系我。顾问不能修改测评规则，也不能查看未授权的原始作答或学习过程全文。

## 4. 撤回语义

- 撤回后立即阻止新的 Agent、飞书、ASKWISE 或顾问 outbox enqueue/claim/retry。
- 已排队但未发送的记录标记 `CANCELLED_BY_CONSENT_WITHDRAWAL`。
- ASKWISE：停止新任务和新写回；保留最小审计；向对方发出删除／最小化请求。候选 SLA 为核验请求后 30 天，最终以隐私负责人签署值为准。
- 飞书：停止新增／更新；按受控 SOP 删除或最小化远端非必要字段。候选 SLA 为核验请求后 30 天，删除失败必须进入人工任务和审计。
- OpenAI／Agent：撤回不回写历史分析正文；删除本地非必要缓存与待执行任务，保留必要安全审计。
- 财务、退款、安全与授权审计按适用政策最小保留；不得用“审计”名义保存原始答案或聊天全文。

## 5. OpenAI Agent 数据合同

核心报告必须由确定性规则先生成；Agent 只可读取：

```text
assessment_id (pseudonymous)
report_id (pseudonymous)
assessment_level
education_system
grade_stage
structured result sections
signal codes + status + evidence question IDs
recommended_focus
report/rule/prompt/template versions
```

禁止出站：姓名、电话、微信 OpenID、学校、地址、出生日期、证件号、支付／订单资料、家庭收入或预算、原始自由文本、原始整份答案、文件、ASKWISE 过程全文。Prompt 与响应使用严格 schema、限长、去标识、内容审查和版本记录；普通日志不得保存正文。Agent 失败不得阻断核心结果查看。

## 6. 飞书角色与字段白名单

- 生产事实源为 PostgreSQL；飞书是可关闭、单向、Consent-gated 的运营镜像，不是交易或测评事实源。
- 旧资料中的“飞书主数据底座／前端直写飞书”属于历史方案，不适用于当前原生小程序后端。

允许的 `CUSTOMER_PROFILE` 字段：

```text
family_id
student_id
family_display_name
student_display_name
guardian_display_name
guardian_phone
city_region
education_system
grade_stage
source_entry
advisor_status
consent_state
updated_at
```

其中 display name、guardian phone 和 city region 只有 `FEISHU_PROFILE_MIRROR` 有效时才可同步；手机号必须在权限受控的专用表中，不得复制到 assessment／report 表。

允许的 `ASSESSMENT_OPERATIONS` 字段：

```text
assessment_id
family_id
student_id
assessment_level
assessment_status
report_id
report_status
product_code
entitlement_status
source_entry
updated_at
```

允许的 `ASKWISE_OPERATIONS` 字段：

```text
student_id
assessment_id
askwise_session_id
first_task_id
learning_mode
task_status
next_action_code
error_code
updated_at
```

禁止镜像：微信 OpenID、证件号、精确地址、出生日期、医疗资料、精确成绩／位次、文件、原始问卷 answers、自由文本、六项报告正文、evidence 详情、Agent prompt/response、ASKWISE task 内容／聊天／提示轨迹、交易号、支付回调或银行卡资料。

## 7. 访问与审计

- 顾问、运营、管理员按最小权限和服务关系访问；撤回或服务终止后立即收缩。
- 敏感读取、导出、修改、Consent、顾问访问和管理操作可追溯。
- 日志只保存事件代码、版本、结果、脱敏关联 ID 和时间；不保存正文或 secret。
- 真实学生启用前，隐私／未成年人负责人必须在 `CONTENT_REVIEW_AND_SIGNATURE_RECORD_V1_RC1.md` 对文案、SLA、飞书字段和第三方处理方逐项签字。
