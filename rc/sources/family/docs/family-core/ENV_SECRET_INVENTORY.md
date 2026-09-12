# Phoenix Environment and Secret Inventory

Status: `VARIABLE NAMES ONLY / VALUES NOT READ`

Classification: `ACTIVE` means referenced by the selected candidate; `UNUSED` means disabled by the current gate; `ROTATE` means a deployed secret should be rotated before promotion or after exposure (no exposure was found here); `UNKNOWN` means current-host presence/deployment binding was not verified.

## Family Core sandbox

| Name | Purpose / source | Status |
| --- | --- | --- |
| `FAMILY_CORE_PG_URL` | disposable PostgreSQL administration endpoint supplied to gate runner | ACTIVE in local gate only; must never point to production |
| `FAMILY_CORE_PG_BIN` | optional directory for portable PostgreSQL executables | ACTIVE on this Windows host |
| `PGPASSWORD` | PostgreSQL client injection | ACTIVE only if the selected test server requires it; value not recorded |
| `phoenix.synthetic_mode` | database session guard required by Education adapter | ACTIVE test guard, not an OS secret |
| `phoenix.actor_user_id`, `phoenix.family_id` | scoped database session claims used by authorization/RLS | ACTIVE synthetic gate; production claim issuer missing |

## Education / Application Compass server

| Group / names | Purpose | Status |
| --- | --- | --- |
| `NODE_ENV`, `PORT`, `PUBLIC_BASE_URL`, `BUILD_VERSION` | runtime mode, bind port, public origin, traceable build | ACTIVE; target-host values UNKNOWN |
| `DATABASE_URL` | application PostgreSQL connection | ACTIVE; must use TLS and least-privilege role in controlled/prod environments; presence UNKNOWN |
| `EDUCATION_TEST_DATABASE_URL`, `EDUCATION_TEST_DATABASE_ALLOW_MUTATION` | destructive-safe Education test DB gate | ACTIVE in tests; current controlled value UNKNOWN |
| `MASTERS_TEST_DATABASE_URL`, `MASTERS_TEST_APP_DATABASE_URL`, `MASTERS_TEST_DATABASE_ALLOW_MUTATION` | PR #9 migration role, application role and destructive-test sentinel | ACTIVE for controlled PR #9 DB gate; external environment UNKNOWN |
| `SESSION_SECRET` | signed server sessions | ACTIVE; inject via secret manager; ROTATE before any environment promotion unless provenance is verified |
| `WECHAT_APP_ID`, `WECHAT_APP_SECRET` | WeChat login/provider | ACTIVE for real controlled device gate; configuration UNKNOWN |
| `PHOENIX_API_BASE_URL`, `PHOENIX_MINIPROGRAM_APPID` | native package build injection | ACTIVE for controlled package; configuration UNKNOWN |
| `WECHAT_MCH_ID`, `WECHAT_MCH_CERT_SERIAL_NO`, `WECHAT_MCH_PRIVATE_KEY_PATH`, `WECHATPAY_API_V3_KEY`, `WECHATPAY_PUBLIC_KEY_ID`, `WECHATPAY_PUBLIC_KEY_PATH`, `WECHAT_PAY_NOTIFY_URL`, `WECHAT_REFUND_NOTIFY_URL` | payment provider | UNUSED for PR #9 free-consultation gate; do not request or enable |
| `PAID_COMPASS_ENABLED`, `GROWTH_DISCOVERY_PAYMENT_ENABLED`, `PAYMENT_PROVIDER` | payment feature gates | UNUSED / must remain off or mock for this gate |
| `MASTERS_INTAKE_ENABLED`, `MASTERS_WORKER_ENABLED` | Masters test feature/worker | ACTIVE only in non-production controlled environment |
| `MASTERS_AI_ENABLED` | external AI switch | UNUSED; must remain `false` for PR #9 |
| `MASTERS_PRIVATE_STORAGE_DIR`, `MASTERS_DEVELOPMENT_STORE_PATH`, `MASTERS_RETENTION_DAYS`, `MASTERS_PDF_FONT_PATH` | private files, test fallback, retention, font | ACTIVE/UNKNOWN on target host; retention is policy HOLD |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_MODERATION_MODEL`, `OPENAI_REQUEST_TIMEOUT_MS`, `OPENAI_MAX_OUTPUT_TOKENS`, `OPENAI_SAFETY_HMAC_KEY` | optional AI/guardrails | UNUSED for PR #9 gate; values not inspected |
| `AI_CONTENT_KEYRING_JSON`, `AI_CONTENT_CURRENT_KEY_VERSION`, `AI_CONVERSATION_RETENTION_DAYS`, `AI_WORKER_*`, `AI_MAX_*`, `AI_RATE_LIMIT_MESSAGES_PER_MINUTE` | encrypted AI content/worker controls | UNUSED for PR #9 gate; deployment state UNKNOWN |
| `FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `FEISHU_BITABLE_APP_TOKEN`, `FEISHU_PSEUDONYM_KEY`, `FEISHU_*_ENABLED`, `FEISHU_SYNC_*` | optional Feishu integration | UNUSED for isolated gate unless separately approved; values not inspected |
| `SOURCE_CATALOG_MODE`, `SOURCE_CATALOG_PATH` | sourced program catalog | ACTIVE only when approved source files exist; target state UNKNOWN |

