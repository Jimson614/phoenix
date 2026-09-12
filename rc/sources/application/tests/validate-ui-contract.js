'use strict'

const assert = require('node:assert')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const baselineDirectory = path.join(root, 'artifacts', 'ui-review', '20260826T030012894Z')
const routeBaselinePath = path.join(baselineDirectory, 'route-tabbar-baseline.json')
const interactionBaselinePath = path.join(baselineDirectory, 'required-handler-baseline.json')
const protectedBaselinePath = path.join(baselineDirectory, 'before-protected-sha256.json')

function readJson(file) {
  assert(fs.existsSync(file), `UI baseline is missing: ${path.relative(root, file)}`)
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function normalizeSlashes(value) {
  return String(value).split(path.sep).join('/')
}

function walk(directory) {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(target) : [target]
  })
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function readSource(relative) {
  const file = path.join(root, ...relative.split('/'))
  assert(fs.existsSync(file), `UI contract source is missing: ${relative}`)
  return fs.readFileSync(file, 'utf8')
}

function countMatches(source, pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  return [...source.matchAll(new RegExp(pattern.source, flags))].length
}

function cssRuleBodies(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [...source.matchAll(new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^}]*)}`, 'gm'))]
    .map((match) => match[1])
}

function cssRules(source) {
  const rules = []
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  let match
  while ((match = pattern.exec(source))) {
    rules.push({ selector: match[1].trim(), body: match[2] })
  }
  return rules
}

function methodBlock(source, methodName, relative) {
  const methodPattern = new RegExp(`\\b${methodName}\\s*\\([^)]*\\)\\s*\\{`)
  const match = methodPattern.exec(source)
  assert(match, `${relative} must define Page.${methodName}()`)
  const opening = source.indexOf('{', match.index)
  let depth = 0
  let quote = ''
  let escaped = false
  let lineComment = false
  let blockComment = false
  for (let index = opening; index < source.length; index += 1) {
    const character = source[index]
    const next = source[index + 1]
    if (lineComment) {
      if (character === '\n') lineComment = false
      continue
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false
        index += 1
      }
      continue
    }
    if (quote) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = ''
      continue
    }
    if (character === '/' && next === '/') {
      lineComment = true
      index += 1
      continue
    }
    if (character === '/' && next === '*') {
      blockComment = true
      index += 1
      continue
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character
      continue
    }
    if (character === '{') depth += 1
    if (character === '}') {
      depth -= 1
      if (depth === 0) return source.slice(opening + 1, index)
    }
  }
  assert.fail(`${relative} has an unterminated Page.${methodName}() body`)
}

function occurrences(values, keyOf) {
  const result = new Map()
  for (const value of values) {
    const key = keyOf(value)
    result.set(key, (result.get(key) || 0) + 1)
  }
  return result
}

function normalizeEventAttribute(value) {
  return String(value).toLowerCase().replaceAll(':', '').replaceAll('-', '')
}

function eventBindings(source) {
  const result = []
  const pattern = /\b((?:capture-)?(?:bind|catch):?[A-Za-z][\w-]*)\s*=\s*(["'])([^"']+)\2/g
  let match
  while ((match = pattern.exec(source))) {
    result.push({ attribute: normalizeEventAttribute(match[1]), handler: match[3].trim() })
  }
  return result
}

function dataBindings(source) {
  const result = []
  const pattern = /\b(data-[\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g
  let match
  while ((match = pattern.exec(source))) {
    result.push({ attribute: match[1].toLowerCase(), value: match[3].replace(/\s+/g, ' ').trim() })
  }
  return result
}

function assertInteractionContract(pageBaseline) {
  const absolute = path.join(root, ...pageBaseline.path.split('/'))
  const source = fs.readFileSync(absolute, 'utf8')
  const actualEvents = occurrences(eventBindings(source), (item) => `${item.attribute}:${item.handler}`)
  const requiredEvents = occurrences(pageBaseline.handlers, (item) => `${normalizeEventAttribute(item.attribute)}:${item.handler}`)
  for (const [key, count] of requiredEvents) {
    assert((actualEvents.get(key) || 0) >= count,
      `${pageBaseline.path} lost required event binding ${key}; expected at least ${count}, found ${actualEvents.get(key) || 0}`)
  }

  const actualData = dataBindings(source)
  const requiredData = occurrences(pageBaseline.dataAttributes, (item) =>
    `${String(item.attribute).toLowerCase()}:${String(item.value).replace(/\s+/g, ' ').trim()}`)
  for (const [key, count] of requiredData) {
    const separator = key.indexOf(':')
    const attribute = key.slice(0, separator)
    const expectedPrefix = key.slice(separator + 1)
    const found = actualData.filter((item) => item.attribute === attribute && item.value.startsWith(expectedPrefix)).length
    assert(found >= count,
      `${pageBaseline.path} lost required ${attribute} binding beginning ${JSON.stringify(expectedPrefix)}; expected at least ${count}, found ${found}`)
  }
}

const routeBaseline = readJson(routeBaselinePath).contract
const interactionBaseline = readJson(interactionBaselinePath)
const protectedBaseline = readJson(protectedBaselinePath)
const app = readJson(path.join(root, 'app.json'))

const legacyPages = routeBaseline.pages
const mastersPages = [
  'pages/masters-intake/index',
  'pages/masters-materials/index',
  'pages/masters-confirm/index',
  'pages/masters-status/index',
  'pages/masters-list/index',
  'pages/masters-report/index'
]
const expectedPages = [legacyPages[0], legacyPages[1], ...mastersPages, ...legacyPages.slice(2)]
assert.strictEqual(legacyPages.length, 16, 'approved pre-UI baseline must continue to cover all 16 legacy pages')
assert.strictEqual(mastersPages.length, 6, 'masters client route contract must cover all six registered pages')
assert.strictEqual(app.pages.length, expectedPages.length, 'source Mini Program must keep all legacy pages plus six masters pages')
assert.deepStrictEqual(app.pages, expectedPages, 'app.json page order changed from the approved legacy baseline or masters route contract')
assert.strictEqual(app.lazyCodeLoading, routeBaseline.lazyCodeLoading, 'lazyCodeLoading changed from the approved baseline')
assert(app.tabBar && Array.isArray(app.tabBar.list), 'tabBar list is missing')
assert.deepStrictEqual(
  app.tabBar.list.map((item) => item.pagePath),
  routeBaseline.tabBar.list.map((item) => item.pagePath),
  'the three family tab pagePath values must remain home, timeline and mine in their original order'
)
assert.strictEqual(app.tabBar.list.length, 3, 'the Mini Program must keep exactly three primary family tabs')

for (const page of app.pages) {
  for (const extension of ['wxml', 'wxss']) {
    assert(fs.existsSync(path.join(root, `${page}.${extension}`)), `registered page is missing ${page}.${extension}`)
  }
}

assert.strictEqual(interactionBaseline.pages.length, legacyPages.length, 'required-handler baseline must continue to cover all 16 legacy pages')
for (const page of interactionBaseline.pages) assertInteractionContract(page)

const mastersIntakeWxml = readSource('pages/masters-intake/index.wxml')
const mastersIntakeJs = readSource('pages/masters-intake/index.js')
const mastersMaterialsWxml = readSource('pages/masters-materials/index.wxml')
const mastersMaterialsJs = readSource('pages/masters-materials/index.js')
for (const type of ['RESUME', 'TRANSCRIPT', 'LANGUAGE', 'ENROLLMENT', 'GRADUATION', 'DEGREE', 'SUPPLEMENTAL']) {
  assert(new RegExp(`data-type=["'](?:\\{\\{item\\.type\\}\\}|${type})["']`).test(mastersMaterialsWxml) ||
    mastersMaterialsWxml.includes(`data-type="${type}"`),
  `masters materials page must expose a clickable ${type} upload card`)
}
assert(mastersMaterialsWxml.includes('bindtap="selectUpload"'), 'masters materials upload cards must use a real selection handler')
assert(/<checkbox-group[^>]*bindchange="adultChange"/.test(mastersMaterialsWxml), 'masters adult confirmation must bind through checkbox-group')
assert(!/<checkbox(?=\s|>)[^>]*bindchange=/i.test(mastersMaterialsWxml), 'masters checkboxes must not rely on standalone checkbox bindchange')
assert(!/\.join\s*\(/.test(mastersMaterialsWxml), 'masters WXML must not call JavaScript .join() methods')
assert(mastersMaterialsJs.includes('uploadDocument') && mastersMaterialsJs.includes('retryDocumentExtraction'),
  'masters materials page must expose real upload and extraction retry handlers')
assert(mastersIntakeJs.includes('onShareAppMessage') && mastersIntakeJs.includes('config.channel'),
  'masters intake sharing must use the whitelist channel contract')
assert(!/(?:reportId|assessmentId|studentId|familyId|orderId|conversationId|price|39\.9)/i.test(mastersIntakeJs),
  'masters intake sharing/client entry must not expose private ids or paid pricing')

const copyContract = {
  'pages/compass/index.wxml': [
    '约 3—5 分钟', '约 15—20 分钟', '学生先完成并提交问卷',
    '学生本人 Assent', '由学生本人开始成长发现'
  ],
  'pages/compass-preview/index.wxml': [
    '微信支付并解锁', '免费测评 · 有限 AI 分析', '不等同于', '完整报告',
    '提交后付款 · 单次解锁', '支付状态仅以服务端订单查询和微信支付通知为准'
  ],
  'pages/agent-chat/index.wxml': [
    '不保证录取', '监护人', '可信来源', '删除这段对话', '撤回 AI 同意'
  ],
  'pages/assessment-analysis/index.wxml': [
    '免费测评分析与', '已购报告分析是不同内容层级', '学生与监护人分别确认', '可信来源', '请勿输入'
  ],
  'pages/report/index.wxml': [
    'PAID REPORT AI ANALYSIS', 'AI 总分析', 'AI 追问（最多 3 次）'
  ],
  'pages/mine/index.wxml': [
    '授权互相独立', '撤回 AI 分析授权', '停止飞书资料镜像', '撤回顾问联系授权',
    '撤回学生本人测评同意', '撤回核心测评授权'
  ]
}

for (const [relative, requiredCopies] of Object.entries(copyContract)) {
  const source = readSource(relative)
  for (const copy of requiredCopies) assert(source.includes(copy), `${relative} is missing required product/safety copy: ${copy}`)
}
assert(/付款(?:确认)?后[^<\n]{0,28}(?:解锁|查看)/.test(readSource('pages/compass/index.wxml')),
  'pages/compass/index.wxml must state that full report access occurs only after payment confirmation')

const screenContract = [
  {
    name: 'Free home',
    wxml: 'pages/compass/index.wxml',
    js: 'pages/compass/index.js',
    hook: /data-ui-screen\s*=\s*["']\{\{uiScreen\}\}["']/,
    token: 'education-compass-free-home'
  },
  {
    name: 'Free questionnaire',
    wxml: 'pages/compass-questionnaire/index.wxml',
    js: 'pages/compass-questionnaire/index.js',
    hook: /data-ui-screen\s*=\s*["']\{\{uiScreen\}\}["']/,
    token: 'education-compass-free-questionnaire'
  },
  {
    name: 'Free result',
    wxml: 'pages/compass-preview/index.wxml',
    hook: /data-ui-screen\s*=\s*["']free-result["']/,
    token: 'free-result'
  },
  {
    name: 'Level 2 home',
    wxml: 'pages/compass/index.wxml',
    js: 'pages/compass/index.js',
    hook: /data-ui-screen\s*=\s*["']\{\{uiScreen\}\}["']/,
    token: 'education-compass-growth-home'
  },
  {
    name: 'Level 2 questionnaire',
    wxml: 'pages/compass-questionnaire/index.wxml',
    js: 'pages/compass-questionnaire/index.js',
    hook: /data-ui-screen\s*=\s*["']\{\{uiScreen\}\}["']/,
    token: 'education-compass-growth-questionnaire'
  },
  {
    name: 'Growth report',
    wxml: 'pages/report/index.wxml',
    hook: /data-ui-screen\s*=\s*["']growth-report["']/,
    token: 'growth-report'
  },
  {
    name: 'Next support',
    wxml: 'pages/report/index.wxml',
    hook: /data-ui-screen\s*=\s*["']next-support["']/,
    token: 'next-support'
  }
]

assert.strictEqual(new Set(screenContract.map((screen) => screen.token)).size, 7,
  'the V2 visual contract must define exactly seven distinct screen tokens')
for (const screen of screenContract) {
  const wxml = readSource(screen.wxml)
  assert(screen.hook.test(wxml), `${screen.wxml} is missing the ${screen.name} data-ui-screen hook (${screen.token})`)
  if (screen.js) {
    assert(readSource(screen.js).includes(`'${screen.token}'`),
      `${screen.js} must map the ${screen.name} state to data-ui-screen=${screen.token}`)
  } else {
    assert.strictEqual(countMatches(wxml, new RegExp(`data-ui-screen\\s*=\\s*["']${screen.token}["']`)), 1,
      `${screen.wxml} must expose data-ui-screen=${screen.token} exactly once`)
  }
}

const compassEntryWxml = fs.readFileSync(path.join(root, 'pages', 'compass', 'index.wxml'), 'utf8')
assert(compassEntryWxml.includes('wx:if="{{isV05 && level === 2 && level2EntryAuthorized}}" class="product-card"'),
  'the product/price card must render only in a server-authorized V0.5 Level 2 entry')
assert(!compassEntryWxml.includes('wx:if="{{!isV05 || level === 2}}" class="product-card"'),
  'Level 1 and demo first entry must not render the historical product/price card')
assert(!compassEntryWxml.includes('微信支付并解锁'),
  'the questionnaire entry page must not expose a payment CTA before a submitted result exists')

const compassEntryJs = readSource('pages/compass/index.js')
for (const required of [
  "if (this.data.level === 2 && !this.data.level2EntryAuthorized)",
  'educationNavigation.resolveCompassEntry(state, 2)',
  'if (!entry.authorized)',
  'sourceAssessmentId: this.sourceAssessmentId',
  "scope: 'CORE_ASSESSMENT'",
  "scope: 'STUDENT_ASSESSMENT_ASSENT'"
]) assert(compassEntryJs.includes(required), `pages/compass/index.js lost the Level 2/Consent gate: ${required}`)
for (const required of [
  'bindchange="guardianChange"',
  'bindchange="assentChange"',
  'checked="{{guardianAccepted}}"',
  'checked="{{studentAssentAccepted}}"'
]) assert(compassEntryWxml.includes(required), `pages/compass/index.wxml lost the separate guardian/student Consent control: ${required}`)

const previewWxml = readSource('pages/compass-preview/index.wxml')
const previewJs = readSource('pages/compass-preview/index.js')
assert(previewJs.includes("const canStartLevel2 = rendered.nextStepStatus === 'AVAILABLE'"),
  'Free result must derive canStartLevel2 only from the authoritative AVAILABLE next-step status')
assert(countMatches(previewWxml, /wx:if\s*=\s*["']\{\{canStartLevel2\}\}["']/) >= 2,
  'Free result must gate both the Level 2 invitation and CTA with canStartLevel2')
assert(/wx:if\s*=\s*["']\{\{canStartLevel2\}\}["'][^>]*bindtap\s*=\s*["']startStudentAssessment["']/.test(previewWxml),
  'Free result Level 2 CTA must not render unless canStartLevel2 is true')

const reportWxml = readSource('pages/report/index.wxml')
const reportJs = readSource('pages/report/index.js')
for (const required of [
  'response.full && response.full.result',
  "const growthReady = Boolean(isGrowthReport && rendered.resultState === 'FULL')",
  'growthSections: growthReady ?',
  'dimensionCards: growthReady ?',
  'evidenceLines: growthReady ?',
  'nextSupportVisible: growthReady && familyUser',
  "response.access === 'full'",
  "response.status === 'READY'",
  "response.deliveryStatus === 'DELIVERED'",
  'response.qaPassed === true',
  'response.entitled === true'
]) assert(reportJs.includes(required), `pages/report/index.js lost a full-report entitlement/delivery gate: ${required}`)
assert(reportWxml.includes('wx:if="{{!growthReady}}" class="report-state report-state--inline"'),
  'Growth report must render the locked state when growthReady is false')
assert(reportWxml.includes('wx:else class="page report__body report__body--growth"'),
  'Growth report full body must remain the wx:else branch of the growthReady lock')

for (const required of [
  'response.capabilities && response.capabilities.nextSupport',
  "['RESERVED', 'BLOCKED', 'DISABLED'].includes(askwise.status)",
  'askwiseEnabled: false'
]) assert(reportJs.includes(required), `pages/report/index.js lost the fail-closed Askwise capability contract: ${required}`)
const askwiseButton = reportWxml.match(/<button\b[^>]*class=["'][^"']*askwise-card__button[^"']*["'][^>]*>/)
assert(askwiseButton && /\bdisabled=["']\{\{!nextSupport\.askwiseEnabled\}\}["']/.test(askwiseButton[0]),
  'Askwise must remain a capability-driven disabled control')
assert(!/\bbind(?:tap|longpress)\s*=/.test(askwiseButton[0]),
  'Askwise reserved control must not bind an action before an approved capability exists')

const consentContracts = {
  'pages/assessment-analysis/index.wxml': [
    'bindchange="consentChange"', 'disabled="{{!consentAccepted || starting}}"', 'bindtap="startAnalysis"'
  ],
  'pages/agent-chat/index.wxml': [
    'bindchange="consentChange"', 'disabled="{{!consentAccepted || starting}}"',
    'disabled="{{sending || runId || !consentActive}}"', 'bindtap="withdrawConsent"', 'bindtap="deleteConversation"'
  ],
  'pages/advisor-request/index.wxml': [
    'bindchange="toggleConsent"', 'disabled="{{loading || !consentConfirmed}}"', 'bindtap="submit"'
  ],
  'pages/mine/index.wxml': [
    'bindtap="withdrawAiConsent"', 'bindtap="withdrawFeishuConsent"', 'bindtap="withdrawAdvisorConsent"',
    'bindtap="withdrawStudentAssent"', 'bindtap="withdrawCoreConsent"'
  ]
}
for (const [relative, requiredBindings] of Object.entries(consentContracts)) {
  const source = readSource(relative)
  for (const binding of requiredBindings) {
    assert(source.includes(binding), `${relative} lost required independent Consent/withdrawal binding: ${binding}`)
  }
}
const analysisJs = readSource('pages/assessment-analysis/index.js')
assert(analysisJs.includes("values.includes('student') && values.includes('guardian')") &&
  analysisJs.includes('if (!this.data.consentAccepted || this.data.starting) return'),
'assessment analysis must require both student and guardian confirmation before starting')
const agentJs = readSource('pages/agent-chat/index.js')
assert(agentJs.includes("values.includes('student') && values.includes('guardian')") &&
  agentJs.includes('if (!this.data.eligible || !this.data.consentAccepted || this.data.starting) return'),
'Agent analysis must require eligibility plus both confirmations before starting')
const advisorJs = readSource('pages/advisor-request/index.js')
assert(advisorJs.includes('if (!this.data.consentConfirmed)'),
  'advisor request must fail closed until its independent contact Consent is confirmed')

const sourceFiles = [
  path.join(root, 'app.wxss'),
  ...walk(path.join(root, 'pages')).filter((file) => /\.(?:wxml|wxss)$/i.test(file)),
  ...walk(path.join(root, 'components')).filter((file) => /\.(?:wxml|wxss)$/i.test(file))
]

const shareAllowlist = new Map([
  ['pages/compass-preview/index.wxml', 'pages/compass-preview/index.js'],
  ['pages/report/index.wxml', 'pages/report/index.js']
])
const shareCounts = new Map([...shareAllowlist.keys()].map((relative) => [relative, 0]))
for (const file of sourceFiles.filter((candidate) => candidate.endsWith('.wxml'))) {
  const relative = normalizeSlashes(path.relative(root, file))
  const source = fs.readFileSync(file, 'utf8')
  for (const tag of source.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)) {
    if (!/\bopen-type\s*=\s*["']share["']/i.test(tag[2])) continue
    assert(shareAllowlist.has(relative),
      `${relative} contains an unapproved share control; only compass-preview and report may share`)
    assert.strictEqual(tag[1].toLowerCase(), 'button',
      `${relative} share must use the native <button open-type="share"> control`)
    shareCounts.set(relative, shareCounts.get(relative) + 1)
  }
}
for (const [wxmlRelative, jsRelative] of shareAllowlist) {
  assert.strictEqual(shareCounts.get(wxmlRelative), 1,
    `${wxmlRelative} must expose exactly one native open-type="share" control`)
  const block = methodBlock(readSource(jsRelative), 'onShareAppMessage', jsRelative)
  assert(/\btitle\s*:\s*(["'])Phoenix Education Compass™ 家庭成长入口\1/.test(block),
    `${jsRelative} share title must be the generic approved entry title`)
  assert(/\bpath\s*:\s*(["'])\/pages\/welcome\/index\1/.test(block),
    `${jsRelative} share path must be the generic /pages/welcome/index entry without query parameters`)
  assert(!/(?:reportId|assessmentId|studentId|familyId|orderId|conversationId|signals?|evidence|summary|result|studentName|familyName)/i.test(block),
    `${jsRelative} share payload must not contain IDs, names, evidence, signals, summaries or result data`)
  assert(!/\/pages\/welcome\/index\s*[?&#]/.test(block),
    `${jsRelative} share path must not append query or fragment data`)
}

const forbiddenPresentationLiterals = [
  { label: 'reference progress 2 / 3', pattern: /(^|[^\d])2\s*\/\s*3([^\d]|$)/ },
  { label: 'reference question count 8 / 40', pattern: /(^|[^\d])8\s*\/\s*40([^\d]|$)/ },
  { label: 'reference question count “4个问题”', pattern: /4\s*个\s*问题/ },
  { label: 'hard-coded ¥39.9 price', pattern: /[¥￥]\s*39\.9(?:0)?/ },
  { label: 'unapproved ¥980起 price', pattern: /[¥￥]\s*980\s*起/ },
  {
    label: 'hard-coded ability grade',
    pattern: /能力(?:等级|评级|分数|评分|得分)\s*[:：]?\s*(?:A\+?|B\+?|C\+?|高|中|低|优秀|良好|待提升|\d+(?:\.\d+)?\s*分)/i
  },
  { label: 'ability radar score', pattern: /(?:能力|维度)?雷达(?:图)?\s*(?:分数|评分|得分)/ }
]
const releasePresentationFiles = app.pages
  .filter((page) => !page.startsWith('pages/admin-'))
  .flatMap((page) => [`${page}.wxml`, `${page}.js`])
for (const relative of releasePresentationFiles) {
  const source = readSource(relative)
  for (const forbidden of forbiddenPresentationLiterals) {
    assert(!forbidden.pattern.test(source),
      `${relative} contains ${forbidden.label}; render progress, product price and evidence status from authoritative data instead`)
  }
}

const globalWxss = fs.readFileSync(path.join(root, 'app.wxss'), 'utf8')
const globalPageRule = globalWxss.match(/\.page\s*\{([^}]*)\}/)
assert(globalPageRule, 'app.wxss is missing the shared .page container rule')
assert(!/min-height\s*:\s*100vh/i.test(globalPageRule[1]),
  'shared .page is a content container and must not force every nested section to one viewport')

for (const file of sourceFiles) {
  const relative = normalizeSlashes(path.relative(root, file))
  const source = fs.readFileSync(file, 'utf8')
  if (file.endsWith('.wxml')) {
    assert(!/<web-view\b/i.test(source), `${relative} must remain native and cannot contain web-view`)
    assert(!/\bsrc\s*=\s*["'](?:https?:)?\/\//i.test(source), `${relative} contains a remote image source`)
    assert(!/(?:class|id)\s*=\s*["'][^"']*(?:language-switch|locale-switch)[^"']*["']/i.test(source),
      `${relative} contains an unapproved language switch`)
    assert(!/>\s*中文\s*</.test(source), `${relative} contains a reference-only Chinese language control label`)
    if (!shareAllowlist.has(relative)) {
      assert(!/(?:class|id)\s*=\s*["'][^"']*(?:share-button|preview-share|report-share)[^"']*["']/i.test(source),
        `${relative} contains a share-styled control outside the approved pages`)
      assert(!/>\s*分享\s*</.test(source), `${relative} contains a share label outside the approved pages`)
    }
  }
  if (file.endsWith('.wxss') || file.endsWith('app.wxss')) {
    assert(!/@font-face\b/i.test(source), `${relative} cannot embed an external font`)
    assert(!/@import\b/i.test(source), `${relative} cannot import an external stylesheet or font`)
    assert(!/url\(\s*["']?(?:https?:)?\/\//i.test(source), `${relative} contains a remote CSS asset`)
    assert(!/(^|[,{>+~])\s*\*/m.test(source), `${relative} contains a universal selector unsupported by the target WXSS compiler`)
  }
  for (const match of source.matchAll(/data:image\/[A-Za-z0-9.+-]+;base64,([A-Za-z0-9+/=\s]+)/g)) {
    const encodedBytes = match[1].replace(/\s+/g, '').length
    assert(encodedBytes <= 4096, `${relative} contains a large inline base64 image (${encodedBytes} encoded bytes)`)
  }

  for (const match of source.matchAll(/(?:src\s*=\s*["']|url\(\s*["']?)(\/assets\/[^"')\s]+)/g)) {
    const asset = path.join(root, ...match[1].replace(/^\//, '').split('/'))
    assert(fs.existsSync(asset), `${relative} references missing local asset ${match[1]}`)
  }
}

const tapToken = globalWxss.match(/--tap-min-size\s*:\s*([^;]+);/)
assert(tapToken && /44px/.test(tapToken[1]),
  'app.wxss --tap-min-size must include a physical 44px minimum; 88rpx alone is below 44px at 320px width')
const nativeButtonRules = cssRuleBodies(globalWxss, 'button')
assert(nativeButtonRules.some((body) => /min-height\s*:\s*(?:var\(\s*--tap-min-size\s*\)|(?:4[4-9]|[5-9]\d)px)/i.test(body)),
  'app.wxss native button rule must apply the 44px tap minimum to non-.btn controls too')
const sharedButtonRules = cssRuleBodies(globalWxss, '.btn')
assert(sharedButtonRules.some((body) => /min-height\s*:\s*var\(\s*--tap-min-size\s*\)/i.test(body)),
  'app.wxss .btn must continue to consume --tap-min-size')

const questionnaireWxss = readSource('pages/compass-questionnaire/index.wxss')
const selectedRules = cssRuleBodies(questionnaireWxss, '.option--selected')
assert(selectedRules.length && selectedRules.some((body) =>
  /background\s*:[^;]*(?:#fff4df|#f9e7c4|#f8ead0|var\(\s*--gold-wash\s*\))/i.test(body)),
'selected questionnaire options must use the pale champagne-gold surface from the approved reference')
assert(selectedRules.every((body) => !/background\s*:[^;]*(?:#102[0-9a-f]{3}|#14243a|#18364f)/i.test(body)),
  'selected questionnaire options must not revert to a dark navy fill')
assert(/option\.selected\s*\?\s*["']✓["']\s*:\s*["']["']/.test(readSource('pages/compass-questionnaire/index.wxml')),
  'selected questionnaire options must retain a non-color checkmark state')

const fixedBottomBars = []
for (const file of sourceFiles.filter((candidate) => candidate.endsWith('.wxss'))) {
  const relative = normalizeSlashes(path.relative(root, file))
  const source = fs.readFileSync(file, 'utf8')
  for (const rule of cssRules(source)) {
    if (!/position\s*:\s*fixed/i.test(rule.body) || !/bottom\s*:\s*0(?:\D|$)/i.test(rule.body)) continue
    fixedBottomBars.push(`${relative} ${rule.selector}`)
    assert(/env\(\s*safe-area-inset-bottom\s*\)/i.test(rule.body),
      `${relative} ${rule.selector} is a fixed bottom bar without safe-area-inset-bottom padding`)
  }
}
assert(fixedBottomBars.some((entry) => entry.includes('questionnaire__actions')),
  'questionnaire fixed action bar is missing from the safe-area contract')
assert(fixedBottomBars.some((entry) => entry.includes('purchase-bar')),
  'growth purchase fixed action bar is missing from the safe-area contract')
assert(/\.questionnaire\s*\{[^}]*padding-bottom\s*:/s.test(questionnaireWxss),
  'questionnaire content must reserve space above its fixed action bar')
assert(previewWxml.includes('class="purchase-bar-placeholder"'),
  'growth preview content must reserve space above its fixed purchase bar')

const viewportRootSelectors = new Set([
  'page', '.page--screen', '.advisor-list-page', '.admin-detail-page', '.advisor-page', '.agent-page',
  '.analysis-page', '.compass-page', '.family-page', '.home', '.mine-page', '.payment-result',
  '.preview-page', '.questionnaire', '.report', '.student-page', '.timeline-page', '.welcome',
  '.masters-intake', '.masters-materials', '.masters-confirm', '.masters-status', '.masters-list', '.masters-report'
])
for (const file of sourceFiles.filter((candidate) => candidate.endsWith('.wxss') || candidate.endsWith('app.wxss'))) {
  const relative = normalizeSlashes(path.relative(root, file))
  const source = fs.readFileSync(file, 'utf8')
  for (const rule of cssRules(source)) {
    for (const match of rule.body.matchAll(/(?:min-)?height\s*:\s*(\d+(?:\.\d+)?)vh\b/gi)) {
      const viewportHeight = Number(match[1])
      if (viewportHeight < 50) continue
      const selectors = rule.selector.split(',').map((selector) => selector.trim())
      const rootOnly = viewportHeight === 100 && selectors.every((selector) => viewportRootSelectors.has(selector))
      const loadingState = /(?:state|loading|skeleton)/i.test(rule.selector)
      assert(rootOnly || loadingState,
        `${relative} ${rule.selector} uses ${match[0]} on a non-root/non-loading block and may create a large blank viewport`)
    }
  }
}

for (const relative of [
  'app.wxss', 'pages/compass/index.wxss', 'pages/compass-questionnaire/index.wxss',
  'pages/compass-preview/index.wxss', 'pages/report/index.wxss'
]) {
  const source = readSource(relative)
  assert(/@media\s*\(\s*max-width\s*:\s*(?:3[0-5]\d|360)px\s*\)/i.test(source),
    `${relative} must include a <=360px narrow-screen rule for the 320/360px acceptance widths`)
}
const previewWxss = readSource('pages/compass-preview/index.wxss')
const overviewRules = cssRuleBodies(previewWxss, '.snapshot-overview')
assert(overviewRules.some((body) => /grid-template-columns\s*:\s*repeat\(\s*3\s*,\s*minmax\(\s*0\s*,\s*1fr\s*\)\s*\)/i.test(body)),
  'Free result factor overview must keep three equal columns')
const overviewColumnDeclarations = overviewRules.flatMap((body) =>
  [...body.matchAll(/grid-template-columns\s*:\s*([^;]+)/gi)].map((match) => match[1].replace(/\s+/g, '').toLowerCase())
)
assert(overviewColumnDeclarations.every((value) => value === 'repeat(3,minmax(0,1fr))'),
  `Free result factor overview must not collapse below three columns; found ${overviewColumnDeclarations.join(', ')}`)

const uiAssetsDirectory = path.join(root, 'assets', 'ui')
assert(fs.existsSync(uiAssetsDirectory) && fs.statSync(uiAssetsDirectory).isDirectory(), 'assets/ui directory is missing')
const uiAssets = walk(uiAssetsDirectory)
assert(uiAssets.length > 0, 'assets/ui must contain the approved local visual assets')
const allowedAssetExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const approvedUiAssetPaths = new Set([
  'assets/ui/compass-champagne.png',
  'assets/ui/feather-champagne.png'
])
let uiAssetBytes = 0
for (const file of uiAssets) {
  const metadata = fs.statSync(file)
  const relative = normalizeSlashes(path.relative(root, file))
  assert(allowedAssetExtensions.has(path.extname(file).toLowerCase()), `${relative} is not an approved raster UI asset type`)
  assert(approvedUiAssetPaths.has(relative),
    `${relative} is not in the approved UI asset allowlist; do not add/crop/generate an Askwise mascot without licensed source approval`)
  assert(!/(?:askwise|mascot|dragon)/i.test(path.basename(relative)),
    `${relative} uses a forbidden Askwise/mascot/dragon asset name`)
  assert(metadata.size <= 750 * 1024, `${relative} exceeds the 750 KiB per-asset UI budget`)
  uiAssetBytes += metadata.size
}
assert.deepStrictEqual(new Set(uiAssets.map((file) => normalizeSlashes(path.relative(root, file)))), approvedUiAssetPaths,
  'assets/ui must contain exactly the approved feather and compass assets')
assert(uiAssetBytes <= 1536 * 1024, `assets/ui exceeds the 1.5 MiB source asset budget (${uiAssetBytes} bytes)`)

const { EXCLUDED } = require('../scripts/build-release')
for (const page of ['pages/admin-families', 'pages/admin-family']) {
  assert(EXCLUDED.has(page), `release builder must continue to exclude demo-only ${page}`)
}

for (const lockPath of ['package-lock.json']) {
  const baseline = protectedBaseline.files.find((item) => normalizeSlashes(item.path) === lockPath)
  assert(baseline, `protected baseline is missing ${lockPath}`)
  assert.strictEqual(sha256(path.join(root, ...lockPath.split('/'))), baseline.sha256, `${lockPath} changed during the UI-only update`)
}

// The Masters P0 is a backend feature as well as a UI addition. Permit its
// explicit parser/export packages while keeping the pre-existing core pinned.
const serverManifest = readJson(path.join(root, 'server', 'package.json'))
const serverLock = readJson(path.join(root, 'server', 'package-lock.json'))
assert.deepStrictEqual(serverLock.packages[''].dependencies, serverManifest.dependencies)
assert.deepStrictEqual(serverLock.packages[''].devDependencies, serverManifest.devDependencies)
assert.deepStrictEqual(Object.keys(serverManifest.dependencies).sort(), ['busboy', 'fflate', 'jpeg-js', 'openai', 'pdfjs-dist', 'pdfkit', 'pg', 'pngjs'].sort())
for (const [name, version] of Object.entries({ openai: '6.49.0', pg: '8.23.0', typescript: '5.9.3', '@types/node': '24.13.3', '@types/pg': '8.23.1' })) {
  assert.strictEqual(serverLock.packages[`node_modules/${name}`].version, version, `Masters must preserve the existing ${name} lock`)
}

console.log('✓ UI route contract: 16 existing pages plus 6 Masters pages; 3 tab paths and lazy loading preserved')
console.log('✓ UI interaction contract: required WXML handlers and data-* bindings preserved')
console.log('✓ UI V2 screen contract: seven screen hooks, Level 2/report/Askwise gates and Consent controls preserved')
console.log('✓ UI share contract: native sharing is limited to preview/report and exposes only the generic welcome entry')
console.log('✓ UI safety contract: dynamic presentation facts, native-only assets, privacy controls and raster budgets verified')
console.log('✓ UI WXSS contract: compiler compatibility, 44px targets, safe fixed bars, selected state and narrow layouts verified')
console.log('✓ UI spacing contract: non-root content cannot force large viewport-height blanks')
console.log('✓ UI release contract: demo admin pages excluded; client lock and existing server core dependencies preserved')
