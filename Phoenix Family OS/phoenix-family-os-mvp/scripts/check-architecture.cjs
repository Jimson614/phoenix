const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const map = JSON.parse(fs.readFileSync(path.join(root, 'docs/architecture/module-map.json'), 'utf8'));
function resolveLocal(relative) {
  const target = path.resolve(root, relative);
  const scoped = path.relative(root, target);
  assert(!scoped.startsWith('..') && !path.isAbsolute(scoped), 'path escapes Family OS: ' + relative);
  return target;
}
for (const file of [...map.runtimeEntrypoints, map.migrationSource]) {
  assert(fs.statSync(resolveLocal(file)).isFile(), 'missing runtime source: ' + file);
}
for (const directory of map.reservedDirectories) {
  assert(fs.statSync(resolveLocal(directory)).isDirectory(), 'missing architecture directory: ' + directory);
}
for (const module of map.modules) {
  assert.equal(module.status, 'reserved', 'update the map when implementing modules');
  assert(fs.existsSync(resolveLocal(module.path + '/README.md')), 'module lacks boundary documentation');
  for (const source of module.sources) assert(fs.statSync(resolveLocal(source)).isFile(), 'missing source: ' + source);
}
function markdownFiles(directory) {
  return fs.readdirSync(directory, {withFileTypes:true}).flatMap(entry => {
    if (['node_modules', '.git', 'data', 'backups'].includes(entry.name)) return [];
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) return [];
    return entry.isDirectory() ? markdownFiles(target) : (entry.name.endsWith('.md') ? [target] : []);
  });
}
let checkedLinks = 0;
const documents = markdownFiles(root);
for (const file of documents) {
  const body = fs.readFileSync(file, 'utf8');
  for (const match of body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const href = match[1];
    if (/^(?:[a-z]+:|#)/i.test(href)) continue;
    const target = decodeURIComponent(href.split('#')[0]);
    assert(fs.existsSync(path.resolve(path.dirname(file), target)), 'broken link in ' + path.relative(root, file) + ': ' + href);
    checkedLinks++;
  }
}
console.log('Architecture OK: ' + map.reservedDirectories.length + ' directories, ' + map.modules.length + ' module maps, ' + documents.length + ' Markdown files, ' + checkedLinks + ' local links.');
console.log('Runtime entry and existing migration preserved. Reserved modules are not implemented.');
