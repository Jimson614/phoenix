'use strict'

/**
 * 飞书多维表格最小客户端（仅供 V0.5 最小链路联调使用）。
 * 只做四件事：取 tenant_access_token、列表/建表、按唯一字段查记录、创建/更新记录。
 * 不缓存业务数据，不做反向写入。
 */

const DEFAULT_BASE_URL = 'https://open.feishu.cn'

class FeishuError extends Error {
  constructor(message, { code, status, endpoint } = {}) {
    super(message)
    this.name = 'FeishuError'
    this.code = code
    this.status = status
    this.endpoint = endpoint
  }
}

class FeishuClient {
  constructor({ appId, appSecret, appToken, baseUrl = DEFAULT_BASE_URL, timeoutMs = 15000 }) {
    if (!appId || !appSecret || !appToken) {
      throw new FeishuError('飞书连接配置不完整（需要 app id / app secret / base app token）', { code: 'CONFIG_INVALID' })
    }
    this.appId = appId
    this.appSecret = appSecret
    this.appToken = appToken
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.timeoutMs = timeoutMs
    this.token = null
    this.tokenExpiresAt = 0
  }

  async request(endpoint, { method = 'GET', body, auth = true } = {}) {
    const headers = { 'Content-Type': 'application/json; charset=utf-8' }
    if (auth) headers.Authorization = `Bearer ${await this.tenantAccessToken()}`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    let response
    try {
      response = await fetch(`${this.baseUrl}${endpoint}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      })
    } catch (error) {
      throw new FeishuError(`请求飞书失败：${error.message}`, { code: 'NETWORK_ERROR', endpoint })
    } finally {
      clearTimeout(timer)
    }

    const text = await response.text()
    let payload
    try {
      payload = text ? JSON.parse(text) : {}
    } catch {
      throw new FeishuError('飞书返回非 JSON 响应', { code: 'RESPONSE_INVALID', status: response.status, endpoint })
    }
    if (!response.ok || (payload.code !== undefined && payload.code !== 0)) {
      throw new FeishuError(`飞书接口错误 ${payload.code ?? response.status}：${payload.msg ?? response.statusText}`, {
        code: String(payload.code ?? response.status),
        status: response.status,
        endpoint
      })
    }
    return payload
  }

  async tenantAccessToken() {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token
    const payload = await this.request('/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      auth: false,
      body: { app_id: this.appId, app_secret: this.appSecret }
    })
    if (typeof payload.tenant_access_token !== 'string') {
      throw new FeishuError('飞书未返回 tenant_access_token', { code: 'TOKEN_MISSING' })
    }
    this.token = payload.tenant_access_token
    const expire = Number(payload.expire ?? 7200)
    this.tokenExpiresAt = Date.now() + Math.max(60, expire - 120) * 1000
    return this.token
  }

  async listTables() {
    const tables = []
    let pageToken = ''
    for (let page = 0; page < 20; page += 1) {
      const query = new URLSearchParams({ page_size: '100' })
      if (pageToken) query.set('page_token', pageToken)
      const payload = await this.request(
        `/open-apis/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables?${query.toString()}`
      )
      const data = payload.data ?? {}
      for (const item of data.items ?? []) {
        tables.push({ tableId: item.table_id, name: item.name })
      }
      if (data.has_more !== true) return tables
      pageToken = data.page_token ?? ''
      if (!pageToken) return tables
    }
    return tables
  }

  async createTable({ name, fields }) {
    const payload = await this.request(`/open-apis/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables`, {
      method: 'POST',
      body: {
        table: {
          name,
          default_view_name: '总览',
          fields: fields.map((field) => {
            const definition = { field_name: field.name, type: field.type }
            if (Array.isArray(field.options)) {
              definition.property = { options: field.options.map((option) => ({ name: option })) }
            }
            return definition
          })
        }
      }
    })
    const tableId = payload.data?.table_id
    if (!tableId) throw new FeishuError('建表未返回 table_id', { code: 'TABLE_ID_MISSING' })
    return tableId
  }

  async listFields(tableId) {
    const fields = []
    let pageToken = ''
    for (let page = 0; page < 20; page += 1) {
      const query = new URLSearchParams({ page_size: '100' })
      if (pageToken) query.set('page_token', pageToken)
      const payload = await this.request(
        `/open-apis/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables/${encodeURIComponent(tableId)}/fields?${query.toString()}`
      )
      const data = payload.data ?? {}
      for (const item of data.items ?? []) {
        fields.push({ name: item.field_name, type: Number(item.type), isPrimary: item.is_primary === true })
      }
      if (data.has_more !== true) return fields
      pageToken = data.page_token ?? ''
      if (!pageToken) return fields
    }
    return fields
  }

  async findRecordId({ tableId, uniqueField, uniqueValue }) {
    const payload = await this.request(
      `/open-apis/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables/${encodeURIComponent(tableId)}/records/search?page_size=2`,
      {
        method: 'POST',
        body: {
          filter: {
            conjunction: 'and',
            conditions: [{ field_name: uniqueField, operator: 'is', value: [uniqueValue] }]
          },
          automatic_fields: false
        }
      }
    )
    const items = payload.data?.items ?? []
    if (items.length > 1) {
      throw new FeishuError(`唯一业务字段 ${uniqueField}=${uniqueValue} 在飞书中存在重复记录`, { code: 'DUPLICATE_BUSINESS_ID' })
    }
    return items[0]?.record_id ?? null
  }

  async createRecord({ tableId, fields }) {
    const payload = await this.request(
      `/open-apis/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables/${encodeURIComponent(tableId)}/records`,
      { method: 'POST', body: { fields } }
    )
    const recordId = payload.data?.record?.record_id
    if (!recordId) throw new FeishuError('创建记录未返回 record_id', { code: 'RECORD_ID_MISSING' })
    return recordId
  }

  async updateRecord({ tableId, recordId, fields }) {
    await this.request(
      `/open-apis/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables/${encodeURIComponent(tableId)}/records/${encodeURIComponent(recordId)}`,
      { method: 'PUT', body: { fields } }
    )
    return recordId
  }
}

module.exports = { FeishuClient, FeishuError, DEFAULT_BASE_URL }
