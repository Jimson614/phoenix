# Phoenix Education Compass™ Current Build Audit

审计日期：2026-08-22  
问卷模板补充日期：2026-08-25  
审计基线：Phoenix Family OS V0.4.1 工作副本  
审计性质：只读代码审计 + 增量更新计划 + 问卷模板草案  
代码修改：无。本轮只完善本审计文件；没有修改页面、路由、运行时题库、数据库、支付或第三方接口。

## 0. 执行结论

当前 Education Compass 已经具备一条可运行的原生微信小程序链路，但它实现的是旧产品假设：

```text
family_user 登录
→ 建立家庭档案
→ 建立学生档案
→ 监护人同意
→ 同一套 6 步 23 题问卷（约 8—12 分钟）
→ 完整度达到 70
→ 免费学生报告预览
→ ¥39.90 微信支付
→ 解锁六模块“完整成长规划报告”与 PDF
→ AI 分析/追问或顾问申请
```

它不是最新冻结的三层产品：运行代码目前没有独立的 3—5 分钟家长问卷、没有真正独立的学生本人入口、没有按教育体系路由的题库，也没有 `Family Education Snapshot`、Growth Discovery 六项结果或 Askwise handoff 合同。本审计在第 15.5—15.12 节补充了可供评审和后续实现的两套问卷模板草案；“文档中已有模板”不代表运行代码已经接入。

最安全的方向不是推翻前台，而是：

1. 冻结 `education_compass_v1`、旧 ¥39.90 商品和旧六模块报告，继续服务历史草稿、订单、权益与报告；
2. 保留现有页面结构、品牌视觉、通用问卷渲染、草稿恢复、ID 主链、支付安全与飞书同步框架；
3. 以新增版本和新增字段的方式拆出 `Free Parent Compass` 与 `Student Growth Discovery`；
4. Level 2 使用新的“问题发现”报告合同，不再复用大学匹配、完整路线和 6—24 个月规划；
5. 本轮只冻结 Askwise handoff 数据合同，不实现网络连接、双向同步或新按钮；
6. 用户本轮称谓为 ¥39.9，上一版冻结模型写 ¥39.8；结算金额、商品码和付费时点获得明确确认前，不修改现有支付代码，也不把价格写进题库版本。

## 1. Repository、版本与运行基线

| 项目 | 当前事实 | 证据 |
|---|---|---|
| Project location | `C:\Users\1\Documents\Codex\2026-08-20\new-chat\work\phoenix_v030_feishu_backend\phoenix-family-os-mvp` | 当前工作目录 |
| Mini Program version | `0.4.1` | `package.json:3`、`project.config.json` |
| Server version | `0.4.1` | `server/package.json:3` |
| Git / branch | 不是 Git 仓库；没有 `.git`，无 branch/commit 可报告 | `git rev-parse` 与 `git branch --show-current` 均返回 `not a git repository` |
| Source pages | 16 个 | `app.json:2-19` |
| Release pages | 14 个；两个 admin demo 页面被剔除 | `scripts/build-release.js:10-13,65-69` |
| 开发者工具默认模式 | `develop` 默认使用本地 demo；`project.config.json` 当前是 `touristappid` | `config/runtime.js`、`project.config.json` |
| 正式构建模式 | release 强制 remote，必须注入 HTTPS API 与真实非 tourist AppID | `scripts/build-release.js` |
| 最近自动化记录 | 客户端通过，服务端 65/65；不是本轮重跑 | `docs/V0.4.1_VERIFICATION.md:19` |
| 外部联调 | 真实 PostgreSQL、微信支付、OpenAI、飞书与微信真机均未验收 | `docs/V0.4.1_VERIFICATION.md:36-41` |

因为没有 Git，本轮后续如进入实施阶段，应先建立可回滚的版本基线；不能依赖 branch diff 判断改动范围。

## 2. 已完成内容

当前已完成并可作为增量基线的能力包括：

- 原生微信小程序欢迎页、家庭中心、家庭/学生档案、Compass、分步问卷、免费预览、支付结果、报告、时间线、个人中心与顾问申请；
- 一套版本化 `education_compass_v1` 问卷合同，6 步 23 字段、总权重 100、完整度 70 门槛；
- 单选、多选、文本输入、步骤校验、700ms 自动保存、草稿恢复及服务端再次校验；
- Family ID → Student ID → Assessment ID → Report ID → Order/Entitlement 的所有权链；
- 付款前报告 QA、服务端权威支付状态、微信 JSAPI Provider、通知验签解密、查单、退款与权益撤回；
- 免费预览与付费内容隔离、历史报告读取、PDF、反馈和 Advisor Request；
- PostgreSQL adapter 与 001—004 migration；
- 飞书七类运营镜像、去标识主键、Schema 预检、重试和显式客户资料白名单；
- 已存在但默认关闭的免费分析、已购报告分析和报告追问 Agent；
- demo、Mock 和自动化合同测试。

这些“已经有代码”不等于已经连接真实外部环境。默认配置中 `PAYMENT_PROVIDER=mock`、`PAID_COMPASS_ENABLED=false`、`FEISHU_BITABLE_ENABLED=false`、`OPENAI_AGENT_ENABLED=false`、`AI_WORKER_ENABLED=false`，见 `server/.env.example`。

## 3. Existing Route Map

### 3.1 当前前端主流程

```text
/pages/welcome/index
  └─ family_user 登录
     └─ /pages/home/index                       [tab: 家庭]
        ├─ /pages/family-edit/index
        │  └─ /pages/student-edit/index
        │     └─ /pages/compass/index
        │        └─ /pages/compass-questionnaire/index
        │           └─ /pages/compass-preview/index
        │              ├─ /pages/assessment-analysis/index?mode=free
        │              └─ /pages/payment-result/index
        │                 └─ /pages/report/index
        │                    ├─ /pages/assessment-analysis/index?mode=paid
        │                    ├─ /pages/agent-chat/index
        │                    └─ /pages/advisor-request/index
        ├─ /pages/timeline/index                 [tab: 时间线]
        ├─ /pages/mine/index                     [tab: 我的]
        └─ /pages/advisor-request/index

本地 demo 专用：
/pages/welcome/index
  └─ /pages/admin-families/index
     └─ /pages/admin-family/index
        └─ /pages/report/index
```

### 3.2 页面清单

| Route | 当前职责 | 当前建议 |
|---|---|---|
| `/pages/welcome/index` | Family OS 品牌落地与家庭用户登录 | Keep UI / Modify entry copy |
| `/pages/home/index` | 家庭中心、第一位学生、动态下一步 | Keep UI / Modify funnel logic |
| `/pages/family-edit/index` | 家庭资料 | Keep；重新评估免费入口前的必填摩擦 |
| `/pages/student-edit/index` | 学生资料与课程体系 Picker | Keep UI / Modify canonical selector 与出现时点 |
| `/pages/compass/index` | 旧 ¥39.90 产品落地、监护同意、历史报告 | Keep layout / Modify Level entry |
| `/pages/compass-questionnaire/index` | 单一问卷渲染、校验、保存、提交 | Keep renderer / Modify bank routing |
| `/pages/compass-preview/index` | 学生免费预览、免费 AI、购买 CTA | Keep layout / Modify 为 Family Snapshot |
| `/pages/payment-result/index` | 服务端权威支付状态 | Keep / Defer price and timing changes |
| `/pages/report/index` | 六模块报告、PDF、AI、顾问 | Keep shell / Modify result contract 与 CTA |
| `/pages/assessment-analysis/index` | 免费或已购报告 AI 分析 | Defer；不扩展、不作为新漏斗核心 |
| `/pages/agent-chat/index` | 已购报告最多 3 次 AI 追问 | Defer；保留旧报告兼容 |
| `/pages/timeline/index` | 家庭成长事件 | Keep / Modify 新事件类型与标签 |
| `/pages/advisor-request/index` | 顾问申请 | Keep contract / Modify intent context |
| `/pages/mine/index` | 档案、报告、订单入口 | Keep / Modify 产品标签与入口 |
| `/pages/admin-families/index` | 本地 demo 顾问列表 | Defer；正式包已排除 |
| `/pages/admin-family/index` | 本地 demo 家庭详情与备注 | Defer；不能视为生产 CRM |

关键证据：`app.json:2-19` 注册全部页面；`pages/home/index.js:34-48` 强制家庭→学生→Compass 顺序；`pages/compass/index.js:56-64` 创建 Assessment 并进入问卷；`pages/compass-questionnaire/index.js:114-139` 提交后进入预览；`pages/compass-preview/index.js:25-46` 发起支付；`pages/report/index.js:67-91` 进入已购分析、PDF、Agent 或顾问。

### 3.3 当前后端 API 路由

