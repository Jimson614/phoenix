const INSTALLATION_ID_KEY = 'PFS_INSTALLATION_ID_V01'
const SESSION_KEY = 'PFS_BACKEND_SESSION_V01'
const LOCAL_DEMO_API_BASE_URL = 'http://127.0.0.1:8787'
const REQUEST_TIMEOUT_MS = 5000

function apiError(message, details = {}) {
  const error = new Error(message)
  Object.assign(error, details)
  return error
}

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${LOCAL_DEMO_API_BASE_URL}${path}`,
      method: options.method || 'GET',
      data: options.data,
      header: {
        'content-type': 'application/json',
        ...(options.headers || {})
      },
      timeout: REQUEST_TIMEOUT_MS,
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data)
          return
        }
        const responseCode = response.data && response.data.error && response.data.error.code
        reject(apiError('Backend request was rejected', {
          code: responseCode || 'http_error',
          statusCode: response.statusCode
        }))
      },
      fail(error) {
        reject(apiError('Backend is unavailable', {
          code: error && error.errMsg ? 'network_error' : 'request_failed'
        }))
      }
    })
  })
}

function installationId() {
  let value = wx.getStorageSync(INSTALLATION_ID_KEY)
  if (!value) {
    value = `install_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`
    wx.setStorageSync(INSTALLATION_ID_KEY, value)
  }
  return value
}

function currentSession() {
  const value = wx.getStorageSync(SESSION_KEY)
  if (!value || !value.token || !value.expiresAt) return null
  if (Date.parse(value.expiresAt) <= Date.now() + 30000) return null
  return value
}

function clearSession() {
  if (wx.removeStorageSync) wx.removeStorageSync(SESSION_KEY)
  else wx.setStorageSync(SESSION_KEY, '')
}

async function createDemoSession() {
  const activeSession = await request('/v1/demo/sessions', {
    method: 'POST',
    data: { installationId: installationId() }
  })
  wx.setStorageSync(SESSION_KEY, activeSession)
  return activeSession
}

async function session(forceRefresh) {
  if (forceRefresh) clearSession()
  return currentSession() || createDemoSession()
}

function validateReceipt(value) {
  const valid = value &&
    value.status === 'synced' &&
    typeof value.submissionId === 'string' &&
    value.submissionId.length > 0 &&
    value.submissionId.length <= 200 &&
    typeof value.receivedAt === 'string' &&
    !Number.isNaN(Date.parse(value.receivedAt))
  if (!valid) throw apiError('Backend returned an invalid receipt', { code: 'invalid_response' })
  return value
}

async function submitQuestionnaire(payload, retried = false) {
  const activeSession = await session(retried)
  try {
    const result = await request('/v1/questionnaire-submissions', {
      method: 'POST',
      data: payload,
      headers: { Authorization: `Bearer ${activeSession.token}` }
    })
    return validateReceipt(result)
  } catch (error) {
    if (error.statusCode === 401 && !retried) return submitQuestionnaire(payload, true)
    throw error
  }
}

module.exports = {
  INSTALLATION_ID_KEY,
  LOCAL_DEMO_API_BASE_URL,
  SESSION_KEY,
  clearSession,
  submitQuestionnaire,
  validateReceipt
}
