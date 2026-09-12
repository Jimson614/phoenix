const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
const projectConfig = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'))
const ignoredUploadPaths = (projectConfig.packOptions && projectConfig.packOptions.ignore || []).map((item) => typeof item === 'string' ? item : item.value)
for (const required of ['server', 'tests', 'docs', 'scripts', 'dist', 'node_modules', '.npm-cache']) {
  assert(ignoredUploadPaths.includes(required), `source project upload boundary must exclude ${required}`)
}

assert(appConfig.pages.includes('pages/agent-chat/index'), 'paid-report Agent page must be registered')
assert(appConfig.pages.includes('pages/assessment-analysis/index'), 'assessment/report analysis result page must be registered')
for (const page of appConfig.pages) {
  for (const extension of ['js', 'json', 'wxml', 'wxss']) {
    const file = path.join(root, `${page}.${extension}`)
    assert(fs.existsSync(file), `missing ${page}.${extension}`)
  }
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(target) : [target]
  })
}

function clientJavaScriptFiles() {
  const roots = ['app.js', 'components', 'config', 'models', 'pages', 'services', 'utils']
  return roots.flatMap((name) => {
    const target = path.join(root, name)
    if (!fs.existsSync(target)) return []
    return fs.statSync(target).isDirectory() ? walk(target).filter((file) => file.endsWith('.js')) : [target]
  })
}

