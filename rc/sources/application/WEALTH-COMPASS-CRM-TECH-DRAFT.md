# Wealth Compass API 与 CRM 技术草案（Draft）

状态：`DRAFT — JIMMY REVIEW REQUIRED`（本草案用于今晚评审，暂不落生产连接）

## 1. 范围与约束（先行结论）

1. 不连接真实飞书 API，不创建正式数据库表，不写入客户资料。
2. 只定义接口与数据结构、Mock 流程、幂等和错误码。
3. 仅在后端返回脱敏/匿名化字段；如需接触客户资料，必须经过 Jimmy 决策并补充法务与隐私签批。
4. 默认采用 `application/json`、UTC `ISO 8601` 时间戳（`YYYY-MM-DDTHH:mm:ss.sssZ`）。

## 2. 版本与通用 Envelope

- API 版本：`wc-api-v1.0`
- 统一 envelope：

```json
{
  "api_version": "wc-api-v1.0",
  "request_id": "req_01H...",
  "trace_id": "trc_...",
  "issued_at": "2026-08-24T10:00:00.000Z",
  "idempotency_key": "idem_...",
  "data": {}
}
```

响应中统一返回：

```json
{
  "ok": true,
  "code": "success",
  "message": "OK",
  "data": {},
  "request_id": "req_01H..."
}
```

## 3.  Assessment Input / Output Schema

### 3.1 Assessment Input（提交到评分入口）

用于 `/assessment/submit`（可复用当前 AssessmentForm 数据结构，先保留 7 字段模型）。

```ts
type AssessmentInput = {
  schema_version: "wc-assessment-input-v1.0";
  assessment_version: "wc-free-v1.0" | "wc-pro-v1.0";
  locale: "zh-CN" | "en-US";

  // 只允许脱敏问卷字段，不包括姓名/手机号/邮箱等 PII
  age_band: "under_6" | "6_8" | "9_11" | "12_14" | "15_18" | "over_18";
  grade_band: "preschool" | "primary_1_3" | "primary_4_6" | "junior_secondary" | "senior_secondary" | "tertiary" | "other";
  location: "mainland_china" | "hong_kong" | "macau" | "overseas" | "other";
  identity_status: "mainland_resident" | "hk_permanent" | "hk_non_permanent" | "macau_or_overseas" | "multiple" | "prefer_not_to_say";
  curriculum: "mainland" | "dse" | "ib" | "a_level" | "btec" | "other";
  interests: Array<"technology" | "art" | "business" | "education" | "health" | "exploring">; // 1–2 且 exploring 互斥
  family_goal: "discover_strengths" | "education_direction" | "career_exploration" | "global_path" | "family_communication" | "unsure";

  context: {
    started_at: string;
    completed_at: string;
    device: "mobile" | "desktop";
    source_page: "/assessment";
    session_id: string; // 前端每次会话生成
  };

  consent_reference: {
    consent_id: string; // 对应 Consent Record 的 ID
    consent_version: "wc-consent-v1.0";
    granted_at: string;
  };
};
```

校验规则：
- `interests` 长度 1–2；如含 `exploring`，仅允许长度 1
- 未声明字段（包括个人身份信息）一律拒绝
- 时间顺序检查：`completed_at >= started_at`

### 3.2 Assessment Output（提交流程返回）

用于 `/assessment/submit` 成功返回（立即返回，后续走异步报告）。

```json
{
  "assessment_id": "asmt_01H...",
  "submission_id": "sub_01H...",
  "report_job_id": "job_01H...",
  "status": "queued",
  "idempotency_state": "accepted",
  "estimated_ready_at": "2026-08-24T10:00:05.000Z",
  "result_preview": {
    "risk_level": "low",
    "confidence_bucket": "medium"
  },
  "links": {
    "self": "/api/v1/wealth-compass/assessments/asmt_01H...",
    "result": "/api/v1/wealth-compass/reports/score/by-submission/sub_01H..."
  }
}
```

字段说明：
- `status`: `queued | processing | done | failed`
- `idempotency_state`: `accepted | replayed | rejected`

## 4. Score Result Schema

用于 `/api/v1/wealth-compass/reports/score/{submission_id}` 查询或推送给 CRM。

