#!/usr/bin/env bash
# Switch the UAT Agent (phoenix_uat_api + phoenix_uat_agent_worker) from mock to DeepSeek.
# The API key is read with hidden input and only passed through environment variables.
set -euo pipefail
umask 077

SERVER="/home/ubuntu/education-compass/Phoenix Compass/education compass/server"
NODE=/home/ubuntu/.nvm/versions/node/v24.20.0/bin/node
export PATH=/home/ubuntu/.nvm/versions/node/v24.20.0/bin:$PATH
cd "$SERVER"

read -rsp "请粘贴 DeepSeek API Key（输入内容不会显示），然后按 Enter: " DEEPSEEK_KEY
echo
if [[ ! "$DEEPSEEK_KEY" =~ ^sk-[A-Za-z0-9]{20,}$ ]]; then
  echo "格式不对：DeepSeek API Key 应以 sk- 开头。没有做任何修改。"
  exit 1
fi
export DEEPSEEK_KEY

echo "1/4 验证 API Key（查询余额，不产生费用）……"
if ! "$NODE" -e '
fetch("https://api.deepseek.com/user/balance", { headers: { Authorization: `Bearer ${process.env.DEEPSEEK_KEY}` }, signal: AbortSignal.timeout(15000) })
  .then(async (r) => {
    if (r.status === 401) { console.log("API Key 无效（401）。"); process.exit(2) }
    if (!r.ok) { console.log(`DeepSeek 返回 HTTP ${r.status}，请稍后再试。`); process.exit(3) }
    const b = await r.json()
    const info = (b.balance_infos || []).map((x) => `${x.total_balance} ${x.currency}`).join("，") || "未知"
    console.log(`API Key 有效。余额：${info}${b.is_available ? "" : "（余额不足，AI 调用会失败，请先充值）"}`)
  })
  .catch((e) => { console.log("无法连接 DeepSeek：" + e.message); process.exit(4) })
'; then
  echo "没有做任何修改。"
  exit 1
fi

echo "2/4 更新数据库（允许 provider=deepseek，可重复执行）……"
set -a; source ./.env.uat; set +a
"$NODE" -e '
const { Client } = require("pg")
const sql = require("fs").readFileSync("migrations/006_deepseek_agent_provider.sql", "utf8")
;(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 })
  await c.connect()
  try { await c.query("BEGIN"); await c.query(sql); await c.query("COMMIT") } catch (e) { await c.query("ROLLBACK"); throw e }
  const r = await c.query("select pg_get_constraintdef(oid) d from pg_constraint where conname = $1", ["agent_runs_provider_check"])
  if (!r.rows[0] || !r.rows[0].d.includes("deepseek")) throw new Error("约束未更新")
  await c.end()
  console.log("数据库已允许 deepseek。")
})().catch((e) => { console.log("数据库更新失败：" + e.message); process.exit(1) })
'

echo "3/4 修改配置……"
BACKUP=".env.uat.bak-$(date +%Y%m%d-%H%M%S)"
cp -p .env.uat "$BACKUP"
TMP="$(mktemp .env.uat.XXXXXX)"
awk '
  BEGIN { set["AGENT_PROVIDER"] = "deepseek"; set["DEEPSEEK_API_KEY"] = ENVIRON["DEEPSEEK_KEY"]; set["DEEPSEEK_MODEL"] = "deepseek-chat" }
  { split($0, kv, "="); k = kv[1]; if (k in set) { print k "=" set[k]; done[k] = 1 } else print }
  END { for (k in set) if (!(k in done)) print k "=" set[k] }
' .env.uat > "$TMP"
chmod 600 "$TMP" && mv "$TMP" .env.uat
unset DEEPSEEK_KEY
if ! bash -c 'set -a; source ./.env.uat; set +a; export LISTEN_HOST=127.0.0.1; '"$NODE"' -e "
  const c = require(\"./dist/config\").loadConfig()
  if (c.agentProvider !== \"deepseek\") throw new Error(\"provider=\" + c.agentProvider)
"' ; then
  cp -p "$BACKUP" .env.uat
  echo "新配置校验失败，已恢复原配置。"
  exit 1
fi

echo "4/4 重启联调后端和 AI 处理进程……"
pm2 restart phoenix_uat_api > /dev/null
pm2 restart phoenix_uat_agent_worker > /dev/null
for _ in $(seq 1 20); do sleep 1; curl -sf -m 2 http://127.0.0.1:3010/health > /dev/null && break; done
if curl -sf -m 5 http://127.0.0.1:3010/health > /dev/null; then
  pm2 save > /dev/null
  echo "完成：联调环境的 AI 分析已改用 DeepSeek（deepseek-chat）。"
else
  echo "联调后端没有正常启动。请告诉 Claude：\"切换 DeepSeek 后后端没启动\"。原配置备份：$BACKUP"
  exit 1
fi
