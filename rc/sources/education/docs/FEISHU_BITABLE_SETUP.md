# 飞书多维表格运营镜像配置手册

## 1. 适用范围与证据状态

本手册对应 Phoenix Family OS V0.4.1 候选工作副本中的飞书多维表格适配层。它用于把 PostgreSQL 中已经存在的家庭、学生、测评、报告、订单、反馈和顾问申请状态，按脱敏白名单投影到飞书，方便运营查看和人工协作；Agent同意、消息、回复、run和Prompt不进入飞书。

当前仓库只提供代码、字段合同、配置模板和自动化测试；没有包含真实飞书 App 凭据、Base App Token 或 Table ID，也不表示任何飞书空间已经创建、授权、联通或通过生产验收。

必须遵守以下边界：

- PostgreSQL 是家庭、问卷、报告、订单、退款、权益和审计的内部事实源。
- 微信支付验签通知和可信查单结果是外部支付事实；飞书不能把订单改成 `PAID`，也不能授予或撤销报告权益。
- 飞书仅接收服务端白名单投影，不接收反向写入；运营人员在飞书中的修改不会回写服务端。客户资料扩展字段默认关闭，只有通过隐私、未成年人数据和飞书权限审批后才能单独开启。
- 飞书同步失败不得阻塞登录、问卷、支付回调、权益授予、退款或报告读取。
- 默认模式不向飞书同步姓名、手机号等直接资料。可选的客户资料模式只增加第4.1/4.2节列出的家庭与学生字段；无论该模式是否开启，原始问卷答案、邮箱、OpenID/UnionID、内部ID、报告正文/PDF、Agent内容、商户订单号、支付交易号、通知密文、退款原因、幂等键和任何密钥都禁止进入飞书。

这与九份需求资料的版本演进一致：早期 Education Compass 计划把飞书作为90天低代码数据底座，后续 Family Passport、工程手册和数据库方案转向关系型主库；本版本已进入“原生小程序 + 微信支付”的商业化阶段，因此飞书保留为运营与人工审核界面，而不是交易数据库。

## 2. 当前同步方式

服务端启动后立即执行一次同步，并按 `FEISHU_SYNC_INTERVAL_MS` 周期执行后续核对。投影版本固定为：

```text
phoenix_feishu_ops_v1
```

每条飞书记录使用稳定伪名业务 ID：

```text
PHX-<24位十六进制摘要>
```

摘要由独立的 `FEISHU_PSEUDONYM_KEY`、运行环境、实体类型和内部 ID 通过 HMAC 生成。飞书无法在没有密钥时直接据此还原内部ID；但稳定ID仍可关联记录，属于伪名化而非匿名化数据，必须按受保护数据处理。不同环境会生成不同伪名ID，因此开发、预发布和生产不得共用同一套Base。

服务端会优先使用本地 `integration_links.external_record_id` 更新已有记录；没有映射时，按每张表的唯一业务字段搜索后创建或更新。飞书本身不替代数据库唯一约束，启用前必须检查每张表不存在重复业务 ID。

### 2.1 客户填写资料的接口链路

小程序填写资料后调用已有鉴权接口：

```text
PUT  /v1/me/family
POST /v1/me/students
PUT  /v1/me/students/:studentId
  → ProfileService 校验并提交 PostgreSQL
  → 周期 reconcile（或管理员受控 reconcile）读取已提交快照
  → HMAC 伪名 + 字段白名单 + 类型/长度/公式注入检查
  → 飞书 Bitable create/update API
```

资料接口返回2xx只表示 PostgreSQL 提交成功，不表示飞书已同步。飞书是最终一致镜像；飞书超时、限流或字段错误不能回滚客户资料，也不能让小程序资料保存失败。可通过管理员状态接口观察 `SYNCED/FAILED/BLOCKED`，但不得向普通客户暴露飞书凭据或内部同步状态。