核心路由集中在 `server/src/http/app.ts:136-334`：

- 认证：`POST /v1/auth/wechat/session`、`DELETE /v1/auth/session`；
- 家庭与学生：`GET|PUT /v1/me/family`、`GET|POST /v1/me/students`、`GET|PUT /v1/me/students/:studentId`；
- Assessment：`POST /v1/students/:studentId/education-assessments`、draft GET/PUT、submit POST、preview GET；
- 支付：Assessment order POST、WeChat prepay POST、order GET、交易/退款 webhook、管理员退款；
- 报告：report GET、PDF GET、feedback POST；
- 家庭运营：reports、timeline、advisor requests；
- 飞书管理：status、schema validate、reconcile；
- Agent：免费分析、已购分析、latest/run 查询及报告追问会话。

所有 Education Assessment 路由目前都没有 Level、respondent 或 education-system question bank 参数。

## 4. Existing Component Inventory

### 4.1 真正注册的共享组件

仓库只有一个自定义共享组件：

| Component | 属性 | 使用位置 | 建议 |
|---|---|---|---|
| `components/brand-mark` | `light`, `compact` | Welcome、Home | Keep |

证据：`components/brand-mark/index.js:1-6`、`components/brand-mark/index.wxml:1-24`；页面注册见 `pages/welcome/index.json` 与 `pages/home/index.json`。

### 4.2 全局可复用视觉原语

`app.wxss` 已提供：

- 品牌颜色 token；
- `.page`、`.page--paper`；
- `.eyebrow`、`.h1`、`.h2`、`.h3`、正文与 muted 层级；
- `.panel`、`.row`、`.tag`、`.status`；
- `.btn` 的 primary/gold/outline/text 变体；
- `.field`、`.input`、`.textarea`、`.picker`；
- `.safe-bottom`。

问卷选项、预览卡片、报告 section、固定购买栏、顾问表单和 AI 结果卡目前都是 page-local block，不是组件。本轮不应为了“组件化”重构它们；先稳定产品合同，再决定是否抽取。

## 5. Landing、Parent Entry 与 Student Entry

### 5.1 Current landing page

应用第一个 route 是 `/pages/welcome/index`。品牌首屏、关系环和视觉可以直接保留；当前 CTA 是“开始家庭成长规划”，两个用户按钮都调用同一个 `start()` 并登录 `family_user`，见 `pages/welcome/index.wxml:30-32` 与 `pages/welcome/index.js:12-25`。

当前 Education Compass 产品落地页是 `/pages/compass/index`，文案明确为“免费填写同一问卷并看预览，再用 ¥39.90 解锁六模块完整报告”，见 `pages/compass/index.wxml:3-38`。

### 5.2 Current parent entry

当前 Parent entry 实际是 Family OS 账户入口，不是 Free Parent Compass：

- Home 没有 Family 时先要求建立家庭档案；
- 没有 Student 时先要求添加学生；
- 家庭表单要求家庭称呼、家长姓名、电话；
- 学生表单要求姓名、年龄、学校、年级；
- 之后才允许开始 Compass。

证据：`pages/home/index.js:34-48`、`pages/family-edit/index.js:36-50`、`pages/student-edit/index.js:47-62`。

这与“内容入口 → 3—5 分钟 Free Parent Compass”的低摩擦漏斗存在冲突。是否允许在完整 Student profile 之前创建临时 Student ID，是实施前的产品/数据决策。

### 5.3 Current student entry

当前没有学生角色或学生登录：服务端角色只有 `family_user | admin`，见 `server/src/domain/model.ts:1`；Student、Compass 和 questionnaire 页面都由 `family_user` guard 保护。

因此当前“学生测评”只能表示“围绕学生资料的问卷”，不能证明学生本人作为独立 respondent 作答。新 Level 2 至少需要显式 `respondent_role=STUDENT`；是否还需要学生独立身份认证、学生 assent 或仅由监护人把设备交给学生，是 Open Issue。

## 6. Current Assessment Flow 与 Current Question Bank

### 6.1 当前状态流

```text
Student 已存在
→ 创建 GuardianConsent + Assessment(DRAFT)
→ 保存 answers JSON
→ calculate completeness
→ completeness >= 70
→ Assessment(PREVIEW_READY)
→ 同时创建 Report(LOCKED) 并生成/QA 六模块
→ 展示免费 preview
→ 支付只负责把已有报告交付并授予 entitlement
```

关键事实：当前并不是 Level 1 完成后再开始 Level 2。提交同一份问卷时，服务端已经生成完整六模块，只是锁定；支付后解锁。证据：`server/src/services/assessment-service.ts:111-150`。

### 6.2 当前题库

固定版本：`education_compass_v1`。  
结构：6 步、23 字段、总权重 100。  
提交门槛：70。  
页面时长：约 8—12 分钟。

| Step | 当前字段 |
|---|---|
| Identity | `identity_type`, `school_stage`, `education_system`, `target_enrollment_year` |
| Academics | `academic_summary`, `language_level`, `strongest_subjects`, `learning_feeling` |
| Strengths | `strengths`, `interests`, `strength_evidence` |
| Goals | `challenges`, `parent_observation`, `parent_expectation`, `future_goal` |
| Routes | `target_region`, `target_major`, `route_preference`, `backup_route_acceptance` |
| Constraints | `annual_budget`, `available_time`, `support_need`, `location_preference` |

证据：`models/questionnaire-contract.json`、`models/questionnaire-schema.js:12-88`、`server/src/domain/questionnaire.ts:15-40`。

题库混合了家长观察、学生学习状态、身份、地区、专业、预算、住宿和升学路线，这体现的是旧“低价完整规划”假设，而不是两个 respondent 的分层发现模型。

### 6.3 可复用问卷逻辑

可直接复用并改为配置驱动：

- single/multi/text 通用渲染；
- 步骤、进度和必填校验；
- 自动保存、草稿恢复、前后切换；
- version、weight、completeness；
- 前后端未知字段拒绝；
- remote 模式不把答案写入本地 storage；
- 服务端 owner、StudentVersion 与 GuardianConsent 校验。

需要修改的是题库注册与路由，不是问卷页面视觉。

### 6.4 与最新四维的弱映射

| 最新维度 | 当前可复用线索 | 当前缺口 |
|---|---|---|
| `ACADEMIC_PERFORMANCE` | `academic_summary`, `language_level`, `strongest_subjects` | 无跨体系科目代码、基准与维度标签 |
| `LEARNING_PROCESS` | `learning_feeling`, `challenges`, `available_time` | 家长观察与学生自评未分开 |
| `THINKING_LEARNING_STYLE` | `strengths`, `strength_evidence` | 只是弱映射，不是学习风格题组 |
| `INTEREST_DIRECTION` | `interests`, `future_goal`, `target_major` | 兴趣与升学专业目标混合 |

当前没有 question-to-dimension map、统一 signal 枚举或经验证的评分解释合同。

## 7. Education System Selector

当前 Student profile 和问卷保存的是展示文本：

```text
内地课程 / DSE / IB / A-Level / AP / 美式课程 / 其他
```

证据：`pages/student-edit/index.js:9`、`models/questionnaire-schema.js:18`、`server/src/domain/questionnaire.ts:18`。

`viewSteps()` 永远返回同一组 `STEPS`，没有按体系题库路由，见 `models/questionnaire-schema.js:109-120`。

增量兼容建议：

| 旧展示值 | 新 canonical code | 处理 |
|---|---|---|
| 内地课程 | `GAOKAO` | 新写入使用 code，旧值兼容读取 |
| DSE | `DSE` | 直接映射 |
| A-Level | `A_LEVEL` | 新写入使用 code |
| AP / 美式课程 | `AP_US` | 新写入使用 code |
| 无 | `IGCSE` | 新增路由 |
| IB | 待确认 | 不应静默删除旧数据 |
| 其他 | 待确认 | 可作为 unsupported/other，而不是伪装成正式题库 |

题库选择建议由 `assessment_kind + education_system_code + questionnaire_version` 决定；前端 Picker 只负责展示，不应成为题库规则的事实源。

## 8. Current Result / Snapshot、Report Structure 与 CTA

### 8.1 当前免费结果

`/pages/compass-preview/index` 当前输出：

- `profileSummary`；
- `oneStrength`；
- `oneRisk`；
- `routeOverview`；
- 付费六模块目录；
- 可选免费有限 AI 分析；
- “微信支付并解锁” CTA。

证据：`pages/compass-preview/index.wxml:13-40`、`server/src/domain/model.ts:114-126`。

这是学生付费报告 teaser，不是 `Family Education Snapshot`。它没有独立呈现“家庭教育关注点、孩子当前阶段、家长最担心的问题、是否建议进入学生本人测评”。

