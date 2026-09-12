const { SCHEMA_VERSION, tables } = require('../models/schema')

const STORAGE_KEY = 'PFS_DB_V01'

function emptyDatabase() {
  const database = { schemaVersion: SCHEMA_VERSION }
  Object.keys(tables).forEach((table) => { database[table] = [] })
  return database
}

function migrate(stored) {
  if (!stored || typeof stored !== 'object') return emptyDatabase()
  const database = { ...emptyDatabase(), ...stored, schemaVersion: SCHEMA_VERSION }
  Object.keys(tables).forEach((table) => {
    if (!Array.isArray(database[table])) database[table] = []
  })
  return database
}

function load() {
  const stored = wx.getStorageSync(STORAGE_KEY)
  return migrate(stored)
}

function save(database) {
  wx.setStorageSync(STORAGE_KEY, database)
  return database
}

function reset() {
  return save(emptyDatabase())
}

module.exports = { STORAGE_KEY, emptyDatabase, migrate, load, save, reset }
