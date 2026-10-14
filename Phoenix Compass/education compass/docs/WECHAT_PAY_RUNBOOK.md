# 小程序虚拟支付手册：Education Compass ¥39.90

## 1. 适用范围

本产品是小程序内销售的虚拟商品（付费测评报告）。按微信《小程序虚拟支付业务管理规范》（2026-02-27 更新，2026-04-01 起执行），这类商品在全部终端都必须走**小程序虚拟支付**，普通微信支付（JSAPI）能力会被关闭。原来的 API v3 商户证书方案已经整体移除。

- 只出售一个道具：V0.5「学生成长发现」完整报告（商品 `EDUCATION_GROWTH_DISCOVERY_SINGLE_V1`，道具 ID `EC_GROWTH_REPORT_V1`，道具名称「付费版问卷分析报告」），3990 分、CNY，模式为道具直购（`short_series_goods`）。旧版 `COMPASS_REPORT_SINGLE_39_9` 没有配置道具，不能购买。
- `wx.requestVirtualPayment` 在 iOS 上走 Apple 支付，在 Android、鸿蒙、Windows 上走微信支付。小程序只拉起支付；订单和权益的事实源在服务端。

官方依据（每次上线前复核）：

- 虚拟支付总览、消息推送字段与签名：https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment.html
- 技术服务费：https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment/devplan.html
- `wx.requestVirtualPayment`：https://developers.weixin.qq.com/miniprogram/dev/api/payment/wx.requestVirtualPayment.html
- 查单 / 退款 / 通知已发货：https://developers.weixin.qq.com/miniprogram/dev/server/API/VirtualPayment/api_query_order 、api_refund_order 、api_notify_provide_goods
- 消息推送（安全模式验签与解密）：https://developers.weixin.qq.com/miniprogram/dev/framework/server-ability/message-push.html
- 业务运营指南：https://developers.weixin.qq.com/community/minihome/doc/00002cf077cd4810fee42f4b865c01

## 2. 开通与后台配置（小程序管理员操作）

1. 小程序后台「虚拟支付」开通：签协议 → 提交营业执照、提现账户、支付管理员 → 审核 1–7 个工作日 → 账户验证 → 扫码签约（约 1–2 个工作日）。显示「已签约」即开通了一个新的微信支付商户号。
2. 「虚拟支付 → 基础配置」：记下 offerId；沙箱 AppKey 与现网 AppKey 是秘密，只用 `ops/server/set-virtual-payment.sh` 隐藏输入录到服务器。
3. 配置**小程序简称**（iOS 走 Apple 支付必须有）。
4. 「虚拟支付 → 道具管理」：建一个普通道具：道具 ID `EC_GROWTH_REPORT_V1`（后台限制最多 20 个字符；改用别的 ID 要同时写进 `WECHAT_XPAY_GROWTH_PRODUCT_ID`），名称「付费版问卷分析报告」，价格 39.90 元，关联关系选「自定义」，道具图片 200×200、PNG/JPG、小于 200KB。先上传到开发版本供沙箱测试，沙箱通过后再发布到现网（发布后约 10 分钟生效）。
5. 「开发管理 → 消息推送」：URL `https://<API 域名>/v1/webhooks/wechat-message`，消息加解密方式选**安全模式**，数据格式选 **JSON**，Token 与 EncodingAESKey 与服务器配置一致。保存时微信会立即访问 URL 校验，所以必须先部署服务端、录好 Token 和 EncodingAESKey 再保存。一个小程序只有一个推送地址，沙箱与现网的推送都到这里。

## 3. 配置项

不要把任何真实值提交到仓库、粘贴到聊天或工单、打印到日志或打进小程序。

| 变量 | 用途 | 是否秘密 |
| --- | --- | --- |
| `PAYMENT_PROVIDER` | `mock` 或 `wechat`（= 虚拟支付）；生产禁止 mock | 否 |
| `WECHAT_APP_ID` / `WECHAT_APP_SECRET` | code2Session、获取接口凭证（stable_token） | Secret 是 |
| `WECHAT_XPAY_OFFER_ID` | 基础配置里的 offerId | 否 |
| `WECHAT_XPAY_ENV` | `1` 沙箱、`0` 现网；生产必须为 `0` | 否 |
| `WECHAT_XPAY_APP_KEY` | 与 `WECHAT_XPAY_ENV` 对应的 AppKey，用于 `paySig` | 是 |
| `WECHAT_XPAY_GROWTH_PRODUCT_ID` | 道具 ID，最多 20 个字符，默认 `EC_GROWTH_REPORT_V1` | 否 |
| `WECHAT_MESSAGE_TOKEN` | 消息推送 Token（3–32 位字母数字） | 是 |
| `WECHAT_MESSAGE_AES_KEY` | 消息推送 EncodingAESKey（43 位） | 是 |
| `GROWTH_DISCOVERY_PAYMENT_ENABLED` | V0.5 报告的收款开关，默认 `false` | 否 |
| `SOURCE_CATALOG_MODE` / `SOURCE_CATALOG_PATH` | 生产只能为 `verified` | 否 |