### 8.2 当前付费报告

当前固定六模块：

1. `student_profile` — 学生成长画像；
2. `strengths` — 优势能力分析；
3. `major_directions` — 推荐专业方向；
4. `university_match` — 大学与专业匹配；
5. `routes` — 升学路线建议；
6. `action_plan` — 未来 6—24 个月时间规划。

证据：`server/src/domain/report-builder.ts:5-14`、`services/report.js:7-12`。

其中大学匹配、主/备路线和长期规划超出最新 Level 2“发现问题，不做完整升学规划”的职责，应对新创建的 Level 2 报告停用，但历史报告继续按旧模板只读显示。

新 Level 2 可复用报告页的通用 `wx:for` 模块渲染壳，改用版本化输出：

- `student_snapshot`；
- `strength_signals`；
- `learning_bottlenecks`；
- `subject_focus`；
- `growth_direction`；
- `action_plan_30d`。

### 8.3 当前 CTA 与新漏斗冲突

| 页面 | 当前 CTA | 最新模型需要 |
|---|---|---|
| Welcome | 开始家庭成长规划 | Free Parent Compass 明确入口 |
| Home | 家庭→学生→单一 Compass | Parent-first 状态机 |
| Compass | 免费填写旧混合问卷 | 根据 Level 显示家长/学生入口 |
| Questionnaire | 生成免费预览 | Level 1 生成 Family Snapshot；Level 2 生成 Discovery |
| Preview | 免费 AI + 支付解锁完整报告 | 主 CTA 进入付费 Student Growth Discovery；最终 ¥39.8/¥39.9 待统一 |
| Report | PDF + AI + 顾问 | Askwise / ¥980 两个标准下一步；顾问承接 |

本轮不得新增 Askwise 真实按钮、¥980 产品或新 Agent；这里只定义下一阶段状态和合同。

## 9. Payment-related Logic

当前产品合同：

- `COMPASS_REPORT_SINGLE_39_9`；
- `3990` 分；
- 展示 `¥39.90`；
- 单次解锁“完整成长规划报告”。

证据：`config/compass.js:1-8`、`server/src/domain/products.ts:3-18`、`server/migrations/001_initial_schema.sql:125-136`。

值得保留的支付基础设施：

- 前端核验服务端 product code 和 amount；
- `wx.requestPayment`；
- 客户端成功回调不自行授权；
- 服务端查询、通知验签解密、金额校验和幂等交付；
- entitlement、退款与撤权；
- 付费开关、verified source catalog、收费前 QA。

但 3990 已在客户端、产品种子、订单服务、支付回调和测试中成为硬合同，不能把文案改成 ¥39.8 就算完成。最新产品标价虽写为 ¥39.8，实施前仍需确认：

1. 微信结算是否严格为 3980 分；
2. Level 2 在答题前付费、提交后付费看结果，还是有试答边界；
3. 旧 ¥39.90 订单、退款、权益与报告如何长期兼容。

确认前保持 `PAID_COMPASS_ENABLED=false`，不改、不启用支付。

## 10. Reusable Data Contracts

### 10.1 可直接复用

| 合同 | 当前内容 | 结论 |
|---|---|---|
| Family | `id`, `userId`, family profile | Keep；三层共用 |
| Student | `id`, `familyId`, profile, `studentVersion` | Keep；三层共用 |
| GuardianConsent | Family/Student/User/版本/scope/撤回 | Keep；按 Level 调整 scope/version |
| Assessment | `id`, user/family/student/consent, questionnaireVersion, studentVersion, answers, score, status, reportId | Keep + additive fields |
| Report | `id`, family/student/assessment, preview/modules/sources/versions/QA | Keep + template/report kind 分流 |
| SourceReference | source、适用年份、核验日期、数据版本 | Keep |
| Order/Entitlement/Refund | 与 user/family/student/assessment/report 强关联 | Keep |
| TimelineEvent | family、report、order 与 event type | Keep + 新事件 |
| AdvisorRequest | family、可选 student/report、topic、status | Keep + intent/context |
| IntegrationLink | Phoenix entity 到飞书 record 的 outbox/map | Keep |

证据：`server/src/domain/model.ts:56-178,303-337`、`server/migrations/001_initial_schema.sql`。

生产 ID 通过 `fam_ / stu_ / asm_ / rpt_ + UUID` 生成，见 `server/src/utils/runtime.ts:3-7`。Level 1 和 Level 2 应各有独立 Assessment ID，因为 respondent 与题库不同；它们共享 Family ID、Student ID，并通过父测评引用串联，不创建新的 Family/Student 数据孤岛。

### 10.2 当前缺失、建议增量新增

以下只是 Phase B 计划，不是已实现字段：

```text
assessment_kind:
  FREE_PARENT_COMPASS
  STUDENT_GROWTH_DISCOVERY
  DEEP_ASSESSMENT_RESERVED

respondent_role:
  PARENT
  STUDENT

source_assessment_id      # Level 2 → Level 1
education_system_code     # GAOKAO | DSE | IGCSE | A_LEVEL | AP_US
source_entry
question_bank_version
report_kind
report_version
subject_focus
learning_bottleneck
learning_signals
interest_signals
growth_signals
recommended_focus
```

`advisor_status` 建议由关联 AdvisorRequest 的最新状态派生，不在 Family、Student、Assessment 和 CRM 多处重复维护。

### 10.3 非破坏性数据库路径

- 001—004 migration 是带 checksum 的历史文件，不修改；
- 下一步如获批准，仅新增 `005_education_compass_levels.sql`；
- `education_compass_v1` 和 `compass-six-modules-v1` 保持历史可读；
- 新旧 assessment/report 通过 kind/version 分流；
- 不覆盖旧订单金额和 product code。

## 11. Feishu / Database Contracts

PostgreSQL 是事实源；飞书是可关闭的运营镜像，不是数据库主源。

当前七类飞书投影：

1. `family_profile`；
2. `student_profile`；
3. `assessment_session`；
4. `report_job`；
5. `order_payment`；
6. `feedback`；
7. `advisor_request`。

证据：`server/src/integrations/feishu/schema-contract.ts:65-119`。

现有 assessment 投影只有伪名 Family/Student/Session ID、版本、状态、完整度和时间；报告投影只有 ID、状态、QA 和版本，不包含原始答案或报告正文，见 `server/src/integrations/feishu/sync-service.ts:256-292`。

结论：

- Keep 现有 outbox、去标识、重试、Schema 预检与显式资料白名单；
- 新 Level/signals 先进入 Phoenix 主库合同；
- 是否把 `source_entry`、`subject_focus` 或 signals 投影飞书，需要单独的运营价值与隐私审批；
- 不把 Askwise handoff 放入飞书作为事实源或中转站；
- 小程序继续只调用 Phoenix API，不直连飞书、不保存飞书密钥。

## 12. Advisor / CRM Hooks

已实现的生产边界是 Advisor Request hook：

- `POST /v1/advisor-requests`；
- `GET /v1/me/advisor-requests`；
- `preferredTime`、`topic`、可选 `note/reportId/studentId`；
- 状态 `PENDING | CONTACTED | CLOSED`；
- 可写时间线并镜像飞书。

证据：`services/family-data.js:135-157`、`server/src/services/profile-service.ts:155-197`、`server/src/domain/model.ts:303-315`。

当前没有生产 CRM connector、advisor assignment、owner、SLA、contact history 或 CRM webhook。两个 admin 页面只是本地 demo，正式发布包已排除。因此当前能力应称为“顾问申请入口”，不能称为完整 CRM。

## 13. Current Test Fixtures 与 Mobile/Responsive Status

### 13.1 Current test fixtures

客户端主 fixture 使用合成数据：

- 家长“王女士”；
- 家庭“王女士家庭”；
- 学生“小明”，16 岁、A-Level、Year 11；
- 兴趣“机器人与音乐”；
- 家庭目标“帮助孩子找到适合的方向”。

见 `tests/run-tests.js:23-40`。

已有测试覆盖：

- Family → Student → Compass → Report → Timeline → Advisor；
- 23 字段与总权重 100；
- 69/70 完整度边界；
- 预览隔离、六模块顺序、历史数据迁移；
- 3990 支付、权益、退款、PDF、跨用户拒绝；
- remote 隐私边界；
- Feishu 合同与重试；
- 免费/付费 AI 分析和报告追问。

缺少：

- Level 1/Level 2 分流 fixture；
- 五个体系的题库 fixture；
- Growth Discovery 六项输出 fixture；
- Parent → Student assessment 关联 fixture；
- Askwise handoff 合同 fixture；
- `source_entry` 与新 signals fixture；
- 旧 ¥39.90 商品与新 Growth Discovery 独立 SKU/价格兼容 fixture；
- 多机型视觉回归。

