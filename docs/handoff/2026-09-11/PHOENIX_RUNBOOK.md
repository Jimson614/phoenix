# Phoenix Operations Runbook and Minimum Monitoring Baseline

版本：2026-09-09  
状态：可用于 staging/production 交接的无 secret 模板；正式 host、domain、unit name 与日志路径必须由环境负责人填实后复验。

## 1. 每次操作前的事实快照

记录：时间、操作者、环境、repo path、branch、exact SHA、dirty/clean、目标服务、变更单。若任一字段未知，停止变更并先查明。

```bash
git status --short
git branch --show-current
git rev-parse HEAD
git remote -v
```

不得对 dirty production checkout 执行 force checkout、reset 或原位覆盖。

## 2. Nginx

```bash
sudo nginx -t
sudo systemctl status nginx --no-pager
sudo ss -ltnp
sudo tail -n 200 /var/log/nginx/error.log
sudo tail -n 200 /var/log/nginx/access.log
```

如使用自定义日志路径，必须在环境清单中明确。变更配置后先 `nginx -t`，再 reload；不要用 restart 掩盖配置错误。

## 3. API / process manager

systemd：

```bash
sudo systemctl status <service>.service --no-pager
sudo journalctl -u <service>.service -n 200 --no-pager
sudo systemctl restart <service>.service
sudo systemctl is-enabled <service>.service
```

PM2（仅环境实际采用时）：

```bash
pm2 status
pm2 logs <app> --lines 200 --nostream
pm2 describe <app>
```

启动前核对 `WorkingDirectory`、build 目录、监听 host/port、运行用户、env source 和 exact SHA。不得在命令行打印 secret。

## 4. PostgreSQL

```bash
pg_isready -h <db-host> -p <db-port> -d <db-name>
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c 'select current_database(), current_user, now();'
```

生产应使用 TLS `verify-full`、独立 migrator/app role、可追踪 migration ledger。任何 migration 前必须有 backup、restore 方法和回滚判据；业务 app role 不应拥有 schema 管理权限。

## 5. Health checks

```bash
curl -fsS --max-time 5 http://127.0.0.1:<port>/health
curl -fsS --max-time 10 https://<domain>/health
curl -I --max-time 10 https://<domain>/
```

顺序必须是：进程监听 → 本机 health → Nginx upstream → 公网 HTTPS → 核心业务 smoke。单独的首页 `200` 不能证明 API 或 DB 健康。

## 6. 502 / 404 / DB failure 排查顺序

### 502

1. `ss -ltnp` 确认 upstream 端口是否监听。
2. 本机 `curl /health`。
3. 检查 unit/PM2 的 working directory、build 与日志。
4. `nginx -T` 核对实际命中的 server block 与 `proxy_pass`。
5. 修复后按本机 → 公网顺序复验。

### 404

1. 判断 404 来自 CDN、Nginx、frontend router 还是 API。
2. 核对 Host header、location precedence、base path 与静态资产目录。
3. 检查 `/robots.txt`、`/sitemap.xml`、health 等是否确实存在于该 build。

### DB failure

1. 检查 DNS/网络/TLS，不先改密码。
2. `pg_isready` 与最小只读 query。
3. 核对 app role 权限、migration ledger、connection pool 与证书链。
4. 若 schema 不匹配，停止流量；先恢复备份或执行已审批 rollback。

## 7. 最低监控基线

| Signal | 最低要求 | 当前可证明状态 |
|---|---|---|
| Website health | 每 1–5 分钟 HTTPS/首页与关键静态资产 | `MISSING`：未发现正式生产目标 |
| API health | `/health` + latency + 5xx | `MISSING`：Education service 当前 inactive |
| DB connection | 连通、TLS、pool saturation | `MISSING`：无生产监控证据 |
| Process auto-restart | systemd/PM2 enabled + restart counter | Education `disabled`; 其他环境 `UNKNOWN` |
| Disk | 使用率与 inode，建议 80% warning / 90% critical | `MISSING` |
| Memory | available memory、OOM/restart | `MISSING` |
| Certificate | 到期前 30/14/7 天告警 | `MISSING` |
| Backup | 成功时间、restore drill | Family sandbox PASS；production `MISSING` |

建议在正式环境选择一个受控监控平台，配置 owner、通知渠道、安静期和 escalation。没有告警路由时，不得把“能 curl”写成“已监控”。

## 8. Change / rollback record

每次发布至少记录：previous SHA、target SHA、migration ID、backup ID、部署开始/结束时间、health 结果、业务 smoke、rollback trigger、实际回滚命令、审批人。日志不得包含 token、cookie、DSN 密码或私钥。
