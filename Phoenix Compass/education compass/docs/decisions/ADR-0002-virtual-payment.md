# ADR-0002：改用小程序虚拟支付

- 状态：Accepted（代码已实现；沙箱、现网与 iOS 受控测试未做）
- 日期：2026-10-12
- 取代：[ADR-0001](ADR-0001-paid-compass.md) 中「服务端用 API v3 JSAPI 下单、客户端调用 wx.requestPayment」的支付渠道部分；收费前锁定报告、服务端为事实源等其余决策不变

## 背景

微信 2026-02-27 更新《小程序虚拟支付业务管理规范》：小程序内销售虚拟商品（含在线教育、付费内容、解锁功能等），自 2026-04-01 起全终端必须接入小程序虚拟支付，只含虚拟类目的小程序会被关闭普通微信支付。付费测评报告属于这一范畴，豁免只有线上问诊和法律咨询。本小程序的虚拟支付已于 2026-10-12 前签约（offerId 已知）。

## 决策

- 用 `wx.requestVirtualPayment` 道具直购（`short_series_goods`）。只配置一个道具：V0.5「学生成长发现」完整报告，3990 分。旧版 `COMPASS_REPORT_SINGLE_39_9` 不配置道具，不能购买。
- 签名在服务端：`paySig` 用对应环境的 AppKey；用户态 `signature` 用 `session_key`。客户端每次支付前调用 `wx.login`，服务端用这个新 code 换取 `session_key`，用后即弃，不存储——这样既不会遇到 session_key 过期，也不新增需要保护的数据。
- 平台订单号只能使用一次：同一订单每次尝试一个新单号，全部记在 `orders.payment_params.attempts`；推送用 attach 中的订单 ID 找回订单。不新增迁移。
- 支付结果来自消息推送（安全模式 + JSON）和 `query_order` 查单，两条路径复用同一幂等事务；查单确认的付款调用 `notify_provide_goods`。沙箱与现网共用一个推送地址，服务只处理本环境的推送。
- 退款用 `refund_order`。iOS（Apple 支付）不能由开发者发起退款，只应答 Apple 的退款问询，口径与 OD-07 一致。
- 原 API v3 商户证书方案（`wechat-pay-provider.ts`、`/v1/webhooks/wechat-pay/*`、`set-wechat-pay.sh`）整体删除。

## 后果

- iOS 收入经 Apple 结算，扣佣后约在自然月结束后 45–60 天到账；当前费率表：安卓等终端主动支付标准 10%、当前 1%，iOS 标准 17%（含 Apple 12%）、当前 12%。
- iOS 没有沙箱，iOS 测试只能在现网用真钱，且无法由我们退款。
- 同一订单的两次尝试都被付款时只能人工退款（审计 `DUPLICATE_PAYMENT_MANUAL_REFUND_REQUIRED`），因为退款台账按订单一笔。
- 页面文案不再写「微信支付」，改为中性的「支付并解锁」「微信平台通知」。

## 未决

见 [OPEN_DECISIONS.md](../OPEN_DECISIONS.md) 的 OD-01、OD-02、OD-03、OD-11 与上线闸门第 5 条，操作见 [WECHAT_PAY_RUNBOOK.md](../WECHAT_PAY_RUNBOOK.md)。
