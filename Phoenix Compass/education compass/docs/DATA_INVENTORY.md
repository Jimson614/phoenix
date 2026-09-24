# 数据清单：Education Compass

本文件供隐私政策、用户协议和监护人同意文本（OD-05）的起草与法律审查使用。

**每一行都对应当前代码或数据库 schema 中的真实字段**，不是设想中的功能。核对方式写在各节末尾。
产品改动后必须同步更新本清单，否则隐私政策会与实际行为脱节。

> **本文件不是隐私政策，也不构成法律意见。** 它回答的是"系统实际收了什么、存在哪、留多久、给了谁、怎么删"，
> 这部分只有读过代码的人能写准；法律定性、告知义务和同意文本仍需具备资质的人审查。

核对日期：2026-09-24。对应 schema：`server/migrations/001` 至 `008`。

## 1. 一句话概览

产品向**家长**收集其本人与**未成年子女**的教育背景、学业表现、兴趣特长、家庭目标与预算信息，
用于生成一份教育规划报告。涉及未成年人个人信息，且包含家长手机号这一可直接联系到自然人的标识。

## 2. 收集的个人信息

### 2.1 身份与账号

| 字段 | 表 | 说明 |
| --- | --- | --- |
| `openid` | `wechat_identities` | 微信登录返回的用户标识，本小程序内唯一 |
| `unionid` | `wechat_identities` | 同一微信开放平台主体下的用户标识，可选 |
| `token_hash` | `sessions` | 会话凭据的哈希，不存明文 |

服务端调用微信 `code2Session` 换取 openid，**不保留 `session_key`**（`server/src/auth/wechat-auth-provider.ts` 只取 openid 与 unionid）。
不收集微信昵称、头像、手机号授权。

### 2.2 家长（`families`）

| 字段 | 性质 |
| --- | --- |
| `parent_name` | 家长姓名 |
| `phone` | **手机号，可直接联系到自然人** |
| `family_name` | 家庭称谓 |
| `location` | 所在地区 |
| `goal` | 家庭教育目标 |

### 2.3 未成年子女（`students`）

| 字段 | 性质 |
| --- | --- |
| `name` | **未成年人姓名** |
| `age` | **年龄**（约束 3–100） |
| `gender` | 性别 |
| `school` | **就读学校** |
| `education_system` | 课程体系 |
| `grade` | 年级 |
| `interest` / `goal` | 兴趣与目标 |

姓名、年龄、学校三项组合后具有较强可识别性，且主体为未成年人。

### 2.4 问卷答案（`assessments.answers`，jsonb）

共 **23 题**（`models/questionnaire-schema.js`，可用 `node -e "console.log(require('./models/questionnaire-schema').allQuestions().length)"` 核对）。
其中属于敏感或高可识别性的：

- **学业表现**：最近成绩或学术表现概况、语言能力或考试情况、相对擅长的科目
- **心理与状态描述**：最近的学习状态、最近一件让你担心或困惑的事
- **家庭经济状况**：家庭可接受的年度教育预算
- **自由文本共 8 题**，家长可能在其中填入学校全称、真实姓名、住址或联系方式——**系统不阻止**

自由文本是本产品最大的不可控面：字段本身不限定内容，实际收到什么取决于家长怎么填。

### 2.5 交易与权益

`orders`、`entitlements`、`payment_events`、`refunds` 保存订单号、金额（固定 3990 分）、支付状态、
第三方交易号与回调摘要。**不保存银行卡号、支付密码或任何支付凭据**。

### 2.6 报告与衍生内容

`reports` 保存报告正文（`modules`、`preview`）、来源目录版本与 QA 状态。
报告内容由规则引擎从问卷答案推导，因此**间接包含上述全部个人信息**。

### 2.7 同意记录

`guardian_consents`（监护人同意）、`consent_grants`、`agent_consents`（AI 分析专项同意）、
`integration_links`（第三方镜像同意）分别记录版本号、范围、确认时间与撤回时间。

### 2.8 其他

