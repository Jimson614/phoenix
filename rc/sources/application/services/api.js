const runtime = require('../config/runtime')

const ACCESS_TOKEN_KEY = 'PFS_REMOTE_ACCESS_TOKEN'

class ApiError extends Error {
  constructor(message, options = {}) {
    super(message || '请求失败')
    this.name = 'ApiError'
    this.code = options.code || 'REQUEST_FAILED'
    this.statusCode = options.statusCode || 0
    this.details = options.details || null
  }
}

function setAccessToken(token) {
  if (!token) wx.removeStorageSync(ACCESS_TOKEN_KEY)
  else wx.setStorageSync(ACCESS_TOKEN_KEY, token)
}

function accessToken() { return wx.getStorageSync(ACCESS_TOKEN_KEY) || '' }

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    let baseUrl = ''
    try { baseUrl = runtime.apiBaseUrl() } catch (error) { reject(error); return }
    const token = accessToken()
    wx.request({
      url: `${baseUrl}${path}`,
      method: options.method || 'GET',
      data: options.data,
      responseType: options.responseType || 'text',
      timeout: options.timeout || 15000,
      header: {
        'content-type': options.contentType || 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      },
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(options.rawResponse ? response : response.data)
          return
        }
        const envelope = response.data && response.data.error ? response.data.error : {}
        reject(new ApiError(envelope.message || `请求失败（${response.statusCode}）`, {
          code: envelope.code || 'HTTP_ERROR', statusCode: response.statusCode, details: envelope.details
        }))
      },
      fail(error) {
        reject(new ApiError(error.errMsg || '网络连接失败', { code: 'NETWORK_ERROR' }))
      }
    })
  })
}

module.exports = { ACCESS_TOKEN_KEY, ApiError, accessToken, request, setAccessToken }
