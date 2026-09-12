import { AppError, invariant } from '../../domain/errors'

export type FeishuFieldValue = string | number | boolean | string[]
export type FeishuRecordFields = Record<string, FeishuFieldValue>

export interface FeishuRecordResult {
  recordId: string
  created: boolean
}

export interface FeishuRemoteField {
  name: string
  type: number
  uiType: string
  isPrimary: boolean
}

export interface FeishuBitableGateway {
  listFields?(tableId: string): Promise<FeishuRemoteField[]>
  upsertRecord(input: {
    tableId: string
    uniqueField: string
    uniqueValue: string
    clientToken: string
    knownRecordId?: string | null
    fields: FeishuRecordFields
    requestBody: string
  }): Promise<FeishuRecordResult>
}

export interface FeishuBitableClientOptions {
  appId: string
  appSecret: string
  appToken: string
  fetchImpl?: typeof fetch
  now?: () => number
  timeoutMs?: number
}

interface FeishuEnvelope {
  code?: number
  msg?: string
  tenant_access_token?: string
  expire?: number
  data?: Record<string, unknown>
}

export class FeishuApiError extends AppError {
  readonly retryable: boolean
  readonly retryAfterMs: number

  constructor(code: string, status: number, retryable = false, retryAfterMs = 0) {
    super(status, code, '飞书多维表格暂时不可用')
    this.name = 'FeishuApiError'
    this.retryable = retryable
    this.retryAfterMs = retryAfterMs
  }
}

function recordId(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const item = value as Record<string, unknown>
  const id = item.record_id ?? item.recordId
  return typeof id === 'string' ? id : ''
}

export class FeishuBitableClient implements FeishuBitableGateway {
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly timeoutMs: number
  private cachedToken: { value: string; expiresAt: number } | null = null
  private tokenRequest: Promise<string> | null = null

  constructor(private readonly options: FeishuBitableClientOptions) {
    invariant(options.appId && options.appSecret && options.appToken, 500, 'FEISHU_CONFIG_INVALID', '飞书连接配置不完整')
    this.fetchImpl = options.fetchImpl ?? fetch
    this.now = options.now ?? Date.now
    this.timeoutMs = options.timeoutMs ?? 8_000
  }

  async listFields(tableId: string): Promise<FeishuRemoteField[]> {
    invariant(/^tbl[A-Za-z0-9_-]{4,}$/.test(tableId), 500, 'FEISHU_TABLE_ID_INVALID', '飞书 Table ID 无效')
    const fields: FeishuRemoteField[] = []
    let pageToken = ''
    for (let page = 0; page < 20; page += 1) {
      const query = new URLSearchParams({ page_size: '100' })
      if (pageToken) query.set('page_token', pageToken)
      const data = await this.apiRequest(
        `/open-apis/bitable/v1/apps/${encodeURIComponent(this.options.appToken)}/tables/${encodeURIComponent(tableId)}/fields?${query.toString()}`,
        { method: 'GET' }
      )
      const payload = data.data
      if (!payload || !Array.isArray(payload.items)) throw new FeishuApiError('FEISHU_FIELDS_RESPONSE_INVALID', 502)
      for (const raw of payload.items) {
        if (!raw || typeof raw !== 'object') throw new FeishuApiError('FEISHU_FIELDS_RESPONSE_INVALID', 502)
        const item = raw as Record<string, unknown>
        if (typeof item.field_name !== 'string' || !Number.isInteger(Number(item.type))) {
          throw new FeishuApiError('FEISHU_FIELDS_RESPONSE_INVALID', 502)
        }
        fields.push({
          name: item.field_name,
          type: Number(item.type),
          uiType: typeof item.ui_type === 'string' ? item.ui_type : '',
          isPrimary: item.is_primary === true
        })
      }
      if (payload.has_more !== true) return fields
      pageToken = typeof payload.page_token === 'string' ? payload.page_token : ''
      if (!pageToken) throw new FeishuApiError('FEISHU_FIELDS_RESPONSE_INVALID', 502)
    }
    throw new FeishuApiError('FEISHU_FIELDS_PAGINATION_LIMIT', 502)
  }

