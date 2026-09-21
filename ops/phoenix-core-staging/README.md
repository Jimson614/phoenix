# Phoenix Core Staging｜只读接入脚本

来源：2026-09-11 Jimson 周五任务（Weekend Safe Gate）实际在服务器上执行的脚本，
原先只存在于本机 `Documents\Codex\2026-09-11\new-chat\work\`，未入库。此处按原样回填，
未做任何功能改动，便于复验与再次执行。

## 作用

为 askwise 提供对 `phoenix_core_staging` 的**只读**接入：

- 读取角色 `askwise_staging_ro` 以 `PASSWORD NULL` + peer 认证创建，不持有任何口令。
- `pg_hba` 仅放通回环（`127.0.0.1/32`、`::1/128`），并对该角色的 host 连接显式 `reject`。
- 连接强制 `default_transaction_read_only=on`，附 `statement_timeout` / `lock_timeout`。

## 文件名不可更改

脚本之间按**确切文件名**通过 `/tmp/<name>` 互相引用，例如
`provision-phoenix-core-staging.sh` 读取 `/tmp/phoenix-core-staging.env`、
`/tmp/askwise-staging-core-readcheck`、`/tmp/pg_hba.conf.askwise-staging`。
重命名（包括把 env 改成 `.env.example`）会破坏可复现性。

`phoenix-core-staging.env` 只含连接参数（socket 路径、库名、角色名、超时），不含凭据，
因此可安全入库；新增任何 secret 值前请改走 secret manager，不要写进本文件。

## 执行顺序

1. `audit_askwise_runtime.sh` — 审计现状，不改动。
2. `inspect_hba.sh` — 只读检查现有 `pg_hba.conf` 与 systemd unit。
3. `provision-phoenix-core-staging.sh` — 落地角色、库、unit；覆盖 `pg_hba.conf` 前会比对
   审计时记录的 SHA-256，不一致即拒绝写入，并先备份原文件。
4. `verify-phoenix-core-staging.sh` — 复验角色无口令、只读、连接可用。
5. `cleanup-phoenix-core-staging-temp.sh` — 清理 `/tmp` 暂存件。

目标主机 PostgreSQL 路径为 `/etc/postgresql/16/main/`；执行前请确认版本一致。
