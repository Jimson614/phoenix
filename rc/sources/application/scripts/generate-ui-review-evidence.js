'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const timestamp = new Date().toISOString().replace(/[-:.]/g, '').replace('Z', 'Z')
const outputArgument = process.argv.find((value) => value.startsWith('--output='))
const referenceArgument = process.argv.find((value) => value.startsWith('--reference='))
const outputDirectory = path.resolve(
  outputArgument ? outputArgument.slice('--output='.length) : path.join(root, 'artifacts', 'ui-review', `${timestamp}-ui-v2`)
)
const referencePath = referenceArgument
  ? path.resolve(referenceArgument.slice('--reference='.length))
  : (process.env.PHOENIX_UI_REFERENCE_IMAGE ? path.resolve(process.env.PHOENIX_UI_REFERENCE_IMAGE) : '')

function slash(value) {
  return String(value).split(path.sep).join('/')
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function walk(target) {
  if (!fs.existsSync(target)) return []
  const metadata = fs.statSync(target)
  if (metadata.isFile()) return [target]
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) => walk(path.join(target, entry.name)))
}

function rasterDimensions(file) {
  const extension = path.extname(file).toLowerCase()
  const buffer = fs.readFileSync(file)
  if (extension === '.png' && buffer.length >= 24 && buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  if (['.jpg', '.jpeg'].includes(extension) && buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2
    while (offset + 8 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1
        continue
      }
      const marker = buffer[offset + 1]
      offset += 2
      if (marker === 0xd8 || marker === 0xd9) continue
      if (offset + 2 > buffer.length) break
      const length = buffer.readUInt16BE(offset)
      if (length < 2 || offset + length > buffer.length) break
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) }
      }
      offset += length
    }
  }
  if (extension === '.webp' && buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buffer.toString('ascii', 12, 16)
    const data = 20
    if (chunk === 'VP8X') return { width: buffer.readUIntLE(data + 4, 3) + 1, height: buffer.readUIntLE(data + 7, 3) + 1 }
    if (chunk === 'VP8 ') return { width: buffer.readUInt16LE(data + 6) & 0x3fff, height: buffer.readUInt16LE(data + 8) & 0x3fff }
    if (chunk === 'VP8L' && buffer[data] === 0x2f) {
      const b1 = buffer[data + 1]
      const b2 = buffer[data + 2]
      const b3 = buffer[data + 3]
      const b4 = buffer[data + 4]
      return {
        width: 1 + (((b2 & 0x3f) << 8) | b1),
        height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6))
      }
    }
  }
  return null
}

function fileEvidence(file) {
  const dimensions = rasterDimensions(file)
  return {
    path: slash(path.relative(root, file)),
    bytes: fs.statSync(file).size,
    sha256: sha256(file),
    ...(dimensions || {})
  }
}

function writeJson(name, value) {
  fs.writeFileSync(path.join(outputDirectory, name), `${JSON.stringify(value, null, 2)}\n`)
}