```ts
type ScoreResult = {
  schema_version: "wc-score-result-v1.0";
  result_id: "scr_01H...";
  assessment_id: "asmt_01H...";
  submission_id: "sub_01H...";
  generated_at: string;
  generation_mode: "ai" | "rule" | "fallback";
  risk_profile: "low" | "medium" | "high_attention";
  dimensions: Array<{
    key: "interest_signal" | "family_alignment" | "readiness" | "follow_through";
    score: number;            // 0~100
    label: "低" | "中" | "高";
    rationale: string;        // 受控文本，最长 120 字
  }>;
  summary: {
    headline: string;         // 1 句短标题
    body: string;             // 80~180 字
  };
  strength_signals: Array<{ title: string; evidence: string }>; // 3 条
  possible_directions: Array<{
    title: string;
    reason: string;
    micro_action: string;
    priority: "high" | "medium" | "low";
  }>;
  today_action: string;
  disclaimer: string;
  validation: {
    schema_ok: true;
    schema_version: "wc-score-result-v1.0";
  };
};
```

## 5. Consent Record Schema

用于 `/consents` 与 CRM 归档。

```ts
type ConsentRecord = {
  schema_version: "wc-consent-v1.0";
  consent_id: "cns_01H...";
  subject_type: "minor" | "guardian";
  subject_ref: {
    // 不存储明文客户资料；如需关联，暂存脱敏 token
    pseudonym_id: "ph_...";
    subject_bucket: "guardian" | "household" | "anonymous_session";
  };
  channel: "web" | "embedded_form" | "api";
  policy_refs: {
    privacy_notice_version: "pn-v1.0";
    marketing_notice_version?: "mn-v1.0";
  };
  scopes: {
    assessment_scoring: true;
    analytics: true;
    crm_reporting: false;
    referral: false;
  };
  granted: boolean;
  granted_at: string;
  expires_at?: string;
  revocation: {
    revoked: boolean;
    revoked_at?: string;
    reason?: string;
  };
  audit: {
    consent_ip_hash: string;         // 仅 IP Hash，非明文
    user_agent_hash: string;
    recorded_by: "frontend" | "admin";
  };
};
```

## 6. Report Job Schema

用于异步队列状态追踪（适合先做 `mock queue`）。

```ts
type ReportJob = {
  schema_version: "wc-report-job-v1.0";
  job_id: "job_01H...";
  submission_id: "sub_01H...";
  report_type: "growth_snapshot" | "wealth_profile_preview";
  state: "queued" | "in_progress" | "completed" | "failed" | "cancelled" | "retrying";
  created_at: string;
  updated_at: string;
  attempt: number;
  max_attempts: 2;
  progress: 0 | 25 | 50 | 75 | 100;
  result_id?: "scr_01H...";
  output_path?: {
    type: "pdf" | "json" | "url";
    ref: string;
  };
  failure?: {
    code: string;
    message: string;
    retriable: boolean;
    last_seen_at: string;
  };
};
```

## 7. Referral Request Schema

用于用户请求顾问跟进 / 转介（需 Consent 才允许提交）。

```ts
type ReferralRequest = {
  schema_version: "wc-referral-v1.0";
  referral_id: "rf_01H...";
  source: {
    assessment_id: "asmt_01H...";
    submission_id: "sub_01H...";
    report_job_id: "job_01H...";
  };
  consent_id: "cns_01H...";

  requester: {
    // 约束：暂不落真实客户资料
    contact_channel_token?: {
      phone_hash?: "sha256:...",
      email_hash?: "sha256:..."
    };
    contact_preference: "wechat" | "phone" | "email" | "wechat+phone";
    locale: "zh-CN";
  };

  payload: {
    urgency: "normal" | "high";
    reason: "followup" | "advice" | "review" | "report_delivery";
    notes?: string; // <= 300 字
  };

  status: "requested" | "accepted" | "contacted" | "closed" | "rejected";
  created_at: string;
  updated_at: string;
};
```

## 8. 错误码（Draft）

