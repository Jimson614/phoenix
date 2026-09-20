# 飞书 V0.5 最小链路

对应 V0.5 实施顺序的第 2、3 步：**用母版在飞书建空框架** → **先跑一条最小链路 Family/Student → Deal → Contract → Payment → ServiceProject**。

唯一基线是 `Phoenix_Feishu_Operating_Model_V0.5_Clean_Master.xlsx`（V0.4 废止）。表名、列名、列序、下拉白名单一律从母版抽取，代码不发明字段。

数据方向固定为 `Phoenix Core / Founder OS（事实源） → 飞书运营投影`，飞书不回写。

## 文件

| 文件 | 作用 |
| --- | --- |
| `Phoenix_Feishu_Operating_Model_V0.5_Clean_Master.xlsx` | 母版副本，建表基线 |
| `extract-master.py` | 从母版抽取建表合同，生成 `master-contract.json`（11 张表 / 208 字段 / 49 个下拉） |
| `master-contract.json` | 生成物：列名、列序、字段类型、下拉白名单、示例值 |
| `schema.js` | 读取合同，另声明最小链路顺序、表间引用、V0.5 红线常量 |
| `core.js` | Core/Founder OS 事实源样本、链路记录、Integration_Links、10 条 Gate |
| `feishu-client.js` | 多维表格最小客户端：token、建表、字段预检、按主字段 upsert |
| `run-min-chain.js` | 执行器，默认 dry-run，`--live` 才写飞书 |
| `gates.test.js` | 反向测试：逐条注入违规，确认 Gate 拦得住 |

## 运行

```bash
python tools/feishu-v05/extract-master.py          # 母版改动后重新抽取合同
node tools/feishu-v05/run-min-chain.js             # dry-run，不连接飞书
node --test tools/feishu-v05/gates.test.js         # Gate 反向测试
node tools/feishu-v05/run-min-chain.js --verify-only            # 只读：校验飞书 11 张表是否对齐母版
node tools/feishu-v05/run-min-chain.js --live --create-tables   # 建齐 11 张空表并跑通一条链路
node tools/feishu-v05/run-min-chain.js --live      # 表已建好时写入链路（按主字段 upsert）
```

表是手工建的，第一次务必先跑 `--verify-only`：它只读字段元数据，逐表列出缺字段、类型不符、主字段错位和母版之外的多余列，一个记录都不写。

`--app-token=` 可以直接粘 Base 链接（`https://<租户>.feishu.cn/base/<app_token>`），不必手动截取 token。

证据写入 `artifacts/feishu-v05/<时间戳>-<运行标记>/min-chain-evidence.json`：事实源、飞书记录、回填项、Integration_Links、Gate 结果，live 模式再加 table_id 与 record_id。

## 环境变量

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | live | 企业自建应用凭据，需多维表格记录读取／搜索／创建／更新权限 |
| `FEISHU_V05_BITABLE_APP_TOKEN` | live | V0.5 经营 Base 的 App Token |
| `FEISHU_V05_TABLE_<SHEET>` | 否 | 指定已有表 ID，`<SHEET>` 为母版表名大写，如 `FEISHU_V05_TABLE_DEALS` |
| `FEISHU_API_BASE_URL` | 否 | 默认 `https://open.feishu.cn` |

## 最小链路写了什么

| 母版表 | 主字段 | 本次写入的 ID |
| --- | --- | --- |
| `Family_Student_View` | `Client ID` | 飞书运营 ID `PN-CLI-…`，另带 Core 的 `Family ID` / `Student ID` |
| `Deals` | `Deal ID` | `PN-DEAL-…` |
| `Contracts` | `Contract ID` | Founder OS 签发的 `CONTRACT-…`，`Contract Code` 只读引用 |
| `Payments` | `Payment ID` | `PN-PAY-…` |
| `Service_Projects` | `Service Project ID` | `PN-SP-…` |
| `Integration_Links` | `Integration Link ID` | 6 行 ACTIVE 映射，把上面 5 条记录接回 Core / Founder OS |

`Deals.Contract ID`、`Deals.Service Project ID`、`Family_Student_View.Primary Deal ID`、`Family_Student_View.Service Project ID` 是反向引用，写完链路再回填，所以 live 模式下这四列走一次 PATCH。

## 10 条 V0.5 Gate

全部通过才写飞书；任一失败立即停止且不触碰飞书。

| Gate | 对应 V0.5 调整 |
| --- | --- |
| G1 | 删除/停用：`Member ID` / `Grant ID` / `Service Order ID` 在母版 11 张表与写入载荷中都不得出现 |
| G2 | 重定义：`Client ID` 只作 Founder OS 经营记录 ID，身份仍以 `Family ID` / `Student ID` 为准 |
| G3 | 保留并分开：`Source Type` / `Partner ID` / `Source Owner` / `Account Manager` 四列独立、取值不混用 |
| G4 | 保留原义：`Source System` + `System Record ID` 是外部／遗留记录号，未被改名为 `Partner ID` |
| G5 | 限制写入：`Contract Code` 只读引用 Founder OS，飞书 create-only、不改号 |
| G6 | 服务主链统一 `Service Project ID`，母版不得出现 `Service Order ID` |
| G7 | 跨系统只经 `Integration_Links`，且飞书本地 `PN-*` ID 不得冒充 Core Canonical ID |
| G8 | 主链引用完整：13 条正向引用 + 4 条回填引用 |
| G9 | 下拉取值全部落在母版白名单内 |
| G10 | 写入列全部来自母版，未自造字段 |

## 边界

- 本工具只跑最小链路。`Delivery`、`Applications`、`Settlements` 要等 Founder OS 与飞书通过 `Integration_Links` 映射确认无误后再接。
- 母版 README 写明：Remote D1 Gate 完成前不接真实自动同步与生产写入。本工具的 `--live` 只做受控单条链路验收，不是同步服务。
- 金额单位跟随母版 `Currency` 列按元记账；若 Founder OS 以分为单位，在 `core.js` 的事实源换算处统一转换。
- 这套经营 Base 与 `docs/FEISHU_BITABLE_SETUP.md` 的 7 张运营镜像表是两套东西，必须使用不同的 Base。
