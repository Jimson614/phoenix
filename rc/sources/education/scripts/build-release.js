const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')

const SOURCE_ROOT = path.resolve(__dirname, '..')
const DIST_ROOT = path.join(SOURCE_ROOT, 'dist')
const RELEASE_VERSION = '0.5.0'
const ROOT_FILES = ['app.js', 'app.json', 'app.wxss', 'project.config.json', 'sitemap.json']
const ROOT_DIRECTORIES = ['assets', 'components', 'config', 'models', 'pages', 'services', 'utils']
const FORBIDDEN_ARTIFACT_SEGMENTS = new Set(['.git', '.next', 'node_modules', 'server'])
const PRIVATE_ARTIFACT_FILE = /(?:^|\/)(?:project\.private\.config\.json|\.env(?:\.[^/]*)?|id_(?:ed25519|rsa)|[^/]+\.(?:jks|key|keystore|p12|p8|pem|pfx|ppk))$/i
const NEXT_GENERATED_BASENAMES = new Set([
  'BUILD_ID',
  '_buildManifest.js',
  '_ssgManifest.js',
  'app-build-manifest.json',
  'app-paths-manifest.json',
  'build-manifest.json',
  'fallback-build-manifest.json',
  'font-manifest.json',
  'functions-config-manifest.json',
  'images-manifest.json',
  'interception-route-rewrite-manifest.js',
  'middleware-build-manifest.js',
  'middleware-manifest.json',
  'middleware-react-loadable-manifest.js',
  'next-font-manifest.js',
  'next-font-manifest.json',
  'pages-manifest.json',
  'prerender-manifest.json',
  'react-loadable-manifest.json',
  'required-server-files.json',
  'routes-manifest.json',
  'server-functions-manifest.json',
  'server-reference-manifest.js',
  'server-reference-manifest.json'
].map((name) => name.toLowerCase()))
const TRANSIENT_RENAME_ERRORS = new Set(['EACCES', 'EBUSY', 'ENOTEMPTY', 'EPERM'])
const EXCLUDED = new Set([
  'models/schema.js',
  'pages/admin-families',
  'pages/admin-family',
  'services/ai-provider.js',
  'services/demo-runtime.js',
  'services/insight.js',
  'services/repository.js',
  'services/store.js'
])

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function isNextGeneratedFile(relative) {
  const basename = path.posix.basename(relative).toLowerCase()
  return NEXT_GENERATED_BASENAMES.has(basename) || basename.endsWith('_client-reference-manifest.js')
}

function assertArtifactEntryType(outputDirectory, name, expectedType) {
  const target = path.join(outputDirectory, name)
  const stats = fs.lstatSync(target)
  invariant(!stats.isSymbolicLink(), `Mini Program artifact must not contain symbolic links: ${name}`)
  invariant(expectedType === 'directory' ? stats.isDirectory() : stats.isFile(),
    `Mini Program artifact top-level ${name} must be a ${expectedType}`)
}

function waitForRenameRetry(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

function renameDirectoryWithRetry(source, destination, operations = {}) {
  const renameSync = operations.renameSync || fs.renameSync
  const wait = operations.wait || waitForRenameRetry
  const attempts = operations.renameAttempts || 4
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      renameSync(source, destination)
      return
    } catch (error) {
      lastError = error
      if (!TRANSIENT_RENAME_ERRORS.has(error && error.code) || attempt === attempts) throw error
      wait(25 * (2 ** (attempt - 1)))
    }
  }
  throw lastError
}

function normalizeArtifactProjectConfig(projectConfig) {
  delete projectConfig.miniprogramRoot
  delete projectConfig.srcMiniprogramRoot
  delete projectConfig.watchOptions
  return projectConfig
}

function relativeName(value) {
  return value.split(path.sep).join('/')
}

function isExcluded(relative) {
  return [...EXCLUDED].some((entry) => relative === entry || relative.startsWith(`${entry}/`))
}

function copyTree(source, destination, relative) {
  if (isExcluded(relativeName(relative))) return
  const stats = fs.lstatSync(source)
  invariant(!stats.isSymbolicLink(), `release source must not contain symbolic links: ${relativeName(relative)}`)
  if (stats.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true })
    for (const name of fs.readdirSync(source)) copyTree(
      path.join(source, name), path.join(destination, name), path.join(relative, name)
    )
    return
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.copyFileSync(source, destination)
}