每轮实际写入前，服务端会读取7张远端表的字段元数据，校验必需英文字段、文本/数字类型和主字段；校验结果缓存15分钟。任一表不符合合同，本轮在读取业务投影和外写前失败，`status` 中的 `schema.state` 变为 `INVALID`。启动配置还会拒绝重复 Table ID。该预检保护飞书外写，但不会改变 PostgreSQL 中的订单、权益或报告，也不会把飞书变成业务健康检查的事实源。

## 3. 飞书侧准备

在飞书开放平台和目标企业空间中完成以下外部操作：

1. 创建企业自建应用，记录 App ID 和 App Secret。
2. 申请并由管理员批准多维表格记录读取、搜索、创建和更新所需权限。
3. 新建独立 Base，建议命名为 `Phoenix Education Operations <环境> V1`。
4. 把自建应用加入该 Base，并只授予这7张表所需的编辑权限。
5. 按第4节逐张建立表和字段；英文 API 字段必须完全一致，区分下划线。
6. 记录 Base App Token 和7个 `tbl...` Table ID，并放入部署环境的秘密/配置管理，不写入仓库或文档。
7. 为开发、预发布和生产分别创建应用或至少创建独立 Base、独立凭据和独立表映射。

字段类型必须按本手册建立。当前适配器把 RFC 3339 时间作为字符串发送，因此所有 `*_at`、`data_as_of` 和 `source_updated_at` 字段都应创建为“单行文本”，不要创建成飞书日期字段；如需日期筛选，可另建不参与 API 合同的公式/辅助字段。

每张表建议把唯一业务字段设为第一列/主字段。所有字符串状态和版本字段也使用单行文本，数字字段使用数字。不要把合同字段改成成员、关联、附件、多选或自动编号类型。

## 4. 七张表的精确字段合同

### 4.1 `Family Profile｜家庭运营镜像`

唯一业务字段：`family_id`

| 英文字段 | 飞书字段类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `family_id` | 单行文本/主字段 | 是 | 稳定伪名家庭 ID，不是内部主键 |
| `status` | 单行文本 | 是 | 当前投影固定为 `ACTIVE` |
| `created_at` | 单行文本 | 是 | 服务端创建时间，RFC 3339 |
| `schema_version` | 单行文本 | 是 | 固定为 `phoenix_feishu_ops_v1` |
| `source_updated_at` | 单行文本 | 是 | 服务端记录最后更新时间，RFC 3339 |
| `family_name` | 单行文本 | 扩展模式 | 家庭名称，最多80字符 |
| `parent_name` | 单行文本 | 扩展模式 | 家长称呼，最多80字符 |
| `phone` | 单行文本 | 扩展模式 | 联系电话，最多30字符，仅允许电话号码字符 |
| `location` | 单行文本 | 扩展模式 | 所在地区，最多120字符 |
| `goal` | 单行文本 | 扩展模式 | 家庭目标，最多500字符 |

扩展字段仅在 `FEISHU_CUSTOMER_PROFILE_FIELDS_ENABLED=true` 时发送；默认关闭。即使开启也不包含邮箱、微信号、OpenID/UnionID、内部用户ID或任何未列出的家庭字段。

### 4.2 `Student Profile｜学生运营镜像`

唯一业务字段：`student_id`