录入与体检：`./set-virtual-payment.sh --check [--env-file …]`、`./set-virtual-payment.sh --env 1|0 [--env-file …] [--only xpay|message]`。联调环境传 `--env-file …/server/.env.uat`。改完需重启服务。

## 4. 上线闸门

### 小程序候选包

仓库根目录只用于开发/demo，禁止直接上传。用已批准参数生成 `dist/release`（`PHOENIX_API_BASE_URL=https://... PHOENIX_MINIPROGRAM_APPID=wx... npm run build:release`），只上传该目录。API/AppID 参数不是支付上线证据，仍须满足服务端闸门。

### 服务端闸门

1. `PAYMENT_PROVIDER=wechat`，生产 `WECHAT_XPAY_ENV=0`，offerId、AppKey、Token、EncodingAESKey 格式正确且 AppKey 不复用其他密钥（启动时校验，失败拒绝启动）。
2. 道具已发布到现网，价格 39.90 元，道具 ID 与配置一致。
3. 消息推送已用安全模式 + JSON 保存成功（URL 校验通过）。
4. 小程序简称已配置。
5. `DATABASE_URL` 指向已迁移的生产 PostgreSQL 且 `sslmode=verify-full`。
6. `SOURCE_CATALOG_MODE=verified`；隐私、条款、监护人同意版本已配置。
7. `GROWTH_DISCOVERY_PAYMENT_ENABLED` 最后开启，并需要书面发布批准。

任一检查失败都不得退回 mock，也不得向客户端返回可用的签名。

## 5. 正常支付链路

1. 用户已登录；测评已提交，报告已在收费前生成并通过 QA（`LOCKED/LOCKED`、`qaPassed=true`）。
2. 客户端用幂等键创建订单；服务端固定 3990 分。
3. 客户端调 `wx.login` 拿新的登录码，`POST /v1/orders/:id/virtual-payment {code}`。服务端 code2Session，要求 OpenID 等于当前用户的微信身份，用返回的 `session_key` 计算 `signature`，用 AppKey 计算 `paySig`；`session_key` 用后即弃。签名前再次检查收款开关、同意、商品、道具配置与报告锁定状态。
4. 平台订单号只能用一次：第一次尝试用订单号，之后每次重试换新号，全部记在订单的 `payment_params.attempts`。重试前先查之前的尝试，已付款就直接结算。
5. 客户端把 `signData/paySig/signature/mode` 原样传给 `wx.requestVirtualPayment`，之后只查服务端订单，不自行标记已支付。
6. 支付成功后平台推送 `xpay_goods_deliver_notify`；服务端核对并在同一事务中写事件、订单 `PAID`、一次 `ACTIVE` 权益、报告 `READY/DELIVERED`，回 `success`（即视为已发货）。
7. 推送没到时，查单补偿：`GET /v1/orders/:id` 至少每 5 秒查一次平台，逐个查全部尝试；查到已付款的复用同一幂等事务，并调用 `notify_provide_goods` 告知已发货。

## 6. 消息推送处理

- 只接受安全模式：`msg_signature = sha1(sort(Token, timestamp, nonce, Encrypt))` 校验后，用 `Base64(EncodingAESKey + "=")` 作 AES-256-CBC 密钥、前 16 字节作 IV 解密，PKCS#7 块大小 32；明文为 `random(16) + len(4, 大端) + msg + AppID`，AppID 必须是本小程序。
- 128KB 上限、5 秒读取期限、按来源限流；回 `success` 无需加密，带内容的回包（iOS 退款问询）加密签名后返回。返回非成功时微信最多重试 15 次（间隔 2、4、8、16… 秒）。
- 发货推送：`Env` 不是本服务环境的直接确认、不处理；用 `GoodsInfo.Attach`（订单 ID）找订单，`OutTradeNo` 必须是该订单的尝试号，核对道具 ID、数量 1、实付 3990 分、付款 OpenID；按尝试号幂等。找不到订单返回 404 让微信重试。
- 退款推送：本库找不到订单视为另一环境，确认不处理；`RetCode=0` 成功、撤回权益；没有退款记录的（Apple 自行退款、后台手工退款）补记 `PLATFORM_REFUND`。
- iOS 退款问询：3 秒内应答，按 OD-07 同一政策（7 天内且未下载 → 0 不拦截；否则 1 拦截并附依据），最终由 Apple 决定。
- 投诉、风控事件：只记投诉单号、事件类型到审计日志，不存投诉正文；需人工在虚拟支付后台处理。

## 7. 常见事件处理

### PENDING 时间过长

1. 查本地订单、`payment_params.attempts` 和审计记录。
2. `GET /v1/orders/:id` 触发查单（至少间隔 5 秒），逐个查全部尝试。`query_order` 的 `status`：2/3/4 已支付，5/7/8 退款状态，6 已关闭，0/1 未支付。
3. 已支付：走与推送相同的幂等事务并通知已发货。
4. 虚拟支付没有关单接口：过期且全部尝试未付款时本地取消。平台明确回答没有这笔单（`268490002`「数据不存在」，买家没付款就关了支付弹窗）算未付款；其他查单错误（网络、签名、参数）算情况不明，要等过期 30 分钟后才算未付款。
5. 不得因为客户端截图或 success 回调人工写 `PAID`。