`audit_logs`、`timeline_events`、`report_feedback`、`advisor_requests`、
`agent_conversations` / `agent_messages` / `agent_runs`（AI 对话与追问）。

> 核对：`grep -hoE "CREATE TABLE (IF NOT EXISTS )?[a-z_]+" server/migrations/*.sql | sort -u` 列出全部 26 张表。

## 3. 数据去了哪里

### 3.1 自有基础设施

| 位置 | 内容 | 加密 |
| --- | --- | --- |
| 腾讯云服务器 PostgreSQL 16（中国境内） | 全部业务数据 | 连接强制 `sslmode=verify-full`；明文连接被 `pg_hba` 拒绝 |
| 服务器本地备份 `~/backups/db/` | 数据库完整转储 | 保留 **14 天** |
| 腾讯云 COS 对象存储 | 备份异地副本 | 保留 **30 天**，桶为私有 |

AI 对话正文在入库前用 `AI_CONTENT_KEYRING_JSON` 的密钥加密（`server/src/ai/crypto.ts`），支持密钥轮换。

### 3.2 第三方

| 接收方 | 发出的内容 | 当前状态 |
| --- | --- | --- |
| **微信**（腾讯） | 登录 code 换取 openid；支付时的订单号与金额 | 登录已启用 |
| **AI 服务商**（OpenAI 或 DeepSeek） | 见下方 3.3 | **未启用**，`AGENT_PROVIDER=mock` |
| **飞书多维表格** | 见下方 3.4 | **未启用**，`FEISHU_BITABLE_ENABLED=false` |
| **腾讯云 COS** | 数据库备份（含全部个人信息） | 已启用 |

### 3.3 发给 AI 服务商的内容

启用后发出的是**经过脱敏的问卷要点与报告正文**，不是原始记录。
`server/src/ai/safety/local-safety.ts` 的 `redactContextText` 会在发出前替换掉：

```
邮箱、大陆手机号、香港手机号、大陆身份证、香港身份证、
平台 ID（openid）、具体住址、具体学校名、人名
```

自由文本额外截断到 600 字符。**这是正则匹配，不是语义识别**：非常规写法的学校名或姓名可能漏网，
法律文本不宜把它描述为"绝对不会外发个人信息"。

AI 对话保留期：`AI_CONVERSATION_RETENTION_DAYS`，默认 **30 天**（可配 1–90 天）。

### 3.4 镜像到飞书的字段

启用后镜像家庭与学生的运营字段，其中**包含 `guardian_phone`、`parent_name`、学生 `age`、`gender`、
`grade`、`school` 相关字段**。实体 ID 经 HMAC-SHA256 假名化（`PHX-` 前缀），但上述业务字段本身不假名化。

设计上不镜像：支付密钥、问卷全文、openid、完整报告正文。
敏感字段还需 `FEISHU_CUSTOMER_PROFILE_FIELDS_ENABLED` 与逐条镜像同意同时开启。

> 核对：`server/src/integrations/feishu/sync-service.ts`，字段清单见 `requiredFeishuSchemaFields`。

## 4. 保留与删除

### 4.1 当前用户能自己删的

| 操作 | 接口 |
| --- | --- |
| 退出登录（撤销当前会话） | `DELETE /v1/auth/session` |
| 撤回某个孩子的监护人同意 | `DELETE /v1/me/education-compass/consents/{studentId}/{scope}` |
| 撤回 AI 分析授权 | `DELETE /v1/me/ai-analysis-consents/{id}` |
| 撤回某次对话的授权 | `DELETE /v1/agent-conversations/{id}/consent` |
| 删除某次 AI 对话 | `DELETE /v1/agent-conversations/{id}` |
| 关闭顾问联系同意 | `PUT /v1/me/integration-consents/advisor-contact`，`enabled: false`（**不是删除接口**） |
| 关闭飞书资料镜像同意 | `PUT /v1/me/integration-consents/feishu-profile` |

> 核对：服务端全部 DELETE 路由共 6 条（含下方的账号注销），见 `server/src/http/app.ts`
> 与 `server/src/http/agent-routes.ts`。

