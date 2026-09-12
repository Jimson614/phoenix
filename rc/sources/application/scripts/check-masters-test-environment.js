'use strict'

// This is a read-only preflight.  It deliberately does not load dotenv files,
// open a database connection, call WeChat, or write a marker file.  Presence
// and syntax are useful for handoff, but they are never end-to-end evidence.

const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const TEST_DATABASE_SENTINEL = /(^|[-_])(test|testing|ci|sandbox)([-_]|$)/i
const DEFAULT_SESSION_SECRET = 'development-only-session-secret-32-bytes'

function value(env, key) {
  return typeof env[key] === 'string' ? env[key].trim() : ''
}

function check(name, present, reason) {
  return {
    name,
    status: present ? 'CONFIG_PRESENT' : 'BLOCKED_EXTERNAL',
    reason
  }
}

function sourceRootFrom(start) {
  let current = path.resolve(start)
  while (!fs.existsSync(path.join(current, '.git')) && path.dirname(current) !== current) {
    current = path.dirname(current)
  }
  return current
}

function isInside(candidate, root) {
  // path.relative() returns an absolute path when Windows drives differ.  A
  // private root on another drive is outside the source root, not inside it.
  if (path.parse(candidate).root.toLowerCase() !== path.parse(root).root.toLowerCase()) return false
  const relative = path.relative(root, candidate)
  return relative === '' || !(relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
}

function safeUrl(raw) {
  if (!raw) return null
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

function databaseDetails(raw) {
  const parsed = safeUrl(raw)
  if (!parsed || !['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname) return null
  let database
  try {
    database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
  } catch {
    return null
  }
  if (!database) return null
  return {
    protocol: parsed.protocol,
    hostname: parsed.hostname.toLowerCase(),
    port: parsed.port || (parsed.protocol === 'postgres:' ? '5432' : '5432'),
    database,
    tlsVerified: parsed.searchParams.get('sslmode') === 'verify-full'
  }
}

function validTestDatabase(raw) {
  const details = databaseDetails(raw)
  return Boolean(details && details.tlsVerified && TEST_DATABASE_SENTINEL.test(details.database))
}

function validHttpsOrigin(raw) {
  const parsed = safeUrl(raw)
  return Boolean(parsed && parsed.protocol === 'https:' && parsed.hostname &&
    !parsed.username && !parsed.password && !parsed.search && !parsed.hash && parsed.pathname === '/')
}

function validAppId(raw) {
  return /^wx[0-9a-fA-F]{16}$/.test(raw)
}

function existingDirectoryOutsideSource(raw, sourceRoot) {
  if (!raw || !path.isAbsolute(raw)) return false
  try {
    const resolved = fs.realpathSync.native(raw)
    return fs.statSync(resolved).isDirectory() && !isInside(resolved, sourceRoot)
  } catch {
    return false
  }
}

function existingFileOutsideSource(raw, sourceRoot) {
  if (!raw || !path.isAbsolute(raw)) return false
  try {
    const resolved = fs.realpathSync.native(raw)
    return fs.statSync(resolved).isFile() && !isInside(resolved, sourceRoot)
  } catch {
    return false
  }
}

function projectConfiguration(root) {
  try {
    const raw = fs.readFileSync(path.join(root, 'project.config.json'), 'utf8')
    const config = JSON.parse(raw)
    return {
      appIdShape: validAppId(typeof config.appid === 'string' ? config.appid : ''),
      urlCheck: config.setting && config.setting.urlCheck === true
    }
  } catch {
    return { appIdShape: false, urlCheck: false }
  }
}

function collectChecks(env = process.env, options = {}) {
  const root = options.projectRoot ? path.resolve(options.projectRoot) : projectRoot
  const sourceRoot = sourceRootFrom(root)
  const nodeEnv = value(env, 'NODE_ENV')
  const intake = value(env, 'MASTERS_INTAKE_ENABLED')
  const worker = value(env, 'MASTERS_WORKER_ENABLED')
  const ai = value(env, 'MASTERS_AI_ENABLED')
  const runtimeDatabase = databaseDetails(value(env, 'DATABASE_URL'))
  const project = projectConfiguration(root)
  const checks = []

  checks.push(check(
    'NODE_ENV=test',
    nodeEnv === 'test',
    nodeEnv === 'test' ? '隔离测试运行模式已显式设置；值不输出' : '目标主机联调需显式设置 NODE_ENV=test；自动化测试由隔离 runner 自行配置'
  ))
  checks.push(check(
    'MASTERS_INTAKE_ENABLED=true',
    intake === 'true' && nodeEnv === 'test',
    intake === 'true' && nodeEnv === 'test'
      ? '硕士咨询仅在隔离测试环境开启；值不输出'
      : '需要在隔离测试环境显式开启；生产环境拒绝 P0'
  ))
  checks.push(check(
    'MASTERS_WORKER_ENABLED=true',
    worker === 'true' && intake === 'true' && nodeEnv === 'test',
    '完整流程需要独立 worker；请在隔离测试环境开启，值不输出'
  ))
  checks.push(check(
    'MASTERS_AI_ENABLED=false',
    ai === '' || ai === 'false',
    ai === '' || ai === 'false' ? '外部 AI 保持关闭（缺省也关闭）' : '外部 AI 未获批准，必须保持关闭'
  ))

  checks.push(check(
    'MASTERS_TEST_DATABASE_URL',
    validTestDatabase(value(env, 'MASTERS_TEST_DATABASE_URL')),
    validTestDatabase(value(env, 'MASTERS_TEST_DATABASE_URL'))
      ? '专用数据库连接串格式、测试库命名标记和 sslmode=verify-full 已检查；连接串不输出'
      : '自动化临时库由 Codex 生成并注入；目标主机库由 Jimson 配置；均需测试库标记和 sslmode=verify-full'
  ))
  checks.push(check(
    'MASTERS_TEST_DATABASE_ALLOW_MUTATION=YES',
    value(env, 'MASTERS_TEST_DATABASE_ALLOW_MUTATION') === 'YES',
    '只有确认隔离测试库后才注入变更哨兵；自动化临时库由 Codex 自行配置，值不输出'
  ))
  const migration = safeUrl(value(env, 'MASTERS_TEST_DATABASE_URL'))
  const application = safeUrl(value(env, 'MASTERS_TEST_APP_DATABASE_URL'))
  checks.push(check(
    'MASTERS_TEST_APP_DATABASE_URL (DML role)',
    Boolean(migration && application && validTestDatabase(application.href) && migration.host === application.host && migration.pathname === application.pathname && migration.username !== application.username),
    '自动 HTTP 专项使用同一测试库的独立 DML 账号；这里只核对形状，真实权限由 PostgreSQL 专项断言，连接串不输出'
  ))
  checks.push(check(
    'DATABASE_URL (HTTP runtime)',
    Boolean(runtimeDatabase && runtimeDatabase.tlsVerified && TEST_DATABASE_SENTINEL.test(runtimeDatabase.database)),
    '人工联调 HTTP 服务必须指向专用测试 PostgreSQL；自动 HTTP 使用 MASTERS_TEST_APP_DATABASE_URL 的隔离 schema；连接串不输出'
  ))
  checks.push(check(
    'HTTP/test database isolation',
    validTestDatabase(value(env, 'MASTERS_TEST_DATABASE_URL')) && validTestDatabase(value(env, 'DATABASE_URL')),
    '两类连接均需专用测试库标记和 TLS；资源对应关系、schema 和最小权限仍由 Jimson 核对，连接信息不输出'
  ))
  checks.push(check(
    'EDUCATION_TEST_DATABASE_URL (legacy baseline)',
    validTestDatabase(value(env, 'EDUCATION_TEST_DATABASE_URL')),
    '既有 Education PostgreSQL 回归若要执行，需要另一个明确隔离的测试库连接串；不输出连接串'
  ))
  checks.push(check(
    'EDUCATION_TEST_DATABASE_ALLOW_MUTATION=YES',
    value(env, 'EDUCATION_TEST_DATABASE_ALLOW_MUTATION') === 'YES',
    '既有迁移回归只接受专用库变更哨兵；Actions 临时库由 Codex 自行生成，值不输出'
  ))
  const sessionSecret = value(env, 'SESSION_SECRET')
  checks.push(check(
    'SESSION_SECRET',
    Buffer.byteLength(sessionSecret, 'utf8') >= 32 && sessionSecret !== DEFAULT_SESSION_SECRET,
    '目标主机会话密钥由秘密管理器注入；自动化临时密钥由测试进程生成；这里只检查长度，不输出密钥'
  ))

  checks.push(check(
    'MASTERS_PRIVATE_STORAGE_DIR',
    existingDirectoryOutsideSource(value(env, 'MASTERS_PRIVATE_STORAGE_DIR'), sourceRoot),
    '私有原件目录必须已存在、为目录且位于源码、.git、静态资源和 dist 之外；绝对路径不输出'
  ))
  const retentionRaw = value(env, 'MASTERS_RETENTION_DAYS')
  const retention = retentionRaw === '' ? 30 : Number(retentionRaw)
  checks.push(check(
    'MASTERS_RETENTION_DAYS',
    Number.isInteger(retention) && retention >= 1 && retention <= 90,
    Number.isInteger(retention) && retention >= 1 && retention <= 90
      ? `保留天数格式有效（${retentionRaw === '' ? '缺省 30' : '显式值'}）；实际清理仍需外部证据`
      : '保留天数必须为 1–90 的整数'
  ))
  checks.push(check(
    'MASTERS_PDF_FONT_PATH',
    existingFileOutsideSource(value(env, 'MASTERS_PDF_FONT_PATH'), sourceRoot),
    'PDF 导出字体需由 Jimson 在目标主机安全提供、位于源码之外并有授权依据；绝对路径不输出'
  ))
  const developmentStore = value(env, 'MASTERS_DEVELOPMENT_STORE_PATH')
  checks.push(check(
    'MASTERS_DEVELOPMENT_STORE_PATH (FileStore fallback)',
    !developmentStore,
    !developmentStore
      ? '未显式配置 FileStore；仍需上面的 PostgreSQL 连接及实际 HTTP 证据，本项不能证明选用数据库'
      : 'PostgreSQL 联调环境需取消开发 FileStore 路径；本地 FileStore 结果不能作为 PostgreSQL 验收证据'
  ))

  const appId = value(env, 'WECHAT_APP_ID')
  checks.push(check(
    'WECHAT_APP_ID',
    validAppId(appId),
    '服务端 code2Session 所用测试 AppID 需由 Jimson 安全提供；只检查格式，不输出 AppID'
  ))
  checks.push(check(
    'WECHAT_APP_SECRET',
    value(env, 'WECHAT_APP_SECRET').length > 0,
    '服务端 AppSecret 需由 Jimson 通过秘密管理器注入；不输出或回报密钥值'
  ))
  checks.push(check(
    'PUBLIC_BASE_URL',
    validHttpsOrigin(value(env, 'PUBLIC_BASE_URL')),
    '服务地址必须是已批准的 HTTPS origin；URL 不输出，合法域名还需微信后台实际核验'
  ))
  const buildApi = value(env, 'PHOENIX_API_BASE_URL')
  const buildAppId = value(env, 'PHOENIX_MINIPROGRAM_APPID')
  checks.push(check(
    'PHOENIX_API_BASE_URL + PHOENIX_MINIPROGRAM_APPID',
    validHttpsOrigin(buildApi) && validAppId(buildAppId),
    '原生包构建参数必须成对提供 HTTPS API origin 和测试 AppID；值不输出，离线包不算微信证据'
  ))
  checks.push(check(
    'project.config.json shape',
    project.appIdShape && project.urlCheck,
    project.appIdShape && project.urlCheck
      ? '项目文件的 AppID 形状和 urlCheck=true 已检查；这不证明它是 Jimson 提供的测试 AppID'
      : 'project.config.json 需要有效 AppID 形状并保持 urlCheck=true；文件值不输出'
  ))

  // These checks intentionally remain blocked until a person supplies
  // external evidence.  No local presence check can prove any of them.
  checks.push(check('dedicated database least-privilege evidence', false, '本项指目标主机库、schema、权限与 TLS；自动临时库证据单列在 CI，预检不连接数据库'))
  checks.push(check('database plus private-file backup/restore evidence', false, '本项指目标主机联合恢复；自动隔离恢复由 Codex 执行并在 CI 单列，目录存在不算通过'))
  checks.push(check('private storage ACL and retention evidence', false, '需要目标主机实际 ACL、静态加密、清理任务和脱敏审计证据；脚本不读取私有目录内容'))
  checks.push(check('PDF font licence and target-host evidence', false, '需要目标主机字体可用性和合法使用依据；配置存在不等于导出验收通过'))
  checks.push(check('WeChat test account, privacy approval and legal-domain evidence', false, '需要 Jimson 提供受控测试 AppID、开发/体验成员、隐私配置和 request/uploadFile/downloadFile 合法域名证据'))
  checks.push(check('real code2Session and WeChat session evidence', false, '必须使用真实微信测试会话完成 code2Session；注入 bearer、mock 或网页会话不算通过'))
  checks.push(check('WeChat DevTools evidence', false, '需要微信开发者工具实际编译和操作证据；网页浏览器工作台不等于微信'))
  checks.push(check('iOS device evidence', false, '需要 iOS 真机实际操作与脱敏证据；当前脚本不连接设备'))
  checks.push(check('Android device evidence', false, '需要 Android 真机实际操作与脱敏证据；当前脚本不连接设备'))

  const blocked = checks.filter((item) => item.status === 'BLOCKED_EXTERNAL').length
  return {
    status: 'BLOCKED_EXTERNAL',
    suite: 'masters-test-environment-preflight',
    checks,
    configPresent: checks.length - blocked,
    blockedExternal: blocked,
    databaseConnectionAttempted: false,
    remoteCallsAttempted: false,
    writesAttempted: false
  }
}

function main() {
  const result = collectChecks(process.env)
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (require.main === module) main()

module.exports = {
  collectChecks,
  databaseDetails,
  validTestDatabase,
  projectRoot
}