### 重复付款

同一订单两次尝试都付款，或已取消订单在新订单付款后又收到付款，服务端保留一笔，另一笔写 `DUPLICATE_PAYMENT_MANUAL_REFUND_REQUIRED` 审计。按审计里的单号到「虚拟支付 → 交易订单」人工退款，退款推送到达后台账自动核对。

### 紧急关闭购买

1. `GROWTH_DISCOVERY_PAYMENT_ENABLED=false` 并重启，确认新创单与新签名均被拒绝。
2. 保留推送、查单、退款、报告读取和已购权益；不删除在途订单。
3. 已签名的尝试之后付款成功，仍按收费前锁定的报告交付；目录或事实问题走事故与退款流程，不以拒绝交付代替退款。

### 金额、道具或付款人不一致

不接受、不部分交付，推送返回错误让平台重试并告警；用 `query_order` 核实。日志不记完整 OpenID。

### 报告未解锁

依次核对：订单 `PAID` → 权益 `ACTIVE` → 报告 `READY/DELIVERED` → 支付事件与时间线是否落库。修复走幂等补偿，不改客户端缓存。

## 8. 退款

- 只由服务端管理员接口发起（RBAC、幂等键、原因、审计），政策见 OD-07（7 天内且未下载；因我方原因走 `MERCHANT_FAULT`）。
- 调 `refund_order`（需要买家 OpenID、本次剩余可退金额 `left_fee`），再用 `query_order` 查退款单（5/8 成功，7 失败）。持久化任务每分钟扫描 `PROCESSING`，以同一退款单号幂等重放并查询。
- 账号已注销的订单没有 OpenID，只能在虚拟支付后台人工退款。
- 注销时还没签过支付的订单（`CREATED`）直接关闭；已签过支付的（`PENDING`）保持原状，因为付款可能还在路上。这类订单之后到账时，服务端找不到付款人、不会交付，要在虚拟支付后台按单号人工退款。
- iOS（Apple 支付）订单开发者不能发起退款，接口返回 `REFUND_APPLE_UNSUPPORTED`；用户向 Apple 申请，我们只应答退款问询。
- 支付 180 天内的退款平台退还手续费；支付超过 365 天的订单不能再通过接口退款。
- 退款成功撤回权益；`SUCCESS` 单调，迟到的其他状态不得恢复访问。
- 退款成功后报告重新锁定为待购买（没有其他有效权益时）；同一份报告退款后可以重新购买一次，退款满两次后下单返回 `409 REPURCHASE_LIMIT_REACHED`。规则改动前退款、仍显示已交付的报告，在下次下单时先重新锁定。

## 9. 密钥轮换

- AppKey：在后台重置后，用 `set-virtual-payment.sh --only xpay` 录入并重启；重置到录入之间的签名会失败（用户重试即可），推送不受影响。
- Token / EncodingAESKey：先用 `--only message` 录入新值并重启，再立即在后台保存同样的新值。两步之间到达的推送验签失败，微信会重试，不会丢。
- 每次轮换记录时间、执行人和回滚点。

## 10. 测试

- Android / 鸿蒙 / Windows：`WECHAT_XPAY_ENV=1` + 沙箱 AppKey + 道具开发版本，可在联调环境完整测试正常支付、取消、推送重复、推送丢失（查单补偿）和退款。**沙箱也会真实扣款**（2026-10-13 实测弹出银行卡并扣款，官方文档没写这一点）：每笔测试付款都要随后退款，测试人员要事先知道。
- iOS：**Apple 支付不支持沙箱**，只能在现网用真钱测（最低 1 元），且开发者不能主动退款。需要 iOS 15+、微信 8.0.68+、中国大陆 App Store 账户。iOS 现网测试要单独审批，测试期间推送地址对应的服务须配置 `WECHAT_XPAY_ENV=0`。
- 自动化测试覆盖：官方文档的签名、解密示例；重试换单号、晚到推送、重复付款、过期取消；平台退款；iOS 退款问询；推送入口（`server/tests/wechat-virtual-payment.test.ts`、`domain.test.ts`、`http.test.ts`）。

## 11. 监控与告警

至少关注：签名接口错误率；PENDING 订单年龄；推送验签/解密失败；金额、道具、付款人不一致；`DUPLICATE_PAYMENT_MANUAL_REFUND_REQUIRED`、`PAYMENT_COMPLAINT_RECEIVED`、`PAYMENT_RISK_EVENT_RECEIVED`、`IOS_REFUND_QUERY_ANSWERED` 审计；PAID 无 ACTIVE 权益；退款 `PROCESSING` 年龄。告警不得包含 AppKey、Token、EncodingAESKey、完整 OpenID、问卷答案或报告正文。

## 12. 发布与回滚

- 先跑 `npm run test:p0`；数据库迁移先于服务端，服务端先于小程序。
- 收款开关最后开启；回滚时先关开关，只停止新创单和新签名，保留推送、查单、退款与已购报告。
- 不删除在途订单、支付事件或权益。
