function getWindowInfo() {
  if (typeof wx === 'undefined') return {}

  try {
    if (typeof wx.getWindowInfo === 'function') return wx.getWindowInfo()
    if (typeof wx.getSystemInfoSync === 'function') return wx.getSystemInfoSync()
  } catch (error) {
    // Fall through to conservative defaults below.
  }

  return {}
}

function getDeviceInfo() {
  if (typeof wx === 'undefined') return {}

  try {
    if (typeof wx.getDeviceInfo === 'function') return wx.getDeviceInfo()
  } catch (error) {
    // Device information is only used to select a fallback navigation height.
  }

  return {}
}

function getMenuButtonRect() {
  if (typeof wx === 'undefined' || typeof wx.getMenuButtonBoundingClientRect !== 'function') return null

  try {
    const rect = wx.getMenuButtonBoundingClientRect()
    if (rect && rect.width && rect.height && rect.top >= 0) return rect
  } catch (error) {
    // Some desktop/debug environments do not expose a valid capsule rectangle.
  }

  return null
}

function getNavigationMetrics() {
  const windowInfo = getWindowInfo()
  const deviceInfo = getDeviceInfo()
  const statusBarHeight = Number(windowInfo.statusBarHeight) || 20
  const windowWidth = Number(windowInfo.windowWidth || windowInfo.screenWidth) || 375
  const platform = String(windowInfo.platform || deviceInfo.platform || '').toLowerCase()
  const defaultNavigationBarHeight = platform === 'android' ? 48 : 44
  const menuButton = getMenuButtonRect()

  let navigationBarHeight = defaultNavigationBarHeight
  let menuButtonSafeWidth = 16

  if (menuButton) {
    const verticalGap = Math.max(0, menuButton.top - statusBarHeight)
    navigationBarHeight = Math.max(defaultNavigationBarHeight, menuButton.height + verticalGap * 2)
    // Reserve the capsule itself, its right margin, and a small visual gap.
    menuButtonSafeWidth = Math.max(16, windowWidth - menuButton.left + 8)
  }

  return {
    statusBarHeight,
    navigationBarHeight,
    menuButtonSafeWidth
  }
}

module.exports = { getNavigationMetrics }
