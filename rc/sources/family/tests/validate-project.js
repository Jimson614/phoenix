const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
const projectConfig = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'))
const declaredPages = new Set(appConfig.pages)
const expectedBrandAssets = [
  'phoenix-nova-icon-light.png',
  'phoenix-nova-icon-primary.png',
  'phoenix-nova-logo-light.png',
  'phoenix-nova-logo-primary.png'
]

const originalPages = [
  'pages/welcome/index', 'pages/home/index', 'pages/family-edit/index', 'pages/student-edit/index',
  'pages/compass/index', 'pages/compass-questionnaire/index', 'pages/report/index', 'pages/timeline/index',
  'pages/advisor-request/index', 'pages/mine/index', 'pages/admin-families/index', 'pages/admin-family/index'
]
const partnerPages = ['pages/partner/yuanchao/index', 'pages/partner/music-exploration/index', 'pages/partner/apply/index']
assert((projectConfig.packOptions && projectConfig.packOptions.ignore || []).includes('backend'), 'backend must be excluded from the WeChat package')
assert.strictEqual(appConfig.pages.length, originalPages.length + partnerPages.length, 'unexpected page count')
for (const page of originalPages) assert(appConfig.pages.includes(page), `original MVP route removed: ${page}`)
for (const page of partnerPages) assert(appConfig.pages.includes(page), `missing Partner Experience route: ${page}`)
for (const page of appConfig.pages) {
  for (const extension of ['js', 'json', 'wxml', 'wxss']) {
    const file = path.join(root, `${page}.${extension}`)
    assert(fs.existsSync(file), `missing ${page}.${extension}`)
  }
}

const tabPages = new Set((appConfig.tabBar && appConfig.tabBar.list || []).map((item) => item.pagePath))
for (const page of tabPages) assert(declaredPages.has(page), `tabBar route is not declared: ${page}`)

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(target) : [target]
  })
}

const projectFiles = walk(root).filter((file) => !file.includes(`${path.sep}node_modules${path.sep}`))

const actualBrandAssets = fs.readdirSync(path.join(root, 'assets', 'brand'))
  .filter((file) => file.toLowerCase().endsWith('.png'))
  .sort()
assert.deepStrictEqual(actualBrandAssets, expectedBrandAssets, 'runtime brand asset set changed; human review is required')

const brandTemplate = fs.readFileSync(path.join(root, 'components', 'brand-mark', 'index.wxml'), 'utf8')
for (const asset of expectedBrandAssets) {
  assert(brandTemplate.includes(`/assets/brand/${asset}`), `brand component does not reference ${asset}`)
}

for (const file of projectFiles.filter((target) => /[\\/](pages|components)[\\/].+\.(wxml|wxss|js)$/.test(target))) {
  const content = fs.readFileSync(file, 'utf8')
  for (const match of content.matchAll(/\/assets\/brand\/([A-Za-z0-9_.-]+)/g)) {
    assert(expectedBrandAssets.includes(match[1]), `unreviewed runtime brand asset ${match[1]} in ${file}`)
  }
}

function resolveRelativeModule(file, request) {
  const target = path.resolve(path.dirname(file), request)
  return [target, `${target}.js`, `${target}.json`, path.join(target, 'index.js')].some((candidate) => fs.existsSync(candidate))
}

for (const file of projectFiles) {
  const content = fs.readFileSync(file, 'utf8')
  if (file.endsWith('.json')) JSON.parse(content)
  if (file.endsWith('.js')) {
    new Function('require', 'module', 'exports', 'getApp', 'wx', content)
    for (const match of content.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
      if (match[1].startsWith('.')) assert(resolveRelativeModule(file, match[1]), `missing require target ${match[1]} in ${file}`)
    }
    for (const match of content.matchAll(/\/pages\/[A-Za-z0-9_/-]+\/index/g)) {
      const route = match[0].slice(1)
      assert(declaredPages.has(route), `undeclared page route ${match[0]} in ${file}`)
    }
  }
  if (file.endsWith('.wxml')) {
    assert(!content.includes('.slice('), `unsupported method call in WXML: ${file}`)
    assert(!content.includes('<script'), `script must not appear in WXML: ${file}`)
    for (const match of content.matchAll(/\/assets\/[A-Za-z0-9_./-]+/g)) {
      assert(fs.existsSync(path.join(root, match[0].slice(1))), `missing asset ${match[0]} in ${file}`)
    }
  }
}

for (const page of appConfig.pages) {
  const pageConfig = JSON.parse(fs.readFileSync(path.join(root, `${page}.json`), 'utf8'))
  if (pageConfig.navigationStyle === 'custom') {
    const template = fs.readFileSync(path.join(root, `${page}.wxml`), 'utf8')
    assert(template.includes('navigation.statusBarHeight'), `custom navigation misses status bar inset: ${page}`)
    assert(template.includes('navigation.menuButtonSafeWidth'), `custom navigation misses capsule inset: ${page}`)
  }
  for (const componentPath of Object.values(pageConfig.usingComponents || {})) {
    const componentBase = path.join(root, String(componentPath).replace(/^\//, ''))
    for (const extension of ['js', 'json', 'wxml', 'wxss']) {
      assert(fs.existsSync(`${componentBase}.${extension}`), `missing component file ${componentPath}.${extension}`)
    }
  }
}

const appStyles = fs.readFileSync(path.join(root, 'app.wxss'), 'utf8')
assert(appStyles.includes('safe-area-inset-bottom'), 'global styles must reserve the bottom safe area')
for (const file of projectFiles.filter((target) => target.endsWith('.wxss'))) {
  const content = fs.readFileSync(file, 'utf8')
  if (content.includes('position: fixed') && content.includes('bottom: 0')) {
    assert(content.includes('safe-area-inset-bottom'), `fixed bottom control misses safe area: ${file}`)
  }
}

const schema = require('../models/schema')
for (const required of ['users', 'families', 'students', 'assessments', 'reports', 'timelineEvents', 'advisorNotes', 'analyticsEvents', 'partners', 'permissions', 'partnerExplorations', 'partnerApplications']) {
  assert(schema.tables[required], `missing model ${required}`)
}

console.log(`✓ project structure: ${appConfig.pages.length} pages, JSON and JS syntax valid`)
console.log('✓ original MVP routes, Partner Experience routes and required data models present')
console.log('✓ backend source and SQLite runtime data are excluded from the WeChat package')