| HTTP | code | 语义 | 重试 |
|---|---|---|---|
| 400 | `WC_INVALID_INPUT` | 输入参数不合法（schema 校验失败） | 否 |
| 400 | `WC_INVALID_INTERESTS_RULE` | 兴趣字段规则不满足（长度/互斥） | 否 |
| 401 | `WC_NOT_AUTHORIZED` | 无权访问/签名缺失 | 否 |
| 403 | `WC_CONSENT_REQUIRED` | 该动作需有效 Consent | 否 |
| 404 | `WC_RESOURCE_NOT_FOUND` | 资源不存在 | 否 |
| 409 | `WC_DUPLICATE_SUBMISSION` | 幂等键已存在且请求体冲突 | 否 |
| 409 | `WC_CONFLICTED_REPLAY` | 幂等重复但参数变化 | 否（建议告警） |
| 409 | `WC_JOB_ALREADY_DONE` | 报告已完成且不允许覆盖 | 否 |
| 429 | `WC_RATE_LIMITED` | 请求频率超限 | 是（建议退避） |
| 500 | `WC_INTERNAL_ERROR` | 服务器异常 | 是 |
| 503 | `WC_DEPENDENCY_UNAVAILABLE` | AI/外部服务不可用（mock 模式时不应触发） | 是 |
| 503 | `WC_MOCK_ONLY` | 当前运行在 Mock 模式，生产链路已禁用 | 是（切换后重试） |

## 9. 幂等键与防重复提交策略

### 9.1 幂等键定义

- 统一请求头：`Idempotency-Key`（必填）
- 若缺失则生成 `generated` 并标记为 `rejected`
- 幂等键作用域：按端点单独计算
- 建议格式：`wc-{tenant}-{date}-{random}`（可被 `sha256`）

### 9.2 幂等规则

- `/assessment/submit`：`tenant + submission_fingerprint` 唯一
- `/consents`：按 `subject_ref.pseudonym_id + scope_set + consent_version` 去重
- `/reports/{submission_id}/result` 以 `submission_id` 作为幂等主键
- `/referrals`：`subject_token + assessment_id + reason` 去重

### 9.3 允许的重放策略

- 同一 `Idempotency-Key` + 相同 payload：返回同一 `submission_id`，`idempotency_state: replayed`
- 同一 `Idempotency-Key` + 不同 payload：返回 `409 WC_CONFLICTED_REPLAY`

## 10. Mock API（草案）

以下接口用于今晚本地联调（无外部飞书、无正式数据库）：

### 10.1 提交问卷

- `POST /api/v1/wealth-compass/assessment/submit`
- `Idempotency-Key` 必填
- 202 级响应，返回 `status: queued` 与 `submission_id`
- 将结果写入内存队列（`Map`），并返回 `report_job_id`

### 10.2 查询提交状态

- `GET /api/v1/wealth-compass/assessments/{assessment_id}`
- 允许在无真实数据库场景返回 mock 结果：
  - `queued/processing` 自动跳到 `completed`（可配置延迟）
  - `completed` 返回 `result_id`

### 10.3 查询评分结果

- `GET /api/v1/wealth-compass/reports/score/{submission_id}`
- 若已完成返回 `ScoreResult`
- 未完成返回 `{ status: "processing", progress: 75 }`

### 10.4 同步 Consent

- `POST /api/v1/wealth-compass/consents`
- 返回 `consent_id` 与 `granted` 状态

### 10.5 查询/提交通知

- `POST /api/v1/wealth-compass/referrals`
- `GET /api/v1/wealth-compass/referrals/{referral_id}`

### 10.6 Mock 开关

- 环境变量（建议）：
  - `WEALTH_COMPASS_MOCK_MODE=true`
  - `WEALTH_COMPASS_MOCK_DELAY_MS=1200`
  - `WEALTH_COMPASS_MOCK_FORCE_AI_FAIL=true|false`
- Mock 模式下返回 `WC_MOCK_ONLY` 以外不应对外抛错（保持可复现）

### 10.7 示例（提交评估）

