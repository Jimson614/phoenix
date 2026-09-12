# Phoenix Education Compass V0.5.0 API 示例

本文与 [`education-compass-v0.5.0.openapi.yaml`](./openapi/education-compass-v0.5.0.openapi.yaml) 一起使用。示例只描述 V0.5 的增量接口；V0.4.1 legacy 路由继续兼容，但不得把旧商品 `COMPASS_REPORT_SINGLE_39_9` 与新商品 `EDUCATION_GROWTH_DISCOVERY_SINGLE_V1` 混用。

## 1. 固定事实与安全边界

- 金额：`3990` 分（`¥39.90`），币种 `CNY`。
- 支付时点：`AFTER_SUBMIT_BEFORE_REPORT`。
- Level 2 只允许 `STUDENT` 本人作答，并要求版本化 student assent。
- 正式体系：`GAOKAO`、`DSE`、`IGCSE`、`A_LEVEL`、`AP_US`。
- fallback：`IB`、`OTHER`，只返回公共题，`systemResultMarker=SYSTEM_BANK_PENDING`。
- 评分：`NONE`。区间成绩题选填，不采集精确分数。
- 草稿以服务端 `revision` 为准；保存成功后 revision 自增。旧 revision 返回 `409 DRAFT_REVISION_STALE`。
- Level 2 提交后返回锁定元数据，不返回任何完整报告 section 或 `evidence_refs`。
- `wx.requestPayment` 的客户端成功回调不授予权益。小程序必须轮询订单/结果，最终以服务端验证的支付通知为准。
- OpenAI、飞书和微信支付密钥只属于后端。小程序包不得包含这些密钥，也不得直连外部服务。

## 2. 本地准备

服务地址示例：

```text
http://127.0.0.1:3000
```

除了 `/health`、登录和支付 webhook 外，所有接口都需要：

```http
Authorization: Bearer <accessToken>
Content-Type: application/json
```

创建测评、提交测评和创建订单还需要：

```http
Idempotency-Key: <8-128 个 A-Z/a-z/0-9/._:- 字符>
```

本地完整 mock 冒烟不需要配置任何真实外部账号：

```powershell
npm.cmd run smoke:education
```

脚本会监听随机 `127.0.0.1` 端口，并直接装配内存存储、Mock 微信登录和 Mock 支付；不会读取真实 OpenAI、飞书、微信支付或数据库配置。

## 3. 登录与档案前置

登录：

```http
POST /v1/auth/wechat/session

{"code":"wx.login 返回的一次性 code"}
```

本地 Mock 模式也使用同一接口，但 `code` 只作为合成身份输入。

创建/更新家庭：

```http
PUT /v1/me/family

{
  "familyName": "示例家庭",
  "parentName": "示例家长",
  "phone": "13900000000",
  "location": "示例地区",
  "goal": "了解学习现状与下一步"
}
```

创建学生：

```http
POST /v1/me/students

{
  "name": "示例学生",
  "age": 16,
  "educationSystem": "GAOKAO",
  "grade": "UPPER_SECONDARY"
}
```

前端每次启动或从后台恢复时读取：

```http
GET /v1/me/education-compass/state
```

用响应中的 `nextAction`、`assessmentId`、`reportId`、`orderId` 和 `revision` 恢复页面，不依据本地缓存猜测服务端状态。

## 4. Level 1｜Free Parent Compass

当前 V1.1 正例见 [`free-parent-v1.1-valid.json`](./examples/free-parent-v1.1-valid.json)。先将 `{studentId}` 替换为当前学生 ID。原有 [`free-parent-valid.json`](./examples/free-parent-valid.json) 保留为 V1.0 历史草稿／报告兼容性示例，不能用于新建问卷的版本判断。

流程：

1. `GET /v1/education-compass/questionnaires/free_parent_compass_v1.1.0`
2. `POST /v1/education-compass/free-parent-assessments`
3. 使用创建响应中的 `assessmentId` 和 `revision` 调用 `PUT /v1/assessments/{assessmentId}/draft`
4. 使用保存响应中的新 `revision` 调用 `POST /v1/assessments/{assessmentId}/submit`
5. 提交响应直接包含 `FAMILY_EDUCATION_SNAPSHOT`；也可稍后 `GET /v1/assessments/{assessmentId}/result`

