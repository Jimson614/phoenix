function createId(prefix) {
  const random = Math.random().toString(36).slice(2, 8)
  return `rc_demo_${prefix}_${Date.now().toString(36)}_${random}`
}

module.exports = { createId }
