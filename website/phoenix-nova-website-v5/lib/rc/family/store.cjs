// Local RC storage port. Native source remains in rc/sources/family.
const { SCHEMA_VERSION, tables } = require('./schema.cjs')
const STORAGE_KEY = 'phoenix:rc:family:v1'
let memory = null
function emptyDatabase() { return Object.fromEntries([['schemaVersion', SCHEMA_VERSION], ...Object.keys(tables).map(k => [k, []])]) }
function load() {
  if (typeof window === 'undefined') return emptyDatabase()
  try { const raw = window.sessionStorage.getItem(STORAGE_KEY); if (raw) { const parsed = JSON.parse(raw); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) { const db = { ...emptyDatabase(), ...parsed }; for (const k of Object.keys(tables)) if (!Array.isArray(db[k])) db[k] = []; memory = db } } } catch {}
  return memory || emptyDatabase()
}
function save(db) { memory = db; try { if (typeof window !== 'undefined') window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(db)) } catch {} return db }
function reset() { return save(emptyDatabase()) }
module.exports = { STORAGE_KEY, emptyDatabase, load, save, reset }
