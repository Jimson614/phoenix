// 当前查看的孩子。只是本机的界面选择，不影响服务端数据；换账号或退出登录时由
// services/auth.js 的 forgetAccountData 一起清掉，不会串到下一个账号。
const KEY = 'PFS_CURRENT_STUDENT_ID_V1'

function get() {
  try { return String(wx.getStorageSync(KEY) || '') } catch (error) { return '' }
}

function set(studentId) {
  try {
    if (studentId) wx.setStorageSync(KEY, String(studentId))
    else wx.removeStorageSync(KEY)
  } catch (error) {}
}

function clear() { set('') }

/** 记住的孩子还在就用它；不在了（比如已删除）用服务端给的默认孩子，再不行用第一个。 */
function resolve(students, fallbackId) {
  const list = Array.isArray(students) ? students : []
  const has = (id) => Boolean(id) && list.some((student) => student && student.id === id)
  const saved = get()
  if (has(saved)) return saved
  if (has(fallbackId)) return fallbackId
  return list.length && list[0] ? list[0].id : ''
}

module.exports = { KEY, clear, get, resolve, set }