Level 1 的同意版本必须精确为：

```json
{
  "scope": "CORE_ASSESSMENT",
  "copyVersion": "guardian_core_assessment_v1.0.0-rc1",
  "locale": "zh-CN",
  "guardianAuthorityConfirmed": true
}
```

答案对象只使用题号作为 key、canonical code 作为值。显示文案不能作为答案上传。

## 5. Level 2｜Education Growth Discovery

Level 2 创建前置是同一学生已提交的 Level 1；`sourceAssessmentId` 必须指向该 Level 1。

新建的 Level 2 使用 `education_growth_discovery_v1.1.0`；可通过以下接口预取指定体系的 V1.1 题库：

```http
GET /v1/education-compass/questionnaires/education_growth_discovery_v1.1.0?educationSystem=GAOKAO
```

当前 V1.1 的高考完整正例见 [`level2-gaokao-v1.1-valid.json`](./examples/level2-gaokao-v1.1-valid.json)。下表中的既有 `*-valid.json` 文件保留为 V1.0 历史兼容性正例；已存在的 V1.0 草稿必须继续使用其原始版本与题库摘要，不能静默迁移到 V1.1。

各体系可复核正例：

| 体系 | 示例 | 分支结果 |
|---|---|---|
| GAOKAO | [`level2-gaokao-valid.json`](./examples/level2-gaokao-valid.json) | `FULL_SYSTEM_BANK` |
| DSE | [`level2-dse-valid.json`](./examples/level2-dse-valid.json) | `FULL_SYSTEM_BANK` |
| IGCSE | [`level2-igcse-valid.json`](./examples/level2-igcse-valid.json) | `FULL_SYSTEM_BANK` |
| A_LEVEL | [`level2-a-level-valid.json`](./examples/level2-a-level-valid.json) | `FULL_SYSTEM_BANK` |
| AP_US | [`level2-ap-us-valid.json`](./examples/level2-ap-us-valid.json) | `FULL_SYSTEM_BANK` |
| IB | [`level2-ib-valid.json`](./examples/level2-ib-valid.json) | `SYSTEM_BANK_PENDING`，公共题 fallback |
| OTHER | [`level2-other-valid.json`](./examples/level2-other-valid.json) | `SYSTEM_BANK_PENDING`，公共题 fallback |

示例中的 `2027` 是针对 2026 年验证环境的合法年份。实际客户端必须从问卷的年份规则生成当前年至当前年 + 8 的选项，不能把示例年份写死到产品代码。

创建时的 student assent 必须精确为：

```json
{
  "scope": "STUDENT_ASSESSMENT_ASSENT",
  "copyVersion": "student_assent_growth_discovery_v1.0.0-rc1",
  "locale": "zh-CN",
  "studentConfirmed": true
}
```

典型流程：

1. `POST /v1/students/{studentId}/education-assessments`
2. `GET /v1/assessments/{assessmentId}/questionnaire`
3. `GET /v1/assessments/{assessmentId}/draft` 恢复服务端草稿
4. `PUT /v1/assessments/{assessmentId}/draft` 保存；体系切换时同时发送新的 `educationSystem` 和对应公共题答案
5. `POST /v1/assessments/{assessmentId}/submit`
6. 收到 `resultState=LOCKED` 后显示锁定页，不把任何客户端缓存当成完整报告

体系切换时，后端保留公共题、删除旧体系题答案并写入 `SYSTEM_ROUTE_CHANGED` 审计记录。客户端必须重新获取与新体系匹配的问卷，并让学生补齐新增必答题。

### 独立撤回核心测评同意或学生本人 assent

撤回核心测评同意：

```http
DELETE /v1/me/education-compass/consents/{studentId}/CORE_ASSESSMENT
```

只撤回学生本人对 Level 2 的 assent：

```http
DELETE /v1/me/education-compass/consents/{studentId}/STUDENT_ASSESSMENT_ASSENT
```

两个接口都不接受 query；合同不定义 request body，客户端不得发送。成功响应示例：

```json
{
  "scope": "CORE_ASSESSMENT",
  "studentId": "stu_example",
  "enabled": false,
  "withdrawnAt": "2026-08-25T12:15:00.000Z",
  "withdrawnGrantCount": 1
}
```