```http
POST /api/v1/wealth-compass/assessment/submit
Idempotency-Key: idem_wc_01h...
Content-Type: application/json

{
  "api_version": "wc-api-v1.0",
  "request_id": "req_01h...",
  "trace_id": "trc_01h...",
  "idempotency_key": "idem_wc_01h...",
  "data": {
    "schema_version": "wc-assessment-input-v1.0",
    "assessment_version": "wc-free-v1.0",
    "locale": "zh-CN",
    "age_band": "15_18",
    "grade_band": "senior_secondary",
    "location": "hong_kong",
    "identity_status": "prefer_not_to_say",
    "curriculum": "dse",
    "interests": ["technology", "business"],
    "family_goal": "education_direction",
    "context": {
      "started_at": "2026-08-24T10:00:00.000Z",
      "completed_at": "2026-08-24T10:00:28.000Z",
      "device": "mobile",
      "source_page": "/assessment",
      "session_id": "sess_01h..."
    },
    "consent_reference": {
      "consent_id": "cns_01h...",
      "consent_version": "wc-consent-v1.0",
      "granted_at": "2026-08-24T10:00:00.000Z"
    }
  }
}
```

示例成功返回：

```json
{
  "ok": true,
  "code": "success",
  "message": "accepted",
  "request_id": "req_01h...",
  "data": {
    "assessment_id": "asmt_01h...",
    "submission_id": "sub_01h...",
    "report_job_id": "job_01h...",
    "status": "queued",
    "idempotency_state": "accepted",
    "estimated_ready_at": "2026-08-24T10:00:05.000Z",
    "links": {
      "self": "/api/v1/wealth-compass/assessments/asmt_01h...",
      "result": "/api/v1/wealth-compass/reports/score/by-submission/sub_01h..."
    }
  }
}
```

## 11. 8 张 CRM 表候选映射（Mock 可先建内存表）

> 命名示例（候选）：`crm_wcompass_*`。  
> 所有表默认不存明文客户资料，默认仅存 `pseudonym_id` 与 `hash` 字段。

1. `crm_wcompass_leads`
   - `lead_id` ← `subject_ref.pseudonym_id`
   - `lead_bucket` ← `subject_ref.subject_bucket`
   - `tenant` ← 环境/租户编码
   - `created_at` ← `issued_at`
   - `last_activity_at` ← 最近一次 `assessment` 或 `referral` 时间
   - `status` ← 新建/跟进中/已关闭

2. `crm_wcompass_consents`
   - `consent_id` ← `consent_id`
   - `subject_ref` ← `pseudonym_id`
   - `scopes.assessment_scoring`
   - `scopes.analytics`
   - `scopes.crm_reporting`
   - `granted`, `granted_at`, `revoked`, `revoked_at`

3. `crm_wcompass_assessments`
   - `assessment_id`
   - `submission_id`
   - `consent_id`
   - `assessment_version`
   - `status`（对应 Output `status`）
   - `completed_at`

4. `crm_wcompass_assessment_answers`
   - `assessment_id`
   - `age_band`、`grade_band`、`location`、`identity_status`、`curriculum`
   - `interests`（数组或 JSON）
   - `family_goal`
   - `response_version`

5. `crm_wcompass_report_jobs`
   - `job_id`
   - `submission_id`
   - `report_type`
   - `state`、`attempt`、`progress`
   - `result_id`
   - `failure_code`

6. `crm_wcompass_score_results`
   - `result_id`
   - `submission_id`
   - `generation_mode`
   - `risk_profile`
   - `dimensions`（JSON）
   - `summary_headline`、`summary_body`
   - `generated_at`

7. `crm_wcompass_referrals`
   - `referral_id`
   - `submission_id`
   - `consent_id`
   - `reason`
   - `urgency`
   - `status`
   - `requester_contact_tokens`

8. `crm_wcompass_events`
   - `event_id`
   - `event_type`（submit/consent/referral/report_ready）
   - `request_id`
   - `trace_id`
   - `created_at`
   - `request_payload_hash`
   - `result_code`

## 12. 关键决策点（需 Jimmy 复核）

1. 是否允许 `subject_ref.pseudonym_id` 以匿名会话 ID 维持还是落“家庭聚合 ID”。  
2. Referral 是否需要落实名联系方式（暂不在草案中）。  
3. `risk_profile` 字段是否保留/更名（影响飞书可视化分层）。  
4. CRM 采用“仅 8 张最小表”还是按业务拆表（咨询、事件、报告）到 12+ 张。  
5. 是否将 `report` 结果作为附件存储（PDF）还是 JSON-only。

以上为今晚版本，等待 Jimmy 做最终决策后可转为 `v1.0.0` 生产 draft。