| 英文字段 | 飞书字段类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `student_id` | 单行文本/主字段 | 是 | 稳定伪名学生 ID |
| `family_id` | 单行文本 | 是 | 对应 Family Profile 的伪名 ID |
| `student_version` | 单行文本 | 是 | 学生资料快照版本 |
| `created_at` | 单行文本 | 是 | 服务端创建时间，RFC 3339 |
| `schema_version` | 单行文本 | 是 | 固定为 `phoenix_feishu_ops_v1` |
| `source_updated_at` | 单行文本 | 是 | 服务端记录最后更新时间，RFC 3339 |
| `student_name` | 单行文本 | 扩展模式 | 学生姓名，最多80字符 |
| `age` | 数字 | 扩展模式 | 年龄整数，3—100 |
| `gender` | 单行文本 | 扩展模式 | 性别字段，最多30字符 |
| `school` | 单行文本 | 扩展模式 | 学校，最多160字符 |
| `education_system` | 单行文本 | 扩展模式 | 教育体系，最多80字符 |
| `grade` | 单行文本 | 扩展模式 | 年级，最多80字符 |
| `interest` | 单行文本 | 扩展模式 | 兴趣，最多500字符 |
| `goal` | 单行文本 | 扩展模式 | 学生目标，最多500字符 |

扩展字段仅在 `FEISHU_CUSTOMER_PROFILE_FIELDS_ENABLED=true` 时发送；默认关闭。即使开启也不包含生日、证件、邮箱、联系方式以外的身份明细、OpenID/UnionID、内部ID或任何未列出的学生字段。开启意味着飞书将处理未成年人资料，必须先完成适用地区的监护人同意、数据处理协议、访问最小化、保留/删除SLA和安全评审。

### 4.3 `Assessment Session｜测评会话镜像`

唯一业务字段：`session_id`

| 英文字段 | 飞书字段类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `session_id` | 单行文本/主字段 | 是 | 稳定伪名测评会话 ID |
| `family_id` | 单行文本 | 是 | 伪名家庭 ID |
| `student_id` | 单行文本 | 是 | 伪名学生 ID |
| `questionnaire_version` | 单行文本 | 是 | 问卷合同版本 |
| `student_version` | 单行文本 | 是 | 提交时学生资料版本 |
| `status` | 单行文本 | 是 | 服务端测评状态 |
| `completeness` | 数字 | 是 | 服务端重算完整度，0—100 |
| `submitted_at` | 单行文本 | 否 | 提交时间；未提交时不发送该字段 |
| `created_at` | 单行文本 | 是 | 服务端创建时间，RFC 3339 |
| `schema_version` | 单行文本 | 是 | 固定为 `phoenix_feishu_ops_v1` |
| `source_updated_at` | 单行文本 | 是 | 服务端记录最后更新时间，RFC 3339 |

不包含：23题原始答案、开放回答、缺失字段详情、同意文本或监护人身份信息。

### 4.4 `Report Job｜报告任务镜像`

唯一业务字段：`report_id`

| 英文字段 | 飞书字段类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `report_id` | 单行文本/主字段 | 是 | 稳定伪名报告 ID |
| `family_id` | 单行文本 | 是 | 伪名家庭 ID |
| `student_id` | 单行文本 | 是 | 伪名学生 ID |
| `assessment_id` | 单行文本 | 是 | 对应 Assessment Session 的伪名 ID |
| `status` | 单行文本 | 是 | `LOCKED` 或 `READY` 等服务端状态 |
| `delivery_status` | 单行文本 | 是 | `LOCKED` 或 `DELIVERED` |
| `qa_status` | 单行文本 | 是 | `PASSED` 或 `PENDING` |
| `data_version` | 单行文本 | 是 | 报告所用数据版本 |
| `rule_version` | 单行文本 | 是 | 硬规则版本 |
| `prompt_version` | 单行文本 | 是 | Prompt版本 |
| `template_version` | 单行文本 | 是 | 报告模板版本 |
| `source_catalog_version` | 单行文本 | 是 | Source Catalog版本 |
| `data_as_of` | 单行文本 | 是 | 报告数据截至日期 |
| `created_at` | 单行文本 | 是 | 服务端创建时间，RFC 3339 |
| `schema_version` | 单行文本 | 是 | 固定为 `phoenix_feishu_ops_v1` |
| `source_updated_at` | 单行文本 | 是 | 服务端记录最后更新时间，RFC 3339 |

不包含：免费预览文案、完整六模块、院校/专业列表、Source正文、Prompt、免责声明、PDF或永久下载地址。

