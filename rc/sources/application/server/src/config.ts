import { AppError, invariant } from './domain/errors'
import { FeishuEntityType } from './domain/model'
import { parseAgentContentKeyring } from './ai/crypto'

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production'
  port: number
  databaseUrl: string
  sessionSecret: string
  paymentProvider: 'mock' | 'wechat'
  wechatAppId: string
  wechatAppSecret: string
  wechatMchId: string
  wechatMchCertSerialNo: string
  wechatMchPrivateKeyPath: string
  wechatPayApiV3Key: string
  wechatPayPublicKeyId: string
  wechatPayPublicKeyPath: string
  wechatPayNotifyUrl: string
  wechatRefundNotifyUrl: string
  publicBaseUrl: string
  paidCompassEnabled: boolean
  growthDiscoveryPaymentEnabled: boolean
  sourceCatalogMode: 'placeholder' | 'verified'
  sourceCatalogPath: string
  feishuBitableEnabled: boolean
  feishuAppId: string
  feishuAppSecret: string
  feishuBitableAppToken: string
  feishuPseudonymKey: string
  feishuCustomerProfileFieldsEnabled: boolean
  feishuBitableTables: Record<FeishuEntityType, string>
  feishuSyncIntervalMs: number
  feishuSyncBatchSize: number
  openaiAgentEnabled: boolean
  agentProvider: 'mock' | 'openai'
  openaiApiKey: string
  openaiModel: string
  openaiModerationModel: string
  openaiRequestTimeoutMs: number
  openaiMaxOutputTokens: number
  openaiSafetyHmacKey: string
  aiContentKeyring: Readonly<Record<string, string>>
  aiContentCurrentKeyVersion: string
  aiConversationRetentionDays: number
  aiWorkerIntervalMs: number
  aiWorkerBatchSize: number
  aiWorkerLeaseMs: number
  aiWorkerEnabled: boolean
  aiMaxTurnsPerReport: number
  aiMaxMessageChars: number
  aiRateLimitMessagesPerMinute: number
  aiMaxActiveRunsPerUser: number
}

const FEISHU_TABLE_ENV: Record<FeishuEntityType, string> = {
  family_profile: 'FEISHU_BITABLE_TABLE_FAMILY_PROFILE',
  student_profile: 'FEISHU_BITABLE_TABLE_STUDENT_PROFILE',
  assessment_session: 'FEISHU_BITABLE_TABLE_ASSESSMENT_SESSION',
  report_job: 'FEISHU_BITABLE_TABLE_REPORT_JOB',
  order_payment: 'FEISHU_BITABLE_TABLE_ORDER_PAYMENT',
  feedback: 'FEISHU_BITABLE_TABLE_FEEDBACK',
  advisor_request: 'FEISHU_BITABLE_TABLE_ADVISOR_REQUEST'
}

function booleanSetting(raw: string | undefined, fallback: boolean, label: string): boolean {
  const value = raw ?? String(fallback)
  invariant(value === 'true' || value === 'false', 500, 'CONFIG_INVALID', `${label} 必须是 true 或 false`)
  return value === 'true'
}

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number, label: string): number {
  const value = Number(raw ?? fallback)
  invariant(Number.isInteger(value) && value >= min && value <= max, 500, 'CONFIG_INVALID', `${label} 无效`)
  return value
}

function configuredUrl(raw: string, label: string): URL {
  try {
    return new URL(raw)
  } catch {
    throw new AppError(500, 'CONFIG_INVALID', `${label} 不是有效 URL`)
  }
}

function validateProductionDatabaseUrl(raw: string): void {
  const url = configuredUrl(raw, 'DATABASE_URL')
  invariant(['postgres:', 'postgresql:'].includes(url.protocol) && Boolean(url.hostname), 500, 'CONFIG_INVALID', 'DATABASE_URL 必须是 PostgreSQL URL')
  invariant(url.searchParams.get('sslmode') === 'verify-full', 500, 'CONFIG_INVALID', '生产 DATABASE_URL 必须显式使用 sslmode=verify-full')
}

