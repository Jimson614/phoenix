# Education Compass V0.5.0 本地证据包

运行：

```powershell
npm.cmd run verify:education-evidence
```

脚本会在 `artifacts/verification/<UTC>/` 新建一次性目录，并运行受控的本地构建、测试、OpenAPI/示例校验和 HTTP mock 冒烟测试。它会移除进程环境中的数据库、OpenAI、飞书、微信登录及微信支付凭据，并将 PostgreSQL 检查固定记录为 `BLOCKED_EXTERNAL`，因此不会连接外部系统。

每次生成的目录包含：

- `commands.ndjson`：实际命令、退出码、耗时、输出摘要及输出哈希；不保存原始测试输出。
- `tests.json`、`http-smoke.redacted.json`：本地测试和 L1/L2 HTTP mock 路径的结构化结果。
- `migration-hashes.before.json`、`migration-hashes.after.json`：迁移前后哈希，以及签署冻结文件和历史 001–004 基线检查。
- `source-manifest.before.json`、`source-manifest.after.json`：验证命令运行前后的源码清单；如果验证期间源码变化，证据自动失效。
- `openapi-conformance.json`、`agent-egress-key-diff.json`、`feishu-field-diff.json`：合同与数据出站边界证据。
- `TEST_REPORT.md`、`release-manifest.json`：人读报告和机器读清单。
- `SHA256SUMS.txt`：除自身外全部证据文件的 SHA-256。

`LOCAL_LEVEL1_LEVEL2_HTTP_MOCK_VERIFIED` 只表示这一次、这一份源码的本地内存数据库与 mock 支付闭环通过。它不表示 PostgreSQL、真实微信支付、OpenAI、飞书、微信开发者工具、部署或生产发布已通过。证据包不是发布候选包，脚本不会生成 ZIP。
