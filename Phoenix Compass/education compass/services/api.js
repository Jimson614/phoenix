const runtime = require('../config/runtime')

const ACCESS_TOKEN_KEY = 'PFS_REMOTE_ACCESS_TOKEN'
const DEFAULT_TIMEOUT_MS = 15000
const MAX_TIMEOUT_MS = 120000
let volatileAccessToken = ''
let volatileAccessTokenAuthoritative = false

class ApiError extends Error {
  constructor(message, options = {}) {
    super(message || '请求失败')
    this.name = 'ApiError'
    this.code = options.code || 'REQUEST_FAILED'
    this.statusCode = options.statusCode || 0
    this.details = options.details || null
  }
}

function validAccessToken(token) {
  return typeof token === 'string' && token.length > 0 && token.length <= 4096 &&
    token.trim() === token && !/[\u0000-\u0020\u007f]/.test(token)
}

function removeStoredAccessToken() {
  try {
    if (typeof wx !== 'undefined' && typeof wx.removeStorageSync === 'function') {
      wx.removeStorageSync(ACCESS_TOKEN_KEY)
      return true
    }
  } catch (error) { return false }
  return false
}

function setAccessToken(token) {
  if (token === undefined || token === null || token === '') {
    volatileAccessToken = ''
    volatileAccessTokenAuthoritative = !removeStoredAccessToken()
    return
  }
  if (!validAccessToken(token)) {
    throw new ApiError('登录凭证格式无效', { code: 'ACCESS_TOKEN_INVALID' })
  }
  // Keep the active session usable when platform storage is temporarily
  // unavailable. The token is still the only value this adapter persists.
  volatileAccessToken = token
  volatileAccessTokenAuthoritative = true
  try {
    if (typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function') {
      wx.setStorageSync(ACCESS_TOKEN_KEY, token)
      volatileAccessTokenAuthoritative = false
    }
  } catch (error) {}
}

function accessToken() {
  if (volatileAccessTokenAuthoritative) return volatileAccessToken
  try {
    if (typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function') {
      const stored = wx.getStorageSync(ACCESS_TOKEN_KEY)
      if (validAccessToken(stored)) {
        volatileAccessToken = stored
        return stored
      }
      volatileAccessToken = ''
      if (stored !== undefined && stored !== null && stored !== '') {
        volatileAccessTokenAuthoritative = !removeStoredAccessToken()
      }
    }
  } catch (error) {
    return volatileAccessToken
  }
  return volatileAccessToken
}

function decodedPathHasTraversal(value) {
  try {
    const decoded = decodeURIComponent(value)
    return /[\u0000-\u001f\u007f\\]/.test(decoded) ||
      decoded.split('/').some((part) => part === '.' || part === '..')
  } catch (error) {
    return true
  }
}

function normalizeBaseUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || value.trim() !== value ||
    /[\u0000-\u0020\u007f\\?#@]/.test(value)) {
    throw new ApiError('生产 API 地址格式无效', { code: 'API_BASE_URL_INVALID' })
  }
  const protocolMatch = value.match(/^(https?):\/\//i)
  if (!protocolMatch) {
    throw new ApiError('生产 API 地址格式无效', { code: 'API_BASE_URL_INVALID' })
  }
  const protocol = protocolMatch[1].toLowerCase()
  const remainder = value.slice(protocolMatch[0].length)
  const slashIndex = remainder.indexOf('/')
  const authority = slashIndex === -1 ? remainder : remainder.slice(0, slashIndex)
  const basePath = slashIndex === -1 ? '' : remainder.slice(slashIndex)
  if (!authority || !/^[A-Za-z0-9.-]+(?::[1-9][0-9]{0,4})?$/.test(authority) ||
    authority.startsWith('.') || authority.endsWith('.') || authority.includes('..') ||
    decodedPathHasTraversal(basePath)) {
    throw new ApiError('生产 API 地址格式无效', { code: 'API_BASE_URL_INVALID' })
  }
  const portMatch = authority.match(/:([0-9]+)$/)
  if (portMatch && Number(portMatch[1]) > 65535) {
    throw new ApiError('生产 API 地址格式无效', { code: 'API_BASE_URL_INVALID' })
  }
  const hostname = authority.replace(/:[0-9]+$/, '').toLowerCase()
  const approvedDevelopmentLoopback = protocol === 'http' && hostname === '127.0.0.1' &&
    runtime.accountEnvironment() === 'develop' &&
    typeof runtime.allowsDevelopmentLoopbackHttp === 'function' &&
    runtime.allowsDevelopmentLoopbackHttp(value)
  if (protocol !== 'https' && !approvedDevelopmentLoopback) {
    throw new ApiError('生产 API 地址格式无效', { code: 'API_BASE_URL_INVALID' })
  }
  return value.replace(/\/+$/, '')
}