function validateMiniProgramArtifactBoundary(outputDirectory, provenanceFile) {
  const expectedTopLevel = [...ROOT_FILES, ...ROOT_DIRECTORIES, provenanceFile].sort()
  const actualTopLevel = fs.readdirSync(outputDirectory).sort()
  invariant(JSON.stringify(actualTopLevel) === JSON.stringify(expectedTopLevel),
    `Mini Program artifact has unexpected top-level entries: ${actualTopLevel.join(', ')}`)

  for (const name of [...ROOT_FILES, provenanceFile]) {
    assertArtifactEntryType(outputDirectory, name, 'file')
  }
  for (const name of ROOT_DIRECTORIES) {
    assertArtifactEntryType(outputDirectory, name, 'directory')
  }

  const pending = [outputDirectory]
  while (pending.length > 0) {
    const current = pending.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name)
      const relative = relativeName(path.relative(outputDirectory, target))
      const stats = fs.lstatSync(target)
      invariant(!stats.isSymbolicLink(), `Mini Program artifact must not contain symbolic links: ${relative}`)
      invariant(stats.isDirectory() || stats.isFile(),
        `Mini Program artifact contains an unsupported filesystem entry: ${relative}`)
      const segments = relative.toLowerCase().split('/')
      invariant(!segments.some((segment) => FORBIDDEN_ARTIFACT_SEGMENTS.has(segment)),
        `Mini Program artifact contains a forbidden directory: ${relative}`)
      invariant(!PRIVATE_ARTIFACT_FILE.test(relative),
        `Mini Program artifact contains a private or key file: ${relative}`)
      invariant(!isNextGeneratedFile(relative),
        `Mini Program artifact contains Next.js output: ${relative}`)
      if (entry.isDirectory()) pending.push(target)
    }
  }
}

function validateApiBaseUrl(value) {
  invariant(value === value.trim(), 'PHOENIX_API_BASE_URL must not contain surrounding whitespace')
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('PHOENIX_API_BASE_URL must be a valid HTTPS URL')
  }
  invariant(parsed.protocol === 'https:', 'PHOENIX_API_BASE_URL must be an HTTPS URL')
  invariant(!parsed.username && !parsed.password,
    'PHOENIX_API_BASE_URL must not contain embedded credentials')
  invariant(!parsed.search && !parsed.hash,
    'PHOENIX_API_BASE_URL must not contain a query string or fragment')
  return parsed
}

function canonicalWritePath(target) {
  const missing = []
  let existing = target
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing)
    if (parent === existing) break
    missing.unshift(path.basename(existing))
    existing = parent
  }
  return path.resolve(fs.realpathSync(existing), ...missing)
}

function isStrictDescendant(target, parent) {
  const relation = path.relative(parent, target)
  return Boolean(relation) && relation !== '..' && !relation.startsWith(`..${path.sep}`) && !path.isAbsolute(relation)
}

function validateReleaseOutput(outputDirectory, distRoot = DIST_ROOT, sourceRoot = SOURCE_ROOT) {
  const canonicalSourceRoot = fs.realpathSync(sourceRoot)
  if (fs.existsSync(distRoot)) {
    invariant(!fs.lstatSync(distRoot).isSymbolicLink(), 'release dist root must not be a symbolic link')
  }
  const canonicalDistRoot = canonicalWritePath(distRoot)
  invariant(isStrictDescendant(canonicalDistRoot, canonicalSourceRoot),
    'release dist root must stay inside the source root')
  const canonicalOutputDirectory = canonicalWritePath(outputDirectory)
  invariant(isStrictDescendant(canonicalOutputDirectory, canonicalDistRoot),
    'release output must stay inside dist/')
}

function ownedSiblingPrefix(outputDirectory, purpose) {
  return `.${path.basename(outputDirectory)}.${purpose}-`
}

function validateOwnedSibling(candidate, outputDirectory, purpose) {
  validateReleaseOutput(candidate)
  invariant(path.dirname(path.resolve(candidate)) === path.dirname(path.resolve(outputDirectory)),
    `artifact ${purpose} directory must be a sibling of the final output`)
  invariant(path.basename(candidate).startsWith(ownedSiblingPrefix(outputDirectory, purpose)),
    `artifact ${purpose} directory has an unexpected name`)
}

function validateRemovableTree(directory, purpose) {
  const pending = [directory]
  while (pending.length > 0) {
    const current = pending.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name)
      const stats = fs.lstatSync(target)
      invariant(!stats.isSymbolicLink(),
        `refusing to recursively remove an artifact ${purpose} tree containing symbolic links`)
      invariant(stats.isDirectory() || stats.isFile(),
        `refusing to recursively remove an artifact ${purpose} tree containing special files`)
      if (stats.isDirectory()) pending.push(target)
    }
  }
}

function removeOwnedDirectory(candidate, outputDirectory, purpose) {
  validateOwnedSibling(candidate, outputDirectory, purpose)
  if (!fs.existsSync(candidate)) return
  const stats = fs.lstatSync(candidate)
  invariant(!stats.isSymbolicLink() && stats.isDirectory(),
    `refusing to recursively remove an unsafe artifact ${purpose} path`)
  validateRemovableTree(candidate, purpose)
  fs.rmSync(candidate, { recursive: true, force: false, maxRetries: 4, retryDelay: 50 })
}

