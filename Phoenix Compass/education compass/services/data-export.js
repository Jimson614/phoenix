const api = require('./api')
const runtime = require('../config/runtime')

// 导出文件会经微信转发、落到聊天记录里，所以文件名不带任何个人信息。
function fileName(exportedAt) {
  const day = String(exportedAt || '').slice(0, 10) || 'export'
  return `phoenix-education-compass-${day}.json`
}

/**
 * 取回个人数据副本。返回的是解析后的对象，调用方负责落盘与分享。
 */
async function fetchExport() {
  if (runtime.isDemo()) {
    throw new api.ApiError('演示模式没有服务端账号，无数据可导出', { code: 'DATA_EXPORT_UNAVAILABLE' })
  }
  return api.request('/v1/me/export')
}

/**
 * 把导出写进小程序的临时目录并交给微信分享。
 *
 * 小程序没有"下载到本地磁盘"这回事，把文件交到用户手里的正规途径是
 * wx.shareFileMessage——用户转发给自己或任意联系人，文件就留在了聊天记录里。
 */
function saveAndShare(bundle) {
  return new Promise((resolve, reject) => {
    let payload
    try {
      payload = JSON.stringify(bundle, null, 2)
    } catch (error) {
      return reject(new api.ApiError('导出内容无法序列化', { code: 'DATA_EXPORT_SERIALIZE_FAILED' }))
    }
    if (typeof wx === 'undefined' || typeof wx.getFileSystemManager !== 'function') {
      return reject(new api.ApiError('当前环境不支持文件导出', { code: 'DATA_EXPORT_UNSUPPORTED' }))
    }
    const filePath = `${wx.env.USER_DATA_PATH}/${fileName(bundle && bundle.exportedAt)}`
    wx.getFileSystemManager().writeFile({
      filePath,
      data: payload,
      encoding: 'utf8',
      success() {
        if (typeof wx.shareFileMessage !== 'function') {
          // 低版本基础库没有这个能力；文件已经写好了，告诉调用方走降级路径。
          return resolve({ filePath, shared: false, reason: 'SHARE_UNSUPPORTED' })
        }
        wx.shareFileMessage({
          filePath,
          fileName: fileName(bundle && bundle.exportedAt),
          success() { resolve({ filePath, shared: true }) },
          fail(error) {
            const message = (error && error.errMsg) || ''
            // 用户自己取消不算失败，不该弹错误。
            if (message.indexOf('cancel') >= 0) return resolve({ filePath, shared: false, reason: 'CANCELLED' })
            resolve({ filePath, shared: false, reason: message || 'SHARE_FAILED' })
          }
        })
      },
      fail(error) {
        reject(new api.ApiError((error && error.errMsg) || '导出文件写入失败', { code: 'DATA_EXPORT_WRITE_FAILED' }))
      }
    })
  })
}

module.exports = { fetchExport, fileName, saveAndShare }