### 4.2 账号注销（2026-09-23 起可用）

`DELETE /v1/me`，需在请求体回传 `{"confirm":"DELETE_MY_ACCOUNT"}`；小程序「我的」页提供入口，两步确认。

**会被删除**：家庭档案、学生资料、全部问卷与答案、全部报告（含已购买的）、监护人同意与各项授权记录、
AI 对话与消息、报告反馈、顾问申请、时间线、第三方镜像链接、微信身份关联（openid）、全部会话。

**会被保留**：订单、权益、支付事件、退款记录——会计与税务法规要求留存交易凭证。
这些记录中指向个人数据的字段（`family_id`、`student_id`、`assessment_id`、`report_id`）在注销时置空，
因此**保留下来的只有订单号、金额、状态、时间与第三方交易号，无法再关联到具体的人**。
`users` 行保留但只剩 `id`、`role`、`created_at`、`deleted_at`，不含个人信息。

**注销后再次用同一微信登录会得到一个全新的空白账号**：openid 映射已删除。

审计记录 `ACCOUNT_DELETED` 只记录各表删除行数，不记录任何个人信息。

### 4.3 个人信息导出（2026-09-24 起可用）

`GET /v1/me/export`；小程序「我的」页提供「导出我的数据」，生成 JSON 文件后经微信转发给用户自己。

**包含**：账号基本信息、家庭、学生、监护人同意与各项授权、全部问卷与答案、全部报告正文、
订单与权益、时间线、报告反馈、顾问申请、AI 对话与正文（Agent 启用时解密导出，未启用时如实标注）。

**刻意排除，并在文件内写明原因**：

| 排除项 | 原因 |
| --- | --- |
| `openid` / `unionid` | 微信账号标识，按 [API.md](API.md) 的既有约定绝不返回客户端；导出文件会落到聊天记录里 |
| `sessions.tokenHash` | 登录凭据，属于认证材料而非个人资料 |

所有查询以 `userId` 为界，不含其他用户的任何数据。已注销账号返回 `ACCOUNT_DELETED`，与"账号不存在"区分。

### 4.4 ⚠ 仍然**没有**的能力

- 撤回同意会阻止后续使用，但**不删除已有记录**（要删除需走账号注销）。

### 4.5 备份中的残留

数据库转储保留 14 天（本地）与 30 天（COS）。账号注销**不会**回溯清理已有备份，
**被删除的数据仍会在备份中存在最多 30 天**。隐私政策不应承诺"立即彻底删除"。

## 5. 起草隐私文本前必须先决定的事

| # | 问题 | 为什么绕不开 |
| --- | --- | --- |
| 1 | 谁是个人信息处理者？经营主体全称、联系方式 | 告知义务的基本要素 |
| 2 | 未成年人同意如何取得与验证？ | 系统只有一个"监护人已确认"的布尔值，无法证明操作者确为监护人 |
| 3 | 是否设定用户年龄下限？ | `students.age` 允许 3 岁起 |
| 4 | 注销后备份中的 30 天残留如何告知？ | 注销功能已上线（4.2），但备份不回溯清理（4.5） |
| 5 | 数据保留多久？ | 除 AI 对话 30 天外，其余**无保留上限**，永久保存 |
| 6 | 启用 AI 前如何单独告知与取得同意？ | 已有独立同意机制，但文本未定 |
| 7 | 启用飞书镜像前如何告知？ | 会把家长手机号等发到第三方平台 |
| 8 | 报告结论的免责边界 | 报告涉及升学建议，需明确非承诺性质 |

## 6. 一句话总结给法务

> 本产品收集未成年人的姓名、年龄、学校、年级、学业表现与心理状态描述，以及家长姓名、手机号与家庭教育预算；
> 数据存储于中国境内腾讯云，备份异地留存最多 30 天；当前未启用 AI 与第三方镜像；
> 用户可自助导出个人数据副本，也可自助注销账号并删除全部个人数据，订单等财务凭证按法规保留但已与个人数据脱钩；
> **备份中的残留最多 30 天**。
