'use strict'

const { spawnSync } = require('node:child_process')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

function execute(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    shell: false,
    windowsHide: true
  })
  if (result.error) throw result.error
  return Number.isInteger(result.status) ? result.status : 1
}

function runAllTests(options = {}) {
  const run = options.run || execute
  const npm = process.platform === 'win32'
    ? {
        command: process.execPath,
        prefix: [path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')]
      }
    : { command: 'npm', prefix: [] }
  const commands = [
    [npm.command, [...npm.prefix, 'run', 'test:client']],
    [npm.command, [...npm.prefix, 'run', 'typecheck']],
    [npm.command, [...npm.prefix, 'run', 'test:web']],
    [npm.command, [...npm.prefix, '--prefix', 'server', 'run', 'typecheck']],
    [npm.command, [...npm.prefix, 'run', 'test:tooling']],
    [process.execPath, ['scripts/run-server-tests.js']]
  ]
  for (const [command, args] of commands) {
    const status = run(command, args)
    if (status !== 0) return status
  }
  return 0
}

if (require.main === module) {
  try {
    process.exitCode = runAllTests()
  } catch (error) {
    process.stderr.write(`Portable project test runner failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

module.exports = { runAllTests }
