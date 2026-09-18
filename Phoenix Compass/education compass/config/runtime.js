// Production releases are always remote. Development builds stay in the isolated
// demo provider until a backend URL is explicitly configured.
const API_BASE_URL = ''
const FORCE_REMOTE_IN_DEVELOPMENT = false

function accountEnvironment() {
  // Node-based contract tests have no `wx`; an actual mini-program runtime that
  // cannot prove it is a development build must never fall back to demo/local.
  if (typeof wx === 'undefined') return 'test'
  if (!wx.getAccountInfoSync) return 'unknown'
  try {
    const info = wx.getAccountInfoSync()
    const value = info && info.miniProgram && info.miniProgram.envVersion
    return ['develop', 'trial', 'release'].includes(value) ? value : 'unknown'
  } catch (error) {
    return 'unknown'
  }
}

function mode() {
  const environment = accountEnvironment()
  if (environment === 'develop' || environment === 'test') {
    return FORCE_REMOTE_IN_DEVELOPMENT ? 'remote' : 'demo'
  }
  return 'remote'
}

function apiBaseUrl() {
  if (mode() !== 'remote') return ''
  if (!API_BASE_URL) {
    const error = new Error('生产 API_BASE_URL 尚未配置')
    error.code = 'API_BASE_URL_MISSING'
    throw error
  }
  if (!/^https:\/\//i.test(API_BASE_URL)) {
    const error = new Error('生产 API_BASE_URL 必须使用 HTTPS')
    error.code = 'API_BASE_URL_INSECURE'
    throw error
  }
  return API_BASE_URL.replace(/\/$/, '')
}

// Source and release builds never permit plaintext transport. The isolated
// development builder replaces this with an exact loopback-only capability.
function allowsDevelopmentLoopbackHttp() { return false }

module.exports = {
  API_BASE_URL,
  accountEnvironment,
  allowsDevelopmentLoopbackHttp,
  apiBaseUrl,
  mode,
  isDemo: () => mode() === 'demo'
}