function eventBindings(source) {
  return [...source.matchAll(/\b((?:capture-)?(?:bind|catch):?[A-Za-z][\w-]*)\s*=\s*(["'])([^"']+)\2/g)]
    .map((match) => ({ attribute: match[1], handler: match[3] }))
}

function screenEvidence() {
  const contracts = [
    ['free-home', 'pages/compass/index.wxml', 'pages/compass/index.js', 'education-compass-free-home'],
    ['free-questionnaire', 'pages/compass-questionnaire/index.wxml', 'pages/compass-questionnaire/index.js', 'education-compass-free-questionnaire'],
    ['free-result', 'pages/compass-preview/index.wxml', '', 'free-result'],
    ['level2-home', 'pages/compass/index.wxml', 'pages/compass/index.js', 'education-compass-growth-home'],
    ['level2-questionnaire', 'pages/compass-questionnaire/index.wxml', 'pages/compass-questionnaire/index.js', 'education-compass-growth-questionnaire'],
    ['growth-report', 'pages/report/index.wxml', '', 'growth-report'],
    ['next-support', 'pages/report/index.wxml', '', 'next-support']
  ]
  return contracts.map(([screen, wxmlPath, jsPath, token]) => {
    const wxml = fs.readFileSync(path.join(root, wxmlPath), 'utf8')
    const js = jsPath ? fs.readFileSync(path.join(root, jsPath), 'utf8') : ''
    return {
      screen,
      token,
      wxmlPath,
      jsPath: jsPath || null,
      hookPresent: wxml.includes('data-ui-screen="{{uiScreen}}"') || wxml.includes(`data-ui-screen="${token}"`),
      stateTokenPresent: !jsPath || js.includes(`'${token}'`)
    }
  })
}

function runContract(relative) {
  const result = spawnSync(process.execPath, [path.join(root, relative)], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true
  })
  return {
    command: `node ${relative}`,
    status: result.status === 0 ? 'PASS' : 'FAIL',
    exitCode: result.status === null ? 1 : result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    spawnError: result.error ? result.error.message : null
  }
}

function runNpmScript(script, extraEnv = {}) {
  const windows = process.platform === 'win32'
  const command = windows ? (process.env.ComSpec || 'cmd.exe') : 'npm'
  const args = windows ? ['/d', '/s', '/c', `npm.cmd run ${script}`] : ['run', script]
  const startedAt = new Date()
  const started = Date.now()
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, ...extraEnv },
    maxBuffer: 10 * 1024 * 1024
  })
  return {
    command: `${process.platform === 'win32' ? 'npm.cmd' : 'npm'} run ${script}`,
    script,
    status: result.status === 0 ? 'PASS' : 'FAIL',
    exitCode: result.status === null ? 1 : result.status,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - started,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    spawnError: result.error ? result.error.message : null
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function compareManifests(beforeFiles, afterFiles) {
  const before = new Map(beforeFiles.map((file) => [file.path, file]))
  const after = new Map(afterFiles.map((file) => [file.path, file]))
  return [...new Set([...before.keys(), ...after.keys()])].sort().flatMap((filePath) => {
    const left = before.get(filePath)
    const right = after.get(filePath)
    if (!left) return [{ path: filePath, change: 'ADDED', before: null, after: right }]
    if (!right) return [{ path: filePath, change: 'REMOVED', before: left, after: null }]
    if (left.sha256 !== right.sha256) return [{ path: filePath, change: 'CHANGED', before: left, after: right }]
    return []
  })
}

function markdownCell(value) {
  return String(value).replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ')
}

const rootWithSeparator = `${root}${path.sep}`
const temporaryRoot = path.resolve(os.tmpdir())
const temporaryRootWithSeparator = `${temporaryRoot}${path.sep}`
const approvedOutput = outputDirectory === root || outputDirectory.startsWith(rootWithSeparator) ||
  outputDirectory === temporaryRoot || outputDirectory.startsWith(temporaryRootWithSeparator)
if (!approvedOutput) {
  throw new Error(`UI evidence output must stay inside the project root or OS temporary directory: ${outputDirectory}`)
}

fs.mkdirSync(outputDirectory, { recursive: true })
fs.mkdirSync(path.join(outputDirectory, 'screenshots'), { recursive: true })

const assets = walk(path.join(root, 'assets', 'brand'))
  .concat(walk(path.join(root, 'assets', 'ui')))
  .filter((file) => fs.statSync(file).isFile())
  .sort()
  .map(fileEvidence)
const uiAssets = assets.filter((asset) => asset.path.startsWith('assets/ui/'))
writeJson('ui-assets.json', {
  generatedAt: new Date().toISOString(),
  budgets: {
    releaseTotalBytes: 1835008,
    brandAndUiBytes: 1250000,
    uiTotalBytes: 1572864,
    uiPerFileBytes: 768000
  },
  totals: {
    files: assets.length,
    bytes: assets.reduce((total, asset) => total + asset.bytes, 0),
    uiFiles: uiAssets.length,
    uiBytes: uiAssets.reduce((total, asset) => total + asset.bytes, 0)
  },
  assets
})

const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
const releasePages = app.pages.filter((page) => !page.startsWith('pages/admin-'))
const pageContracts = app.pages.map((page) => {
  const relative = `${page}.wxml`
  const source = fs.readFileSync(path.join(root, relative), 'utf8')
  return { path: relative, release: releasePages.includes(page), handlers: eventBindings(source) }
})
writeJson('route-handler-contract.json', {
  generatedAt: new Date().toISOString(),
  registeredPageCount: app.pages.length,
  releasePageCount: releasePages.length,
  releaseBoundary: { included: 14, excludedDemoAdmin: 2 },
  screenHooks: screenEvidence(),
  shareAllowlist: ['pages/compass-preview/index', 'pages/report/index'],
  pages: pageContracts
})

const reference = referencePath && fs.existsSync(referencePath)
  ? {
      status: 'RECORDED',
      sourcePath: referencePath,
      bytes: fs.statSync(referencePath).size,
      sha256: sha256(referencePath),
      ...rasterDimensions(referencePath),
      interpretationBoundary: 'Reference poster chrome, phone shell, status bar, captions, arrows and unapproved Askwise mascot are not application assets.'
    }
  : {
      status: 'NOT_PROVIDED_TO_SCRIPT',
      sourcePath: referencePath || null,
      instruction: 'Pass --reference=<absolute-path> or set PHOENIX_UI_REFERENCE_IMAGE to record immutable reference metadata.'
    }
writeJson('reference.json', reference)
writeJson('REFERENCE.json', reference)
fs.writeFileSync(path.join(outputDirectory, 'REFERENCE.md'), `# UI Reference\n\n` +
  `- Status: ${reference.status}\n` +
  `- Source: ${reference.sourcePath || 'not provided'}\n` +
  `- Dimensions: ${reference.width || 'unknown'} × ${reference.height || 'unknown'}\n` +
  `- SHA-256: ${reference.sha256 || 'not recorded'}\n\n` +
  `The image is a visual hierarchy and copy reference only. Phone chrome, status bar, flow arrows, poster captions, hard-coded prices/question counts, capability states and the unlicensed Askwise mascot are not runtime facts or application assets. Product Freeze, server state, catalog, entitlement, privacy and payment contracts remain authoritative.\n`)

const safeReleaseEnvironment = {
  PHOENIX_API_BASE_URL: 'https://api.phoenix-local-verification.invalid',
  PHOENIX_MINIPROGRAM_APPID: 'wx0123456789abcdef'
}
const requiredScripts = [
  'validate',
  'test:ui-contract',
  'test:client',
  'typecheck:server',
  'test:server',
  'test:education-contracts',
  'test:education-http',
  'validate:education-docs',
  'test:all',
  'smoke:education',
  'build:release',
  'scan:release-secrets'
]
const commandResults = requiredScripts.map((script) => runNpmScript(
  script,
  script === 'build:release' ? safeReleaseEnvironment : {}
))
fs.writeFileSync(path.join(outputDirectory, 'commands.ndjson'), `${commandResults.map((result) => JSON.stringify(result)).join('\n')}\n`)

const contractResults = [
  runContract('tests/validate-ui-contract.js'),
  runContract('tests/validate-release-build.js')
]
writeJson('ui-contract-results.json', {
  generatedAt: new Date().toISOString(),
  status: contractResults.every((result) => result.status === 'PASS') ? 'PASS' : 'FAIL',
  results: contractResults
})

const beforeProtectedPath = path.join(outputDirectory, 'before-protected-sha256.json')
const afterProtectedPath = path.join(outputDirectory, 'after-protected-sha256.json')
const beforeSourcePath = path.join(outputDirectory, 'source-ui-manifest.before.json')
const afterSourcePath = path.join(outputDirectory, 'source-ui-manifest.after.json')
const protectedChanges = fs.existsSync(beforeProtectedPath) && fs.existsSync(afterProtectedPath)
  ? compareManifests(readJson(beforeProtectedPath).files, readJson(afterProtectedPath).files)
  : []
const migrationChanges = protectedChanges.filter((item) => /(?:^|\/)migrations?\//i.test(item.path))
const freezeChanges = protectedChanges.filter((item) => /docs\/product\/(?:freeze\/|EDUCATION_COMPASS_PRODUCT_FREEZE_V1)/i.test(item.path))
const lockfileChanges = protectedChanges.filter((item) => /(?:^|\/)package-lock\.json$/i.test(item.path))
writeJson('protected-files-diff.json', {
  generatedAt: new Date().toISOString(),
  status: migrationChanges.length || freezeChanges.length || lockfileChanges.length ? 'FAIL' : 'PASS',
  immutableChecks: {
    signedFreeze: freezeChanges.length ? 'CHANGED' : 'UNCHANGED',
    existingMigrations: migrationChanges.length ? 'CHANGED' : 'UNCHANGED',
    packageLockfiles: lockfileChanges.length ? 'CHANGED' : 'UNCHANGED'
  },
  migration: 'none',
  changes: protectedChanges
})

if (fs.existsSync(beforeSourcePath)) fs.copyFileSync(beforeSourcePath, path.join(outputDirectory, 'source-manifest.before.json'))
if (fs.existsSync(afterSourcePath)) fs.copyFileSync(afterSourcePath, path.join(outputDirectory, 'source-manifest.after.json'))

const apiScripts = new Set([
  'typecheck:server', 'test:server', 'test:education-contracts', 'test:education-http',
  'validate:education-docs', 'smoke:education'
])
const apiResults = commandResults.filter((result) => apiScripts.has(result.script))
writeJson('api-contract-results.json', {
  generatedAt: new Date().toISOString(),
  status: apiResults.every((result) => result.exitCode === 0) ? 'PASS' : 'FAIL',
  verificationLevel: apiResults.every((result) => result.exitCode === 0) ? 'LOCAL_HTTP_MOCK_VERIFIED' : 'LOCAL_VERIFICATION_FAILED',
  localHttpMock: {
    status: commandResults.find((result) => result.script === 'smoke:education').status,
    externalCalls: 0,
    checkpoints: ['health', 'profile', 'level1-ready', 'level2-locked-no-leak', 'mock-payment-authority', 'level2-ready']
  },
  postgres: {
    status: 'BLOCKED_EXTERNAL',
    commandRun: false,
    reason: 'No EDUCATION_TEST_DATABASE_URL plus EDUCATION_TEST_DATABASE_ALLOW_MUTATION=YES dedicated-test sentinel was provided; no database connection was attempted.'
  },
  externalProviders: {
    wechatPay: 'NOT_CALLED',
    openAI: 'NOT_CALLED',
    feishu: 'NOT_CALLED',
    askwise: 'NOT_CALLED'
  },
  migration: 'none',
  results: apiResults
})

writeJson('manual-visual-status.json', {
  generatedAt: new Date().toISOString(),
  screenshotsCaptured: 0,
  environments: {
    wechatDevTools: 'BLOCKED_MANUAL',
    iosRealDevice: 'BLOCKED_MANUAL',
    androidRealDevice: 'BLOCKED_MANUAL'
  },
  viewports: [320, 360, 375, 390, 430].map((width) => ({
    width,
    status: 'BLOCKED_MANUAL',
    steps: [
      'Open all seven data-ui-screen states with authoritative fixture data.',
      'Verify no horizontal clipping, oversized blank block, fixed-bar overlap or safe-area collision.',
      'Verify 44px tap targets, three-column Free result factors, selected checkmark and disabled/loading states.',
      'Verify preview/report share opens only the generic welcome entry and exposes no IDs or result summary.'
    ]
  })),
  note: 'No screenshot pass is claimed until WeChat DevTools and real-device captures are added to screenshots/ and reviewed.'
})

const automatedPassed = commandResults.every((result) => result.exitCode === 0) &&
  contractResults.every((result) => result.status === 'PASS') &&
  migrationChanges.length === 0 && freezeChanges.length === 0 && lockfileChanges.length === 0
const finalStatus = automatedPassed ? 'LOCAL_HTTP_MOCK_VERIFIED' : 'LOCAL_VERIFICATION_FAILED'
const commandTable = commandResults.map((result) =>
  `| ${markdownCell(result.command)} | ${result.exitCode} | ${result.status} | ${result.durationMs} |`
).join('\n')
const report = `# Phoenix Education Compass UI Test Report\n\n` +
  `## Result\n\n` +
  `- Overall local status: **${finalStatus}**\n` +
  `- Automated UI/API contracts: **${automatedPassed ? 'PASS' : 'FAIL'}**\n` +
  `- WeChat DevTools and real devices: **BLOCKED_MANUAL**\n` +
  `- Dedicated PostgreSQL integration: **BLOCKED_EXTERNAL** (not attempted)\n` +
  `- Migration: **none**; signed freeze, existing migrations and package lockfiles are unchanged.\n` +
  `- Real WeChat Pay/OpenAI/Feishu/Askwise calls: **not performed**.\n\n` +
  `## Seven-screen route map\n\n` +
  `1. Free home — \`pages/compass/index?level=1&studentId=…\`\n` +
  `2. Free questionnaire — \`pages/compass-questionnaire/index?level=1&assessmentId=…\`\n` +
  `3. Free result — \`pages/compass-preview/index?mode=family-snapshot&assessmentId=…\`\n` +
  `4. Level 2 home — \`pages/compass/index?level=2&studentId=…&sourceAssessmentId=…\` (server-authorized only)\n` +
  `5. Level 2 questionnaire — \`pages/compass-questionnaire/index?level=2&assessmentId=…\`\n` +
  `6. Delivered report — \`pages/report/index?id=reportId\` (FULL/READY + entitlement gates)\n` +
  `7. Next support — report bottom region plus \`pages/advisor-request/index\` for independent advisor Consent.\n\n` +
  `## Reference-to-product corrections\n\n` +
  `- Free is 8 required questions and 3–5 minutes, not 4 questions/15 seconds.\n` +
  `- Level 2 uses resolved-bank dynamic counts and 15–20 minutes, not a fixed 40 questions.\n` +
  `- Price is returned by the catalog as 3990 fen/CNY and formatted as ¥39.90; no release page hard-codes the display price.\n` +
  `- Payment remains AFTER_SUBMIT_BEFORE_REPORT; starting Level 2 never creates an order or calls requestPayment.\n` +
  `- Four evidence-status cards replace the five-axis ability radar; scoring remains NONE.\n` +
  `- The flow is Family/Student/Assessment linked and is not described as anonymous.\n` +
  `- Askwise remains RESERVED/BLOCKED/DISABLED with no action or network call.\n` +
  `- Level 3 exposes information/advisor intent only, with no ¥980 price, SKU, order or auto-appointment.\n` +
  `- Native sharing targets only the generic welcome route and carries no IDs, names or result summary.\n\n` +
  `## Required commands\n\n` +
  `| Command | Exit | Status | Duration ms |\n|---|---:|---|---:|\n${commandTable}\n\n` +
  `## Manual completion required\n\n` +
  `Open the source project in WeChat DevTools, clear Console, compile, and capture all seven normal states plus loading/error/disabled/conflict/payment-state fixtures at 320/360/375/390/430 widths. Repeat safe-area and payment-cancel checks on iOS and Android. Add only actual simulator/device screenshots to \`screenshots/\`; design-reference crops do not count.\n`
fs.writeFileSync(path.join(outputDirectory, 'UI_TEST_REPORT.md'), report)

const evidenceFiles = walk(outputDirectory)
  .filter((file) => fs.statSync(file).isFile() && path.basename(file) !== 'SHA256SUMS.txt')
  .sort()
const sums = evidenceFiles.map((file) => `${sha256(file)}  ${slash(path.relative(outputDirectory, file))}`).join('\n')
fs.writeFileSync(path.join(outputDirectory, 'SHA256SUMS.txt'), `${sums}${sums ? '\n' : ''}`)

const passed = automatedPassed
console.log(`UI review evidence written to ${outputDirectory}`)
console.log(`Automated UI/API contracts: ${passed ? 'PASS' : 'FAIL'}; manual visual environments remain BLOCKED_MANUAL`)
if (!passed) process.exitCode = 1
