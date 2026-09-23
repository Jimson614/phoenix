const api = require('./api')
const runtime = require('../config/runtime')

// 服务端要求显式回传这个串，避免误触发不可逆操作。
const CONFIRMATION = 'DELETE_MY_ACCOUNT'

/**
 * 注销账号。删除家庭、学生、问卷、报告与 AI 对话；
 * 订单等财务凭证按法规保留，但不再关联到个人数据。
 * 不可撤销。
 */
async function deleteAccount() {
  if (runtime.isDemo()) {
    throw new api.ApiError('演示模式没有服务端账号，无需注销', { code: 'ACCOUNT_DELETION_UNAVAILABLE' })
  }
  return api.request('/v1/me', { method: 'DELETE', data: { confirm: CONFIRMATION } })
}

module.exports = { CONFIRMATION, deleteAccount }