本轮只读审计没有重新执行测试；最新已有记录是客户端通过、服务端 65/65，且不包含真实外部系统联调。

### 13.2 Mobile / responsive

已完成基础：

- 原生小程序移动端布局，大量使用 `rpx`、flex/grid；
- Welcome/Home 根据状态栏和微信胶囊计算自定义导航安全区；
- 问卷固定操作栏与购买栏使用 `env(safe-area-inset-bottom)`；
- 基础库配置为 3.7.12。

未完成证据：

- 源码 WXSS 没有 `@media` 窄屏断点；
- 学生表单与问卷选项存在固定两列布局；
- 购买按钮有 `300rpx` 最小宽度；
- 自动测试只有一个 430px iOS 导航尺寸 fixture；
- 没有多机型截图回归、Android/iOS 真机、横屏、大字号或完整无障碍验收。

结论只能写“已完成基础移动适配”，不能写“已完成全设备响应式验收”。

## 14. Conflict List vs New Product Model

| 严重度 | 冲突 | 当前事实 | 增量处理 |
|---:|---|---|---|
| P0 | 单 Assessment 承担免费与付费 | 同一 23 题先生成预览和完整报告 | 拆成两个 Assessment kind，以 sourceAssessment 关联 |
| P0 | respondent 不分层 | 只有 family_user；无 student respondent 合同 | 增加 respondent role；身份方式待确认 |
| P0 | Level 1 不存在 | 当前免费结果是学生付费报告 teaser | 新建短家长题库和 Family Education Snapshot |
| P0 | Level 2 范围过深 | 含专业、大学、路线、6—24 月规划 | 新报告只做六项 Growth Discovery 输出 |
| P0 | 新产品 ¥39.8 vs 用户本轮 ¥39.9 vs 旧 ¥39.90 SKU | 旧 3990 已被多层硬编码且交付语义不同 | 未确认前不改；确认后创建新 SKU/迁移，旧订单不覆盖 |
| P0 | 无体系题库路由 | education_system 只是显示文本 | canonical enum + common/system bank registry |
| P0 | 结果合同不一致 | 旧六模块无 bottleneck/subject/signals | 新增 versioned Level 2 result schema |
| P0/Open | 支付时点未冻结 | 当前答完旧问卷后付费解锁 | 产品确认后再改 |
| P1 | CTA 漏斗不同 | Preview→支付；Report→AI/顾问 | Parent→Student；Report→Askwise/¥980 reservation |
| P1 | 无 Askwise handoff | 全仓零实现 | 本轮只冻结 DTO |
| P1 | 无 `source_entry` | 没有渠道归因合同 | 添加受控枚举与 Assessment 关联 |
| P1 | Subject/signals 未结构化 | 散落自由文本或不存在 | 存入版本化结果合同 |
| P1 | advisor status 不统一 | 只存在单个 AdvisorRequest 状态 | 从 request 派生，不重复存 |
| P2 | 已有 Agent 较突出 | 三种 Agent purpose 已存在 | Keep isolated；本轮不新增、不扩展 |
| P2 | 199 会员旧占位 | 商品 inactive | 对 Compass Deprecate，不扩展 |

## 15. Current Safest Incremental Change Plan

### 15.1 保留页面，改变模式与合同

- `welcome`：保留品牌首屏，只调整 Free Parent Compass 入口文案；
- `home`：保留家庭中心，只调整状态机为 Parent-first；
- `compass`：保留产品卡、历史区与同意 UI，根据 assessment kind 展示 Level 1/Level 2；
- `compass-questionnaire`：保留 renderer，改为读取服务端确认的 bank/version/dimension；
- `compass-preview`：按 `result_kind` 渲染 Family Snapshot；旧 assessment 继续 legacy preview；
- `student-edit`：保留表单，使用 canonical education system；在建议继续后进入；
- `report`：保留通用模块循环，以 template version 渲染新六项或旧六模块；
- `payment-result`：完整保留，直到价格与付费时点确认；
- `advisor-request`：保留，通过 intent/report/student/source assessment 补齐漏斗上下文；
- `assessment-analysis/agent-chat`：保留旧能力和开关，新漏斗不新增入口、不扩展。

### 15.2 推荐版本注册

```text
legacy:
  education_compass_v1
  compass-six-modules-v1

new:
  free_parent_compass_v1
  student_growth_discovery_v1.common
  student_growth_discovery_v1.GAOKAO
  student_growth_discovery_v1.DSE
  student_growth_discovery_v1.IGCSE
  student_growth_discovery_v1.A_LEVEL
  student_growth_discovery_v1.AP_US
```

不要把旧 23 题原地改造成新题库；否则历史草稿无法稳定恢复、旧报告解释失真、订单审计也会失去版本依据。

### 15.3 Level 1 计划合同

目标时长 3—5 分钟，只围绕：

- 家庭教育关注点；
- 孩子当前阶段；
- 家长最担心的问题；
- 是否建议进入学生本人测评。

可从旧题库复用/改写 `school_stage`、`challenges`、`parent_observation`、`parent_expectation`；身份、地区、专业、路线、预算与住宿不属于 Level 1 默认必答。

### 15.4 Level 2 计划合同

目标时长 15—20 分钟；common bank + education-system bank 共享四个维度：

- `ACADEMIC_PERFORMANCE`；
- `LEARNING_PROCESS`；
- `THINKING_LEARNING_STYLE`；
- `INTEREST_DIRECTION`。

输出严格限制为：Student Snapshot、Strength Signals、Learning Bottlenecks、Subject Focus、Growth Direction、30-Day Action Plan。禁止录取概率、保证提分、保证录取或把 Level 3 深度规划下放到本层。

### 15.5 两套问卷模板的状态与命名

审计结论是：运行代码中没有两套独立问卷。现有 `education_compass_v1` 是“同一份 23 题 → 免费 preview → ¥39.90 解锁旧六模块”的历史链路，不是 Free Parent Compass 与付费 Student Growth Discovery。

以下模板是本次补充的**计划合同（Draft / Review Required）**，用于产品、教育内容、数据、隐私与工程联合评审；尚未写入 `models/`、服务端、数据库或小程序页面：

```yaml
free:
  questionnaire_version: free_parent_compass_v1
  assessment_kind: FREE_PARENT_COMPASS
  respondent_role: PARENT
  estimated_minutes: 3-5
  result_kind: FAMILY_EDUCATION_SNAPSHOT
  report_version: family_education_snapshot_v1

paid:
  questionnaire_version: student_growth_discovery_v1
  common_bank: student_growth_discovery_v1.common
  system_banks:
    - student_growth_discovery_v1.GAOKAO
    - student_growth_discovery_v1.DSE
    - student_growth_discovery_v1.IGCSE
    - student_growth_discovery_v1.A_LEVEL
    - student_growth_discovery_v1.AP_US
  assessment_kind: STUDENT_GROWTH_DISCOVERY
  respondent_role: STUDENT
  estimated_minutes: 15-20
  result_kind: STUDENT_GROWTH_DISCOVERY
  report_version: student_growth_discovery_report_v1
```

本轮按用户称谓把第二层写作“¥39.9 / ¥39.90 学生问卷”，但题库身份与商品价格解耦。上一版产品模型写 ¥39.8，现有 `COMPASS_REPORT_SINGLE_39_9` 又代表旧“完整成长规划报告”；即使新产品最终仍结算 3990 分，也应创建新的 Growth Discovery 商品/权益语义，不能复用旧 SKU，题库版本中也不得包含价格。

### 15.6 题库公共合同

两套模板只使用当前渲染器已经支持的 `single | multi | text`；五级量表仍按 `single` 渲染。后续落地时服务端必须成为题库版本、选项 code 和体系路由的事实源，客户端只消费服务端确认的只读视图。

每题至少包含：

```ts
interface QuestionnaireItemDraftV1 {
  id: string
  key: string
  label: string
  type: 'single' | 'multi' | 'text'
  required: boolean
  options?: Array<{ code: string; label: string; value?: number | null }>
  validation?: { minSelections?: number; maxSelections?: number; maxLength?: number }
  dimension?:
    | 'ACADEMIC_PERFORMANCE'
    | 'LEARNING_PROCESS'
    | 'THINKING_LEARNING_STYLE'
    | 'INTEREST_DIRECTION'
    | 'CONTEXT'
  signalCodes: string[]
  educationSystems: Array<'ALL' | 'GAOKAO' | 'DSE' | 'IGCSE' | 'A_LEVEL' | 'AP_US'>
  scored: boolean
}
```

公共五级选项 `AGREEMENT_5`：