### 4.5 `Order & Payment｜订单运营镜像`

唯一业务字段：`order_id`

| 英文字段 | 飞书字段类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `order_id` | 单行文本/主字段 | 是 | 稳定伪名订单 ID，不是微信商户订单号 |
| `family_id` | 单行文本 | 是 | 伪名家庭 ID |
| `student_id` | 单行文本 | 是 | 伪名学生 ID |
| `assessment_id` | 单行文本 | 是 | 伪名测评会话 ID |
| `report_id` | 单行文本 | 是 | 伪名报告 ID |
| `product_code` | 单行文本 | 是 | 当前为 `COMPASS_REPORT_SINGLE_39_9` |
| `amount_fen` | 数字 | 是 | 服务端固定商品快照；当前为3990 |
| `currency` | 单行文本 | 是 | 当前为 `CNY` |
| `channel` | 单行文本 | 是 | 当前投影固定为 `WECHAT` |
| `status` | 单行文本 | 是 | 服务端订单状态的只读镜像 |
| `paid_at` | 单行文本 | 否 | 服务端确认支付时间；未支付时不发送 |
| `refunded_at` | 单行文本 | 否 | 服务端确认退款时间；未退款时不发送 |
| `created_at` | 单行文本 | 是 | 服务端创建时间，RFC 3339 |
| `schema_version` | 单行文本 | 是 | 固定为 `phoenix_feishu_ops_v1` |
| `source_updated_at` | 单行文本 | 是 | 服务端记录最后更新时间，RFC 3339 |

本表只是运营展示。不得在飞书中增加自动化来授予权益、交付报告或触发退款。不同步 `out_trade_no`、`transaction_id`、通知 ID、OpenID、付款参数、验签材料、回调原文、退款原因、权益记录或幂等键。

### 4.6 `Feedback｜报告反馈镜像`

唯一业务字段：`feedback_id`

| 英文字段 | 飞书字段类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `feedback_id` | 单行文本/主字段 | 是 | 稳定伪名反馈 ID |
| `report_id` | 单行文本 | 是 | 伪名报告 ID |
| `rating` | 数字 | 是 | 1—5评分 |
| `consult_intent` | 单行文本 | 是 | `YES` 或 `NO` |
| `created_at` | 单行文本 | 是 | 服务端创建时间，RFC 3339 |
| `schema_version` | 单行文本 | 是 | 固定为 `phoenix_feishu_ops_v1` |
| `source_updated_at` | 单行文本 | 是 | 当前等于反馈创建时间 |

不包含：反馈标签、评论全文、联系信息或用户原文。

### 4.7 `Advisor Request｜顾问申请镜像`

唯一业务字段：`request_id`

| 英文字段 | 飞书字段类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `request_id` | 单行文本/主字段 | 是 | 稳定伪名顾问申请 ID |
| `family_id` | 单行文本 | 是 | 伪名家庭 ID |
| `student_id` | 单行文本 | 否 | 有关联学生时发送伪名学生 ID |
| `report_id` | 单行文本 | 否 | 有关联报告时发送伪名报告 ID |
| `status` | 单行文本 | 是 | 服务端申请状态的只读镜像 |
| `created_at` | 单行文本 | 是 | 服务端创建时间，RFC 3339 |
| `schema_version` | 单行文本 | 是 | 固定为 `phoenix_feishu_ops_v1` |
| `source_updated_at` | 单行文本 | 是 | 服务端记录最后更新时间，RFC 3339 |

不包含：顾问申请备注、主题、期望联系时间、家庭联系方式或对话摘要。

## 5. 环境变量映射

`server/.env.example` 只是模板；当前服务端不会自动加载 `.env` 文件，实际值必须由进程管理器、容器平台或秘密管理系统注入。

