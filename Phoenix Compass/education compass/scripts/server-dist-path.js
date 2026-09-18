'use strict'

const { existsSync } = require('node:fs')
const path = require('node:path')

const distRoot = path.resolve(__dirname, '..', 'server', 'dist')

function compiledSourceRoot() {
  const layouts = [
    { marker: path.join(distRoot, 'index.js'), root: distRoot },
    { marker: path.join(distRoot, 'src', 'index.js'), root: path.join(distRoot, 'src') }
  ].filter((layout) => existsSync(layout.marker))

  if (layouts.length > 1) {
    throw new Error('Ambiguous compiled server layout: both dist/ and dist/src/ contain an entry point')
  }
  if (layouts.length === 0) {
    throw new Error('Compiled server entry point not found; run the server build first')
  }
  return layouts[0].root
}

function serverDist(...segments) {
  const resolved = path.join(compiledSourceRoot(), ...segments)
  if (!existsSync(resolved)) throw new Error(`Compiled server module not found: ${segments.join('/')}`)
  return resolved
}

module.exports = { compiledSourceRoot, serverDist }