function validatePostgresUrl(raw: string, label: string): void {
  const url = configuredUrl(raw, label)
  invariant(['postgres:', 'postgresql:'].includes(url.protocol) && Boolean(url.hostname), 500, 'CONFIG_INVALID', `${label} 必须是 PostgreSQL URL`)
}

function parseAgentKeyring(raw: string): Readonly<Record<string, string>> {
  try {
    return parseAgentContentKeyring(raw)
  } catch {
    throw new AppError(500, 'CONFIG_INVALID', 'AI_CONTENT_KEYRING_JSON 无效')
  }
}

function secretReused(encodedKey: string, secret: string): boolean {
  if (!secret) return false
  if (encodedKey === secret) return true
  const decoded = Buffer.from(encodedKey, 'base64')
  const candidate = Buffer.from(secret, 'utf8')
  return decoded.length === candidate.length && decoded.equals(candidate)
}

function validateWechatCallbackUrls(config: AppConfig): void {
  const base = configuredUrl(config.publicBaseUrl, 'PUBLIC_BASE_URL')
  invariant(base.protocol === 'https:' && !base.username && !base.password && !base.search && !base.hash && base.pathname === '/', 500, 'CONFIG_INVALID', 'PUBLIC_BASE_URL 必须是无凭据、查询或路径的 HTTPS origin')
  const checks: Array<[string, string, string]> = [
    ['WECHAT_PAY_NOTIFY_URL', config.wechatPayNotifyUrl, '/v1/webhooks/wechat-pay/transactions'],
    ['WECHAT_REFUND_NOTIFY_URL', config.wechatRefundNotifyUrl, '/v1/webhooks/wechat-pay/refunds']
  ]
  for (const [label, raw, expectedPath] of checks) {
    const endpoint = configuredUrl(raw, label)
    invariant(endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash, 500, 'CONFIG_INVALID', `${label} 必须是无凭据或查询的 HTTPS URL`)
    invariant(endpoint.origin === base.origin && endpoint.pathname === expectedPath, 500, 'CONFIG_INVALID', `${label} 必须位于 PUBLIC_BASE_URL 的固定回调路径`)
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = (env.NODE_ENV ?? 'development') as AppConfig['nodeEnv']
  invariant(['development', 'test', 'production'].includes(nodeEnv), 500, 'CONFIG_INVALID', 'NODE_ENV 无效')
  const paymentProvider = (env.PAYMENT_PROVIDER ?? 'mock') as AppConfig['paymentProvider']
  invariant(['mock', 'wechat'].includes(paymentProvider), 500, 'CONFIG_INVALID', 'PAYMENT_PROVIDER 无效')
  const sessionSecret = env.SESSION_SECRET ?? (nodeEnv === 'production' ? '' : 'development-only-session-secret-32-bytes')
  invariant(sessionSecret.length >= 32, 500, 'CONFIG_INVALID', 'SESSION_SECRET 至少需要32个字符')
  invariant(!(nodeEnv === 'production' && paymentProvider === 'mock'), 500, 'CONFIG_INVALID', '生产环境禁止使用 Mock 支付')
  invariant(!(nodeEnv === 'production' && !env.DATABASE_URL), 500, 'CONFIG_INVALID', '生产环境必须配置 DATABASE_URL')
  if (nodeEnv === 'production') validateProductionDatabaseUrl(env.DATABASE_URL ?? '')
  const port = Number(env.PORT ?? 3000)
  invariant(Number.isInteger(port) && port > 0 && port < 65536, 500, 'CONFIG_INVALID', 'PORT 无效')
  const sourceCatalogMode = (env.SOURCE_CATALOG_MODE ?? 'placeholder') as AppConfig['sourceCatalogMode']
  invariant(['placeholder', 'verified'].includes(sourceCatalogMode), 500, 'CONFIG_INVALID', 'SOURCE_CATALOG_MODE 无效')
  invariant(!(nodeEnv === 'production' && sourceCatalogMode !== 'verified'), 500, 'CONFIG_INVALID', '生产环境必须使用 verified 来源目录')
  const paidCompassEnabled = booleanSetting(env.PAID_COMPASS_ENABLED, false, 'PAID_COMPASS_ENABLED')
  const growthDiscoveryPaymentEnabled = booleanSetting(
    env.GROWTH_DISCOVERY_PAYMENT_ENABLED, false, 'GROWTH_DISCOVERY_PAYMENT_ENABLED'
  )
  const feishuBitableEnabled = booleanSetting(env.FEISHU_BITABLE_ENABLED, false, 'FEISHU_BITABLE_ENABLED')
  const feishuCustomerProfileFieldsEnabled = booleanSetting(
    env.FEISHU_CUSTOMER_PROFILE_FIELDS_ENABLED, false, 'FEISHU_CUSTOMER_PROFILE_FIELDS_ENABLED'
  )
  const openaiAgentEnabled = booleanSetting(env.OPENAI_AGENT_ENABLED, false, 'OPENAI_AGENT_ENABLED')
  const aiWorkerEnabled = booleanSetting(env.AI_WORKER_ENABLED, false, 'AI_WORKER_ENABLED')
  const agentProvider = (env.AGENT_PROVIDER ?? 'mock') as AppConfig['agentProvider']
  invariant(['mock', 'openai'].includes(agentProvider), 500, 'CONFIG_INVALID', 'AGENT_PROVIDER 无效')
  const aiContentKeyring = parseAgentKeyring(env.AI_CONTENT_KEYRING_JSON ?? '{}')
  const feishuBitableTables = Object.fromEntries(Object.entries(FEISHU_TABLE_ENV).map(([entityType, envName]) => [
    entityType,
    env[envName] ?? ''
  ])) as Record<FeishuEntityType, string>

  const config: AppConfig = {
    nodeEnv,
    port,
    databaseUrl: env.DATABASE_URL ?? '',
    sessionSecret,
    paymentProvider,
    wechatAppId: env.WECHAT_APP_ID ?? '',
    wechatAppSecret: env.WECHAT_APP_SECRET ?? '',
    wechatMchId: env.WECHAT_MCH_ID ?? '',
    wechatMchCertSerialNo: env.WECHAT_MCH_CERT_SERIAL_NO ?? '',
    wechatMchPrivateKeyPath: env.WECHAT_MCH_PRIVATE_KEY_PATH ?? '',
    wechatPayApiV3Key: env.WECHATPAY_API_V3_KEY ?? '',
    wechatPayPublicKeyId: env.WECHATPAY_PUBLIC_KEY_ID ?? '',
    wechatPayPublicKeyPath: env.WECHATPAY_PUBLIC_KEY_PATH ?? '',
    wechatPayNotifyUrl: env.WECHAT_PAY_NOTIFY_URL ?? '',
    wechatRefundNotifyUrl: env.WECHAT_REFUND_NOTIFY_URL ?? '',
    publicBaseUrl: env.PUBLIC_BASE_URL ?? '',
    paidCompassEnabled,
    growthDiscoveryPaymentEnabled,
    sourceCatalogMode,
    sourceCatalogPath: env.SOURCE_CATALOG_PATH ?? '',
    feishuBitableEnabled,
    feishuAppId: env.FEISHU_APP_ID ?? '',
    feishuAppSecret: env.FEISHU_APP_SECRET ?? '',
    feishuBitableAppToken: env.FEISHU_BITABLE_APP_TOKEN ?? '',
    feishuPseudonymKey: env.FEISHU_PSEUDONYM_KEY ?? '',
    feishuCustomerProfileFieldsEnabled,
    feishuBitableTables,
    feishuSyncIntervalMs: boundedInteger(env.FEISHU_SYNC_INTERVAL_MS, 60_000, 10_000, 3_600_000, 'FEISHU_SYNC_INTERVAL_MS'),
    feishuSyncBatchSize: boundedInteger(env.FEISHU_SYNC_BATCH_SIZE, 50, 1, 200, 'FEISHU_SYNC_BATCH_SIZE'),
    openaiAgentEnabled,
    agentProvider,
    openaiApiKey: env.OPENAI_API_KEY ?? '',
    openaiModel: env.OPENAI_MODEL ?? '',
    openaiModerationModel: env.OPENAI_MODERATION_MODEL ?? '',
    openaiRequestTimeoutMs: boundedInteger(env.OPENAI_REQUEST_TIMEOUT_MS, 30_000, 1_000, 120_000, 'OPENAI_REQUEST_TIMEOUT_MS'),
    openaiMaxOutputTokens: boundedInteger(env.OPENAI_MAX_OUTPUT_TOKENS, 1200, 128, 4000, 'OPENAI_MAX_OUTPUT_TOKENS'),
    openaiSafetyHmacKey: env.OPENAI_SAFETY_HMAC_KEY ?? '',
    aiContentKeyring,
    aiContentCurrentKeyVersion: env.AI_CONTENT_CURRENT_KEY_VERSION ?? 'v1',
    aiConversationRetentionDays: boundedInteger(env.AI_CONVERSATION_RETENTION_DAYS, 30, 1, 90, 'AI_CONVERSATION_RETENTION_DAYS'),
    aiWorkerIntervalMs: boundedInteger(env.AI_WORKER_INTERVAL_MS, 1000, 100, 60_000, 'AI_WORKER_INTERVAL_MS'),
    aiWorkerBatchSize: boundedInteger(env.AI_WORKER_BATCH_SIZE, 5, 1, 50, 'AI_WORKER_BATCH_SIZE'),
    aiWorkerLeaseMs: boundedInteger(env.AI_WORKER_LEASE_MS, 60_000, 5_000, 600_000, 'AI_WORKER_LEASE_MS'),
    aiWorkerEnabled,
    aiMaxTurnsPerReport: boundedInteger(env.AI_MAX_TURNS_PER_REPORT, 3, 1, 3, 'AI_MAX_TURNS_PER_REPORT'),
    aiMaxMessageChars: boundedInteger(env.AI_MAX_MESSAGE_CHARS, 2000, 100, 2000, 'AI_MAX_MESSAGE_CHARS'),
    aiRateLimitMessagesPerMinute: boundedInteger(env.AI_RATE_LIMIT_MESSAGES_PER_MINUTE, 6, 1, 60, 'AI_RATE_LIMIT_MESSAGES_PER_MINUTE'),
    aiMaxActiveRunsPerUser: boundedInteger(env.AI_MAX_ACTIVE_RUNS_PER_USER, 2, 1, 20, 'AI_MAX_ACTIVE_RUNS_PER_USER')
  }
  if (nodeEnv === 'production' || paymentProvider === 'wechat') {
    invariant(config.wechatAppId && config.wechatAppSecret, 500, 'CONFIG_INVALID', '微信 AppID/AppSecret 未配置')
  }
  if (paymentProvider === 'wechat') {
    for (const key of [
      'wechatMchId', 'wechatMchCertSerialNo', 'wechatMchPrivateKeyPath', 'wechatPayApiV3Key',
      'wechatPayPublicKeyId', 'wechatPayPublicKeyPath', 'wechatPayNotifyUrl', 'wechatRefundNotifyUrl', 'publicBaseUrl'
    ] as const) invariant(config[key], 500, 'CONFIG_INVALID', `${key} 未配置`)
    validateWechatCallbackUrls(config)
  }
  if (sourceCatalogMode === 'verified') invariant(config.sourceCatalogPath, 500, 'CONFIG_INVALID', 'verified 模式必须配置 SOURCE_CATALOG_PATH')
  if (feishuBitableEnabled) {
    invariant(config.databaseUrl, 500, 'CONFIG_INVALID', '启用飞书同步必须使用持久化 PostgreSQL 数据库')
    const feishuDatabase = configuredUrl(config.databaseUrl, 'DATABASE_URL')
    invariant(['postgres:', 'postgresql:'].includes(feishuDatabase.protocol) && Boolean(feishuDatabase.hostname), 500, 'CONFIG_INVALID', '启用飞书同步必须使用 PostgreSQL URL')
    invariant(config.feishuAppId && config.feishuAppSecret && config.feishuBitableAppToken, 500, 'CONFIG_INVALID', '飞书 App ID、App Secret 或多维表格 App Token 未配置')
    invariant(Buffer.byteLength(config.feishuPseudonymKey, 'utf8') >= 32, 500, 'CONFIG_INVALID', 'FEISHU_PSEUDONYM_KEY 至少需要32字节且不得复用会话密钥')
    invariant(config.feishuPseudonymKey !== config.sessionSecret, 500, 'CONFIG_INVALID', 'FEISHU_PSEUDONYM_KEY 不得复用 SESSION_SECRET')
    for (const [entityType, tableId] of Object.entries(config.feishuBitableTables)) {
      invariant(/^tbl[A-Za-z0-9_-]{4,}$/.test(tableId), 500, 'CONFIG_INVALID', `飞书 ${entityType} Table ID 未配置或格式无效`)
    }
    invariant(new Set(Object.values(config.feishuBitableTables)).size === Object.keys(config.feishuBitableTables).length, 500, 'CONFIG_INVALID', '飞书各实体必须配置不同的 Table ID')
  }
  invariant(!feishuCustomerProfileFieldsEnabled || feishuBitableEnabled, 500, 'CONFIG_INVALID',
    '开启飞书客户资料字段前必须启用 FEISHU_BITABLE_ENABLED')
  invariant(!config.aiWorkerEnabled || config.openaiAgentEnabled, 500, 'CONFIG_INVALID', '启用 Agent worker 前必须启用 Agent')
  if (config.openaiAgentEnabled || config.agentProvider === 'openai') {
    invariant(config.databaseUrl, 500, 'CONFIG_INVALID', '启用 OpenAI Agent 必须使用持久化 PostgreSQL 数据库')
    validatePostgresUrl(config.databaseUrl, 'DATABASE_URL')
  }
  if (config.openaiAgentEnabled) {
    invariant(Buffer.byteLength(config.openaiSafetyHmacKey, 'utf8') >= 32, 500, 'CONFIG_INVALID', 'OPENAI_SAFETY_HMAC_KEY 至少需要32字节')
    invariant(config.openaiSafetyHmacKey !== config.sessionSecret && config.openaiSafetyHmacKey !== config.feishuPseudonymKey,
      500, 'CONFIG_INVALID', 'OPENAI_SAFETY_HMAC_KEY 不得复用其他用途密钥')
    const currentContentKey = config.aiContentKeyring[config.aiContentCurrentKeyVersion]
    invariant(currentContentKey, 500, 'CONFIG_INVALID', 'AI_CONTENT_CURRENT_KEY_VERSION 必须存在于 keyring')
    for (const contentKey of Object.values(config.aiContentKeyring)) {
      invariant(!secretReused(contentKey, config.sessionSecret) &&
        !secretReused(contentKey, config.feishuPseudonymKey) &&
        !secretReused(contentKey, config.openaiSafetyHmacKey),
        500, 'CONFIG_INVALID', 'AI 内容密钥不得复用其他用途密钥')
    }
    invariant(new Set(Object.values(config.aiContentKeyring)).size === Object.keys(config.aiContentKeyring).length,
      500, 'CONFIG_INVALID', 'AI 内容 keyring 的各版本必须使用不同密钥')
    invariant(!(config.nodeEnv === 'production' && config.agentProvider === 'mock'), 500, 'CONFIG_INVALID', '生产环境启用 Agent 时禁止使用 Mock provider')
  }
  if (config.agentProvider === 'openai') {
    invariant(config.openaiApiKey && config.openaiModel && config.openaiModerationModel,
      500, 'CONFIG_INVALID', 'OpenAI API Key、生成模型或审核模型未配置')
  }
  return config
}
