import { readFile } from 'node:fs/promises'
import { AppError, invariant } from './errors'

export interface SourceCatalogEntry {
  sourceId: string
  title: string
  applicableYear: string
  verifiedAt: string
}

export interface SourceCatalog {
  mode: 'placeholder' | 'verified'
  verified: boolean
  version: string
  dataAsOf: string
  reviewedAt: string
  reviewedBy: string
  entries: SourceCatalogEntry[]
}

export const PLACEHOLDER_SOURCE_CATALOG: SourceCatalog = {
  mode: 'placeholder', verified: false, version: 'UNVERIFIED', dataAsOf: '1970-01-01',
  reviewedAt: '1970-01-01T00:00:00.000Z', reviewedBy: 'UNVERIFIED', entries: []
}

function requiredText(value: unknown, key: string, max = 200): string {
  invariant(typeof value === 'string' && value.trim().length > 0 && value.length <= max, 500, 'SOURCE_CATALOG_INVALID', `来源目录 ${key} 无效`)
  return value.trim()
}

export function validateSourceCatalog(input: unknown): SourceCatalog {
  invariant(input !== null && typeof input === 'object' && !Array.isArray(input), 500, 'SOURCE_CATALOG_INVALID', '来源目录必须是对象')
  const value = input as Record<string, unknown>
  const version = requiredText(value.version, 'version', 80)
  invariant(!version.toUpperCase().includes('DEMO_ONLY'), 500, 'SOURCE_CATALOG_INVALID', '来源目录不能使用 DEMO_ONLY 版本')
  const dataAsOf = requiredText(value.dataAsOf, 'dataAsOf', 32)
  const reviewedAt = requiredText(value.reviewedAt, 'reviewedAt', 40)
  const reviewedBy = requiredText(value.reviewedBy, 'reviewedBy', 120)
  invariant(Number.isFinite(Date.parse(dataAsOf)) && Number.isFinite(Date.parse(reviewedAt)), 500, 'SOURCE_CATALOG_INVALID', '来源目录日期无效')
  invariant(Array.isArray(value.entries) && value.entries.length > 0, 500, 'SOURCE_CATALOG_INVALID', '来源目录 entries 不能为空')
  const entries = value.entries.map((entry, index) => {
    invariant(entry !== null && typeof entry === 'object' && !Array.isArray(entry), 500, 'SOURCE_CATALOG_INVALID', `来源目录 entries[${index}] 无效`)
    const row = entry as Record<string, unknown>
    const sourceId = requiredText(row.sourceId, `entries[${index}].sourceId`, 120)
    invariant(!sourceId.toUpperCase().includes('DEMO_ONLY'), 500, 'SOURCE_CATALOG_INVALID', '来源目录不能包含 DEMO_ONLY 来源')
    const result: SourceCatalogEntry = {
      sourceId,
      title: requiredText(row.title, `entries[${index}].title`, 300),
      applicableYear: requiredText(row.applicableYear, `entries[${index}].applicableYear`, 20),
      verifiedAt: requiredText(row.verifiedAt, `entries[${index}].verifiedAt`, 40)
    }
    invariant(Number.isFinite(Date.parse(result.verifiedAt)), 500, 'SOURCE_CATALOG_INVALID', `来源目录 entries[${index}].verifiedAt 无效`)
    return result
  })
  invariant(new Set(entries.map((entry) => entry.sourceId)).size === entries.length, 500, 'SOURCE_CATALOG_INVALID', '来源目录 sourceId 必须唯一')
  return { mode: 'verified', verified: true, version, dataAsOf, reviewedAt, reviewedBy, entries }
}

export async function loadSourceCatalog(mode: 'placeholder' | 'verified', path: string): Promise<SourceCatalog> {
  if (mode === 'placeholder') return PLACEHOLDER_SOURCE_CATALOG
  invariant(path.length > 0, 500, 'SOURCE_CATALOG_PATH_REQUIRED', 'verified 模式必须配置 SOURCE_CATALOG_PATH')
  try {
    return validateSourceCatalog(JSON.parse(await readFile(path, 'utf8')))
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError(500, 'SOURCE_CATALOG_LOAD_FAILED', '无法读取或解析来源目录')
  }
}
