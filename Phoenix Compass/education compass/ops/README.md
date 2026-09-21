# 运维脚本

这些脚本运行在腾讯云服务器（Ubuntu 24.04，`ubuntu` 用户）和本机 Windows 上，用于部署、数据库迁移、备份和联调。
仓库里保存的是**服务器上正在运行的版本**，修改后需要重新拷贝到服务器才会生效。

脚本里不包含任何密钥。所有密钥由脚本交互式录入，写进服务器上权限 600 的文件（`server/.env`、`server/.env.uat`、`~/.config/rclone/rclone.conf`），不进仓库。

## 目录

| 目录 | 内容 | 部署位置 |
| --- | --- | --- |
| `server/` | 服务器脚本 | `/home/ubuntu/`，权限 700 |
| `systemd/` | 生产服务单元 | `/etc/systemd/system/` |
| `windows/` | 本机开发脚本 | 任意位置，双击运行 |

脚本中的绝对路径假设：项目位于 `/home/ubuntu/phoenix/Phoenix Compass/education compass`，Node 24 位于
`/home/ubuntu/.nvm/versions/node/v24.20.0/bin/node`（主机默认的 Node 18 不满足项目要求）。

## server/

| 脚本 | 作用 | 何时运行 |
| --- | --- | --- |
| `update-education-compass.sh <分支> [--switch]` | 把服务器代码快进到指定分支；后端有改动时跑测试、构建、重启联调后端与 AI 处理进程，测试不过就不构建、不重启 | 每次部署 |
| `apply-migrations.sh [库名]` | 以数据库管理员身份应用未执行的迁移并登记到 `schema_migrations`，校验和与 `server/scripts/migrate.js` 一致，可重复运行 | 新增迁移后（默认 `phoenix_uat`） |
| `backup-databases.sh` | 备份 `compass` 和 `phoenix_uat`，校验备份可读，保留 14 天，日志写入 `~/backups/db/backup.log` | 每天 03:30（cron） |
| `sync-backups-to-cos.sh` | 把备份上传到腾讯云 COS，云端保留 30 天，日志写入 `~/backups/db/cos-sync.log` | 每天 04:10（cron） |
| `set-cos-backup.sh` | 一次性配置 COS：录入桶名、地域、SecretId/SecretKey（隐藏输入），验证读写权限后写入 rclone 配置并加定时任务 | 更换备份桶或密钥时 |
| `check-cos-access.sh` | 用已保存的凭据复测 COS 读写权限，并解释失败原因 | COS 上传失败时排查 |
| `set-uat-wechat-secret.sh` | 录入小程序 AppSecret（隐藏输入），让联调环境改用真实微信登录并重启 | 更换 AppSecret 时 |
| `set-uat-deepseek-key.sh` | 录入 DeepSeek API Key（隐藏输入），验证余额、应用迁移 006、切换联调 AI 供应商并重启 | 启用 DeepSeek 时 |
| `phoenix_uat_start.sh` | pm2 进程 `phoenix_uat_api` 的启动脚本：加载 `.env.uat`，仅监听 127.0.0.1，固定 Node 24 | 由 pm2 调用 |
| `phoenix_uat_agent_worker_start.sh` | pm2 进程 `phoenix_uat_agent_worker` 的启动脚本 | 由 pm2 调用 |

服务器上的定时任务：

```cron
30 3 * * * /home/ubuntu/backup-databases.sh >/dev/null 2>&1
10 4 * * * /home/ubuntu/sync-backups-to-cos.sh >/dev/null 2>&1
```

## systemd/

生产环境的两个服务，目前都是 `inactive/disabled`，等 HTTPS 域名、微信与支付凭据、verified 来源目录就绪后再启用：

- `education-compass.service`：后端 API，`NODE_ENV=production`，仅监听 `127.0.0.1:3100`，由 nginx 反向代理。
- `education-compass-agent-worker.service`：AI 任务处理进程，与 API 同源同配置。启用 AI 时才需要。

安装后执行 `sudo systemctl daemon-reload`；启用为 `sudo systemctl enable --now <服务名>`。

联调环境不使用 systemd，由 pm2 管理，且已配置开机自启（`pm2-ubuntu` 服务 + `pm2 save`）。

## windows/

`phoenix-uat-tunnel.cmd`：建立 SSH 隧道，把本机 `127.0.0.1:3000` 转发到服务器的联调后端 `127.0.0.1:3010`，断线自动重连。
微信开发者工具的开发版产物只允许访问 `127.0.0.1`，因此本机联调必须先运行它，保持窗口打开。

## 部署流程

```bash
# 本机：推送到 GitHub（走 PR）和服务器（走 SSH，国内访问 GitHub 不稳定时更可靠）
git push fork <分支>
git push tencent <分支>

# 服务器：快进到指定分支，必要时测试、构建并重启
ssh phoenix-tencent '~/update-education-compass.sh <分支>'
```

分支必须显式写出。服务器是**多个项目共用的同一个检出**（askwise、Identity Compass、Wealth Compass 都在里面），
切换分支会一并改写它们的文件，所以脚本的规则是：

- 指定分支与当前检出分支相同 → 直接快进。
- 当前分支已包含目标分支的全部提交 → 提示无需切换并退出。
- 两者确实不同 → 列出切换会改写哪些顶层目录，并要求追加 `--switch` 再执行一次；工作区有未提交改动时拒绝切换。
- 不带参数运行 → 打印用法和本机已推送过来的分支列表。

## 备份与恢复

备份为 PostgreSQL 自定义格式（`pg_dump -Fc`），含个人数据，目录与文件均为属主可读（700/600）。

```bash
# 查看最近结果
ssh phoenix-tencent 'tail -4 ~/backups/db/backup.log; tail -2 ~/backups/db/cos-sync.log'

# 从本地备份恢复到临时库核对
sudo -u postgres createdb restore_check
cat ~/backups/db/phoenix_uat-<时间戳>.dump | sudo -u postgres pg_restore -d restore_check --no-owner --no-privileges
sudo -u postgres psql -d restore_check -c 'select count(*) from users'
sudo -u postgres dropdb restore_check

# 从云端取回某个备份
rclone copy "cos:$(cat ~/.config/phoenix-cos-bucket)/db/<文件名>" /tmp
```

保留策略分三层，周期错开，正常情况下只有脚本在清理：本地 14 天、云端 30 天、存储桶生命周期规则 60 天（兜底）。

## 已知前提

- COS 备份账号是仅能访问该存储桶的 CAM 子用户，没有创建存储桶的权限，因此 rclone 配置必须保留 `no_check_bucket = true`，否则上传前的建桶探测会被拒绝（403）。
- 联调库 `phoenix_uat` 的表属于数据库管理员，应用账号只有数据读写权限，因此迁移要用 `apply-migrations.sh`；生产库 `compass` 的表属于应用账号，可直接用 `npm --prefix server run db:migrate`。