| Code | 前台文案 | 规则值 |
|---|---|---:|
| `VERY_TRUE` | 非常符合 | 5 |
| `MOSTLY_TRUE` | 比较符合 | 4 |
| `PARTLY_TRUE` | 部分符合 | 3 |
| `MOSTLY_NOT_TRUE` | 不太符合 | 2 |
| `NOT_TRUE` | 很不符合 | 1 |
| `UNSURE` | 说不清 / 暂无足够信息 | 不计分 |

`UNSURE` 是有效回答，但降低相应维度置信度。不得把“未作答”“不确定”和低水平混为一类。

### 15.7 Free Parent Compass 问卷模板

目标：家长用最近 1—3 个月可观察到的事实，形成 `Family Education Snapshot`，决定是否建议邀请学生本人继续测评。共 10 道必答题 + 1 道选答题；不要求身份、学校、成绩原始记录、目标地区、专业、预算或住宿信息。下文 `LOW / MEDIUM / HIGH` 只表示“家庭当前关注优先级”，绝不表示学生能力高低。

| ID / Key | 题干 | 类型 | 选项 / 校验 | 主要输出 |
|---|---|---|---|---|
| `FPC-01 school_stage` | 孩子目前处于哪个学习阶段？ | single，必答 | `PRIMARY_LOWER` 小学低年级；`PRIMARY_UPPER` 小学高年级；`JUNIOR_SECONDARY` 初中；`SENIOR_SECONDARY` 高中；`POST_SECONDARY` 大学或其他；`UNSURE` 暂不确定 | stage context |
| `FPC-02 education_system_code` | 孩子目前主要使用哪种课程体系？ | single，必答 | `GAOKAO / DSE / IGCSE / A_LEVEL / AP_US / IB_LEGACY / OTHER / UNSURE`，前台显示中文标签 | system routing context |
| `FPC-03 family_education_focus` | 家庭目前最关注哪些方面？ | multi，必答 | 最多 3 项：`ACADEMIC_STABILITY / LEARNING_PROCESS / THINKING_METHOD / INTEREST_DIRECTION / SUBJECT_SELECTION / LEARNING_PRESSURE / PARENT_CHILD_COMMUNICATION / NEXT_STAGE_TRANSITION / NO_MAJOR_CONCERN`；`NO_MAJOR_CONCERN` 与其他项互斥 | concern areas |
| `FPC-04 parent_primary_concern` | 当前最希望先看清的一个问题是什么？ | single，必答 | `FOCUS_UNCLEAR / MOTIVATION_LOW / HABIT_INCONSISTENT / SUBJECT_GAP / PERFORMANCE_FLUCTUATION / INTEREST_UNCLEAR / LEARNING_PRESSURE_VISIBLE / COMMUNICATION_DIFFICULT / NO_MAJOR_CONCERN / UNSURE` | primary concern |
| `FPC-05 concern_duration` | 这个情况大约持续了多久？ | single，必答 | `LESS_THAN_1_MONTH / ONE_TO_THREE_MONTHS / THREE_TO_SIX_MONTHS / MORE_THAN_SIX_MONTHS / NOT_APPLICABLE / UNSURE` | evidence context |
| `FPC-06 observed_learning_state` | 最近孩子的学习状态更接近哪一项？ | single，必答 | `SELF_DIRECTED_STABLE / GENERALLY_STABLE / NEEDS_REMINDERS / AVOIDS_DIFFICULT_TASKS / VARIES_BY_SUBJECT / PRESSURE_VISIBLE / UNSURE` | observed learning signal |
| `FPC-07 observation_sources` | 你的判断主要来自哪些观察？ | multi，必答 | 最多 3 项：`HOMEWORK / TESTS / TEACHER_FEEDBACK / STUDENT_CONVERSATION / PROJECTS_ACTIVITIES / NO_CLEAR_EVIDENCE`；`NO_CLEAR_EVIDENCE` 与其他项互斥 | evidence refs |
| `FPC-08 child_view_alignment` | 你对孩子本人想法的了解更接近哪一项？ | single，必答 | `CLEAR_AND_ALIGNED / PARTLY_KNOWN / DIFFERENT_VIEWS / NOT_DISCUSSED / UNSURE` | child voice status |
| `FPC-09 parent_30d_goal` | 未来 30 天，家庭最希望先获得什么？ | multi，必答 | 最多 2 项：`UNDERSTAND_STRENGTH / LOCATE_BOTTLENECK / CHOOSE_SUBJECT_FOCUS / BUILD_ROUTINE / IMPROVE_CONVERSATION / DECIDE_SUPPORT` | priority focus |
| `FPC-10 student_readiness` | 孩子是否适合现在由本人完成下一步测评？ | single，必答 | `WILLING_NOW / DISCUSS_FIRST / NOT_WILLING_NOW / STAGE_NOT_SUITABLE / UNSURE` | next-step route |
| `FPC-11 parent_observation` | 如愿意，请补充一个最近真实发生的学习例子。 | text，选答 | 最多 300 字；提示不得填写姓名、电话、证件、精确地址、疾病诊断 | supporting evidence |

监护人同意继续使用现有独立 `GuardianConsent` 记录，不伪装成问卷题。学生拒绝或退出不是负面信号，也不得因为漏斗转化目标而覆盖。

### 15.8 Family Education Snapshot 规则与输出

免费问卷不输出“学生能力总分”。内部关注强度只用于决定卡片顺序和下一步文案，不用于排名、诊断或对外显示：

- 某维度被 `family_education_focus` 选中：该维度 +1 条证据；
- `parent_primary_concern` 映射到该维度：+2 条证据；
- `observed_learning_state` 命中相应维度：+1 条证据；
- `parent_30d_goal` 映射到该维度：+1 条证据；
- 关注持续 3 个月以上：只提高置信度和优先级，不解释为能力差或疾病。

下一步规则：

| Decision | 确定性条件 | 前台动作 |
|---|---|---|
| `START_LEVEL_2` | `WILLING_NOW`，且至少存在一个有两条独立 evidence ref 的关注信号 | 邀请学生进入 Growth Discovery |
| `DISCUSS_WITH_STUDENT` | `DISCUSS_FIRST`、`DIFFERENT_VIEWS`、`NOT_DISCUSSED` 或 `UNSURE` | 先展示 3 个亲子对话提示，再允许返回 |
| `PARENT_ACTION_FIRST` | `NOT_WILLING_NOW` 或 `STAGE_NOT_SUITABLE` | 给家长 7 天观察行动，不进入付费催促 |
| `NOT_ENOUGH_DATA` | 主要回答均为 `UNSURE` / `NO_CLEAR_EVIDENCE` | 建议补充观察后重测，不生成确定性结论 |

`LEARNING_PRESSURE / LEARNING_PRESSURE_VISIBLE / PRESSURE_VISIBLE` 只触发 `SUPPORTIVE_CONVERSATION` 中性提示，不计入付费转化推荐条件，也不形成心理或医疗判断。

```ts
interface FamilyEducationSnapshotV1 {
  result_kind: 'FAMILY_EDUCATION_SNAPSHOT'
  current_stage: string
  education_system_code: string
  family_focus: string[]
  primary_concern: string
  observed_signals: Array<{
    code: string
    dimension: 'ACADEMIC_PERFORMANCE' | 'LEARNING_PROCESS' | 'THINKING_LEARNING_STYLE' | 'INTEREST_DIRECTION'
    level: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN'
    evidence_refs: string[]
  }>
  child_voice_status: string
  support_message_codes: string[]
  recommended_student_assessment: {
    decision: 'START_LEVEL_2' | 'DISCUSS_WITH_STUDENT' | 'PARENT_ACTION_FIRST' | 'NOT_ENOUGH_DATA'
    reason_codes: string[]
  }
  parent_actions_7d: string[]
  completeness_score: number
  confidence: 'LOW' | 'MEDIUM' | 'HIGH'
  questionnaire_version: 'free_parent_compass_v1'
  report_version: 'family_education_snapshot_v1'
  disclaimer: string
}
```

### 15.9 ¥39.9 Student Growth Discovery common bank

进入条件：服务端确认监护人同意；学生阅读简明说明并主动确认由本人作答；商品权益和付费时点按最终商业决策另行处理。所有状态题以“最近 8 周”为观察窗口。

上下文与综合题：