| 环境变量 | 含义 | 边界 |
| --- | --- | --- |
| `FEISHU_BITABLE_ENABLED` | 总开关，默认 `false` | 未完成外部配置和验证前保持关闭 |
| `FEISHU_CUSTOMER_PROFILE_FIELDS_ENABLED` | 家庭/学生实际资料扩展开关，默认 `false` | 仅在飞书总开关开启且隐私审批完成后启用；与支付、Agent开关独立 |
| `FEISHU_APP_ID` | 企业自建应用 App ID | 配置项，不写入小程序 |
| `FEISHU_APP_SECRET` | 企业自建应用 App Secret | 密钥，只能由服务端读取 |
| `FEISHU_BITABLE_APP_TOKEN` | 目标 Base App Token | 敏感配置 |
| `FEISHU_PSEUDONYM_KEY` | 生成稳定伪名 ID 的独立密钥 | 至少32字节，不得复用 `SESSION_SECRET` |
| `FEISHU_BITABLE_TABLE_FAMILY_PROFILE` | Family Profile Table ID | 必须是有效 `tbl...` |
| `FEISHU_BITABLE_TABLE_STUDENT_PROFILE` | Student Profile Table ID | 必须是有效 `tbl...` |
| `FEISHU_BITABLE_TABLE_ASSESSMENT_SESSION` | Assessment Session Table ID | 必须是有效 `tbl...` |
| `FEISHU_BITABLE_TABLE_REPORT_JOB` | Report Job Table ID | 必须是有效 `tbl...` |
| `FEISHU_BITABLE_TABLE_ORDER_PAYMENT` | Order & Payment Table ID | 必须是有效 `tbl...` |
| `FEISHU_BITABLE_TABLE_FEEDBACK` | Feedback Table ID | 必须是有效 `tbl...` |
| `FEISHU_BITABLE_TABLE_ADVISOR_REQUEST` | Advisor Request Table ID | 必须是有效 `tbl...` |
| `FEISHU_SYNC_INTERVAL_MS` | 自动核对间隔 | 默认60000；允许10000—3600000 |
| `FEISHU_SYNC_BATCH_SIZE` | 单轮最大尝试数 | 默认50；允许1—200 |

启用时还必须配置持久化 `DATABASE_URL`。生产数据库仍须满足 PostgreSQL、`sslmode=verify-full` 和项目的其他生产闸门。飞书开关与 `PAID_COMPASS_ENABLED` 相互独立：启用飞书不能开启真实收费，关闭飞书也不能中断可信支付交付。

## 6. 数据库迁移

启用飞书前，按顺序将以下迁移应用到目标 PostgreSQL：

```text
server/migrations/001_initial_schema.sql
server/migrations/002_feishu_bitable_integration.sql
```

第二个迁移创建 `integration_links`，用于保存内部实体与飞书记录的映射、投影摘要、同步状态、重试时间和最后成功时间。它不保存飞书 App Secret，也不是业务实体的事实源。为保证飞书“响应未知”时使用相同 UUID 和完全相同请求重放，处理中/失败的操作会暂存冻结请求体；客户资料扩展模式开启时，该请求体可能包含已批准的资料白名单值，因此 PostgreSQL 备份、数据库角色和保留策略也必须按敏感资料标准治理，成功同步后会清空冻结体。

在项目根目录使用带校验和和 PostgreSQL advisory lock 的迁移器：

```powershell
$env:DATABASE_URL = '<由秘密管理注入的PostgreSQL连接串>'
npm.cmd --prefix server run db:migrate
```

迁移器会创建`schema_migrations`，按文件名顺序执行未应用迁移，并拒绝已应用文件的校验和变化。001—003现为不可变历史；V0.4.1 的`004_dual_agent_analysis.sql`扩展Agent conversation purpose和活动唯一索引，不改变7张飞书表。004已被占用，后续飞书结构调整必须新增005或更高迁移，不得修改旧文件或伪造校验和。

