const { repository } = require('./demo-runtime')
const { isoNow } = require('../utils/date')
const runtime = require('../config/runtime')
const api = require('./api')

// 本机缓存（订单、资料映射、测评引用、草稿）属于哪个服务端账号。远程模式的当前用户只在内存里，
// 重新打开小程序后没有别的办法知道这些缓存是谁留下的。
const ACCOUNT_DATA_OWNER_KEY = 'PFS_REMOTE_ACCOUNT_DATA_OWNER_V1'

function wechatCode() {
  return new Promise((resolve, reject) => {
    wx.login({ success: ({ code }) => code ? resolve(code) : reject(new Error('微信登录凭证为空')), fail: reject })
  })
}

function loginFamilyUser(profile = {}) {
  if (!runtime.isDemo()) {
    return wechatCode().then((code) => api.request('/v1/auth/wechat/session', { method: 'POST', data: { code } }))
      .then((result) => {
        const payload = result.data || result
        const session = payload.session || payload
        const accessToken = payload.accessToken || session.accessToken
        const remoteUser = payload.user || session.user
        if (!accessToken || !remoteUser || !remoteUser.id || !remoteUser.role) throw new Error('登录服务响应不完整')
        // 服务端账号可能在本机没退出的情况下就没了（例如在另一台设备上注销），下次登录的就是
        // 另一个账号；没有归属记录的缓存同样不能交给新登录的人。
        let owner = ''
        try { owner = wx.getStorageSync(ACCOUNT_DATA_OWNER_KEY) } catch (error) {}
        if (owner !== remoteUser.id) {
          forgetAccountData()
          try { wx.setStorageSync(ACCOUNT_DATA_OWNER_KEY, remoteUser.id) } catch (error) {}
        }
        api.setAccessToken(accessToken)
        const user = { id: remoteUser.id, role: remoteUser.role }
        getApp().setCurrentUser(user)
        return user
      })
  }
  return new Promise((resolve) => {
    const completeLogin = () => {
      const app = getApp()
      let user = repository.where('users', (item) => item.wechat_id === 'local_family_user')[0]
      if (!user) {
        user = repository.insert('users', {
          wechat_id: 'local_family_user', name: profile.name || '家庭用户', phone: '',
          role: 'family_user', created_at: isoNow()
        })
      }
      app.setCurrentUser(user.id)
      resolve(user)
    }

    // V0.1 performs the WeChat login handshake but keeps a local demo identity.
    // Production must exchange `code` on a trusted server and store the returned openid.
    if (wx.login) wx.login({ success: completeLogin, fail: completeLogin })
    else completeLogin()
  })
}

function loginAdvisorDemo() {
  if (!runtime.isDemo()) throw new Error('生产环境不提供公开顾问演示入口')
  const app = getApp()
  const advisor = repository.getById('users', 'usr_phoenix_advisor')
  app.setCurrentUser(advisor.id)
  return advisor
}

function logout() {
  const app = getApp()
  const revoke = runtime.isDemo()
    ? Promise.resolve()
    : api.request('/v1/auth/session', { method: 'DELETE' }).catch(() => undefined)
  app.setCurrentUser(runtime.isDemo() ? '' : null)
  api.setAccessToken('')
  if (!runtime.isDemo()) forgetAccountData()
  return revoke
}

// 清掉只属于某个账号的本机数据。退出登录，以及登录时发现换了账号，都走这里。
function forgetAccountData() {
  ;['PFS_CURRENT_USER_ID', 'PFS_REMOTE_PROFILE_MAP_V1', 'PFS_COMPASS_ASSESSMENT_REFS_V1', 'PFS_COMPASS_ORDER_CACHE_V1', ACCOUNT_DATA_OWNER_KEY].forEach((key) => {
    try { wx.removeStorageSync(key) } catch (error) {}
  })
  try {
    const keys = wx.getStorageInfoSync ? (wx.getStorageInfoSync().keys || []) : []
    keys.filter((key) => key.indexOf('PFS_COMPASS_DRAFT_') === 0).forEach((key) => wx.removeStorageSync(key))
  } catch (error) {}
  try { require('./payment').clearOrderCache() } catch (error) {}
  try { require('./assessment').clearRemoteSessionData() } catch (error) {}
  // 上面按前缀扫存储的那段依赖 wx.getStorageInfoSync，不是所有环境都有；
  // 草稿兜底自己维护索引，这里显式再清一次，换账号不留上一个人的答案。
  try { require('./draft-buffer').forgetAll() } catch (error) {}
}

module.exports = { loginFamilyUser, loginAdvisorDemo, logout, isDemo: runtime.isDemo }