for (const file of clientJavaScriptFiles()) {
  const content = fs.readFileSync(file, 'utf8')
  const requirePattern = /require\(\s*(['"])([^'"]+)\1\s*\)/g
  let match
  while ((match = requirePattern.exec(content))) {
    const request = match[2]
    assert(!request.endsWith('.json'), `Mini Program runtime cannot require JSON as CommonJS: ${path.relative(root, file)} -> ${request}`)
    if (!request.startsWith('.')) continue
    const target = path.resolve(path.dirname(file), request)
    const candidates = path.extname(target) ? [target] : [`${target}.js`, path.join(target, 'index.js')]
    assert(candidates.some((candidate) => fs.existsSync(candidate)), `unresolved client module: ${path.relative(root, file)} -> ${request}`)
  }
}

const previousPage = global.Page
try {
  for (const page of appConfig.pages) {
    const pageModule = path.join(root, `${page}.js`)
    let definition = null
    global.Page = (value) => { definition = value }
    delete require.cache[require.resolve(pageModule)]
    require(pageModule)
    assert(definition && typeof definition === 'object', `page module did not register: ${page}`)
  }
} finally {
  if (previousPage === undefined) delete global.Page
  else global.Page = previousPage
}

for (const file of walk(root)) {
  if (file.includes(`${path.sep}node_modules${path.sep}`)) continue
  const content = fs.readFileSync(file, 'utf8')
  if (file.endsWith('.json')) JSON.parse(content)
  if (file.endsWith('.js')) new Function('require', 'module', 'exports', 'getApp', 'wx', content)
  if (file.endsWith('.wxml')) {
    assert(!content.includes('.slice('), `unsupported method call in WXML: ${file}`)
    assert(!content.includes('<script'), `script must not appear in WXML: ${file}`)
  }
}

const schema = require('../models/schema')
for (const required of ['users', 'families', 'students', 'assessments', 'reports', 'orders', 'reportFeedback', 'timelineEvents', 'advisorNotes', 'advisorRequests', 'analyticsEvents', 'partners', 'permissions']) {
  assert(schema.tables[required], `missing model ${required}`)
}

const questionnaireSchema = require('../models/questionnaire-schema')
const questionnaireContract = JSON.parse(fs.readFileSync(path.join(root, 'models', 'questionnaire-contract.json'), 'utf8'))
assert.deepStrictEqual(questionnaireSchema.SCHEMA_CONTRACT, questionnaireContract, 'client questionnaire schema must match the server contract JSON')

console.log(`✓ project structure: ${appConfig.pages.length} pages, JSON and JS syntax valid`)
console.log('✓ Mini Program modules: relative requires resolve and no JSON is loaded as CommonJS')
console.log(`✓ Mini Program page registration: all ${appConfig.pages.length} Page modules load successfully`)
console.log('✓ questionnaire schema: client fields match the cross-layer contract')
console.log('✓ required data models and future placeholders present')

const previewWxml = fs.readFileSync(path.join(root, 'pages', 'compass-preview', 'index.wxml'), 'utf8')
assert(previewWxml.includes('微信支付并解锁'), 'native payment CTA should exist')
assert(previewWxml.includes('免费测评 · 有限 AI 分析') && previewWxml.includes('不等同于付费完整报告'),
  'free preview must clearly distinguish limited assessment analysis from the paid report')
assert(!previewWxml.includes('<web-view'), 'paid Compass must stay native and not use web-view')
const questionnairePage = fs.readFileSync(path.join(root, 'pages', 'compass-questionnaire', 'index.js'), 'utf8')
assert(!questionnairePage.includes("require('../../services/ai-provider')"), 'questionnaire page must not generate the full report on device')
const paymentService = fs.readFileSync(path.join(root, 'services', 'payment.js'), 'utf8')
assert(paymentService.includes('wx.requestPayment'), 'remote provider must invoke native WeChat payment')
assert(paymentService.includes('/v1/orders/${encodeURIComponent(orderId)}'), 'payment result must query the server order')
console.log('✓ paid Compass pages: native preview/payment result flow and server-authoritative payment checks')

const familyDataService = fs.readFileSync(path.join(root, 'services', 'family-data.js'), 'utf8')
for (const endpoint of ['/v1/me/family', '/v1/me/students', '/v1/me/reports', '/v1/me/timeline', '/v1/me/advisor-requests', '/v1/advisor-requests']) {
  assert(familyDataService.includes(endpoint), `missing remote family data endpoint ${endpoint}`)
}
for (const page of ['family-edit', 'student-edit', 'home', 'compass', 'compass-questionnaire', 'timeline', 'advisor-request', 'mine']) {
  const pageJs = fs.readFileSync(path.join(root, 'pages', page, 'index.js'), 'utf8')
  assert(pageJs.includes('family-data') || page === 'compass-questionnaire', `production page must use async remote family data adapter: ${page}`)
}
console.log('✓ production family pages: async remote repository adapters and server-owned profile ids')

const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8')
assert(/if \(runtime\.isDemo\(\)\) \{\s*repository\.initialize\(\)/.test(appSource), 'local repository initialization must be demo-only')
const runtimeSource = fs.readFileSync(path.join(root, 'config', 'runtime.js'), 'utf8')
assert(runtimeSource.includes("return 'unknown'") && runtimeSource.includes("return 'remote'"), 'unknown mini-program environments must fail closed to remote')
assert(runtimeSource.includes('API_BASE_URL_INSECURE'), 'remote API must require HTTPS')
const analyticsSource = fs.readFileSync(path.join(root, 'services', 'analytics.js'), 'utf8')
assert(analyticsSource.includes("if (!runtime.isDemo()) return null"), 'remote analytics must fail closed without local persistence')
const assessmentSource = fs.readFileSync(path.join(root, 'services', 'assessment.js'), 'utf8')
assert(assessmentSource.includes('remoteAnswers[assessmentId]'), 'remote questionnaire drafts must use session memory')
assert(assessmentSource.includes('/v1/assessments/${encodeURIComponent(assessmentId)}/draft'), 'remote questionnaire must load its server draft')
const authSource = fs.readFileSync(path.join(root, 'services', 'auth.js'), 'utf8')
assert(authSource.includes('payload.session || payload') && authSource.includes('getApp().setCurrentUser(user)'), 'remote auth must support flat/nested session envelopes and keep user in app memory')
const reportSource = fs.readFileSync(path.join(root, 'services', 'report.js'), 'utf8')
assert(reportSource.includes('wx.downloadFile') && reportSource.includes('response.tempFilePath'), 'paid PDF must use an authenticated temporary download')
assert(!reportSource.includes('USER_DATA_PATH') && !reportSource.includes('.writeFile('), 'paid PDF must not persist report content in the mini-program user directory')
assert(familyDataService.includes('reportId: context.reportId') && familyDataService.includes('studentId: context.studentId'), 'remote advisor requests must preserve server-validated report/student context')
console.log('✓ production privacy guards: opaque session only; no local PII/report persistence')

const rootPackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
assert.strictEqual(rootPackage.version, '0.5.0', 'root package must identify the V0.5.0 release')
assert(projectConfig.description.includes('V0.5.0') && projectConfig.projectname.includes('V0.5.0'), 'project metadata must identify V0.5.0')
const agentService = fs.readFileSync(path.join(root, 'services', 'agent.js'), 'utf8')
for (const endpoint of [
  '/agent-conversations', '/v1/agent-conversations/', '/v1/agent-runs/'
]) assert(agentService.includes(endpoint), `Agent client is missing endpoint fragment ${endpoint}`)
assert(agentService.includes("'Idempotency-Key'"), 'Agent create/message requests must send Idempotency-Key')
assert(!agentService.includes('setStorageSync') && !agentService.includes('getStorageSync'), 'Agent service must not persist conversation content or ids locally')
assert(!agentService.includes('OPENAI_API_KEY') && !agentService.includes('responses.create'), 'Mini Program must not call OpenAI directly')
const agentPage = fs.readFileSync(path.join(root, 'pages', 'agent-chat', 'index.js'), 'utf8')
assert(!agentPage.includes('setStorageSync') && !agentPage.includes('getStorageSync'), 'Agent page must keep messages in page memory only')
for (const gate of ["access === 'full'", "status === 'READY'", "deliveryStatus === 'DELIVERED'", 'qaPassed === true', 'entitled === true']) {
  assert(agentPage.includes(gate), `Agent entry must check ${gate}`)
}
const reportPage = fs.readFileSync(path.join(root, 'pages', 'report', 'index.js'), 'utf8')
assert(reportPage.includes('agentVisibility') && reportPage.includes('/pages/agent-chat/index?reportId='), 'report must expose the server-gated Agent entry')
const agentWxml = fs.readFileSync(path.join(root, 'pages', 'agent-chat', 'index.wxml'), 'utf8')
for (const copy of ['不保证录取', '监护人', '可信来源', '删除这段对话', '撤回 AI 同意']) {
  assert(agentWxml.includes(copy), `Agent page must show safety/management copy: ${copy}`)
}
assert(!agentWxml.includes('<web-view'), 'Agent experience must remain a native Mini Program page')
console.log('✓ V0.4.1 Agent client: dual analyses, paid-report gates, consent, safety copy and no local transcript persistence')

const analysisService = fs.readFileSync(path.join(root, 'services', 'agent-analysis.js'), 'utf8')
for (const endpoint of [
  '/v1/assessments/${encodeURIComponent(assessmentId)}/agent-analyses',
  '/v1/reports/${encodeURIComponent(reportId)}/agent-analyses',
  '/v1/agent-analyses/${encodeURIComponent(runId)}',
  '/v1/assessments/${encodeURIComponent(assessmentId)}/agent-analyses/latest',
  '/v1/reports/${encodeURIComponent(reportId)}/agent-analyses/latest'
]) assert(analysisService.includes(endpoint), `analysis client is missing endpoint ${endpoint}`)
assert(analysisService.includes("'Idempotency-Key'") && analysisService.includes('consentPayload()'),
  'both analysis create requests must carry idempotency and independent AI consent')
assert(!analysisService.includes('setStorageSync') && !analysisService.includes('getStorageSync'),
  'analysis service must not persist run ids or result content')
assert(!analysisService.includes('OPENAI_API_KEY') && !analysisService.includes('responses.create'),
  'analysis client must call Phoenix API only')
const analysisPage = fs.readFileSync(path.join(root, 'pages', 'assessment-analysis', 'index.js'), 'utf8')
assert(!analysisPage.includes('setStorageSync') && !analysisPage.includes('getStorageSync'),
  'analysis page must keep run/result data in page memory only')
for (const guard of ['MAX_POLL_ATTEMPTS = 60', 'MAX_POLL_DURATION_MS = 120000', 'onHide()', 'onUnload()', 'PII']) {
  assert(analysisPage.includes(guard), `analysis page is missing safety/polling guard: ${guard}`)
}
const analysisWxml = fs.readFileSync(path.join(root, 'pages', 'assessment-analysis', 'index.wxml'), 'utf8')
for (const copy of ['免费测评分析与已购报告分析是不同内容层级', '学生与监护人分别确认', '可信来源', '请勿输入']) {
  assert(analysisWxml.includes(copy), `analysis page is missing consent/product-boundary copy: ${copy}`)
}
assert(!analysisWxml.includes('<web-view'), 'dual analysis experience must remain a native Mini Program page')
assert(reportPage.includes('openPaidAnalysis') && reportPage.includes('paidAnalysisVisible'),
  'paid full report must expose a separately labeled one-shot analysis entry')
assert(reportPage.includes('openPaidAnalysis()') && reportPage.includes('runtime.isDemo()'),
  'paid report analysis must not call an empty remote API from demo mode')
const reportWxml = fs.readFileSync(path.join(root, 'pages', 'report', 'index.wxml'), 'utf8')
assert(reportWxml.includes('PAID REPORT AI ANALYSIS') && reportWxml.includes('AI 总分析') && reportWxml.includes('AI 追问（最多 3 次）'),
  'paid report analysis and paid report follow-up must be visibly distinct')
console.log('✓ dual analysis UX: free limited result, paid full-report analysis, paid follow-up kept separate')
