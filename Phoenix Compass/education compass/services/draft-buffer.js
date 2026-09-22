// 问卷草稿的失败兜底缓存。
//
// 正式包里草稿只存在内存（services/assessment.js 的 cacheAnswers 在非 demo 模式
// 写的是进程内对象），服务端保存失败后只要退出小程序，已填内容就没了。
// 2026-09-22 联调时一次后端重启导致连续 31 次草稿保存 502，正在填问卷的人
// 丢掉了那段时间的输入。
//
// 这里刻意**不做全量镜像**：只有服务端保存失败时才落盘，保存成功立刻删除，
// 退出登录清空，超期自动丢弃。未成年人的问卷答案不该长期留在设备上，
// 兜底的代价要压到"一次失败到下一次成功之间"这个窗口。

const PREFIX = 'PFS_COMPASS_DRAFT_FALLBACK_'
const INDEX_KEY = 'PFS_COMPASS_DRAFT_FALLBACK_INDEX'
// 问卷本身是一次性的填写任务，留久了既无用又是隐私负担。
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
// 23 题的答案远小于这个量；超了说明数据不对，不如不存。
const MAX_BYTES = 128 * 1024

function key(assessmentId) { return `${PREFIX}${assessmentId}` }

// 小程序存储在隐私模式、配额满或系统异常时都会抛错。兜底功能本身不能
// 反过来把填问卷这件事弄挂，所以每个读写都吞掉异常。
function readRaw(storageKey) {
  try {
    return wx.getStorageSync(storageKey)
  } catch (error) {
    return undefined
  }
}

function writeRaw(storageKey, value) {
  try {
    wx.setStorageSync(storageKey, value)
    return true
  } catch (error) {
    return false
  }
}

function removeRaw(storageKey) {
  try {
    wx.removeStorageSync(storageKey)
  } catch (error) {
    // 删不掉也只能算了：下一次 recall 会按过期时间再丢一次。
  }
}

function indexedIds() {
  const value = readRaw(INDEX_KEY)
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item) : []
}

function addToIndex(assessmentId) {
  const next = indexedIds().filter((item) => item !== assessmentId)
  next.push(assessmentId)
  writeRaw(INDEX_KEY, next)
}

function removeFromIndex(assessmentId) {
  const next = indexedIds().filter((item) => item !== assessmentId)
  if (next.length) writeRaw(INDEX_KEY, next)
  else removeRaw(INDEX_KEY)
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

/**
 * 记下一份没能存到服务端的草稿。只在保存失败时调用。
 * 返回是否真的落盘，便于调用方决定提示文案。
 */
function remember(assessmentId, payload) {
  if (typeof assessmentId !== 'string' || !assessmentId) return false
  const value = plainObject(payload)
  const answers = value && plainObject(value.answers)
  if (!answers || !Object.keys(answers).length) return false

  const entry = {
    assessmentId,
    answers,
    revision: Number.isInteger(value.revision) ? value.revision : 0,
    failedAt: Date.now()
  }
  if (typeof value.educationSystem === 'string' && value.educationSystem) {
    entry.educationSystem = value.educationSystem
  }

  let size = 0
  try {
    size = JSON.stringify(entry).length
  } catch (error) {
    return false
  }
  if (size > MAX_BYTES) return false

  if (!writeRaw(key(assessmentId), entry)) return false
  addToIndex(assessmentId)
  return true
}

/**
 * 取出兜底草稿；不存在、格式坏掉或已过期都返回 null，并顺手清掉。
 */
function recall(assessmentId) {
  if (typeof assessmentId !== 'string' || !assessmentId) return null
  const entry = plainObject(readRaw(key(assessmentId)))
  if (!entry || !plainObject(entry.answers) || !Object.keys(entry.answers).length) {
    if (entry !== null) forget(assessmentId)
    return null
  }
  const failedAt = Number(entry.failedAt)
  if (!Number.isFinite(failedAt) || Date.now() - failedAt > MAX_AGE_MS) {
    forget(assessmentId)
    return null
  }
  return {
    assessmentId,
    answers: entry.answers,
    revision: Number.isInteger(entry.revision) ? entry.revision : 0,
    failedAt,
    ...(typeof entry.educationSystem === 'string' && entry.educationSystem
      ? { educationSystem: entry.educationSystem }
      : {})
  }
}

/** 保存成功、提交成功或用户选择丢弃后调用。 */
function forget(assessmentId) {
  if (typeof assessmentId !== 'string' || !assessmentId) return
  removeRaw(key(assessmentId))
  removeFromIndex(assessmentId)
}

/** 退出登录时调用：换了账号就不该还留着上一个人的答案。 */
function forgetAll() {
  for (const assessmentId of indexedIds()) removeRaw(key(assessmentId))
  removeRaw(INDEX_KEY)
}

/**
 * 兜底草稿里有没有服务端还没拿到的答案。
 * 两边都用提交给接口的那套键，可以直接比。
 */
function hasUnsavedAnswers(buffered, serverAnswers) {
  const local = plainObject(buffered && buffered.answers)
  if (!local) return false
  const remote = plainObject(serverAnswers) || {}
  return Object.keys(local).some((field) => JSON.stringify(local[field]) !== JSON.stringify(remote[field]))
}

module.exports = {
  INDEX_KEY, MAX_AGE_MS, MAX_BYTES, PREFIX,
  forget, forgetAll, hasUnsavedAnswers, recall, remember
}
