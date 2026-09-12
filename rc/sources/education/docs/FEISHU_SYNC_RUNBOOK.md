# 飞书多维表格同步运行手册

## 1. 运行边界

飞书同步是可关闭、单向、最终一致的运营镜像。它读取 PostgreSQL 中已提交的服务端记录，默认生成脱敏投影并写入飞书多维表格。经单独审批后，可用默认关闭的 `FEISHU_CUSTOMER_PROFILE_FIELDS_ENABLED` 把精确白名单内的家庭/学生资料一并投影；这不会改变 PostgreSQL 事实源边界。

它不参与以下关键路径：

- 微信 `code2Session` 和服务端登录；
- 测评草稿、不可变快照和完整度判断；
- 微信支付下单、验签、解密、查单、关单或退款；
- `PAID`、`ACTIVE entitlement`、`DELIVERED` 的事务迁移；
- 完整报告/PDF鉴权或用户数据删除决定。
- Agent同意、消息、回复、Prompt、run、worker或OpenAI调用。

因此，飞书失败时不能人工把飞书状态当作支付结论，也不能为了“修复看板”直接修改 PostgreSQL 订单。支付排障必须回到微信支付可信结果、服务端订单、`payment_events`、`entitlements` 和审计记录。

当前仓库没有真实飞书配置，本文只说明代码运行和运维合同，不代表飞书已经上线。

## 2. 同步链路

客户资料入口是已有的鉴权 API：`PUT /v1/me/family`、`POST /v1/me/students`、`PUT /v1/me/students/:studentId`。接口先完成校验和 PostgreSQL 事务；接口2xx不承诺飞书同步成功。周期任务或管理员 reconcile 随后读取已经提交的记录，因此飞书失败不会使客户资料保存失败，飞书人工修改也不会回写小程序。

```text
PostgreSQL 业务记录
  → 远端7表字段/类型/主字段预检
  → 读取7类实体快照
  → 字段白名单、功能开关、类型/长度/公式注入检查与伪名ID投影
  → 计算 payload SHA-256 摘要
  → integration_links 领取处理租约并冻结 UUIDv4 client_token + 请求体
  → 飞书按唯一业务字段搜索/按 record_id 更新
  → integration_links 标记 SYNCED / FAILED / BLOCKED
```

服务启动后会立即执行一次核对，此后按 `FEISHU_SYNC_INTERVAL_MS` 运行。单进程内同时只允许一轮；默认单轮最多尝试50条，可配置1—200。当前实现最多扫描10000条投影，超过时以 `FEISHU_SYNC_SCAN_LIMIT` 停止本轮并要求架构评审，不能简单无限提高批量。

业务记录按 `source_updated_at` 从旧到新处理。投影摘要没有变化且上一状态为 `SYNCED` 时跳过写入。当前投影版本为 `phoenix_feishu_ops_v1`。

远端 Schema 校验结果缓存15分钟；任一必需字段缺失、文本/数字类型错误或主字段错误，本轮在外写前整体停止，状态接口显示 `schema.state=INVALID`。该失败只降级飞书集成，不应拖垮支付或报告API。

## 3. `integration_links` 状态

| 状态 | 含义 | 运维动作 |
| --- | --- | --- |
| `PENDING` | 预留状态；当前创建后直接领取为处理中 | 观察，不作为业务失败 |
| `PROCESSING` | 已被一轮同步领取 | 正常租约为120秒；短时间内不要重复操作 |
| `SYNCED` | 最近字段摘要已成功写入 | 无需动作 |
| `FAILED` | 可重试写入失败，等待退避重试 | 按错误码检查限流、网络或上游暂时故障 |
| `BLOCKED` | 不可重试错误，或连续尝试达到8次 | 先修复权限/字段/重复ID等根因，再由管理员受控重放 |

可重试失败从30秒开始指数退避并加入稳定抖动，尊重上游 `Retry-After`/限流重置提示，最长6小时；不可重试错误或第8次失败进入 `BLOCKED`，不会自动重试。成功后 attempts 清零、错误码清空并更新 `last_synced_at`。服务进程崩溃后，过期的 `PROCESSING` 租约可被后续轮次重新领取。

每次新操作把随机 UUIDv4 `operation_token`、字段摘要和序列化请求体持久化到 `integration_links`。在响应未知或进程中断后，后续尝试必须用同一 token 重放完全相同的 body；成功后才清空这组冻结字段。源记录在冻结操作期间又变化时，先完成旧操作，下一轮再以新摘要创建新操作，不能用同一 token 偷换载荷。

