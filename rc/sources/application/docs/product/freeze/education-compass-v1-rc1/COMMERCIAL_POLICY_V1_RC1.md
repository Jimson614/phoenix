# Commercial Policy V1 RC1

> 产品策略状态：`FROZEN_BY_PRODUCT_MANIFEST`；真实支付激活为 `NOT_AUTHORIZED`。  
> 版本：`education_growth_discovery_commercial_v1.0.0-rc1`

## 1. 商品冻结值

```yaml
product_code: EDUCATION_GROWTH_DISCOVERY_SINGLE_V1
product_name: Education Growth Discovery 单次报告
amount_fen: 3990
currency: CNY
display_price: "¥39.90"
display_price_source: DERIVED_FROM_AMOUNT_FEN
payment_timing: AFTER_SUBMIT_BEFORE_REPORT
submit_before_payment: true
submitted_result_state: LOCKED
entitlement_deliverable: STUDENT_GROWTH_DISCOVERY_REPORT_V1
purchase_quantity_per_order: 1
partial_refund: NOT_SUPPORTED
```

## 2. 与历史商品隔离

- 历史 `COMPASS_REPORT_SINGLE_39_9` 即使同为 3990 分，也对应旧六模块报告，不得改名、覆盖或授予新报告权益。
- 新旧商品必须使用不同 product code、订单产品快照、entitlement kind、报告版本和 feature flag。
- 历史订单、报告、PDF、退款与权益继续只读兼容；禁止迁移脚本把旧权益批量转换成新权益。
- Level 3 ¥980、Family Passport 199 元／年会员和其他服务均为独立商品，不进入本商品目录。

## 3. 解锁与失败语义

- 服务端订单与查单结果是支付事实源；客户端成功回调不能单独授予权益。
- 支付状态不是权威 `PAID` 时，报告、PDF、付费 Agent、ASKWISE 生产 handoff 均 fail closed。
- 重复预支付／通知／查单必须幂等，不得重复创建订单、交付报告或 session。
- 付款前的 locked 响应遵守结果政策的“零六项结果泄露”规则。
- 支付成功后授予单一报告权益；同一 Assessment 的重复查询返回同一 Report 和 Entitlement。

## 4. 退款

```yaml
refund_after_success:
  revoke:
    - STUDENT_GROWTH_DISCOVERY_REPORT_ACCESS
    - PDF_ACCESS
    - PAID_REPORT_AGENT_ACCESS
    - NEW_ASKWISE_HANDOFF_CREATION
  preserve:
    - MINIMUM_FINANCIAL_AUDIT
    - REFUND_AUDIT
    - PREVIOUSLY_GRANTED_CONSENT_AUDIT
```

- 已创建的 ASKWISE session 不因退款被静默删除；停止新数据发送，并按独立 Consent/retention SOP 处理。
- 退款状态未知时不提前恢复权益；人工例外必须有授权人与审计原因。

## 5. 五日 ASKWISE 联调的支付边界

- 正式产品规则仍为 3990 分、提交后付款、付款后报告。
- 2026-08-25 至 2026-08-29 的 ASKWISE／鳌鱼集成 UAT 明确不开发或验证真实支付。
- UAT 只能使用 `INTERNAL_UAT + TEST_ENTITLEMENT` 与合成数据；界面和证据必须标注测试，不得称为真实付费闭环。
- 五日“不做支付”不覆盖本商业冻结值；它只限制该集成 Sprint 的实施范围。

## 6. 启用闸门

以下全部满足前，`EDUCATION_GROWTH_DISCOVERY_SINGLE_V1` 保持关闭：Freeze 已签署、独立 feature flag、微信商户/证书/回调域名完成 staging 核验、金额快照测试通过、退款与权益撤回通过、iOS/Android 真机人工确认，并获得单独的真实扣款与退款授权。