## Website V5

| Name/binding | Purpose | Status |
| --- | --- | --- |
| `DB` | Cloudflare D1 binding declared in `.openai/hosting.json` | declared; runtime binding UNKNOWN; not Phoenix Core authority |
| `ASSETS`, `IMAGES` | Cloudflare runtime asset/image bindings in downstream branches | ACTIVE when hosted; target binding UNKNOWN |
| `WRANGLER_LOG_PATH`, `WRANGLER_WRITE_LOGS`, `MINIFLARE_REGISTRY_PATH` | local/CI runtime paths | ACTIVE tooling, non-secret |
| `CODEX_SANDBOX`, `CI` | build behavior | ACTIVE tooling, non-secret |
| `HEALTH_COMPASS_PREVIEW`, `HEALTH_TEST_PORT` | PR #12/#13 Health preview | UNUSED/HOLD under current scope |
| customer auth pepper/signing/recovery variables documented by PR #13 | D1 account protection | UNKNOWN and out of PR #6 release baseline; must be inventoried before PR #13 review |

## Identity Compass / Family OS legacy

| Names | Purpose | Status |
| --- | --- | --- |
| `NEXT_PUBLIC_IDENTITY_ADVISOR_BOOKING_URL` | public advisor booking target | ACTIVE in Identity candidate; value UNKNOWN and not secret |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` | optional server-side AI surface | UNKNOWN; never expose to browser bundle |
| `PFS_BACKEND_HOST`, `PFS_BACKEND_PORT`, `PFS_DATABASE_PATH`, `PFS_ENABLE_DEMO_AUTH` | Family OS local backend/SQLite/demo auth | ACTIVE for local MVP only; demo auth must be off outside isolated development |
| `PHOENIX_API_BASE_URL`, `PHOENIX_MINIPROGRAM_APPID` | mini-program API/AppID build inputs | UNKNOWN for controlled environments |

## Required environment boundaries

| Environment | Database/data | URL | Env source | Allowed use |
| --- | --- | --- | --- | --- |
| `dev` | local SQLite/FileStore or disposable synthetic PostgreSQL | loopback only | developer process / local ignored file | coding and unit tests; never real customer data |
| `test` | disposable database with `test`/`sandbox` marker | CI/local ephemeral | CI secret store / generated ephemeral values | automated destructive tests and synthetic fixtures |
| `staging` | dedicated non-production DB, private storage and least-privilege app role | approved HTTPS host | managed secret store | controlled UAT with synthetic data only until privacy approval |
| `production` | dedicated production RDS/D1/approved storage | canonical HTTPS domain | managed secret store with rotation/audit | only after Founder, security, migration and release gates |

## Actions

1. Never copy secret values into Git, Notion, screenshots, commands captured as evidence, or this inventory.
2. On each target host, record only `CONFIG_PRESENT/MISSING`, secret manager reference, owner, and last-rotation evidence ID.
3. Reject any test/staging database URL that resolves to the production cluster/account.
4. Rotate any credential whose provenance, scope, or prior handling is unknown before promotion; rotation itself was not performed in this audit.