function buildArtifactAtomically(outputDirectory, populateStaging, operations = {}) {
  invariant(typeof populateStaging === 'function', 'artifact staging writer must be a function')
  const finalDirectory = path.resolve(outputDirectory)
  validateReleaseOutput(finalDirectory)
  const parentDirectory = path.dirname(finalDirectory)
  fs.mkdirSync(parentDirectory, { recursive: true })
  validateReleaseOutput(finalDirectory)

  if (fs.existsSync(finalDirectory)) {
    const stats = fs.lstatSync(finalDirectory)
    invariant(!stats.isSymbolicLink() && stats.isDirectory(),
      'artifact final output must be a real directory')
  }

  const stagingDirectory = fs.mkdtempSync(path.join(
    parentDirectory, ownedSiblingPrefix(finalDirectory, 'staging')
  ))
  const backupDirectory = path.join(
    parentDirectory, `${ownedSiblingPrefix(finalDirectory, 'backup')}${randomUUID()}`
  )
  validateOwnedSibling(stagingDirectory, finalDirectory, 'staging')
  validateOwnedSibling(backupDirectory, finalDirectory, 'backup')
  invariant(!fs.existsSync(backupDirectory), 'artifact backup path must not already exist')

  let previousMoved = false
  let installed = false
  try {
    populateStaging(stagingDirectory)
    const stagedStats = fs.lstatSync(stagingDirectory)
    invariant(!stagedStats.isSymbolicLink() && stagedStats.isDirectory(),
      'artifact staging output must remain a real directory')

    if (fs.existsSync(finalDirectory)) {
      try {
        renameDirectoryWithRetry(finalDirectory, backupDirectory, operations)
        previousMoved = true
      } catch (error) {
        if (!fs.existsSync(finalDirectory) && fs.existsSync(backupDirectory)) previousMoved = true
        else throw error
      }
    }

    try {
      renameDirectoryWithRetry(stagingDirectory, finalDirectory, operations)
      installed = true
    } catch (error) {
      if (!fs.existsSync(stagingDirectory) && fs.existsSync(finalDirectory)) installed = true
      else throw error
    }

    if (previousMoved) {
      removeOwnedDirectory(backupDirectory, finalDirectory, 'backup')
      previousMoved = false
    }
    return finalDirectory
  } catch (error) {
    const recoveryErrors = []
    if (!installed && previousMoved) {
      if (!fs.existsSync(finalDirectory) && fs.existsSync(backupDirectory)) {
        try {
          renameDirectoryWithRetry(backupDirectory, finalDirectory, operations)
          previousMoved = false
        } catch (restoreError) {
          recoveryErrors.push(restoreError)
        }
      } else {
        recoveryErrors.push(new Error('artifact backup could not be restored without overwriting another path'))
      }
    }
    if (fs.existsSync(stagingDirectory)) {
      try {
        removeOwnedDirectory(stagingDirectory, finalDirectory, 'staging')
      } catch (cleanupError) {
        recoveryErrors.push(cleanupError)
      }
    }
    if (recoveryErrors.length > 0) {
      throw new AggregateError([error, ...recoveryErrors],
        `artifact publish failed; recovery requires inspection of ${backupDirectory}`)
    }
    throw error
  }
}

function releaseRuntime(apiBaseUrl) {
  return `// Generated by scripts/build-release.js. Do not hand-edit.\nconst API_BASE_URL = ${JSON.stringify(apiBaseUrl)}\n\nfunction accountEnvironment() { return 'release' }\nfunction allowsDevelopmentLoopbackHttp() { return false }\nfunction mode() { return 'remote' }\nfunction apiBaseUrl() { return API_BASE_URL.replace(/\\\/$/, '') }\n\nmodule.exports = { API_BASE_URL, accountEnvironment, allowsDevelopmentLoopbackHttp, apiBaseUrl, mode, isDemo: () => false }\n`
}

