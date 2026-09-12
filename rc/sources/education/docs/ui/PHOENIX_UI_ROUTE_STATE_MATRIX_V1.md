# Phoenix UI Route & State Matrix V1

> 文档状态：当前代码事实  
> 基线日期：2026-08-26  
> 路由来源：`app.json`  
> Release 边界来源：`scripts/build-release.js`  
> 关联规范：[UI Design System](./PHOENIX_UI_DESIGN_SYSTEM_V1.md)

## 1. 图例

| 标记 | 含义 |
|---|---|
| **Y** | 当前 WXML 有独立、可见的对应状态或分支 |
| **I** | 当前仅有行内、局部或控件级状态，不是整页独立分支 |
| **—** | 当前没有显式对应状态 |
| **RELEASE** | 保留在正式家庭端构建 |
| **DEMO_ONLY** | 仅源码/内部演示；正式构建必须排除 |

“—”是实现事实，不代表视觉层可以自行增加数据状态。若需要补充网络错误、空态或禁用逻辑，必须另立功能变更并修改对应 JS/服务契约。

## 2. 16 / 14 / 2 发布边界

源码 `app.json` 按顺序注册 16 页。Release 构建通过明确排除规则移除两个 `pages/admin-*` 演示页，得到 14 页家庭端原生小程序。

### 2.1 Release：14 页

1. `pages/welcome/index`
2. `pages/home/index`
3. `pages/family-edit/index`
4. `pages/student-edit/index`
5. `pages/compass/index`
6. `pages/compass-questionnaire/index`
7. `pages/compass-preview/index`
8. `pages/payment-result/index`
9. `pages/report/index`
10. `pages/assessment-analysis/index`
11. `pages/agent-chat/index`
12. `pages/timeline/index`
13. `pages/advisor-request/index`
14. `pages/mine/index`

### 2.2 Demo only：2 页

1. `pages/admin-families/index`
2. `pages/admin-family/index`

Release 构建必须继续满足：

- `app.json` 正式产物页面列表等于源码列表减去 `pages/admin-*`。
- 双分析页、已购报告追问页、Compass 入口、问卷和锁定预览仍保留。
- 两个 demo admin 页面不得作为生产 CRM、顾问后台或 release 能力宣传。

## 3. 路由状态矩阵

| Route | 边界 | Loading | Error / Blocked | Empty / Onboarding | Content | Disabled / Busy | 特有状态与必须保留的边界 |
|---|---|---:|---:|---:|---:|---:|---|
| `welcome` | RELEASE | I | — | — | Y | — | CTA `loading`；自定义导航安全区；`showAdvisorDemo` 内部入口只在允许时出现 |
| `home` | RELEASE | Y | Y | Y | Y | — | `!family` onboarding；家庭/学生阶段、下一步、最近洞察均由服务端状态派生 |
| `family-edit` | RELEASE | I | — | — | Y | Y | 初始 `loading` 期间保存禁用；`saving` 按钮忙态；创建/编辑复用同一表单 |
| `student-edit` | RELEASE | I | — | — | Y | Y | 初始 `loading` 期间保存禁用；`saving`；孩子档案创建/编辑；两列表单窄屏降一列 |
| `compass` | RELEASE | Y | Y | I | Y | I | V0.5 Level 1 / Level 2、legacy、demo badge、监护人核心同意、学生本人 Assent、`creating`、可选历史报告 |
| `compass-questionnaire` | RELEASE | Y | Y | Y | Y | Y | V0.5 / legacy 两套题型；服务端草稿恢复；saving、submitting、routeReloading；矩阵空值；保存退出 |
| `compass-preview` | RELEASE | Y | Y | Y | Y | Y | `family`、`growth-locked`、`growth-full`、`legacy`；paying；支付通道不可用；付款前正文严格锁定 |
| `payment-result` | RELEASE | Y | Y | I | Y | I | checking；无 order 时维持待核验刷新；PAID、PENDING、PAYING、FAILED、CANCELLED、EXPIRED、CREATED；只信服务端 |
| `report` | RELEASE | Y | Y | I | Y | I | growth 未交付、GENERATING、full incomplete、growth/full/legacy/preview-locked；PDF/反馈忙态；AI 总分析、追问和管理入口 |
| `assessment-analysis` | RELEASE | Y | Y | — | Y | Y | CONSENT、LOADING、RUNNING、PENDING、RESULT、BLOCKED、ERROR；免费/付费分层；双重同意、可信来源、监护人提示 |
| `agent-chat` | RELEASE | Y | Y | Y | Y | Y | 不可用、首次双重同意、历史加载、对话空态、运行/有限轮询、额度、同意失效、撤回、删除、管理旧会话 |
| `timeline` | RELEASE | Y | Y | Y | Y | — | skeleton、下拉恢复提示、事件时间线、首条记录引导、授权范围说明 |
| `advisor-request` | RELEASE | I | — | — | Y | Y | 初始 loading/未同意时提交禁用；submitting；可选备注；submitted 成功页；授权摘要边界 |
| `mine` | RELEASE | Y | — | I | Y | Y | 订单局部空态；consentBusy；五类授权独立撤回；家庭/孩子/报告统计 |
| `admin-families` | DEMO_ONLY | — | — | Y | Y | — | 搜索结果、无匹配、无家庭；内部演示边界文案；不得进入 release |
| `admin-family` | DEMO_ONLY | Y | — | Y | Y | — | overview 未就绪 loading；学生、报告、申请、备注、时间线各自局部空态；内部备注；不得进入 release |