`integration_links` 保存内部实体到飞书记录的映射、投影摘要、冻结请求体和同步元数据，不保存飞书密钥，也不是事实源。默认脱敏模式的冻结体不含客户实际资料；客户资料扩展模式开启后，处理中或失败操作的冻结体会暂存白名单资料以保证未知结果可以原字节幂等重放，成功后清空。因此应限制数据库角色、备份访问和保留期，并把该表纳入资料删除SLA。不要手工删除或修改它来处理支付问题。

把客户资料扩展开关从 `true` 改为 `false` 时，服务端会丢弃尚未成功的敏感冻结体，生成新的伪名核心字段操作和新 UUID，避免停用后继续外发资料。该安全切换不能自动清除此前已经写入飞书的单元格；必须按批准的删除SOP清理目标Base、核对备份/导出，并确认剩余访问者和自动化。关闭开关不等于完成历史数据删除。

## 4. 管理员接口

三个接口都需要服务端签发且角色为 `admin` 的 opaque bearer token。项目没有面向公网的“创建管理员”接口；管理员身份必须通过经批准的内部流程提供。不要把管理员 token 保存到文档、脚本、聊天记录或 CI 日志。

### 4.1 查看状态

```http
GET /v1/admin/integrations/feishu/status
Authorization: Bearer <ADMIN_OPAQUE_TOKEN>
```

示例响应：

```json
{
  "enabled": true,
  "projectionVersion": "phoenix_feishu_ops_v1",
  "customerProfileFieldsEnabled": false,
  "configuredEntities": [
    "family_profile",
    "student_profile",
    "assessment_session",
    "report_job",
    "order_payment",
    "feedback",
    "advisor_request"
  ],
  "counts": {
    "PENDING": 0,
    "PROCESSING": 0,
    "SYNCED": 42,
    "FAILED": 0,
    "BLOCKED": 0
  },
  "schema": {
    "state": "VALID",
    "checkedAt": "2026-08-21T09:59:50.000Z",
    "errorCode": null
  },
  "lastSyncedAt": "2026-08-21T10:00:00.000Z"
}
```

`enabled=false` 只说明飞书 Gateway 当前关闭，不说明微信支付或主服务异常。`customerProfileFieldsEnabled` 应默认保持 `false`；它为 `true` 时必须能关联到有效的隐私审批和受限Base。`schema.state` 为 `DISABLED / UNKNOWN / VALID / INVALID`；`lastSyncedAt=null` 表示尚无成功记录。

PowerShell 示例：

```powershell
$apiBase = 'https://api.example.com'
$adminToken = '<短时管理员token>'
$headers = @{ Authorization = "Bearer $adminToken" }
Invoke-RestMethod -Method Get -Uri "$apiBase/v1/admin/integrations/feishu/status" -Headers $headers
```

### 4.2 强制校验远端 Schema

```http
POST /v1/admin/integrations/feishu/validate-schema
Authorization: Bearer <ADMIN_OPAQUE_TOKEN>
```

成功返回：

```json
{
  "state": "VALID",
  "checkedAt": "2026-08-21T09:59:50.000Z",
  "errorCode": null
}
```

该接口读取7张表的全部字段页，要求每张表具备合同中的英文字段、单行文本/数字类型和正确主字段。失败返回503并把状态记为 `INVALID`；先修复远端表，不要绕过校验或把敏感字段加进投影。

PowerShell 示例：

```powershell
Invoke-RestMethod -Method Post -Uri "$apiBase/v1/admin/integrations/feishu/validate-schema" -Headers $headers
```

### 4.3 手动触发核对

```http
POST /v1/admin/integrations/feishu/reconcile
Authorization: Bearer <ADMIN_OPAQUE_TOKEN>
Content-Type: application/json

{ "limit": 50 }
```

`limit` 可省略，允许1—200。当前实现会在该HTTP请求内完成本轮处理，然后返回202和摘要；它不是带 `jobId` 的异步任务。调用会先把所有 `BLOCKED` 映射重新排入队列，因此只能在根因已经修复后由管理员执行，不能用来反复冲击永久错误。

```json
{
  "enabled": true,
  "discovered": 42,
  "attempted": 12,
  "succeeded": 11,
  "failed": 1,
  "skipped": 30
}
```