| ID / Key | 题干 | 类型 / 选项 | 用途 |
|---|---|---|---|
| `SGD-C01 student_confirmation` | 我是学生本人，并愿意按最近真实情况作答。 | single，必答：`CONFIRM / NEED_EXPLANATION / NOT_STUDENT / EXIT` | respondent guard；非 `CONFIRM` 不进入评分 |
| `SGD-C02 education_system_code` | 请确认你目前主要使用的课程体系。 | single，必答：五个正式体系；`IB_LEGACY / OTHER / UNSURE` 不错误路由 | bank routing |
| `SGD-C03 system_stage` | 请确认当前年级或阶段。 | single，必答；选项由体系 registry 提供 | stage context |
| `SGD-C04 learning_bottleneck_self` | 你认为目前最影响学习的环节是什么？ | multi，必答，最多 3 项：`KNOWLEDGE_GAP / APPLYING_CONCEPTS / PLANNING / TASK_START / FOCUS / REVIEW / EXPRESSION / TIME_USE / HELP_SEEKING / UNSURE` | bottleneck evidence |
| `SGD-C05 recommended_focus_self` | 未来 30 天你最想先改善什么？ | multi，必答，最多 2 项：从上述学习环节和兴趣探索中选择 | recommended focus |
| `SGD-C06 current_learning_state` | 最近的整体学习感受更接近哪一项？ | single，必答：`ENERGETIC / GENERALLY_STABLE / UNCERTAIN / PRESSURED / VARIES_BY_SUBJECT / UNSURE` | Student Snapshot context；不作心理判断 |
| `SGD-C07 student_evidence_note` | 可选：写一个最近真实发生的学习例子。 | text，选答，最多 300 字；不得填写敏感个人信息 | supporting evidence |

四维共同题：

| 维度 | ID / Key | 题干 | 计分 / Signal |
|---|---|---|---|
| ACADEMIC_PERFORMANCE | `SGD-AP01 ap_stable_subject_evidence` | 我能用最近的作业、测验或作品，说明至少一门科目的当前表现。 | AGREEMENT_5 / `PERFORMANCE_EVIDENCE` |
| ACADEMIC_PERFORMANCE | `SGD-AP02 ap_gap_identification` | 我知道目前最需要补的是哪些知识点或任务。 | AGREEMENT_5 / `GAP_IDENTIFICATION` |
| ACADEMIC_PERFORMANCE | `SGD-AP03 ap_error_cause` | 失分后，我能分清主要来自知识、理解、应用、表达还是时间。 | AGREEMENT_5 / `ERROR_CAUSE_AWARENESS` |
| ACADEMIC_PERFORMANCE | `SGD-AP04 ap_variation_explanation` | 同一科目表现出现波动时，我通常能说明可能的原因。 | AGREEMENT_5 / `PERFORMANCE_STABILITY` |
| ACADEMIC_PERFORMANCE | `SGD-AP05 ap_core_task_completion` | 面对当前课程难度，我大多数时候能完成核心学习任务。 | AGREEMENT_5 / `CORE_TASK_READINESS` |
| LEARNING_PROCESS | `SGD-LP01 lp_weekly_priority` | 我通常知道本周最重要的学习任务。 | AGREEMENT_5 / `PRIORITY_CLARITY` |
| LEARNING_PROCESS | `SGD-LP02 lp_task_start` | 我能在计划时间开始任务，不需要反复提醒。 | AGREEMENT_5 / `TASK_INITIATION` |
| LEARNING_PROCESS | `SGD-LP03 lp_focus_recovery` | 走神或被打断后，我能重新回到任务。 | AGREEMENT_5 / `FOCUS_RECOVERY` |
| LEARNING_PROCESS | `SGD-LP04 lp_review_errors` | 我会处理错误，并再次验证自己是否真正掌握。 | AGREEMENT_5 / `ERROR_REVIEW` |
| LEARNING_PROCESS | `SGD-LP05 lp_seek_help_adjust` | 遇到困难时，我会先尝试，再求助或调整方法，而不是一直停住。 | AGREEMENT_5 / `HELP_SEEKING` |
| THINKING_LEARNING_STYLE | `SGD-TLS01 tls_break_down` | 面对复杂任务，我会把它拆成较小步骤。 | AGREEMENT_5 / `TASK_DECOMPOSITION` |
| THINKING_LEARNING_STYLE | `SGD-TLS02 tls_explain_reasoning` | 我能用自己的话说明思考过程，而不只是给出答案。 | AGREEMENT_5 / `REASONING_EXPLANATION` |
| THINKING_LEARNING_STYLE | `SGD-TLS03 tls_connect_example_rule` | 我会比较例子与规律，寻找它们之间的联系。 | AGREEMENT_5 / `CONCEPT_CONNECTION` |
| THINKING_LEARNING_STYLE | `SGD-TLS04 tls_switch_strategy` | 一种方法无效时，我愿意尝试另一种方法。 | AGREEMENT_5 / `STRATEGY_FLEXIBILITY` |
| THINKING_LEARNING_STYLE | `SGD-TLS05 preferred_learning_modes` | 哪些方式更帮助你理解？ | multi，最多 2 项：`DIAGRAM / EXAMPLE_FIRST / RULE_FIRST / READING / LISTENING / DISCUSSION / HANDS_ON / PRACTICE`；不计高低分 | 
| INTEREST_DIRECTION | `SGD-ID01 id_voluntary_explore` | 没有作业要求时，我也会主动了解某些主题。 | AGREEMENT_5 / `VOLUNTARY_EXPLORATION` |
| INTEREST_DIRECTION | `SGD-ID02 id_sustained_engagement` | 对感兴趣的事情，我愿意持续投入并完成一个阶段。 | AGREEMENT_5 / `SUSTAINED_ENGAGEMENT` |
| INTEREST_DIRECTION | `SGD-ID03 id_explain_interest` | 我能说明自己为什么喜欢或不喜欢某类学习内容。 | AGREEMENT_5 / `INTEREST_CLARITY` |
| INTEREST_DIRECTION | `SGD-ID04 id_interest_evidence` | 我有作品、阅读、活动或实践，可以说明自己的兴趣。 | AGREEMENT_5 / `INTEREST_EVIDENCE` |
| INTEREST_DIRECTION | `SGD-ID05 interest_domains` | 当前愿意继续探索哪些领域？ | multi，最多 3 项：`NATURAL_SCIENCE / ENGINEERING_TECH / HUMANITIES_SOCIAL / BUSINESS_ECONOMICS / LANGUAGE_COMMUNICATION / ARTS_DESIGN / SPORTS_HEALTH / COMMUNITY_SERVICE / UNSURE`；不计高低分 |

因此每次完整 Level 2 为 7 道上下文/综合题（其中 1 道选答）+ 20 道共同题 + 7 道体系题，共 34 道，预计 15—20 分钟。pilot 如显示中位完成时间超出 20 分钟，应删减重复证据题，而不是压缩阅读时间或降低有效回答门槛。

### 15.10 五个教育体系分库

每次 Level 2 只加载 common bank + 一个体系分库。每个分库使用以下 7 个字段，但年级、科目和瓶颈选项由该体系版本控制；因此既保持统一 schema，也避免把一套展示文本伪装成五套题库。

| Key | 题目 / 类型 | GAOKAO | DSE | IGCSE | A_LEVEL | AP_US |
|---|---|---|---|---|---|---|
| `current_subjects` | 当前正在学习的主要科目；multi，必答 | 内地高中科目 registry | DSE 核心/选修 registry | IGCSE subject registry | A-Level subject registry | 校内学科/AP course registry |
| `relative_strength_subjects` | 相对更有把握的科目；multi，最多 3 项 | 同左体系 registry | 同左 | 同左 | 同左 | 同左 |
| `challenge_subjects` | 当前最需要关注的科目；multi，最多 3 项 | 同左体系 registry | 同左 | 同左 | 同左 | 同左 |
| `recent_evidence_type` | 判断主要依据；multi，最多 3 项 | `HOMEWORK / QUIZ_TEST / MOCK_EXAM / TEACHER_FEEDBACK / PROJECT_COURSEWORK / SELF_OBSERVATION / NO_CLEAR_EVIDENCE` | 同一 code、体系化前台标签 | 同左 | 同左 | 同左 |
| `system_readiness` | 对当前体系核心任务的准备情况；single，AGREEMENT_5 | 我能跟上校内进度，并知道必修/选考科目的当前优先级。 | 我知道核心科与选修科的当前优先级和要求差异。 | 我能在多科并行中理解题目指令并安排准备节奏。 | 我能应对选科后的学科深度和较多独立学习。 | 我能平衡校内课程表现、AP 学习与阶段性考试准备。 |
| `system_task_bottleneck` | 当前体系中最卡住的任务；multi，最多 3 项 | `FOUNDATION / KNOWLEDGE_TRANSFER / TIMED_PRACTICE / ANSWER_FORMAT / ERROR_REVIEW / SUBJECT_TIME_ALLOCATION / UNSURE` | `SUBJECT_LANGUAGE / COMMAND_WORDS / EVIDENCE_ARGUMENT / TIMED_PRACTICE / SBA_IF_APPLICABLE / SUBJECT_BALANCE / UNSURE` | `SUBJECT_TERMS / COMMAND_WORDS / APPLICATION / PRACTICAL_COURSEWORK / MULTI_SUBJECT_SCHEDULE / NEXT_STAGE_TRANSITION / UNSURE` | `DEPTH / CROSS_TOPIC_CONNECTION / EXTENDED_RESPONSE / DATA_PRACTICAL / INDEPENDENT_STUDY / SUBJECT_BALANCE / UNSURE` | `COURSE_EXAM_BALANCE / COURSE_LOAD / MCQ_FRQ_FORMAT / ACADEMIC_WRITING / PROJECT_DEADLINES / COURSE_SELECTION / UNSURE` |
| `subject_focus_30d` | 未来 30 天准备优先验证或改善的科目；multi，最多 2 项 | 从 `challenge_subjects` 选择 | 同左 | 同左 | 同左 | 同左 |

