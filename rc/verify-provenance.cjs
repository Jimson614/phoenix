'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const provenance = JSON.parse(fs.readFileSync(path.join(__dirname, 'source-provenance.json'), 'utf8'))
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const entries = []
for (const [module, source] of Object.entries(provenance)) {
  for (const [file, expected] of Object.entries(source.files)) {
    if (module === 'website') {
      entries.push({ spec: source.head + ':' + source.sourceModule + '/' + file, expected })
    } else {
      const relative = 'rc/sources/' + module + '/' + file
      if (sha(fs.readFileSync(path.join(root, relative))) !== expected) throw new Error('Source snapshot mismatch: ' + relative)
      entries.push({ spec: ':' + relative, expected })
    }
  }
}
const batch = execFileSync('git', ['-C', root, 'cat-file', '--batch'], { input: entries.map(e => e.spec).join('\n') + '\n', maxBuffer: 512 * 1024 * 1024, windowsHide: true })
let offset = 0
for (const entry of entries) {
  const newline = batch.indexOf(10, offset)
  const header = batch.subarray(offset, newline).toString().split(' ')
  if (header[1] !== 'blob') throw new Error('Missing source/index blob: ' + entry.spec)
  const size = Number(header[2])
  const bytes = batch.subarray(newline + 1, newline + 1 + size)
  if (sha(bytes) !== entry.expected) throw new Error('Git source/index bytes mismatch: ' + entry.spec)
  offset = newline + 1 + size + 1
}
console.log(JSON.stringify({ passed: true, checkedFiles: entries.length, modules: Object.keys(provenance), indexBytesVerified: true }, null, 2))
