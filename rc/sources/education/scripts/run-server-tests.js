'use strict'

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const serverRoot = path.join(root, 'server')

function slash(value) {
  return String(value).split(path.sep).join('/')
}

function filesUnder(directory, suffix) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Server test source must not be a symbolic link: ${absolute}`)
    if (entry.isDirectory()) return filesUnder(absolute, suffix)
    return entry.isFile() && entry.name.endsWith(suffix) ? [absolute] : []
  })
}

function isStrictDescendant(target, parent) {
  const relation = path.relative(parent, target)
  return Boolean(relation) && relation !== '..' && !relation.startsWith(`..${path.sep}`) && !path.isAbsolute(relation)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
    ...options
  })
  if (result.error) throw result.error
  return Number.isInteger(result.status) ? result.status : 1
}

function temporaryCompilerConfig(outputDirectory) {
  const sources = [
    ...filesUnder(path.join(serverRoot, 'src'), '.ts'),
    ...filesUnder(path.join(serverRoot, 'tests'), '.ts')
  ].sort()
  if (!sources.length) throw new Error('No server TypeScript sources or tests were found')
  return {
    extends: slash(path.join(serverRoot, 'tsconfig.json')),
    compilerOptions: {
      noEmit: false,
      outDir: slash(outputDirectory),
      rootDir: slash(serverRoot)
    },
    files: sources.map(slash)
  }
}

function compiledTests(outputDirectory) {
  const testsDirectory = path.join(outputDirectory, 'tests')
  if (!fs.existsSync(testsDirectory)) return []
  return filesUnder(testsDirectory, '.test.js').sort()
}

function runServerTests(options = {}) {
  const canonicalServerRoot = fs.realpathSync(serverRoot)
  const temporaryDirectory = fs.mkdtempSync(path.join(serverRoot, '.evidence-test-'))
  const canonicalTemporaryDirectory = fs.realpathSync(temporaryDirectory)
  const cleanupApproved = isStrictDescendant(canonicalTemporaryDirectory, canonicalServerRoot)
  const outputDirectory = temporaryDirectory
  const configPath = path.join(temporaryDirectory, 'tsconfig.json')
  const tscPath = path.join(serverRoot, 'node_modules', 'typescript', 'bin', 'tsc')
  const execute = options.run || run
  try {
    if (!cleanupApproved) throw new Error('Temporary server test directory escaped the server root')
    if (!fs.existsSync(tscPath)) throw new Error('Server TypeScript compiler is not installed')
    fs.writeFileSync(configPath, `${JSON.stringify(temporaryCompilerConfig(outputDirectory), null, 2)}\n`, 'utf8')
    const compileStatus = execute(process.execPath, [tscPath, '-p', configPath])
    if (compileStatus !== 0) return compileStatus
    const allTests = compiledTests(outputDirectory)
    const requested = new Set(options.testNames || [])
    const tests = requested.size
      ? allTests.filter((file) => requested.has(path.basename(file)))
      : allTests
    if (!tests.length) throw new Error('Server test compilation produced no requested test files')
    if (requested.size && tests.length !== requested.size) {
      const found = new Set(tests.map((file) => path.basename(file)))
      const missing = [...requested].filter((name) => !found.has(name))
      throw new Error(`Requested server tests were not found: ${missing.join(', ')}`)
    }
    const modulePath = [path.join(serverRoot, 'node_modules'), process.env.NODE_PATH]
      .filter(Boolean)
      .join(path.delimiter)
    return execute(process.execPath, ['--test', ...tests], {
      env: { ...process.env, NODE_PATH: modulePath }
    })
  } finally {
    if (cleanupApproved) {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true })
      if (fs.existsSync(temporaryDirectory)) throw new Error('Temporary server test directory was not removed')
    }
  }
}

if (require.main === module) {
  try {
    const testNames = process.argv.slice(2).map((argument) => {
      if (!argument.startsWith('--test=') || argument.length === '--test='.length) {
        throw new Error(`Unsupported server test runner argument: ${argument}`)
      }
      const name = path.basename(argument.slice('--test='.length))
      if (!/^[A-Za-z0-9_-]+\.test\.js$/.test(name)) throw new Error(`Invalid server test name: ${name}`)
      return name
    })
    process.exitCode = runServerTests({ testNames })
  } catch (error) {
    process.stderr.write(`Server test runner failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

module.exports = { compiledTests, filesUnder, isStrictDescendant, runServerTests, temporaryCompilerConfig }
