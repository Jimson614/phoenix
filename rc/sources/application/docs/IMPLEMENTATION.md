# Phoenix Compass™ Free MVP｜实现说明

## ACTIVE BASELINE（冻结）

当前唯一有效闭环：**测评 → Growth Snapshot → 1–5 分反馈**。

以下能力不属于本基线：价格或付费产品、付费 CTA、支付及购买跳转、商业化环境变量和产品配置、付费转化事件、用户数据库、会员系统、Family OS，以及未来模块的注册、路由、调用或 UI。未来模块仅允许保留无运行时行为的类型接口。

## 体验与架构

核心路径：Landing → Assessment（5 屏 7 字段）→ 服务端生成 → Growth Snapshot → Feedback。

当前版本仅验证免费体验，不包含产品推荐、价格、支付 CTA 或购买跳转。未来的 Growth Profile Agent、Growth Pattern Agent、Blueprint Agent 与 Family OS 只在 `src/lib/compass/extensions.ts` 保留纯类型适配器边界；没有实现、注册、路由、运行时调用或 UI。当前 AssessmentInput / GrowthSnapshot 是稳定契约，AI 调用集中在 `src/lib/ai`，页面不直接依赖模型供应商。

## 输入数据结构

```ts
type AssessmentInput = {
  assessment_version: "free-mvp-v1.0";
  age_band: AgeBand;
  grade_band: GradeBand;
  location: Location;
  identity_status: IdentityStatus;
  curriculum: Curriculum;
  interests: Interest[]; // 1–2；exploring 与其他选项互斥
  family_goal: FamilyGoal;
  language: "zh-CN";
};
```

API 拒绝任何额外字段，避免姓名、学校、电话、成绩等 PII 被误传。身份字段不进入用户级分析属性。

## 输出数据结构

```ts
type GrowthSnapshot = {
  result_version: "growth-snapshot-v1.0";
  growth_type: { title: string; summary: string };
  strength_signals: Array<{ title: string; evidence: string }>; // 3
  possible_directions: Array<{
    title: string;
    reason: string;
    micro_action: string;
  }>; // 2–3
  today_action: string;
  disclaimer: string;
};
```

模型返回后仍执行运行时校验。输出只允许上述字段；额外字段会被拒绝，规范化时也会按白名单重建结果。免责声明由代码覆盖，不能由模型修改。

## AI Prompt 结构

`src/lib/ai/prompt.ts` 包含：

1. Role：Phoenix Compass™ Growth Snapshot Agent。
2. Mission：将有限结构化回答整理成方向快照。
3. Grounding：成长类型只来自兴趣；优势信号必须注明输入依据。
4. Action：每个方向必须有 7 天内低成本行动。
5. Safety：禁止诊断、保证、录取预测、身份价值判断与虚构事实。
6. Free scope：禁止推荐或销售产品，不得输出价格、支付或购买链接。
7. Output：Responses API 严格 JSON Schema。

API 最多尝试两次，每次 3.2 秒；无密钥、超时、拒绝、非法结构或网络错误时返回个性化安全规则模板。

## 会话与分析

- 进度、回答与结果只存于 `sessionStorage`，刷新当前标签页可恢复。
- 没有账号、Cookie 身份、长期家庭档案或数据库。
- 事件通过一个 typed analytics adapter 推送到 `window.dataLayer` 与浏览器自定义事件，便于后续接入实际分析平台。
- 事件只包含版本、设备、时长分桶、生成状态与评分；不包含原始开放文本或身份信息。
