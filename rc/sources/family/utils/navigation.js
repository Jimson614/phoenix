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
    const left = rect && Number(rect.left)
    const top = rect && Number(rect.top)
    const width = rect && Number(rect.width)
    const height = rect && Number(rect.height)
    if (Number.isFinite(left) && Number.isFinite(top) && width > 0 && height > 0 && top >= 0) {
      return { ...rect, left, top, width, height }
    }
  } catch (error) {
    // Some desktop/debug environments do not expose a valid capsule rectangle.
  }

  return null
}

function getNavigationMetrics() {
  const windowInfo = getWindowInfo()
  const deviceInfo = getDeviceInfo()
  const safeAreaTop = Number(windowInfo.safeArea && windowInfo.safeArea.top) || 0
  // safeArea.top is the fallback for environments that omit statusBarHeight.
  const statusBarHeight = Number(windowInfo.statusBarHeight) || safeAreaTop || 20
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

  // A full brand lockup plus greeting can collide with the capsule on narrow phones.
  const compactHeader = windowWidth - menuButtonSafeWidth - 16 < 240

  return {
    statusBarHeight,
    navigationBarHeight,
    menuButtonSafeWidth,
    compactHeader
  }
}

function navigateBackOrHome() {
  wx.navigateBack({
    delta: 1,
    fail: () => wx.switchTab({ url: '/pages/home/index' })
  })
}

module.exports = { getNavigationMetrics, navigateBackOrHome }