- `discovered`：本轮扫描得到的全部投影数，不等于写入数。
- `attempted`：本轮实际领取并尝试写入数。
- `succeeded`：成功创建或更新数。
- `failed`：本轮失败数；逐条失败通常不会让整个接口返回5xx。
- `skipped`：摘要未变化、仍在租约或尚未到重试时间的记录数。

PowerShell 示例：

```powershell
$body = @{ limit = 50 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$apiBase/v1/admin/integrations/feishu/reconcile" -Headers $headers -ContentType 'application/json' -Body $body
```

完成排障后清理当前终端中的 `$adminToken` 和 `$headers`；不要把真实 token 写进 shell profile。

## 5. 日常检查

每个工作日或发布后至少检查：

1. `enabled` 是否符合当前环境预期；开发/未批准生产应为 `false`。
2. `configuredEntities` 是否正好包含7类实体。
3. `schema.state` 是否为 `VALID`；`INVALID` 时先查 `errorCode` 并停止外写排障。
4. `FAILED` 是否持续增长、`BLOCKED` 是否非零、`PROCESSING` 是否长时间不归零。
5. `lastSyncedAt` 是否超过预期间隔加合理重试窗口。
6. 飞书每张表的主业务 ID 是否唯一，有无人工复制出的重复记录。
7. `Order & Payment` 是否只有伪名ID、商品、金额、币种、渠道、状态和时间，不含交易号/OpenID；稳定伪名仍按受保护数据处理。
8. `Assessment Session`、`Report Job` 是否没有答案、报告正文、Prompt或PDF。
9. 同一服务端实体再次核对时是否更新原记录，而不是新增记录。

飞书表里的公式列、视图和运营标签不属于服务端 API 合同。可以添加，但不得与合同字段同名，也不得用自动化反向控制订单、权益、退款或报告交付。

## 6. 常见故障

| 现象/错误 | 可能原因 | 安全处理 |
| --- | --- | --- |
| 启动时报 `CONFIG_INVALID` | 启用后缺少数据库、凭据、伪名密钥或7个Table ID | 保持服务关闭，补齐秘密管理配置；不要回退到硬编码 |
| `FEISHU_TABLE_ID_INVALID` | Table ID不是有效 `tbl...` | 从目标Base重新复制正确Table ID，确认环境未串用 |
| `FEISHU_SCHEMA_FIELD_MISSING` | 远端表缺少合同字段 | 停止核对，按配置手册补齐精确英文字段后重新校验 |
| `FEISHU_SCHEMA_FIELD_TYPE_MISMATCH` | 文本/数字类型不符合合同 | 修正字段类型；不要在代码中放宽隐私白名单 |
| `FEISHU_SCHEMA_PRIMARY_FIELD_MISMATCH` | 唯一业务字段不是主字段 | 调整远端表主字段后重新校验 |
| `FEISHU_DUPLICATE_BUSINESS_ID` | 同一唯一字段在飞书已有多条记录 | 停止同步，导出并人工核对；未经批准不要批量删除 |
| `FEISHU_HTTP_401` / `FEISHU_TOKEN_EXPIRED` | token过期或凭据/权限变化 | 客户端会清缓存并重试一次；持续失败则检查App状态和权限 |
| `FEISHU_API_<code>` | 字段名/类型错误、无权限或飞书业务错误 | 对照配置手册逐字段检查，不把敏感正文加入排障日志 |
| `FEISHU_TIMEOUT` | 飞书请求超过8秒 | 检查网络和飞书状态，等待退避；不要阻塞支付回调 |
| `FEISHU_NETWORK_ERROR` | DNS、TLS或出口网络失败 | 保持主服务运行，修复出口后手动小批量核对 |
| 大量429/5xx | 限流或上游故障 | 降低批量/拉长间隔，等待退避，不并发狂点reconcile |
| `FEISHU_SYNC_SCAN_LIMIT` | 当前投影超过10000条 | 停止扩大同步，评审增量游标、事务outbox或队列方案 |
| 飞书状态与支付不一致 | 最终一致延迟或同步失败 | 以PostgreSQL和可信微信结果为准，修复同步，禁止手工改权益 |