function buildRelease(options = {}) {
  const configuredApiBaseUrl = options.apiBaseUrl || process.env.PHOENIX_API_BASE_URL || ''
  const configuredAppid = options.appid || process.env.PHOENIX_MINIPROGRAM_APPID || ''
  const offlineTest = !configuredApiBaseUrl && !configuredAppid
  invariant(offlineTest || Boolean(configuredApiBaseUrl && configuredAppid),
    'PHOENIX_API_BASE_URL and PHOENIX_MINIPROGRAM_APPID must be supplied together')
  const apiBaseUrl = offlineTest ? 'https://education-compass-offline-test.invalid' : configuredApiBaseUrl
  const appid = offlineTest ? 'touristappid' : configuredAppid
  const outputDirectory = path.resolve(options.outputDirectory || path.join(DIST_ROOT, offlineTest ? 'offline-test' : 'release'))

  const parsedApiBaseUrl = validateApiBaseUrl(apiBaseUrl)
  invariant(offlineTest || /^wx[0-9a-fA-F]{16}$/.test(appid),
    'PHOENIX_MINIPROGRAM_APPID must be a non-tourist WeChat Mini Program AppID')
  validateReleaseOutput(outputDirectory)

  return buildArtifactAtomically(outputDirectory, (stagingDirectory) => {
    for (const name of ROOT_FILES) copyTree(
      path.join(SOURCE_ROOT, name), path.join(stagingDirectory, name), name
    )
    for (const name of ROOT_DIRECTORIES) copyTree(
      path.join(SOURCE_ROOT, name), path.join(stagingDirectory, name), name
    )

    const appConfigPath = path.join(stagingDirectory, 'app.json')
    const appConfig = JSON.parse(fs.readFileSync(appConfigPath, 'utf8'))
    const sourcePageCount = appConfig.pages.length
    appConfig.pages = appConfig.pages.filter((page) => !page.startsWith('pages/admin-'))
    invariant(appConfig.pages.includes('pages/agent-chat/index'), 'release must include the paid-report Agent page')
    invariant(appConfig.pages.includes('pages/assessment-analysis/index'), 'release must include the dual analysis result page')
    invariant(appConfig.pages.includes('pages/compass/index'), 'release must include the Education Compass entry page')
    invariant(appConfig.pages.includes('pages/compass-questionnaire/index'), 'release must include the resumable Education Compass questionnaire')
    invariant(appConfig.pages.includes('pages/compass-preview/index'), 'release must include the locked Education Compass result page')
    fs.writeFileSync(appConfigPath, `${JSON.stringify(appConfig, null, 2)}\n`)

    const projectConfigPath = path.join(stagingDirectory, 'project.config.json')
    const projectConfig = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'))
    normalizeArtifactProjectConfig(projectConfig)
    projectConfig.appid = appid
    projectConfig.description = offlineTest
      ? `OFFLINE TEST ONLY - Phoenix Family OS V${RELEASE_VERSION}; not authorized for upload or release`
      : `Phoenix Family OS V${RELEASE_VERSION} paid Compass Agent remote release`
    projectConfig.projectname = offlineTest
      ? `Phoenix-Family-OS-V${RELEASE_VERSION}-Offline-Test-Only`
      : `Phoenix-Family-OS-V${RELEASE_VERSION}-Release`
    projectConfig.packOptions = { ignore: [], include: [] }
    projectConfig.setting = { ...projectConfig.setting, urlCheck: true }
    fs.writeFileSync(projectConfigPath, `${JSON.stringify(projectConfig, null, 2)}\n`)

    fs.writeFileSync(path.join(stagingDirectory, 'config', 'runtime.js'), releaseRuntime(apiBaseUrl))
    fs.writeFileSync(path.join(stagingDirectory, 'services', 'demo-runtime.js'),
      "// Remote release: local database and demo report generation are intentionally absent.\nmodule.exports = { repository: Object.freeze({}), aiProvider: Object.freeze({}) }\n")
    fs.writeFileSync(path.join(stagingDirectory, 'RELEASE_BUILD.json'), `${JSON.stringify({
      schemaVersion: 3,
      productVersion: RELEASE_VERSION,
      generatedAt: new Date().toISOString(),
      runtimeMode: 'remote',
      artifactClass: offlineTest ? 'OFFLINE_TEST_ONLY' : 'STAGING_OR_RELEASE_BUILD',
      uploadAuthorized: false,
      externalConnectivityVerified: false,
      appid,
      apiOrigin: parsedApiBaseUrl.origin,
      sourcePageCount,
      releasePageCount: appConfig.pages.length,
      includesPaidReportAgent: true,
      includesDualAgentAnalysis: true,
      includesEducationCompassV05: true,
      excludesLocalDatabase: true,
      excludesDemoReportGenerator: true,
      excludesServerSource: true,
      excludesOpenAiSdkAndServerPrompt: true
    }, null, 2)}\n`)

    validateMiniProgramArtifactBoundary(stagingDirectory, 'RELEASE_BUILD.json')
  })
}

if (require.main === module) {
  const output = buildRelease()
  const provenance = JSON.parse(fs.readFileSync(path.join(output, 'RELEASE_BUILD.json'), 'utf8'))
  console.log(`${provenance.artifactClass} build created: ${output}`)
}

module.exports = {
  buildArtifactAtomically, buildRelease, canonicalWritePath, copyTree, DIST_ROOT, EXCLUDED,
  isStrictDescendant, normalizeArtifactProjectConfig, RELEASE_VERSION, validateApiBaseUrl,
  validateMiniProgramArtifactBoundary, validateReleaseOutput
}
