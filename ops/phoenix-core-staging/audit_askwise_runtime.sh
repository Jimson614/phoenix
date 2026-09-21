#!/usr/bin/env bash
set -u

echo '=== PM2_SAFE_SUMMARY ==='
if command -v pm2 >/dev/null 2>&1; then
  pm2 jlist 2>/dev/null | python3 -c '
import json, re, sys
data = json.load(sys.stdin)
for proc in data:
    env = proc.get("pm2_env") or {}
    db_keys = sorted(k for k in env if re.search(r"DATABASE|DB_|POSTGRES|PHOENIX", k, re.I))
    fields = {
        "name": proc.get("name"),
        "status": env.get("status"),
        "cwd": env.get("pm_cwd"),
        "script": env.get("pm_exec_path"),
        "NODE_ENV": env.get("NODE_ENV"),
        "APP_ENV": env.get("APP_ENV"),
        "ENVIRONMENT": env.get("ENVIRONMENT"),
        "db_config_keys": db_keys,
    }
    print(json.dumps(fields, ensure_ascii=False))
'
else
  echo 'PM2_NOT_FOUND'
fi

echo '=== LISTENERS_WITH_PROCESS ==='
ss -ltnp 2>/dev/null | awk 'NR == 1 || $4 ~ /:(3000|3001|4000|5000|5432|8000|8080|5173)$/'

echo '=== CONFIG_FILE_NAMES ==='
find /home/ubuntu/phoenix -maxdepth 5 -type f \
  \( -name '.env' -o -name '.env.*' -o -name 'ecosystem*.js' -o -name 'ecosystem*.cjs' \
     -o -name 'docker-compose*.yml' -o -name 'docker-compose*.yaml' -o -name 'package.json' \
     -o -name 'prisma.schema' -o -name 'schema.prisma' \) \
  -printf '%p\n' 2>/dev/null | sort

echo '=== ENV_SAFE_SUMMARY ==='
python3 - <<'PY'
from pathlib import Path
from urllib.parse import urlparse
import json, re

root = Path('/home/ubuntu/phoenix')
for path in sorted(root.rglob('.env*')):
    if not path.is_file() or len(path.relative_to(root).parts) > 6:
        continue
    safe = {}
    try:
        lines = path.read_text(errors='replace').splitlines()
    except OSError:
        continue
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        key, value = key.strip(), value.strip().strip('"').strip("'")
        upper = key.upper()
        if upper in {'NODE_ENV','APP_ENV','ENVIRONMENT','DEPLOY_ENV','STAGE'}:
            safe[key] = value[:80]
        elif upper in {'DATABASE_URL','POSTGRES_URL','POSTGRESQL_URL'}:
            try:
                u = urlparse(value)
                safe[key] = {
                    'scheme': u.scheme,
                    'host': u.hostname,
                    'port': u.port,
                    'database': u.path.lstrip('/'),
                    'credentials_configured': bool(u.username or u.password),
                }
            except Exception:
                safe[key] = {'configured': bool(value), 'parseable': False}
        elif re.fullmatch(r'(DB|DATABASE|POSTGRES)_(HOST|PORT|NAME|DATABASE)', upper):
            safe[key] = value[:120]
        elif re.search(r'(DB|DATABASE|POSTGRES).*(USER|PASSWORD|PASS|TOKEN|SECRET)', upper):
            safe[key] = {'configured': bool(value), 'value': '[redacted]'}
    if safe:
        print(json.dumps({'path': str(path), 'safe': safe}, ensure_ascii=False))
PY

echo '=== LOCAL_POSTGRES_VERSION ==='
psql --version 2>/dev/null || true