`CORE_ASSESSMENT` 撤回后，依赖该授权的 Level 1/Level 2 草稿、提交、结果与报告读取必须失败关闭；`STUDENT_ASSESSMENT_ASSENT` 撤回后，依赖该 assent 的 Level 2 流程必须失败关闭。两种撤回都会围住该学生未完成的 Agent 工作。客户端不得在本地重新打开旧测评；如用户之后重新同意，应通过新的显式创建流程保存新授权。

## 6. 3990 分支付与解锁

先读取商品事实：

```http
GET /v1/education-compass/products/growth-discovery
```

只有响应同时满足以下条件才显示支付入口：

- `productCode=EDUCATION_GROWTH_DISCOVERY_SINGLE_V1`
- `amountFen=3990`
- `currency=CNY`
- `paymentTiming=AFTER_SUBMIT_BEFORE_REPORT`
- `paymentEnabled=true`

创建订单：

```http
POST /v1/assessments/{assessmentId}/orders
Idempotency-Key: example-growth-order-001

{"productCode":"EDUCATION_GROWTH_DISCOVERY_SINGLE_V1"}
```

订单响应包含服务端权威过期时间；客户端不得自行延长或用本地时间覆盖：

```json
{
  "orderId": "ord_example",
  "outTradeNo": "PX_EXAMPLE",
  "productCode": "EDUCATION_GROWTH_DISCOVERY_SINGLE_V1",
  "amountFen": 3990,
  "currency": "CNY",
  "status": "CREATED",
  "reportId": "rpt_example",
  "expiresAt": "2026-08-25T14:00:00.000Z"
}
```

创建预支付：

```http
POST /v1/orders/{orderId}/wechat-prepay

{}
```

将 `paymentParams` 原样传给 `wx.requestPayment`。无论客户端回调成功或失败，都随后读取：

```http
GET /v1/orders/{orderId}
GET /v1/assessments/{assessmentId}/result
```

只有订单后端状态为 `PAID` 且结果返回 `resultState=READY` 时，才能进入完整报告页。若仍为 `PENDING` 或 `LOCKED`，显示“支付结果确认中”并继续有限次数轮询。

服务端支付 webhook 是运营侧接口，不应由小程序调用、伪造或重放。mock 冒烟脚本会在进程内用 MockPaymentProvider 生成带签名的合成通知，用于验证一次权益和一次事件的幂等约束。

## 7. 报告读取

推荐按测评读取结构化结果：

```http
GET /v1/assessments/{assessmentId}/result
```

已解锁的 Level 2 结果至少包含：

- `student_snapshot`
- `strength_signals`
- `learning_bottlenecks`
- `subject_focus`
- `growth_direction`
- `action_plan_30d`

每个分析信号保留 `status` 与 `evidence_refs`；没有证据时使用 `UNKNOWN`，不能臆造结论。`scoring_mode` 固定为 `NONE`。

通用报告读取：

```http
GET /v1/reports/{reportId}
```

无正确权益时只返回 `access=preview`；正确商品权益、交付状态和 QA 状态同时满足时才返回 `access=full`。

## 8. 飞书客户资料镜像 opt-in

启用：

```http
PUT /v1/me/integration-consents/feishu-profile

{
  "studentId": "{studentId}",
  "enabled": true,
  "copyVersion": "feishu_profile_mirror_opt_in_v1.0.0-rc1",
  "locale": "zh-CN",
  "guardianAuthorityConfirmed": true
}
```

撤回使用同一结构，只把 `enabled` 设为 `false`。该 opt-in 只覆盖已批准的客户资料字段；不覆盖原始问卷答案、学习过程全文、报告全文、支付资料或证件资料。

## 9. AI 分析独立同意与撤回

V0.5 的 AI 分析不是核心测评同意、学生 assent、支付权益或其他集成同意的附属字段。每次首次创建一次性分析或报告追问会话时，客户端必须发送当前冻结版的完整独立同意：

```json
{
  "consentVersion": "agent_analysis_opt_in_v1.0.0-rc1",
  "scope": "AI_ANALYSIS",
  "guardianConfirmed": true,
  "studentConfirmed": true,
  "locale": "zh-CN"
}
```