## 4. 状态触发与视觉检查点

### 4.1 Welcome

- **Content**：正常进入页面。
- **Busy**：触发“开始家庭成长规划”，确认按钮 spinner 不造成宽度跳动。
- **Demo-only entry**：仅在 `showAdvisorDemo` 为真时出现；正式家庭端不能凭视觉新增入口。
- **检查**：状态栏与微信胶囊安全区、两处羽毛不拦截 CTA。

### 4.2 Home

- **Loading**：首次读取或刷新期间。
- **Error**：服务端失败，显示恢复按钮。
- **Onboarding**：`!family`。
- **Content**：已有家庭，可分别覆盖无主学生、已有学生、无最新报告和有报告。
- **检查**：动态家庭名、目标、地区和下一步文案可换行。

### 4.3 Family / Student Edit

- **Initial busy**：页面数据尚未读取时，保存按钮禁用。
- **Saving**：提交时显示按钮 loading。
- **Content**：新建和编辑数据均需检查；长家庭目标、学校名和兴趣文本不能溢出。
- 当前没有独立 error/empty 分支，视觉验收不得伪造其已通过。

### 4.4 Compass

- **Loading / Error**：读取服务端题库、商品和进度。
- **V0.5 L1**：监护人核心同意。
- **V0.5 L2**：监护人同意 + 学生本人 Assent。
- **Legacy**：旧版三项同意。
- **History**：有/无历史报告。
- **Busy**：`creating`。
- 同意缺失时的业务阻断由现有逻辑负责，视觉层不得通过擅自禁用或绕过改变行为。

### 4.5 Questionnaire

- **Loading**：服务端题库与草稿。
- **Error**：加载或题库切换失败。
- **Empty**：`!current`。
- **Content**：单选、多选、动态多选、文本和成绩区间矩阵。
- **Busy/Disabled**：saving、submitting、routeReloading 下的保存退出、返回、继续。
- **Special**：已恢复草稿、未填写矩阵、末题提交、V0.5 与 legacy 分支。

### 4.6 Preview / Payment

- Preview 必测 `family`、`growth-locked`、`growth-full`、`legacy` 和无结果。
- Locked 状态不得出现完整结论、signals、evidence 或六项正文。
- Paying 时购买按钮禁用并保持价格和服务端权威说明可见。
- Payment result 必测全部订单状态，以及 checking 与 error 同时显示的恢复路径。
- 客户端 `wx.requestPayment` 结果不得直接渲染为已支付。

### 4.7 Report

- **Loading / Error**。
- **Growth locked/generating/not-ready**。
- **Growth ready**：六项内容、依据、版本和免责声明。
- **Legacy full / legacy free / preview locked**。
- **局部空态**：单模块无 lines/items。
- **Busy**：PDF 和反馈提交。
- **AI entries**：paid analysis、follow-up、management 分别按已有权限变量显示，不合并。
- 可信来源、免责、反馈和家庭/顾问角色边界不得因布局压缩而隐藏。

### 4.8 Assessment Analysis

- **CONSENT**：学生与监护人两项均未选、仅选一项、两项选中。
- **LOADING / RUNNING / PENDING**：包含有限轮询达到上限后的刷新按钮。
- **RESULT**：关键理解、下一步、限制、可信来源可分别为空或非空。
- **BLOCKED / ERROR**：安全阻断与一般不可用使用同一错误壳但不同文案。
- **Special**：免费有限分析与已购报告总分析必须保持独立标题和返回目标。

### 4.9 Agent Chat

- **Page loading / error / ineligible**。
- **Consent**：两项同意与禁用主按钮。
- **Conversation**：历史 loading、无消息、用户消息、AI 回复。
- **Run**：PENDING、BLOCKED、FAILED、poll limit。
- **Disabled**：发送中、runId 存在、同意撤回、无可发送文本。
- **Management**：仍可发现、撤回或删除旧会话；删除按钮和 `data-id` 不得丢失。

### 4.10 Timeline / Advisor / Mine

- Timeline：loading skeleton、error、events content、empty。
- Advisor：未提交、未勾选授权、submitting、submitted；没有独立网络 error 页。
- Mine：loading、正常内容、无订单、consentBusy；五类撤回按钮必须同时禁用并保持危险层级。

### 4.11 Demo Admin

- Admin families：有数据、搜索无匹配、完全无数据。
- Admin family：loading、完整 overview，以及五类局部空态。
- 两页只能作为源码内演示覆盖；正式包检查重点是**不存在**。

## 5. 矩阵维护规则

- 新增路由时必须同步 `app.json`、此矩阵、release 边界测试和视觉验收清单。
- 新增状态时必须同时记录触发条件、恢复动作、a11y 语义和是否进入 release。
- 纯视觉修改只能改变呈现，不得改变状态计算、事件 handler 或权限条件。
- 自动化契约通过不等于视觉通过；设备状态见[视觉验收报告](./PHOENIX_UI_VISUAL_ACCEPTANCE_REPORT_V1.md)。