生产迁移必须通过已批准的数据库发布流程完成。不要在未备份的生产库里从个人终端直接执行，也不要只创建 `integration_links` 而跳过主 Schema。

## 7. 首次启用检查

首次启用应在预发布环境完成：

1. 保持 `PAID_COMPASS_ENABLED=false`，先验证数据库和飞书，不做真实扣款。
2. 确认7个 Table ID 互不相同，且英文字段、类型和唯一业务主字段与第4节完全一致。
3. 默认保持 `FEISHU_CUSTOMER_PROFILE_FIELDS_ENABLED=false`，确认 Base 中没有测试家庭的姓名、电话、OpenID、问卷答案、报告正文或支付标识。
4. 先在少量去标识化数据上启用 `FEISHU_BITABLE_ENABLED=true`。若业务确需实际客户资料，必须另行审批后补齐第4.1/4.2节扩展列，先在隔离预发布Base验证，再单独开启客户资料开关。
5. 服务启动后先调用管理员 `validate-schema` 接口，要求返回 `VALID`；再读取状态并手动触发小批量核对。自动周期任务同样会在写入前执行该预检。
6. 验证同一实体重复核对不会新增第二条记录，服务端变更会更新原记录；模拟未知响应时应以同一 UUIDv4 `client_token` 和同一冻结请求体重放。
7. 关闭飞书网络或临时撤销权限，确认支付和核心API继续工作，同步进入 `FAILED`；不可重试错误或连续失败达到上限后应进入 `BLOCKED`。
8. 恢复权限并修复根因后，由管理员受控重放 `BLOCKED` 记录，确认它们最终恢复为 `SYNCED`。

若需停用客户资料扩展，先关闭 `FEISHU_CUSTOMER_PROFILE_FIELDS_ENABLED`。服务端不会再重放尚未完成的敏感冻结请求，但也不会自动擦除已成功写入飞书的历史单元格；随后必须执行获批的飞书历史资料删除、导出/备份处置和访问审计流程。

管理员接口和故障操作见 [飞书同步运行手册](FEISHU_SYNC_RUNBOOK.md)。完整本地、预发布和 Codex 执行顺序见 [Codex后端代理运行手册](CODEX_BACKEND_PROXY_RUNBOOK.md)。

## 8. 当前未完成的外部验收

- 未提供或验证真实飞书 App 权限、App Token、Table ID。
- 未证明目标企业空间的访问控制、管理员审批和离职撤权流程已经完成。
- 未完成生产数据保留、删除、跨境和供应商安全评估。
- 当前同步不会自动删除飞书历史记录；用户删除/撤回后的飞书处置必须纳入经批准的数据删除SOP。
- 当前空值从投影中省略，不会主动清空飞书中旧的可选字段；字段清空、删除 tombstone 和保留期自动化尚未实现，涉及撤回/删除时必须执行人工SOP。
- 当前为周期扫描与最终一致投影，不是高吞吐事件总线；达到性能、审计或规模阈值后应评审事务 outbox/队列方案。
- 当前最多扫描10000条源投影，推荐先按单实例运行；横向扩容前应评审 transactional outbox、独立 worker/连接池、分布式单飞、按表共享限流和异步 `jobId`。
- 自动化测试和预发布样例不能证明真实飞书或真实微信支付已经上线。

## 9. 飞书官方接口参考

- [企业自建应用 tenant_access_token](https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal)
- [多维表格接口概览](https://open.feishu.cn/document/server-docs/docs/bitable-v1/bitable-overview)
- [新增单条记录](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/create)
- [更新单条记录](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/update)
- [搜索记录](https://open.feishu.cn/document/docs/bitable-v1/app-table-record/search)
- [列出字段](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-field/list)
- [服务端 API 频率控制](https://open.feishu.cn/document/server-docs/api-call-guide/frequency-control)

接口、权限、限流和参数可能调整；接入或上线前应以目标租户当时的官方文档与控制台权限为准。
