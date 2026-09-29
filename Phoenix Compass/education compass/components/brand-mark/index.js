Component({
  properties: {
    light: { type: Boolean, value: false },
    compact: { type: Boolean, value: false },
    // 顶栏右侧还要放别的内容（如首页问候语）时关掉，只留 Logo，给胶囊按钮让出位置。
    lockup: { type: Boolean, value: true }
  }
})