免费快照的一次性分析：

```http
POST /v1/assessments/{assessmentId}/agent-analyses
Idempotency-Key: example-free-agent-001
```

该接口不能分析 Level 2 锁定结果，也不能绕过 3990 分支付。已付款且完成交付的 Level 2 报告必须使用：

```http
POST /v1/reports/{reportId}/agent-analyses
Idempotency-Key: example-paid-agent-001
```

两个接口都使用上方同意 body，并返回 `202` 的服务端任务状态。页面恢复只读取：

```http
GET /v1/assessments/{assessmentId}/agent-analyses/latest
GET /v1/reports/{reportId}/agent-analyses/latest
GET /v1/agent-analyses/{runId}
```

完整撤回某个学生的 AI 分析同意：

```http
DELETE /v1/me/ai-analysis-consents/{studentId}
```

成功响应为：

```json
{
  "scope": "AI_ANALYSIS",
  "studentId": "stu_example",
  "enabled": false,
  "consentVersion": "agent_analysis_opt_in_v1.0.0-rc1",
  "updatedAt": "2026-08-25T12:30:00.000Z"
}
```

撤回会关闭该学生仍在活动的 Agent 会话，但不撤回核心测评、学生 assent、飞书资料镜像或顾问联系同意。

## 10. 顾问联系独立同意与请求

家庭范围启用（如只针对某个学生，可增加 `studentId`）：

```http
PUT /v1/me/integration-consents/advisor-contact

{
  "enabled": true,
  "copyVersion": "advisor_contact_opt_in_v1.0.0-rc1",
  "locale": "zh-CN",
  "guardianAuthorityConfirmed": true
}
```

撤回使用同一结构并把 `enabled` 改为 `false`；顾问联系同意不授权查看原始作答或学习过程全文。

创建请求时仍需显式携带当前冻结版确认：

```http
POST /v1/advisor-requests

{
  "preferredTime": "工作日 19:00 后",
  "topic": "了解学生下一步可选择的教育支持",
  "studentId": "stu_example",
  "reportId": "rpt_example",
  "consent": {
    "scope": "ADVISOR_CONTACT",
    "copyVersion": "advisor_contact_opt_in_v1.0.0-rc1",
    "locale": "zh-CN",
    "guardianAuthorityConfirmed": true
  }
}
```

当前用户可用 `GET /v1/me/advisor-requests` 恢复请求状态。

## 11. 必要反例

| 场景 | 示例 | 预期 |
|---|---|---|
| 创建 Level 1 带未知字段 | [`invalid-free-create-unknown-field.json`](./examples/invalid-free-create-unknown-field.json) | `400 UNKNOWN_REQUEST_FIELDS` |
| Level 2 由家长代答 | [`invalid-level2-parent-respondent.json`](./examples/invalid-level2-parent-respondent.json) | `400 GROWTH_DISCOVERY_CREATE_INVALID` |
| 使用过期 revision 保存 | [`invalid-draft-stale-revision.json`](./examples/invalid-draft-stale-revision.json) | `409 DRAFT_REVISION_STALE` |
| 答案体系与当前题库分支不一致 | [`invalid-level2-system-route-mismatch.json`](./examples/invalid-level2-system-route-mismatch.json) | `409 EDUCATION_SYSTEM_ROUTE_MISMATCH` |

错误统一为：

```json
{
  "error": {
    "code": "DRAFT_REVISION_STALE",
    "message": "草稿版本已更新，请重新加载",
    "details": {
      "currentRevision": 2
    }
  }
}
```

## 12. 验证命令

Windows PowerShell 使用 `npm.cmd`：

```powershell
npm.cmd run test:education-contracts
npm.cmd run test:education-http
npm.cmd run smoke:education
npm.cmd run scan:release-secrets
npm.cmd run test:p0
```

`test:p0` 保持默认离线。若未配置 `EDUCATION_TEST_DATABASE_URL`，PostgreSQL 子项输出 `BLOCKED_EXTERNAL` 并以 0 退出，且不会尝试网络连接。只有专用测试库、库名含 `test`/`ci`/`sandbox`，并显式设置 `EDUCATION_TEST_DATABASE_ALLOW_MUTATION=YES` 时才执行迁移和只读 schema 校验。
