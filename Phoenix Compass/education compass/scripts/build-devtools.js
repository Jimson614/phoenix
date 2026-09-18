const path = require('path')
const { spawnSync } = require('child_process')
const { buildDevelopment } = require('./build-development')
const { DIST_ROOT } = require('./build-release')

// WeChat DevTools keeps a file watcher on dist/development while the project is open,
// which makes the atomic directory swap in build:development fail with EBUSY on Windows.
// Build atomically into an unwatched sibling, then mirror it into dist/development
// file-by-file so DevTools can stay open and hot-reload.
const STAGING_DIRECTORY = path.join(DIST_ROOT, 'devtools-staging')
const TARGET_DIRECTORY = path.join(DIST_ROOT, 'development')

function mirrorDirectory(source, destination) {
  if (process.platform !== 'win32') {
    throw new Error('build:devtools is only needed on Windows; use build:development elsewhere')
  }
  const result = spawnSync('robocopy', [source, destination, '/MIR', '/NFL', '/NDL', '/NJH', '/NP', '/R:3', '/W:1'], {
    encoding: 'utf8'
  })
  // robocopy exit codes 0-7 mean success; 8 and above mean at least one failure.
  if (result.error || result.status === null || result.status >= 8) {
    throw new Error(`robocopy failed (exit ${result.status}): ${result.stdout || ''}${result.stderr || ''}`)
  }
  return result.stdout.trim()
}

function buildDevtools(options = {}) {
  const staging = buildDevelopment({ ...options, outputDirectory: STAGING_DIRECTORY })
  const summary = mirrorDirectory(staging, TARGET_DIRECTORY)
  return { staging, target: TARGET_DIRECTORY, summary }
}

if (require.main === module) {
  const { staging, target, summary } = buildDevtools()
  if (summary) console.log(summary)
  console.log(`LOCAL_DEVTOOLS_LOOPBACK_ONLY build synced: ${staging} -> ${target}`)
}

module.exports = { buildDevtools, STAGING_DIRECTORY, TARGET_DIRECTORY }
