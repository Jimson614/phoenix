import { isAbsolute } from 'node:path'
import { invariant } from '../domain/errors'

export interface MastersConfig {
  enabled: boolean
  aiEnabled: false
  privateStorageDir: string
  developmentStorePath: string
  pdfFontPath: string
  retentionDays: number
  workerEnabled: boolean
}

export function loadMastersConfig(env: NodeJS.ProcessEnv = process.env): MastersConfig {
  for (const key of ['MASTERS_INTAKE_ENABLED', 'MASTERS_AI_ENABLED', 'MASTERS_WORKER_ENABLED']) {
    invariant(env[key] === undefined || ['true', 'false'].includes(env[key]!), 500, 'MASTERS_CONFIG_INVALID', `${key} 须为 true 或 false`)
  }
  const enabled = env.MASTERS_INTAKE_ENABLED === 'true'
  // P0 is deliberately unavailable in production; no release approval is implied by a feature flag.
  invariant(!enabled || env.NODE_ENV !== 'production', 503, 'MASTERS_P0_TEST_ONLY', '本轮仅允许隔离测试环境')
  invariant(env.MASTERS_AI_ENABLED !== 'true', 503, 'MASTERS_AI_NOT_APPROVED', '外部 AI 适配器未获批准；使用规则草稿与人工核验')
  const privateStorageDir = env.MASTERS_PRIVATE_STORAGE_DIR ?? ''
  invariant(!enabled || isAbsolute(privateStorageDir), 500, 'MASTERS_STORAGE_REQUIRED', '请配置私有材料存储绝对路径')
  const developmentStorePath = env.MASTERS_DEVELOPMENT_STORE_PATH ?? ''
  invariant(!enabled || Boolean(env.DATABASE_URL) || isAbsolute(developmentStorePath), 500, 'MASTERS_PERSISTENCE_REQUIRED', '咨询开启时需要 PostgreSQL 或隔离开发文件数据库')
  const retentionDays = Number(env.MASTERS_RETENTION_DAYS ?? '30')
  invariant(Number.isInteger(retentionDays) && retentionDays >= 1 && retentionDays <= 90, 500, 'MASTERS_RETENTION_INVALID', '保留期限须在 1–90 天')
  return { enabled, aiEnabled: false, privateStorageDir, developmentStorePath, pdfFontPath: env.MASTERS_PDF_FONT_PATH ?? '', retentionDays, workerEnabled: enabled && env.MASTERS_WORKER_ENABLED === 'true' }
}
