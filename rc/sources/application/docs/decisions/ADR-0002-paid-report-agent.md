# ADR-0002：已购报告的有限 AI 解读

- 状态：Accepted for V0.4.0 code candidate
- 日期：2026-08-22
- 决策范围：Phoenix Family OS Mini Program MVP V0.4.0

## 背景

V0.3.0 已把 Education Compass 六模块报告在收费前生成、QA并锁定，微信可信支付只授予报告权益。V0.4.0 需要增加 AI 能力，但不能破坏报告事实、支付状态机、未成年人隐私或飞书镜像边界。

## 决策

- Agent 仅为已购、`READY/DELIVERED`、QA通过报告的监护人解读与追问；每份报告最多三个成功回复。
- 报告生成、QA、价格、支付、退款、权益和飞书不由 Agent 驱动。
- 小程序只调用 Phoenix API；OpenAI Responses API、Key、Prompt、moderation和模型配置只存在于可信后端。
- 每轮使用 `store:false` 的独立请求，不启用工具或远端长期记忆。上下文由服务端从最小报告快照和有限本地加密消息重建。
- Agent 使用独立、版本化、会话专属的监护人同意；每次处理及返回正文都重检所有权、权益、报告状态和同意。
- 内容字段级 AES-256-GCM 加密，默认30天保留；日志、飞书、analytics和release没有正文。
- API只入队；生产由独立 worker 领取。OpenAI故障与慢请求不得占用支付 webhook 资源。
- 退款或撤回后停止处理并拒绝正文，但继续提供无正文管理摘要、删除和法定数据请求渠道。

## 被否决的方案

1. **小程序直连 OpenAI**：会泄露 Key、Prompt和信任边界，无法可靠执行付费墙与数据最小化。
2. **让 AI 生成收费报告**：会改变已经验证的收费前报告/QA顺序，并把模型故障带入扣款链路。
3. **使用 ChatGPT 网页、Cookie 或 Custom GPT 私链**：没有适合本产品的正式服务端合同与授权边界。
4. **给模型支付、飞书或数据库工具**：违反只读解释范围，并放大 Prompt injection 后果。
5. **把对话同步飞书或长期留在小程序 storage**：扩大未成年人内容暴露面且无运营必要性。
6. **在 HTTP 请求内同步等待模型**：会导致客户端超时、重复请求和关键资源争用。

## 后果

- 新增 003 migration、Agent repository/worker/API和原生对话页。
- 生产启用需要 OpenAI Project/Key、批准模型、费用告警、未成年人披露/同意、数据处理与必要 ZDR、危机升级文案和人工SOP。
- `store:false` 和环境开关只是技术控制，不构成合规或上线证据。
- Agent 可以独立关闭；关闭后已购报告、PDF、支付、退款和飞书运营镜像仍可运行。
