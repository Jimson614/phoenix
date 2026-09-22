# WeChat Pay Runbook：Education Compass ¥39.90

## 1. 适用范围

本手册用于普通商户模式的原生微信小程序支付。商品为 COMPASS_REPORT_SINGLE_39_9，服务端固定金额3990分、CNY。小程序只调起收银台；订单和权益的事实源在服务端。

官方依据应在每次上线前复核：

- JSAPI/小程序下单：https://pay.wechatpay.cn/doc/v3/merchant/4012791897
- 小程序调起支付：https://pay.wechatpay.cn/doc/v3/merchant/4012791898
- 支付成功通知：https://pay.wechatpay.cn/doc/v3/merchant/4012791861
- 回调与查单：https://pay.wechatpay.cn/doc/v3/merchant/4012075249
- API v3规则：https://pay.wechatpay.cn/doc/v3/merchant/4012081606

## 2. 配置原则

环境变量只保存引用或由秘密管理注入的值。不要把任何真实值提交到仓库、粘贴到工单、打印到日志或打进小程序。

| 变量 | 用途 | 是否秘密 |
| --- | --- | --- |
| NODE_ENV | development/test/production | 否 |
| PORT | 服务监听端口 | 否 |
| PUBLIC_BASE_URL | 对外HTTPS origin；无路径、查询、fragment或userinfo | 否 |
| DATABASE_URL | PostgreSQL连接；production必须显式 `sslmode=verify-full` | 是 |
| SESSION_SECRET | 服务端会话签名/派生密钥 | 是 |
| PAYMENT_PROVIDER | mock 或 wechat | 否 |
| WECHAT_APP_ID | 已认证小程序 AppID | 通常不作为密钥，但不必进前端配置以外位置 |
| WECHAT_APP_SECRET | code2Session凭据 | 是 |
| WECHAT_MCH_ID | 微信支付商户号 | 敏感配置 |
| WECHAT_MCH_CERT_SERIAL_NO | 商户API证书序列号 | 敏感配置 |
| WECHAT_MCH_PRIVATE_KEY_PATH | 只读私钥文件路径 | 是 |
| WECHATPAY_API_V3_KEY | 通知资源解密 | 是 |
| WECHATPAY_PUBLIC_KEY_ID | 微信支付公钥ID | 敏感配置 |
| WECHATPAY_PUBLIC_KEY_PATH | 只读验签公钥路径 | 敏感配置 |
| WECHAT_PAY_NOTIFY_URL | 支付公网HTTPS通知地址 | 否 |
| WECHAT_REFUND_NOTIFY_URL | 退款公网HTTPS通知地址 | 否 |
| PAID_COMPASS_ENABLED | ¥39.90购买 kill switch；默认 `false` | 否 |
| SOURCE_CATALOG_MODE | `verified` 或 `placeholder`；生产只能为 `verified` | 否 |
| SOURCE_CATALOG_PATH | 已批准、通过 schema 校验的来源清单路径 | 否（清单本身应受控） |

若实现中的变量名不同，以 server/.env.example 为准并同步更新本表。

### 2.1 五项支付凭据从哪里取