function normalizeRequestPath(value) {
  if (typeof value !== 'string' || value.length < 2 || value.length > 4096 ||
    value[0] !== '/' || value[1] === '/' || /[\u0000-\u0020\u007f\\#]/.test(value)) {
    throw new ApiError('请求路径格式无效', { code: 'REQUEST_PATH_INVALID' })
  }
  const pathname = value.split('?')[0]
  if (decodedPathHasTraversal(pathname)) {
    throw new ApiError('请求路径格式无效', { code: 'REQUEST_PATH_INVALID' })
  }
  return value
}

function requestHeaders(options, token) {
  const custom = options.headers === undefined ? {} : options.headers
  if (!custom || typeof custom !== 'object' || Array.isArray(custom)) {
    throw new ApiError('请求头格式无效', { code: 'REQUEST_HEADERS_INVALID' })
  }
  const contentType = options.contentType || 'application/json'
  if (typeof contentType !== 'string' || !contentType || /[\r\n]/.test(contentType)) {
    throw new ApiError('请求头格式无效', { code: 'REQUEST_HEADERS_INVALID' })
  }
  const headers = { 'content-type': contentType }
  Object.keys(custom).forEach((name) => {
    const value = custom[name]
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n]/.test(String(value))) {
      throw new ApiError('请求头格式无效', { code: 'REQUEST_HEADERS_INVALID' })
    }
    if (name.toLowerCase() !== 'authorization') headers[name] = value
  })
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

function clearAccessTokenIfCurrent(requestToken) {
  if (requestToken && accessToken() === requestToken) setAccessToken('')
}

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    let requestUrl
    let headers
    let token
    const config = options && typeof options === 'object' && !Array.isArray(options) ? options : {}
    try {
      requestUrl = `${normalizeBaseUrl(runtime.apiBaseUrl())}${normalizeRequestPath(path)}`
      token = accessToken()
      headers = requestHeaders(config, token)
    } catch (error) {
      reject(error)
      return
    }

    let settled = false
    const resolveOnce = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const rejectOnce = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    const timeout = Number.isFinite(config.timeout) && config.timeout > 0
      ? Math.min(Math.floor(config.timeout), MAX_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS
    const method = typeof config.method === 'string' && config.method.trim()
      ? config.method.trim().toUpperCase()
      : 'GET'
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method)) {
      rejectOnce(new ApiError('请求方法无效', { code: 'REQUEST_METHOD_INVALID' }))
      return
    }

    try {
      if (typeof wx === 'undefined' || typeof wx.request !== 'function') {
        throw new Error('wx.request unavailable')
      }
      wx.request({
        url: requestUrl,
        method,
        data: config.data,
        responseType: config.responseType || 'text',
        timeout,
        header: headers,
        success(response) {
          if (settled) return
          if (!response || typeof response !== 'object' || Array.isArray(response) ||
            !Number.isInteger(response.statusCode) || response.statusCode < 100 || response.statusCode > 599) {
            rejectOnce(new ApiError('服务端响应格式无效', { code: 'INVALID_RESPONSE' }))
            return
          }
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolveOnce(config.rawResponse ? response : response.data)
            return
          }
          if (response.statusCode === 401) clearAccessTokenIfCurrent(token)
          const envelope = response.data && typeof response.data === 'object' && response.data.error &&
            typeof response.data.error === 'object' ? response.data.error : {}
          rejectOnce(new ApiError(envelope.message || `请求失败（${response.statusCode}）`, {
            code: envelope.code || 'HTTP_ERROR', statusCode: response.statusCode, details: envelope.details
          }))
        },
        fail(error) {
          const message = error && typeof error.errMsg === 'string' ? error.errMsg : '网络连接失败'
          rejectOnce(new ApiError(message, { code: 'NETWORK_ERROR' }))
        }
      })
    } catch (error) {
      rejectOnce(new ApiError('网络连接失败', { code: 'NETWORK_ERROR' }))
    }
  })
}

module.exports = { ACCESS_TOKEN_KEY, ApiError, accessToken, request, setAccessToken }
