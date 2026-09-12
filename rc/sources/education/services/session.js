function currentUser() { return getApp().getCurrentUser() }

function guard(allowedRoles) {
  const user = currentUser()
  if (!user || (allowedRoles && !allowedRoles.includes(user.role))) {
    wx.reLaunch({ url: '/pages/welcome/index' })
    return null
  }
  return user
}

module.exports = { currentUser, guard }