  async upsertRecord(input: {
    tableId: string
    uniqueField: string
    uniqueValue: string
    clientToken: string
    knownRecordId?: string | null
    fields: FeishuRecordFields
    requestBody: string
  }): Promise<FeishuRecordResult> {
    invariant(/^tbl[A-Za-z0-9_-]{4,}$/.test(input.tableId), 500, 'FEISHU_TABLE_ID_INVALID', '飞书 Table ID 无效')
    invariant(input.uniqueField.length > 0 && input.uniqueValue.length > 0, 500, 'FEISHU_UNIQUE_KEY_INVALID', '飞书唯一键无效')
    invariant(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.clientToken), 500, 'FEISHU_CLIENT_TOKEN_INVALID', '飞书幂等 Token 无效')
    invariant(input.requestBody === JSON.stringify({ fields: input.fields }), 500, 'FEISHU_OPERATION_BODY_MISMATCH', '飞书冻结请求体与投影不一致')
    const existingId = input.knownRecordId || await this.findRecordId(input.tableId, input.uniqueField, input.uniqueValue)
    if (existingId) {
      const data = await this.apiRequest(
        `/open-apis/bitable/v1/apps/${encodeURIComponent(this.options.appToken)}/tables/${encodeURIComponent(input.tableId)}/records/${encodeURIComponent(existingId)}?client_token=${encodeURIComponent(input.clientToken)}`,
        { method: 'PUT', body: input.requestBody }
      )
      const updated = recordId(data.data?.record) || existingId
      return { recordId: updated, created: false }
    }
    const data = await this.apiRequest(
      `/open-apis/bitable/v1/apps/${encodeURIComponent(this.options.appToken)}/tables/${encodeURIComponent(input.tableId)}/records?client_token=${encodeURIComponent(input.clientToken)}`,
      { method: 'POST', body: input.requestBody }
    )
    const createdId = recordId(data.data?.record)
    if (!createdId) throw new FeishuApiError('FEISHU_RECORD_ID_MISSING', 502)
    return { recordId: createdId, created: true }
  }

  private async findRecordId(tableId: string, fieldName: string, value: string): Promise<string> {
    const data = await this.apiRequest(
      `/open-apis/bitable/v1/apps/${encodeURIComponent(this.options.appToken)}/tables/${encodeURIComponent(tableId)}/records/search?page_size=10`,
      {
        method: 'POST',
        body: JSON.stringify({
          filter: {
            conjunction: 'and',
            conditions: [{ field_name: fieldName, operator: 'is', value: [value] }]
          }
        })
      }
    )
    const items = Array.isArray(data.data?.items) ? data.data?.items : []
    if (items.length > 1) throw new FeishuApiError('FEISHU_DUPLICATE_BUSINESS_ID', 409)
    return items.length === 1 ? recordId(items[0]) : ''
  }

  private async tenantToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > this.now()) return this.cachedToken.value
    if (this.tokenRequest) return this.tokenRequest
    this.tokenRequest = (async () => {
      const data = await this.rawRequest('/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        body: JSON.stringify({ app_id: this.options.appId, app_secret: this.options.appSecret })
      })
      const token = data.tenant_access_token
      if (!token || typeof token !== 'string') throw new FeishuApiError('FEISHU_TOKEN_MISSING', 502)
      const parsedExpiry = Number(data.expire ?? 7200)
      const expireSeconds = Number.isFinite(parsedExpiry) && parsedExpiry > 0 ? Math.min(parsedExpiry, 7200) : 7200
      const refreshMargin = Math.min(300, Math.max(1, Math.floor(expireSeconds / 10)))
      const safeLifetime = Math.max(1, expireSeconds - refreshMargin)
      this.cachedToken = { value: token, expiresAt: this.now() + safeLifetime * 1000 }
      return token
    })()
    try { return await this.tokenRequest } finally { this.tokenRequest = null }
  }

  private async apiRequest(path: string, init: RequestInit): Promise<FeishuEnvelope> {
    let token = await this.tenantToken()
    let result = await this.rawRequest(path, init, token).catch((error: unknown) => {
      if (error instanceof FeishuApiError && ['FEISHU_TOKEN_EXPIRED', 'FEISHU_HTTP_401'].includes(error.code)) return null
      throw error
    })
    if (result) return result
    this.cachedToken = null
    token = await this.tenantToken()
    result = await this.rawRequest(path, init, token)
    return result
  }

  private async rawRequest(path: string, init: RequestInit, token?: string): Promise<FeishuEnvelope> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(`https://open.feishu.cn${path}`, {
        ...init,
        signal: controller.signal,
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json; charset=utf-8',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(init.headers ?? {})
        }
      })
      const raw = await response.text()
      if (raw.length > 2_000_000) throw new FeishuApiError('FEISHU_RESPONSE_TOO_LARGE', 502)
      let data: FeishuEnvelope
      try { data = JSON.parse(raw) as FeishuEnvelope } catch {
        const retryable = response.status === 429 || response.status >= 500
        if (!response.ok) throw new FeishuApiError(`FEISHU_HTTP_${response.status}`, retryable ? 503 : 502, retryable, this.retryDelay(response))
        throw new FeishuApiError('FEISHU_RESPONSE_INVALID', 502)
      }
      const apiCode = Number(data.code ?? -1)
      if (!response.ok || apiCode !== 0) {
        if (response.status === 401 || [99991663, 99991664, 99991668].includes(apiCode)) {
          throw new FeishuApiError(response.status === 401 ? 'FEISHU_HTTP_401' : 'FEISHU_TOKEN_EXPIRED', 502, true)
        }
        const retryableCodes = [99991400, 1254290, 1254291, 1255040]
        const retryable = response.status === 429 || response.status >= 500 || retryableCodes.includes(apiCode)
        throw new FeishuApiError(
          `FEISHU_API_${Number.isFinite(apiCode) ? apiCode : response.status}`,
          retryable ? 503 : 502,
          retryable,
          this.retryDelay(response)
        )
      }
      return data
    } catch (error) {
      if (error instanceof FeishuApiError) throw error
      if ((error as { name?: string }).name === 'AbortError') throw new FeishuApiError('FEISHU_TIMEOUT', 504, true)
      throw new FeishuApiError('FEISHU_NETWORK_ERROR', 503, true)
    } finally {
      clearTimeout(timer)
    }
  }

  private retryDelay(response: Response): number {
    const raw = response.headers.get('retry-after') ?? response.headers.get('x-ogw-ratelimit-reset') ?? ''
    const seconds = Number(raw)
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(6 * 60 * 60_000, Math.ceil(seconds * 1000))
    const date = Date.parse(raw)
    if (Number.isFinite(date)) return Math.min(6 * 60 * 60_000, Math.max(0, date - this.now()))
    return 0
  }
}