首发 fallback subject registry：

- `GAOKAO`：语文、数学、英语、物理、化学、生物、历史、地理、思想政治、信息科技、其他；
- `DSE`：中国语文、英国语文、数学、公民与社会发展、数学延伸单元、物理、化学、生物、经济、企业会计与财务概论、地理、历史、信息及通讯科技、视觉艺术、其他；
- `IGCSE`：English/ESL、Mathematics、Additional Mathematics、Physics、Chemistry、Biology、Combined Science、Computer Science、Business/Economics、History/Geography、Languages、Arts、其他；
- `A_LEVEL`：Mathematics、Further Mathematics、Physics、Chemistry、Biology、Economics、Business、Psychology、Computer Science、History、Geography、English Literature、Art & Design、其他；
- `AP_US`：English/ELA、Mathematics、Biology、Chemistry、Physics、History/Social Science、Economics、Computer Science、World Language、Arts、其他 AP 课程。

这些列表是产品首发 fallback，不宣称覆盖所有学校、考试局或地区课程。所有科目多选额外提供互斥的 `UNSURE`；`challenge_subjects` 另提供互斥的 `NO_CLEAR_CHALLENGE`；`subject_focus_30d` 提供互斥的 `NO_CURRENT_FOCUS`。后续 subject registry 需由教育内容负责人版本化评审；`IB_LEGACY / OTHER / UNSURE` 只运行 common bank 并输出 `SYSTEM_BANK_PENDING`，不得错误映射到五个正式体系。

### 15.11 Growth Discovery 信号、完整度与报告映射

完整度与分析强度分开：

- `completeness_score` 只表示回答覆盖率，不表示能力；
- 上下文 6 道必答题必须完成，学生确认必须为 `CONFIRM`；
- 四个维度各至少回答 4 道适用题；偏好/领域选择计入完整度，但不计高低；
- 体系分库 7 道均需回答，允许选择 `UNSURE`；
- 某维度有效计分题少于 4 道时输出 `UNKNOWN / INSUFFICIENT_DATA`，禁止补猜。

维度内部规则不生成对外百分制：

- `ESTABLISHED`：至少 3 道相关题为 4—5，且不存在两道或以上 1—2；
- `EMERGING`：至少 2 道相关题为 1—2；
- `DEVELOPING`：信息充分但不满足以上两项；
- `UNKNOWN`：有效证据不足。

Strength Signal 至少需要两条同方向 evidence ref；Learning Bottleneck 至少需要两道低响应，或一项学生自选瓶颈 + 一项体系题/近期证据。单题不得形成确定结论。`Subject Focus` 只来自 `challenge_subjects`、`subject_focus_30d` 和近期证据，最多 3 科；没有交叉证据时标记 `NEEDS_VALIDATION`。

```ts
interface StudentGrowthDiscoveryReportV1 {
  result_kind: 'STUDENT_GROWTH_DISCOVERY'
  student_snapshot: {
    education_system_code: string
    grade_stage: string
    summary: string
    completeness_score: number
    confidence: 'LOW' | 'MEDIUM' | 'HIGH'
  }
  strength_signals: LearningSignal[]
  learning_bottlenecks: LearningSignal[]
  subject_focus: Array<{
    subject_code: string
    reason_codes: string[]
    evidence_refs: string[]
    validation_status: 'SUPPORTED' | 'NEEDS_VALIDATION'
  }>
  growth_direction: Array<{
    code: string
    rationale: string
    evidence_refs: string[]
    validation_action: string
  }>
  action_plan_30d: {
    objectives: string[]
    weeks: Array<{ week: 1 | 2 | 3 | 4; actions: string[]; evidence_to_collect: string[] }>
    review_questions: string[]
  }
  learning_signals: LearningSignal[]
  recommended_focus: string[]
  questionnaire_versions: string[]
  report_version: 'student_growth_discovery_report_v1'
  disclaimer: string
}

interface LearningSignal {
  code: string
  dimension: 'ACADEMIC_PERFORMANCE' | 'LEARNING_PROCESS' | 'THINKING_LEARNING_STYLE' | 'INTEREST_DIRECTION'
  level: 'EMERGING' | 'DEVELOPING' | 'ESTABLISHED' | 'UNKNOWN'
  evidence_refs: string[]
}
```

六项输出映射固定为：

| 报告区块 | 允许的数据源 | 禁止内容 |
|---|---|---|
| Student Snapshot | context、四维 band、体系上下文 | 排名、智力/人格标签、心理或医疗诊断 |
| Strength Signals | 至少两条正向 evidence ref | 仅凭 AI 推测的“天赋” |
| Learning Bottlenecks | 低响应、自选瓶颈、体系证据 | 固定性缺陷标签 |
| Subject Focus | challenge + 30d focus + evidence | 大学匹配、录取概率 |
| Growth Direction | 1—3 个可验证方向 | 完整升学路线、专业定论 |
| 30-Day Action Plan | top focus、具体证据收集 | 保证提分、保证录取、6—24 个月规划 |

Askwise 预留使用精确合同字段：`subject_focus` 直接读取；`learning_bottlenecks[].code` 由 adapter 映射为 `learning_bottleneck`；`learning_signals` 与 `recommended_focus` 直接读取。不得传姓名、电话、学校、地址、原始自由文本或支付信息。

### 15.12 上线前内容与安全门槛

1. 两套模板必须经过产品负责人、至少一名熟悉五个体系的教育内容负责人、隐私/未成年人数据负责人和工程负责人签字评审；它们当前不是已验证的心理量表或学业能力测验。
2. 先做小规模认知访谈，确认学生能理解题干和选项；再做 pilot，检查完成时长、跳题、`UNSURE` 比例、重复作答稳定性与报告可解释性。
3. 禁止收集未成年人手机号、证件号、精确地址；学校名称不是必答项；自由文本明确提示不要填写敏感信息。
4. 结果免责声明固定为：“本结果基于本次自我报告及已提供学习证据形成成长快照，不是心理、医疗或学业能力诊断，也不构成提分、升学或录取承诺。”
5. 如果回答显示压力已明显影响日常学习或生活，只给出中性支持提示，建议与可信任成年人或合格专业人士沟通；不得诊断、恐吓或以此强推付费。
6. 后续如使用现有 AI 分析能力，AI 只能解释已经由确定性规则形成的结构化信号，不能创造证据、疾病判断、能力排名或录取结论。
7. 保留 `education_compass_v1`、旧报告、旧订单和权益的只读兼容；新模板使用新 Assessment/Report kind，不原地覆盖历史问卷。
8. 本节只完善审计交付物。支付时点、3990/3980 金额、数据库 migration、前端路由、Agent、飞书投影和真实发布仍需单独批准与实施。

## 16. Askwise Handoff Reservation

仓库目前没有 Askwise/问思实现，也没有以下四个字段。建议本轮只冻结纯数据合同：

```ts
interface AskwiseHandoffV1 {
  contract_version: 'education_support_handoff_v1'
  handoff_type: 'ASKWISE_LEARNING_SUPPORT'
  family_id: string
  student_id: string
  assessment_id: string
  report_id: string
  education_system: 'GAOKAO' | 'DSE' | 'IGCSE' | 'A_LEVEL' | 'AP_US'
  grade_stage: string
  subject_focus: string[]
  learning_bottleneck: string[]
  learning_signals: Array<{
    code: string
    level: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN'
    evidence_ref: string[]
  }>
  recommended_focus: string[]
  source_entry: string
  report_version: string
  advisor_status: 'NOT_REQUESTED' | 'PENDING' | 'CONTACTED' | 'CLOSED'
  status: 'RESERVED'
}
```

边界：

- 只从已完成的 Level 2 结构化报告生成；
- 复用 Family/Student/Assessment/Report ID；
- 不包含姓名、电话、学校、地址、原始自由文本答案、支付或 Agent 数据；
- 可用 `assessment_id + report_version + ASKWISE` 构造未来幂等键；
- 当前只定义 DTO/validator 或未来 provider interface；
- 本轮不实现 POST route、OAuth、webhook、双向状态同步、飞书中转或 Askwise 数据库；
- 真正出站前再确定原 ID、边界伪名化、同意、保留期、删除 SLA 与失败状态。

