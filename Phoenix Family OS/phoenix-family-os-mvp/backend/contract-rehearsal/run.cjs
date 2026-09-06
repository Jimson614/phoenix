'use strict'

// Local verification launcher only. This is never imported by the adapter or application.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'))
assert.ok(config.packOptions.ignore.includes('backend'), 'Rehearsal must remain excluded from mini-program packaging')
for (const name of ['adapter.cjs', 'fixtures.cjs']) {
  const source = fs.readFileSync(path.join(__dirname, name), 'utf8')
  const imports = Array.from(source.matchAll(/require\(['"]([^'"]+)['"]\)/g), m => m[1])
  assert.ok(imports.every(i => ['node:crypto', 'node:util', './fixtures.cjs'].includes(i)), 'Adapter imports outside the synthetic allowlist')
  assert.ok(!/\b(process|fetch|eval|Function|WebSocket)\b|\bimport\s*\(/.test(source), 'Adapter must not access environment, dynamic execution or network APIs')
}
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(e => {
    const p = path.join(directory, e.name)
    if (p === __dirname || ['node_modules', 'docs', 'assets'].includes(e.name)) return []
    return e.isDirectory() ? walk(p) : [p]
  })
}
for (const p of walk(root).filter(p => /\.(js|cjs|mjs|json)$/.test(p))) {
  assert.ok(!fs.readFileSync(p, 'utf8').includes('contract-rehearsal'), 'Runtime must not reference the rehearsal')
}
console.log('PASS: synthetic source/import guard; runtime unconnected; backend packaging exclusion retained')
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: __dirname, stdio: 'inherit' })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `Verification failed: ${args.join(' ')}`)
}
for (const f of ['adapter.cjs', 'fixtures.cjs', 'adapter.test.cjs', 'run.cjs']) run(['--check', f])
run(['--test', '--experimental-test-coverage', '--test-coverage-lines=100', '--test-coverage-functions=100', '--test-coverage-branches=95', 'adapter.test.cjs'])