> **⚠️ 先看这里：本节描述的普通商户号（JSAPI）这条路，对本产品很可能不适用。**
> 微信 2026-02-27 更新《小程序虚拟支付业务管理规范》，要求小程序内销售虚拟商品
> （含「在线教育、视频课程」形态）自 2026-04-01 起全终端接入**小程序虚拟支付**，
> 并会关闭这类小程序在安卓等非 iOS 端的**普通微信支付**能力。付费测评报告属于该范畴，
> 豁免只有线上问诊和法律咨询。虚拟支付走 `wx.requestVirtualPayment` 和 `/xpay/*`
> 接口（HMAC-SHA256 + AppKey + session_key），与本手册描述的 API v3 商户证书体系
> 完全不同，商户号也改为在小程序后台「虚拟支付」模块单独开通。
> 在与平台确认本小程序的类目判定之前，不要按本节申请商户 API 证书。
> 依据：[虚拟支付：企业、个体户](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment)、
> [虚拟支付业务运营指南](https://developers.weixin.qq.com/community/minihome/doc/00002cf077cd4810fee42f4b865c01)

全部在**微信支付商户平台** https://pay.weixin.qq.com，需要超级管理员登录并通过操作证书或短信验证。前置条件：已有微信支付商户号（申请需营业执照与对公账户），且商户号与本项目的小程序 AppID 已完成关联——商户平台「产品中心 → AppID 账号管理」发起关联，再由小程序管理员在微信公众平台确认。未关联时下单会返回 appid 与 mchid 不匹配。

| 变量 | 商户平台位置 | 注意 |
| --- | --- | --- |
| `WECHAT_MCH_ID` | 账户中心 → 商户信息 | 10 位数字，登录后右上角也能看到 |
| `WECHAT_MCH_CERT_SERIAL_NO` | 账户中心 → API 安全 → API 证书 → 申请/查看证书 | 40 位十六进制。证书由「微信支付证书工具」在本机生成 |
| `WECHAT_MCH_PRIVATE_KEY_PATH` | 同上，证书工具生成的 `apiclient_key.pem` | 私钥只在生成时那一次能拿到；丢失只能作废重申 |
| `WECHATPAY_API_V3_KEY` | 账户中心 → API 安全 → APIv3 密钥 → 设置密钥 | 自己定的 32 个字符；设置后不可查看，只能重置 |
| `WECHATPAY_PUBLIC_KEY_ID` / `WECHATPAY_PUBLIC_KEY_PATH` | 账户中心 → API 安全 → 微信支付公钥 → 下载公钥 | 得到 `PUB_KEY_ID_…` 和 `pub_key.pem`。本实现只支持公钥模式，不走已弃用的平台证书 |

录入用 `ops/server/set-wechat-pay.sh`：隐藏输入、校验格式、核对私钥与证书是否配套、把两个 PEM 装到 `/etc/phoenix/wechatpay`（目录 700、文件 600），并按 §3 的同源固定路径规则写好两个回调地址。`--check` 是只读体检，随时可重跑。

### 2.2 小程序服务器域名

微信公众平台 https://mp.weixin.qq.com → 开发管理 → 开发设置 → 服务器域名 → 修改。本项目实际发起的网络请求只有两类，因此只需登记两处，且填同一个域名：

- **request 合法域名**：`https://api.<域名>`（`services/api.js` 的 `wx.request`）
- **downloadFile 合法域名**：同上（`services/report.js` 的报告 PDF 下载）

uploadFile、socket、udp 合法域名都不需要——代码里没有对应调用。业务域名（web-view）也不需要，项目没有 `web-view` 组件。域名必须是已完成 ICP 备案的 HTTPS 域名，不能填 IP、端口或路径；服务器域名每月可修改的次数有限，一次填完整。

支付回调地址（`WECHAT_PAY_NOTIFY_URL` / `WECHAT_REFUND_NOTIFY_URL`）是微信服务器到本服务的调用，不需要登记为合法域名，但同样要求公网可达的、已备案域名上的 HTTPS。

## 3. 生产启动闸门

### 小程序候选包

仓库根目录只用于开发/demo，禁止直接上传。使用已批准参数生成正式候选包：

```text
PHOENIX_API_BASE_URL=https://... PHOENIX_MINIPROGRAM_APPID=wx... npm.cmd run build:release
```

微信开发者工具只导入`dist/release`。发布前核对`RELEASE_BUILD.json`、`project.config.json`和产物清单：运行模式必须为remote；页面从`app.json`和demo-admin排除规则动态派生（当前14个家庭端页面并含双分析/追问页）；不得含本地数据库、demo报告生成器、admin页、OpenAI SDK/服务端Prompt/Key或`server/`源码。API/AppID参数不是支付或Agent上线证据，仍须满足以下服务端闸门。

### 服务端闸门

production 启动时必须检查：

1. PAYMENT_PROVIDER=wechat；mock 必须拒绝启动或禁用购买。
2. AppID 不是 touristappid，且与商户号绑定。
3. 商户私钥、证书序列号、API v3密钥、微信支付公钥ID/公钥全部可读。
4. `PUBLIC_BASE_URL` 是无凭据/路径/查询的公网 HTTPS origin；两个notify URL必须与它同源，且路径分别精确为 `/v1/webhooks/wechat-pay/transactions` 和 `/v1/webhooks/wechat-pay/refunds`。
5. DATABASE_URL 指向已迁移、可事务写入的生产 PostgreSQL，并显式使用 `sslmode=verify-full` 与受信CA完成主机名/证书校验；任何私网明文例外都必须单独风险审批，当前代码不接受。
6. `SOURCE_CATALOG_MODE=verified`，`SOURCE_CATALOG_PATH` 指向已批准且通过 schema 校验的 manifest；缺失或无效时启动/收费均失败关闭。适用年份与内容时效由发布审批另行核验。
7. 隐私/条款/监护人同意版本已配置。
8. `PAID_COMPASS_ENABLED` 默认保持 `false`。受控真机支付验收只能在支付配置齐全并取得书面测试审批后临时设为 `true`；生产常开还必须等待全部上线证据和最终发布批准。

任一检查失败都不得自动回退到 mock，也不得向客户端返回可调起支付的参数。

## 4. 正常支付链路

1. 用户已登录，服务端持有其当前小程序 OpenID。
2. assessment 已提交：有效监护人同意、同一份23字段问卷合同往返一致、完整度不低于70。
3. 服务端按规则与 verified Source Catalog 生成全部六模块并完成事实/安全QA；只有 `qaPassed=true`、`status=LOCKED`、`deliveryStatus=LOCKED` 的完整快照可进入收费。
4. 客户端用幂等键创建订单；服务端忽略客户端金额并固定写入3990分。`PHOENIX_MEMBER_199` 不能替代本SKU，也不能解锁本报告。
5. 服务端创建/复用唯一 out_trade_no，将订单的 `expiresAt` 作为微信请求 `time_expire`，把订单置为 `PENDING` 并调用微信 JSAPI/小程序下单。
6. 服务端生成 timeStamp、nonceStr、package、signType、paySign，客户端调用 wx.requestPayment。
7. 客户端回到页面后只轮询服务端订单，不自行写 `PAID` 或解锁。
8. 服务端验证并解密通知，核对 appid、mchid、订单号、transaction_id、SUCCESS、3990和CNY。
9. 在同一事务中记录 provider event、把订单改为 `PAID`、授予一次 `ACTIVE` 权益，并把既有报告改为 `status=READY`、`deliveryStatus=DELIVERED`。支付回调不得再生成、补写或QA报告正文。
10. 回调未到时由服务端主动查单补偿；查单响应必须验签并复用同一幂等交付事务。

创单和预支付各自都检查 `PAID_COMPASS_ENABLED=true`、verified Source Catalog版本一致、六模块完整和QA锁定。不要依靠仅隐藏客户端按钮来关闭收费。

## 5. 回调处理

- 读取原始请求体，不能在验签前重新序列化。
- 必需签名头、时间窗和声明长度在占用处理槽前快验；应用限制回调body为128KB、读取期限5秒，并配置短headers/request/keepalive timeout。
- 使用 Wechatpay-Timestamp、Wechatpay-Nonce、原始 body 和 Wechatpay-Signature 验签。
- 根据 Wechatpay-Serial 选择微信支付公钥或平台证书；未知序列号拒绝。
- 验签通过后，用API v3密钥、resource.nonce、associated_data和ciphertext进行AES-256-GCM解密。
- 校验所有业务字段后再改订单；字段不一致记录脱敏安全事件并返回失败。
- notification_id 和 transaction_id 用唯一约束防重；已处理通知仍返回成功，不能再次发权益。
- 报告正文已在收费前锁定；通知路径只执行短事务中的订单确认、权益授予和交付状态切换，随后尽快按官方要求应答。
- 通知、主动查单、退款和补偿路径不得同步调用Agent/OpenAI；可以提交既有业务事务或本地待处理记录，但Agent队列、worker或上游故障不能改变微信应答。
- 应用层限制不能替代边缘防护：生产ingress/WAF必须设置连接/慢请求/请求体/速率限制、容量保留和告警；若经反向代理，必须明确可信代理与真实源IP策略，应用默认不信任客户端伪造的转发头。

## 6. 常见事件处理

### PENDING 时间过长

1. 按 order_id 查询本地订单和审计记录。
2. 服务端对同一订单的微信主动查单至少间隔5秒；客户端更频繁轮询只读取本地状态。
3. 用 out_trade_no 调微信查单并验证响应。
   非成功态的官方响应可能省略payer/amount；此时仍核对appid、mchid、out_trade_no和trade_type。只有SUCCESS必须同时具备并严格匹配OpenID、3990分/CNY及transaction_id；可选字段一旦返回也必须匹配。
4. SUCCESS：走与通知相同的幂等事务。
5. USERPAYING：保持PENDING并按退避策略重试。
6. 到达本地 `expiresAt` 也不能直接取消PENDING；若可信查询为NOTPAY，先调用微信关单，关单成功后才改CANCELLED。
7. CLOSED/REVOKED/PAYERROR：按映射进入内部终态并提示用户重新下单。
8. 不得因为客户端截图或 success 回调人工写 PAID。

### 紧急关闭购买

1. 把 `PAID_COMPASS_ENABLED=false` 并发布服务端配置，确认新创单和新预支付均返回 `PAID_COMPASS_DISABLED`。
2. 继续保留通知、主动查单、退款、报告读取和已购权益服务，不删除在途订单或支付验签材料。
3. 已经取得签名支付参数的订单可能在关闭后成功。其通知/查单若通过签名、appid、mchid、订单号、transaction_id、3990分、CNY和OpenID核对，仍应原子授予权益并交付收费前锁定报告。
4. 如果关闭原因是 verified Source Catalog 被撤回或发现事实问题，不得以拒绝交付代替退款。登记安全/内容事故，圈定受影响报告与订单，由授权管理员发起退款并保留通知、查退款和审计证据。

### 重复通知

检查 notification_id、transaction_id、订单状态和 entitlement 唯一约束。若已有相同成功记录，返回成功并停止后续交付；若字段冲突，升级为安全事件。

### 金额或商户字段不一致

不得接受、不得部分交付。保留 body digest、Request-ID和脱敏字段，告警支付负责人，使用官方查单核实。不要记录完整 OpenID 或密文解密后的敏感数据。

### 用户重复支付风险

同一 user/product/report/idempotency_key 返回原订单。调起前先查订单；已有ACTIVE权益直接进入报告。prepay/order过期时先查原订单；只有确认NOTPAY并成功关单、原订单成为CANCELLED后，才允许以新的幂等键创建新订单，不能在原订单仍未决时盲目生成新 out_trade_no。

### 报告未解锁

核对顺序：订单是否服务端 `PAID` → entitlement 是否 `ACTIVE` → report 是否 `READY/DELIVERED` → provider event 与时间线是否落库。若报告在收费前并非六模块齐全、`qaPassed=true`、`LOCKED/LOCKED`，应升级为收费闸门事故，不能在支付后临时生成正文。修复必须走幂等补偿命令，不直接改客户端缓存。

## 7. 退款

- 退款仅由服务端管理员接口发起，要求RBAC、幂等键、原因和审计。
- 服务端生成唯一 out_refund_no，金额不得超过原订单可退金额。
- 退款通知必须验签和解密；重复通知不得重复撤权。
- 当前实现的安全默认是退款成功后撤销该订单的报告权益；OD-07仍须批准是否允许例外、恢复或部分退款。在政策未定前，不向用户开放自动退款按钮。
- `SUCCESS` 是退款单调终态；任何迟到的 `PROCESSING`、`CLOSED` 或 `ABNORMAL` 不得把退款/订单倒退或恢复权益。
- 退款申请响应已显示终态或怀疑回调丢失时，立即主动查退款并验证微信响应；可信查询结果复用通知的幂等迁移，可补偿丢失回调。
- 后台每分钟扫描持久化的PROCESSING退款并退避查单。若进程在写入退款意图后、首次调用微信前崩溃，任务使用同一out_refund_no幂等重放退款，再查退款；失败只记录脱敏计数并告警，不恢复权益或伪造终态。
- 退款、权益和财务记录要可一一对账。

## 8. 密钥与公钥轮换

1. 在秘密管理中加入新版本，不覆盖或删除仍用于在途验证的旧版本。
2. 部署支持新旧验签材料并完成健康检查。
3. 用非真实扣款的签名fixture和受控查单验证。
4. 切换主动签名配置。
5. 观察通知验签失败、下单失败和查单错误。
6. 超过在途窗口后撤销旧版本，并记录轮换时间、执行人和回滚点。

## 9. 监控与告警

至少监控：

- 下单成功率、错误码和延迟；
- PENDING订单年龄分布；
- 同一订单主动查单频率、到期NOTPAY关单成功率及关单失败；
- 通知验签/解密失败；
- 金额、appid、mchid或订单字段不一致；
- 重复通知和幂等冲突；
- PAID无ACTIVE权益、ACTIVE权益无PAID订单；
- `PAID` 后交付状态转换失败、报告读取403/5xx、鉴权PDF生成/下载失败；
- 退款对账任务失败、PROCESSING年龄、重放次数和退款/权益差异。
- kill switch关闭后的在途成功交易，以及Source Catalog撤回关联的人工退款事件。

告警不得包含私钥、API v3密钥、完整OpenID、问卷答案或报告正文。

## 10. 发布与回滚

- 先运行根目录`npm.cmd run test:all`；该命令统一执行客户端测试、服务端typecheck和服务端测试，并回归证明支付路径Agent provider调用为0。
- 先部署数据库向后兼容migration，再部署服务端，最后发布小程序。
- 以受控参数重新生成 `dist/release`，只上传该目录；禁止直接上传仓库根目录。
- `PAID_COMPASS_ENABLED` 最后开启；回滚时先设为 `false`，只停止新创单/预支付，保持在途通知/查单、退款和已购报告可用。
- 不删除在途订单、通知去重记录或权益。
- 每次发布完成 MANUAL_E2E_CHECKLIST，并记录版本和测试订单。