飞书 API 错误对外统一显示“飞书多维表格暂时不可用”。详细排障只使用错误码、伪名业务ID、Table ID、请求时间和飞书请求标识；不要记录App Secret、原始实体ID、OpenID、问卷答案、报告正文、Agent内容或回调载荷。当前`integration_links`不保存飞书响应log-id，请在受控网关/平台日志中保留脱敏请求标识，并把“持久化脱敏log-id”作为生产可观测性改进项。

## 7. 紧急停用飞书

当发现权限泄露、错误字段、跨环境写入或大量重复时：

1. 把 `FEISHU_BITABLE_ENABLED=false` 作为部署配置发布并重启服务实例。
2. 确认 `GET .../status` 返回 `enabled=false`。
3. 保持 PostgreSQL、微信支付回调、主动查单、退款和报告读取继续运行。
4. 在飞书侧收缩应用权限，保留现场和访问审计，不立即删除记录。
5. 确定受影响环境、表、伪名ID范围和时间窗口。
6. 按隐私/安全事故流程决定封存、修正或删除；任何批量删除都需明确批准和可恢复备份。
7. 修复后先在新Base或预发布表小批量验证，再决定是否恢复原映射。

关闭飞书不会删除已有镜像，也不会撤销已经授予的报告权益。不能用关闭 `PAID_COMPASS_ENABLED` 代替飞书停用，两个开关职责不同。

## 8. 重建与灾难恢复

PostgreSQL 是重建依据。推荐采用可回滚方式：

1. 新建一套空的7张表，字段严格按配置手册建立。
2. 为新表记录新的7个 Table ID，先在预发布环境验证。
3. 备份 `integration_links` 和旧Base记录；不要覆盖旧证据。
4. 在受控维护窗口切换 Table ID。因为唯一键包含 Table ID，服务端会为新表建立新的映射并重新投影。
5. 从小批量开始手动核对，再恢复周期任务。
6. 核对新表条数、唯一ID和脱敏字段后，把旧Base设为只读归档。
7. 是否删除旧Base由数据保留/删除政策决定，不由同步程序自动决定。

不要通过从飞书“回灌订单状态”重建 PostgreSQL。若主库丢失，应使用数据库备份、微信官方账单/查单和审计流程恢复，飞书镜像只能辅助定位，不能作为支付账本。

## 9. 密钥轮换与变更控制

`FEISHU_APP_SECRET` 可按飞书应用流程轮换；部署应先注入新值并验证，再撤销旧值。

`FEISHU_PSEUDONYM_KEY`轮换会改变全部伪名ID。不得像普通凭据一样直接替换。必须先设计映射迁移，评估飞书关联、历史看板、`integration_links`、删除请求和跨环境隔离；没有批准的迁移方案时保持原密钥。

以下变更必须同时更新代码、测试、数据库迁移和文档：

- 增删7类实体；
- 修改任何英文合同字段、字段含义或字段类型；
- 修改伪名ID算法或投影版本；
- 增加飞书反向写入；
- 让飞书进入支付、退款、权益或报告访问路径。

后两项属于架构和合规范围变更，不能作为普通运营需求直接上线。

001—003是不可变迁移历史；V0.4.1的`004_dual_agent_analysis.sql`不改变飞书合同。004已被占用，后续飞书结构演进必须新增005或更高迁移。

## 10. 当前生产扩展差距

以下能力当前没有实现，不能由测试通过推断为已具备：

- 当前从7张业务表做最多10000条的周期状态对账，不是transactional outbox，也没有独立飞书worker、小连接池或`SKIP LOCKED`队列；V0.4.1仍建议先按单实例运行飞书同步，数据量增长前完成容量评审。新增Agent worker不改变此差距。
- 单进程内有同步互斥，数据库租约可避免同一映射被同时完成，但没有跨实例全局单飞或按 Table ID 的共享限流。多实例部署前应增加分布式调度/限速。
- 管理员 reconcile 在HTTP请求内同步执行且没有 `jobId`；生产运维面建议改为异步任务、分布式单飞和可查询作业状态。
- 空值会从投影中省略，不能清除飞书已有可选值；源记录删除也不会发送 tombstone 或自动删除镜像。字段清空、删除传播、保留期和撤回必须按人工SOP执行，直至专门方案上线。
- 飞书响应 log-id 未进入映射账本或管理员状态；需要由部署平台补齐脱敏关联日志和告警。

这些差距不影响“飞书不是支付/权益事实源”的边界，但会影响高容量、多实例、自动删除和正式SLA，因此生产启用前必须在风险验收中逐项定责。