## 17. Suggested 3-Sprint Update Plan

### Sprint 1｜合同拆分与 Free Parent Compass

- 建立 Git/备份基线，冻结 V1 legacy；
- 冻结 `FREE_PARENT_COMPASS`、`STUDENT_GROWTH_DISCOVERY`、respondent、sourceAssessment 和 sourceEntry 合同；
- 新增 005 migration 设计与兼容测试，但不改 001—004；
- 建版本化题库 registry 与 canonical education-system mapping；
- 复用 Compass、questionnaire、preview 页面实现 3—5 分钟家长问卷；
- 输出 Family Education Snapshot 与“是否建议进入学生测评”；
- Home/Mine 改为 Parent-first；
- 不改支付、不接 Askwise、不扩 Agent。

### Sprint 2｜Student Growth Discovery

- 明确学生 respondent/assent 方式；
- 接入 common bank + 五体系路由 bank；
- 给题目增加 dimension、subject、signal evidence 合同；
- 输出新版六项结果；
- 报告页按 template version 兼容新旧内容；
- 移出大学匹配、完整路线和 6—24 月规划；
- 新增两层、五体系、草稿恢复和历史兼容 fixture；
- 价格/支付时点仍未确认时，继续使用禁用 capability 或演示状态。

### Sprint 3｜商业边界与交接准备

- 获得明确支付批准后，才按最终确认的 3980 或 3990 分创建新 SKU，并完成金额/回调/退款回归；旧 3990 SKU 不覆盖；
- 定义 Askwise Handoff V1 validator/provider interface，但不连接外部系统；
- 为 Askwise 与 ¥980 只准备 capability/interest/advisor intent，不开发产品；
- 关联现有 AdvisorRequest，统一派生 advisor status；
- 决定新 signals 是否允许投影飞书；
- 完成 iOS/Android、多尺寸、大字号、历史报告、支付迁移与隐私人工验收。

## 18. Future Interfaces：当前不需要开发

以下全部 Defer：

- ¥980 Deep Student Assessment 的完整题库、支付、报告、AI Profile、Advisor Interview 与 Professional Review；
- Askwise API client、OAuth、webhook、双向同步与运营后台；
- CRM connector、advisor assignment、SLA 与自动状态回写；
- 新 Agent 或现有 Agent 扩展；
- Wealth Compass、Identity Compass、完整 Family OS；
- Partner/Permission 未来模型；
- 自动申请、提分/录取保证和录取概率；
- 未批准的新价格层或支付时点；
- 飞书新增敏感字段投影。

## 19. Open Issues

1. 用户本轮称 ¥39.9，而上一版产品模型写 ¥39.8：新 Growth Discovery 最终是否结算 3990 分，且是否创建独立新 SKU？
2. Level 2 是付款后答题、答题后付款看结果，还是允许试答？
3. Level 1 是否允许没有完整 Student profile 开始；Student ID 在何时创建？
4. 学生本人是否需要独立登录，还是监护人会话内切换 respondent mode；是否需要学生 assent？
5. 是否确认 Level 1 与 Level 2 使用两个 Assessment ID，并以 sourceAssessment 关联？
6. 第 15.7—15.11 节的 draft 题量、必答项、完成门槛与信号规则由哪些产品/教育内容/隐私负责人批准；pilot 的通过标准是什么？
7. IGCSE 是独立路由还是 A-Level 前置阶段？
8. 当前 IB 与“其他”是否继续支持？
9. Grade/Stage/Subject 的跨体系 canonical taxonomy 是什么？
10. 是否批准本审计的“枚举 + evidence refs + rule band”模型，并明确禁止前台展示伪精确总分？
11. 是否批准第 15.8 节 Level 1 的确定性路由规则与第 15.12 节免责声明？
12. `source_entry` 的允许值、渠道归因窗口和小红书 deep-link 规则是什么？
13. 新结果由确定性规则、现有报告服务、人工审阅还是已有 AI 分析生成？本轮不应默认扩 Agent。
14. 旧 ¥39.90 已购报告、PDF、AI 分析、追问、退款和权益保留多久？
15. Askwise 的 subject taxonomy、同意、ID 边界、保留期、删除 SLA 和失败状态是什么？
16. Advisor status 的事实源是 Phoenix AdvisorRequest 还是未来 CRM？
17. ¥980 CTA 暂时显示“了解/预约”、写入 AdvisorRequest，还是完全隐藏？
18. 新 signals/source entry 是否允许同步飞书？
19. 新版本最低微信基础库、窄屏、大字号、横屏和无障碍验收矩阵是什么？
20. 真实 Source Catalog、PostgreSQL migration、微信支付、飞书与真机联调由谁批准和验收？

## 20. Final Keep / Modify / Deprecate / Defer

| 主要模块 | 分类 | 明确结论 |
|---|---|---|
| Welcome/Home/Compass/Questionnaire/Preview/Report UI shell | **Keep + Modify** | 保留结构与品牌，只改 entry、label、route、contract、CTA |
| Brand mark 与全局 WXSS primitives | **Keep** | 不重写 |
| Family/Student 主数据与 ID | **Keep** | 三层共享，不另建孤岛 |
| Assessment ID、草稿、answers JSON、完整度框架 | **Keep + Modify** | 增加 kind/respondent/sourceAssessment/version routing |
| `education_compass_v1` 23 题 | **Deprecate for new entry** | 历史草稿/报告只读兼容，不原地改写 |
| `free_parent_compass_v1` 文档模板 | **Draft / Review** | 已补齐逐题、选项、路由与 Snapshot 合同；尚未实现 |
| `student_growth_discovery_v1.*` 文档模板 | **Draft / Review** | 已补齐 common bank、五体系分库、信号与六项报告合同；尚未实现 |
| Education System 文本值 | **Modify** | canonical code + legacy mapping |
| 当前免费学生 preview | **Modify** | 新 Level 1 改为 Family Education Snapshot；旧 preview 保留 |
| 当前六模块完整规划报告 | **Deprecate for Level 2** | 旧已购报告保留；深度内容未来属于 Level 3 |
| 通用 Report renderer、versions、sources、QA | **Keep + Modify** | 按 template/report kind 分流 |
| 微信下单、验签、查单、权益、退款 | **Keep** | 不重写 |
| `COMPASS_REPORT_SINGLE_39_9` 新购语义 | **Deprecate after approval** | 历史不可覆盖；新 SKU/价格等待确认 |
| Payment price/timing migration | **Defer pending confirmation** | 本轮不改、不启用 |
| Timeline | **Keep + Modify** | 增加 Level 事件类型 |
| AdvisorRequest | **Keep + Modify** | 复用为 Askwise/¥980/顾问 intent，不称完整 CRM |
| 生产 CRM | **Defer** | 当前不存在，本轮不开发 |
| Feishu outbox/伪名/重试/Schema preflight | **Keep** | 新字段另行审批 |
| Feishu Growth Signals projection | **Defer** | 数据合同和隐私批准后再做 |
| 现有 AI analyses / Agent follow-up | **Keep isolated / Defer expansion** | 不删除旧能力；不新增、不启用为新漏斗核心 |
| Askwise handoff DTO | **Reserve** | 只冻结合同 |
| Askwise 真实同步 | **Defer** | 不开发 |
| ¥980 Level 3 产品 | **Defer** | 只做接口/CTA状态准备 |
| 199 会员占位 | **Deprecate for Compass** | 已 inactive，不纳入新漏斗 |
| Admin demo pages | **Defer** | 正式包继续排除 |
| Existing Mock/InMemory tests | **Keep + Extend later** | 增补两层、五体系、新结果与兼容 fixture |
| 大范围 UI 重构 | **Defer / Avoid** | 当前无必要 |

## 21. 审计结论与下一步门槛

审计结果支持增量更新，不支持重做。现有 UI 和底层交易/数据骨架的复用价值很高；真正需要变化的是产品语义、Assessment 类型、题库路由、结果合同与 CTA。

在开始改代码前，至少确认以下五项：

1. 新 Growth Discovery 最终是 ¥39.8/3980 分还是 ¥39.9/3990 分，并确认独立 SKU；
2. Level 2 的付款时点；
3. Student respondent/身份/assent 方式；
4. 第 15.7—15.12 节两套题库、五体系内容和 signals 通过内容、隐私与 pilot 评审；
5. 旧 V1/¥39.90 历史兼容期限。

未确认这些门槛前，不应修改现有支付合同，也不应大范围重构前台。
