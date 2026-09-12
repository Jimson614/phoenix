const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = path.resolve(__dirname, '..')
const phase = process.argv[2]
const outputDirectory = process.argv[3] && path.resolve(process.argv[3])

if (!['before', 'after'].includes(phase) || !outputDirectory) {
  console.error('usage: node tests/ui-protection-snapshot.js <before|after> <output-directory>')
  process.exit(2)
}

function slash(value) {
  return value.split(path.sep).join('/')
}

function walk(target) {
  if (!fs.existsSync(target)) return []
  const stat = fs.statSync(target)
  if (stat.isFile()) return [target]
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) =>
    walk(path.join(target, entry.name))
  )
}

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function pngDimensions(buffer) {
  const signature = '89504e470d0a1a0a'
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== signature) return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function jpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null
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
    const segmentLength = buffer.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) }
    }
    offset += segmentLength
  }
  return null
}

function webpDimensions(buffer) {
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return null
  const chunk = buffer.toString('ascii', 12, 16)
  const data = 20
  if (chunk === 'VP8X' && buffer.length >= 30) {
    return { width: buffer.readUIntLE(data + 4, 3) + 1, height: buffer.readUIntLE(data + 7, 3) + 1 }
  }
  if (chunk === 'VP8 ' && buffer.length >= data + 10) {
    return { width: buffer.readUInt16LE(data + 6) & 0x3fff, height: buffer.readUInt16LE(data + 8) & 0x3fff }
  }
  if (chunk === 'VP8L' && buffer.length >= data + 5 && buffer[data] === 0x2f) {
    const b1 = buffer[data + 1]
    const b2 = buffer[data + 2]
    const b3 = buffer[data + 3]
    const b4 = buffer[data + 4]
    return {
      width: 1 + (((b2 & 0x3f) << 8) | b1),
      height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6))
    }
  }
  return null
}

function rasterDimensions(file) {
  const extension = path.extname(file).toLowerCase()
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) return null
  const buffer = fs.readFileSync(file)
  const dimensions = extension === '.png'
    ? pngDimensions(buffer)
    : (extension === '.webp' ? webpDimensions(buffer) : jpegDimensions(buffer))
  if (!dimensions || !dimensions.width || !dimensions.height) {
    throw new Error(`cannot read raster dimensions for ${slash(path.relative(ROOT, file))}`)
  }
  return dimensions
}

function manifest(targets) {
  const files = targets
    .flatMap((target) => walk(path.resolve(ROOT, target)))
    .filter((file) => fs.statSync(file).isFile())
  return [...new Set(files)]
    .sort()
    .map((file) => {
      const dimensions = rasterDimensions(file)
      return {
        path: slash(path.relative(ROOT, file)),
        bytes: fs.statSync(file).size,
        sha256: digest(file),
        ...(dimensions || {})
      }
    })
}

function assetSnapshot() {
  const files = manifest(['assets/brand', 'assets/ui'])
  const group = (prefix) => {
    const selected = files.filter((file) => file.path.startsWith(prefix))
    return { fileCount: selected.length, totalBytes: selected.reduce((total, file) => total + file.bytes, 0) }
  }
  return {
    generatedAt: new Date().toISOString(),
    files,
    totals: {
      fileCount: files.length,
      totalBytes: files.reduce((total, file) => total + file.bytes, 0),
      brand: group('assets/brand/'),
      ui: group('assets/ui/')
    }
  }
}

function pageFiles(extension) {
  return walk(path.join(ROOT, 'pages'))
    .filter((file) => file.endsWith(extension))
    .sort()
}

function collectWxmlContract() {
  const eventPattern = /\b((?:bind|catch|capture-bind|capture-catch):?[a-zA-Z0-9_-]+)\s*=\s*["']([^"']+)["']/g
  const dataPattern = /\b(data-[a-zA-Z0-9_-]+)\s*=\s*["']([^"']*)["']/g
  return pageFiles('.wxml').map((file) => {
    const source = fs.readFileSync(file, 'utf8')
    const handlers = []
    const dataAttributes = []
    let match
    while ((match = eventPattern.exec(source))) {
      handlers.push({ attribute: match[1], handler: match[2] })
    }
    while ((match = dataPattern.exec(source))) {
      dataAttributes.push({ attribute: match[1], value: match[2] })
    }
    return {
      path: slash(path.relative(ROOT, file)),
      handlers,
      dataAttributes
    }
  })
}

function routeContract() {
  const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'))
  const pageNavigation = {}
  for (const file of pageFiles('.json')) {
    const relative = slash(path.relative(ROOT, file))
    const json = JSON.parse(fs.readFileSync(file, 'utf8'))
    pageNavigation[relative] = {
      navigationStyle: json.navigationStyle || null,
      navigationBarTitleText: json.navigationBarTitleText || null
    }
  }
  return {
    pages: app.pages,
    window: {
      navigationStyle: app.window && app.window.navigationStyle || null,
      navigationBarBackgroundColor: app.window && app.window.navigationBarBackgroundColor || null,
      navigationBarTextStyle: app.window && app.window.navigationBarTextStyle || null
    },
    tabBar: {
      list: (app.tabBar && app.tabBar.list || []).map(({ pagePath, text }) => ({ pagePath, text }))
    },
    lazyCodeLoading: app.lazyCodeLoading || null,
    pageNavigation
  }
}

const protectedTargets = [
  'app.js',
  'server',
  'services',
  'models',
  'config',
  'utils',
  'docs/product/freeze',
  'docs/openapi',
  'package-lock.json',
  ...pageFiles('.js').map((file) => path.relative(ROOT, file))
]

const uiTargets = [
  'app.json',
  'app.wxss',
  'components',
  'assets/brand',
  'assets/ui',
  ...walk(path.join(ROOT, 'pages'))
    .filter((file) => /\.(wxml|wxss|json|js)$/.test(file))
    .map((file) => path.relative(ROOT, file))
]

fs.mkdirSync(outputDirectory, { recursive: true })
fs.writeFileSync(
  path.join(outputDirectory, phase + '-protected-sha256.json'),
  JSON.stringify({ phase, generatedAt: new Date().toISOString(), files: manifest(protectedTargets) }, null, 2) + '\n'
)
fs.writeFileSync(
  path.join(outputDirectory, 'required-handler-' + (phase === 'before' ? 'baseline' : 'after') + '.json'),
  JSON.stringify({ phase, generatedAt: new Date().toISOString(), pages: collectWxmlContract() }, null, 2) + '\n'
)
fs.writeFileSync(
  path.join(outputDirectory, 'route-tabbar-' + (phase === 'before' ? 'baseline' : 'after') + '.json'),
  JSON.stringify({ phase, generatedAt: new Date().toISOString(), contract: routeContract() }, null, 2) + '\n'
)
fs.writeFileSync(
  path.join(outputDirectory, 'source-ui-manifest.' + phase + '.json'),
  JSON.stringify({
    phase,
    generatedAt: new Date().toISOString(),
    files: manifest(uiTargets),
    assetTotals: assetSnapshot().totals
  }, null, 2) + '\n'
)
fs.writeFileSync(
  path.join(outputDirectory, 'asset-manifest.' + phase + '.json'),
  JSON.stringify({ phase, ...assetSnapshot() }, null, 2) + '\n'
)

console.log('UI protection ' + phase + ' snapshot written to ' + outputDirectory)
