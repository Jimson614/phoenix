const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { buildRelease, DIST_ROOT, RELEASE_VERSION } = require('../scripts/build-release')

const output = path.join(DIST_ROOT, '.release-boundary-test')
const RELEASE_TOTAL_BUDGET_BYTES = Math.floor(1.75 * 1024 * 1024)
const BRAND_AND_UI_BUDGET_BYTES = 1250000
const UI_TOTAL_BUDGET_BYTES = 1536 * 1024
const UI_FILE_BUDGET_BYTES = 750 * 1024
const APPROVED_UI_ASSETS = new Set([
  'assets/ui/compass-champagne.png',
  'assets/ui/feather-champagne.png'
])

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(target) : [target]
  })
}

function slash(value) {
  return value.split(path.sep).join('/')
}

function bytes(files) {
  return files.reduce((total, file) => total + fs.statSync(file).size, 0)
}

function assertClientModulesResolve(directory) {
  const roots = ['app.js', 'components', 'config', 'models', 'pages', 'services', 'utils']
  const files = roots.flatMap((name) => {
    const target = path.join(directory, name)
    if (!fs.existsSync(target)) return []
    return fs.statSync(target).isDirectory() ? walk(target).filter((file) => file.endsWith('.js')) : [target]
  })
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8')
    const requirePattern = /require\(\s*(['"])([^'"]+)\1\s*\)/g
    let match
    while ((match = requirePattern.exec(content))) {
      const request = match[2]
      assert(!request.endsWith('.json'), `release Mini Program cannot require JSON as CommonJS: ${path.relative(directory, file)} -> ${request}`)
      if (!request.startsWith('.')) continue
      const target = path.resolve(path.dirname(file), request)
      const candidates = path.extname(target) ? [target] : [`${target}.js`, path.join(target, 'index.js')]
      assert(candidates.some((candidate) => fs.existsSync(candidate)), `release contains unresolved module: ${path.relative(directory, file)} -> ${request}`)
    }
  }
}

try {
  buildRelease({
    apiBaseUrl: 'https://api.example.invalid',
    appid: 'wx1234567890abcdef',
    outputDirectory: output
  })
  const files = walk(output)
  assertClientModulesResolve(output)
  const relativeFiles = files.map((file) => slash(path.relative(output, file)))
  for (const file of files.filter((candidate) => /\.(?:js|json|wxml|wxss)$/i.test(candidate))) {
    assert(!fs.readFileSync(file).includes(Buffer.from('\r\n')),
      `${slash(path.relative(output, file))} must use deterministic LF line endings`)
  }
  const releaseBytes = bytes(files)
  assert(releaseBytes <= RELEASE_TOTAL_BUDGET_BYTES,
    `release package exceeds 1.75 MiB (${releaseBytes} > ${RELEASE_TOTAL_BUDGET_BYTES} bytes)`)

  const brandAndUiFiles = files.filter((file) => {
    const relative = slash(path.relative(output, file))
    return relative.startsWith('assets/brand/') || relative.startsWith('assets/ui/')
  })
  const brandAndUiBytes = bytes(brandAndUiFiles)
  assert(brandAndUiBytes <= BRAND_AND_UI_BUDGET_BYTES,
    `release assets/brand + assets/ui exceed ${BRAND_AND_UI_BUDGET_BYTES} bytes (${brandAndUiBytes} bytes)`)

  const uiFiles = files.filter((file) => slash(path.relative(output, file)).startsWith('assets/ui/'))
  const uiRelativeFiles = uiFiles.map((file) => slash(path.relative(output, file)))
  const uiBytes = bytes(uiFiles)
  assert(uiBytes <= UI_TOTAL_BUDGET_BYTES,
    `release assets/ui exceed 1.5 MiB (${uiBytes} > ${UI_TOTAL_BUDGET_BYTES} bytes)`)
  for (const file of uiFiles) {
    const relative = slash(path.relative(output, file))
    const fileBytes = fs.statSync(file).size
    assert(fileBytes <= UI_FILE_BUDGET_BYTES,
      `${relative} exceeds the 750 KiB per-file UI budget (${fileBytes} bytes)`)
  }
  assert.deepStrictEqual(new Set(uiRelativeFiles), APPROVED_UI_ASSETS,
    'release assets/ui must contain exactly the approved feather and compass assets')

  const namedMascotAssets = relativeFiles.filter((relative) =>
    relative.startsWith('assets/') && /(?:askwise|mascot|dragon)/i.test(relative))
  assert.deepStrictEqual(namedMascotAssets, [],
    `release contains unapproved Askwise/mascot/dragon assets: ${namedMascotAssets.join(', ')}`)

  const shareAllowlist = new Map([
    ['pages/compass-preview/index.wxml', 'pages/compass-preview/index.js'],
    ['pages/report/index.wxml', 'pages/report/index.js']
  ])
  const shareCounts = new Map([...shareAllowlist.keys()].map((relative) => [relative, 0]))
  for (const file of files.filter((candidate) => candidate.endsWith('.wxml'))) {
    const relative = slash(path.relative(output, file))
    const source = fs.readFileSync(file, 'utf8')
    for (const tag of source.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)) {
      if (!/\bopen-type\s*=\s*["']share["']/i.test(tag[2])) continue
      assert(shareAllowlist.has(relative),
        `release share is not allowed in ${relative}; only compass-preview and report may share`)
      assert.strictEqual(tag[1].toLowerCase(), 'button', `${relative} share must use a native button`)
      shareCounts.set(relative, shareCounts.get(relative) + 1)
    }
  }
  for (const [wxmlRelative, jsRelative] of shareAllowlist) {
    assert.strictEqual(shareCounts.get(wxmlRelative), 1,
      `release ${wxmlRelative} must contain exactly one native share button`)
    const source = fs.readFileSync(path.join(output, ...jsRelative.split('/')), 'utf8')
    const shareMethod = source.match(/\bonShareAppMessage\s*\([^)]*\)\s*\{[\s\S]{0,600}/)
    assert(shareMethod, `${jsRelative} must define onShareAppMessage()`)
    assert(/\btitle\s*:\s*(["'])Phoenix Education Compass™ 家庭成长入口\1/.test(shareMethod[0]),
      `${jsRelative} must use the generic approved share title`)
    assert(/\bpath\s*:\s*(["'])\/pages\/welcome\/index\1/.test(shareMethod[0]),
      `${jsRelative} must share only /pages/welcome/index`)
    const payload = shareMethod[0].split(/\n\s*}\s*[,)]?/)[0]
    assert(!/(?:reportId|assessmentId|studentId|familyId|orderId|conversationId|signals?|evidence|summary|result)/i.test(payload),
      `${jsRelative} share payload contains protected IDs or result data`)
  }
  for (const forbidden of [
    'services/ai-provider.js', 'services/insight.js', 'services/repository.js',
    'services/store.js', 'models/schema.js'
  ]) assert(!relativeFiles.includes(forbidden), `release must exclude ${forbidden}`)
  assert(!relativeFiles.some((file) => file.startsWith('server/')), 'release must exclude all server source')
  assert(!relativeFiles.some((file) => file.startsWith('pages/admin-')), 'release must exclude demo advisor pages')
  assert(!relativeFiles.some((file) => /(^|\/)(?:openai|.*prompt.*|.*mock.*)(?:\/|$)/i.test(file)),
    'release must exclude OpenAI, server prompt and mock implementation files')

  const allSource = files.filter((file) => /\.(js|json|wxml)$/.test(file)).map((file) => fs.readFileSync(file, 'utf8')).join('\n')
  const presentationSourceFiles = files.filter((file) => /\.(?:js|wxml|wxss)$/i.test(file))
  const allPresentationSource = presentationSourceFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n')
  assert(!/(?:src\s*=\s*["']|url\(\s*["']?)\/assets\/[^"')\s]*(?:askwise|mascot|dragon)/i.test(allPresentationSource),
    'release source references an unapproved Askwise/mascot/dragon visual asset')
  const forbiddenPresentationLiterals = [
    ['reference progress 2 / 3', /(^|[^\d])2\s*\/\s*3([^\d]|$)/m],
    ['reference question count 8 / 40', /(^|[^\d])8\s*\/\s*40([^\d]|$)/m],
    ['reference question count “4个问题”', /4\s*个\s*问题/],
    ['hard-coded ¥39.9 price', /[¥￥]\s*39\.9(?:0)?/],
    ['unapproved ¥980起 price', /[¥￥]\s*980\s*起/],
    ['hard-coded ability grade', /能力(?:等级|评级|分数|评分|得分)\s*[:：]?\s*(?:A\+?|B\+?|C\+?|高|中|低|优秀|良好|待提升|\d+(?:\.\d+)?\s*分)/i],
    ['ability radar score', /(?:能力|维度)?雷达(?:图)?\s*(?:分数|评分|得分)/]
  ]
  const releaseUiSourceFiles = presentationSourceFiles.filter((file) =>
    slash(path.relative(output, file)).startsWith('pages/'))
  for (const file of releaseUiSourceFiles) {
    const relative = slash(path.relative(output, file))
    const source = fs.readFileSync(file, 'utf8')
    for (const [label, pattern] of forbiddenPresentationLiterals) {
      assert(!pattern.test(source), `${relative} contains ${label}; release UI facts must remain data-driven`)
    }
  }
  for (const forbidden of [
    'touristappid', 'function generateDemoCompassReport', 'PFS_DB_V01',
    'WECHAT_APP_SECRET', 'WECHATPAY_API_V3_KEY', 'FEISHU_APP_SECRET',
    'FEISHU_BITABLE_APP_TOKEN', 'FEISHU_PSEUDONYM_KEY',
    'OPENAI_API_KEY', 'OPENAI_SAFETY_HMAC_KEY', 'AGENT_CONTENT_ENCRYPTION_KEYS',
    'AGENT_SYSTEM_PROMPT', 'responses.create', 'chat.completions', 'api.openai.com'
  ]) {
    assert(!allSource.includes(forbidden), `release contains forbidden token: ${forbidden}`)
  }
  assert(!/require\(\s*['"]openai['"]\s*\)|from\s+['"]openai['"]/i.test(allSource),
    'release must not contain an OpenAI SDK import')
  const remoteOnlyAdapter = fs.readFileSync(path.join(output, 'services', 'demo-runtime.js'), 'utf8')
  assert(remoteOnlyAdapter.includes('Object.freeze({})') && !remoteOnlyAdapter.includes('require('),
    'release compatibility adapter must be inert and contain no local database or demo provider')
  const runtime = fs.readFileSync(path.join(output, 'config', 'runtime.js'), 'utf8')
  assert(runtime.includes("function mode() { return 'remote' }"), 'release runtime must be permanently remote')
  assert(runtime.includes('https://api.example.invalid'), 'release runtime must contain configured HTTPS API')
  const project = JSON.parse(fs.readFileSync(path.join(output, 'project.config.json'), 'utf8'))
  assert.strictEqual(project.appid, 'wx1234567890abcdef')
  assert.strictEqual(project.setting.urlCheck, true)
  const app = JSON.parse(fs.readFileSync(path.join(output, 'app.json'), 'utf8'))
  const sourceApp = JSON.parse(fs.readFileSync(path.join(path.resolve(__dirname, '..'), 'app.json'), 'utf8'))
  const expectedPages = sourceApp.pages.filter((page) => !page.startsWith('pages/admin-'))
  assert.deepStrictEqual(app.pages, expectedPages, 'release pages must be derived from app.json minus explicit demo-admin exclusions')
  assert(!app.pages.some((page) => page.startsWith('pages/admin-')))
  assert(app.pages.includes('pages/agent-chat/index'), 'release must contain the Agent page')
  assert(app.pages.includes('pages/assessment-analysis/index'), 'release must contain the dual analysis page')
  assert(relativeFiles.includes('services/agent.js'), 'release must contain the Phoenix Agent API client')
  assert(relativeFiles.includes('services/agent-analysis.js'), 'release must contain the dual analysis API client')
  const agentReleaseSource = [
    fs.readFileSync(path.join(output, 'services', 'agent.js'), 'utf8'),
    fs.readFileSync(path.join(output, 'services', 'agent-analysis.js'), 'utf8'),
    fs.readFileSync(path.join(output, 'pages', 'agent-chat', 'index.js'), 'utf8'),
    fs.readFileSync(path.join(output, 'pages', 'assessment-analysis', 'index.js'), 'utf8')
  ].join('\n')
  assert(!agentReleaseSource.includes('setStorageSync') && !agentReleaseSource.includes('getStorageSync'), 'release Agent client must not persist chat content')
  assert(!agentReleaseSource.includes('responses.create') && !agentReleaseSource.includes('OPENAI_API_KEY'), 'release must not contain OpenAI SDK calls or keys')
  const provenance = JSON.parse(fs.readFileSync(path.join(output, 'RELEASE_BUILD.json'), 'utf8'))
  assert.strictEqual(provenance.productVersion, RELEASE_VERSION)
  assert.strictEqual(provenance.sourcePageCount, sourceApp.pages.length)
  assert.strictEqual(provenance.releasePageCount, expectedPages.length)
  assert.strictEqual(provenance.includesPaidReportAgent, true)
  assert.strictEqual(provenance.includesDualAgentAnalysis, true)
  assert.strictEqual(provenance.includesEducationCompassV05, true)
  assert.strictEqual(provenance.artifactClass, 'STAGING_OR_RELEASE_BUILD')
  assert.strictEqual(provenance.uploadAuthorized, false)
  assert.strictEqual(provenance.externalConnectivityVerified, false)
  console.log(`✓ release size budget: ${releaseBytes}/${RELEASE_TOTAL_BUDGET_BYTES} bytes; brand+UI ${brandAndUiBytes}/${BRAND_AND_UI_BUDGET_BYTES} bytes`)
  console.log('✓ release Mini Program modules: relative requires resolve and no JSON is loaded as CommonJS')
  console.log('✓ remote release boundary: no demo generator, local DB, server source, tourist AppID or admin demo pages')
} finally {
  const resolved = path.resolve(output)
  assert(resolved.startsWith(`${path.resolve(DIST_ROOT)}${path.sep}`), 'test cleanup must stay inside dist/')
  if (fs.existsSync(resolved)) fs.rmSync(resolved, { recursive: true, force: true })
}
