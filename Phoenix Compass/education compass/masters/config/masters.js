const model = require('../models/masters-intake')

// The client ships fail-closed.  A release build must be enabled by the
// deployment/release process after the server and privacy configuration are
// ready; it is never inferred from a local file or a temporary upload path.
const MASTERS_ENABLED = false
const API_PREFIX = '/v1/masters/consultations'
const CONSENT_VERSION = 'MASTERS_CONSENT_V1'
const SERVICE_CONSENT_VERSION = 'masters_service_consent_v1.1'
const MAX_DOCUMENT_SIZE = model.MAX_DOCUMENT_SIZE
const MAX_DOCUMENTS = model.MAX_DOCUMENTS
const DEFAULT_RETENTION_DAYS = 30
const MIN_RETENTION_DAYS = 1
const MAX_RETENTION_DAYS = 90

const SHARE_CHANNELS = Object.freeze(['organic', 'wechat', 'partner', 'campus', 'campaign'])

let testOverride
let retentionOverride

function isEnabled() {
  return testOverride === undefined ? MASTERS_ENABLED : testOverride
}

// This hook is intentionally named for contract tests.  It is not a storage
// backed feature switch and must never be called by application code.
function setEnabledForTests(value) { testOverride = Boolean(value) }
function resetEnabledForTests() { testOverride = undefined }

function retentionDays() {
  const value = retentionOverride === undefined ? DEFAULT_RETENTION_DAYS : Number(retentionOverride)
  return Number.isInteger(value) && value >= MIN_RETENTION_DAYS && value <= MAX_RETENTION_DAYS
    ? value : DEFAULT_RETENTION_DAYS
}

function setRetentionDaysForTests(value) { retentionOverride = Number(value) }
function resetRetentionDaysForTests() { retentionOverride = undefined }

function channel(value) {
  const candidate = String(value || 'organic').trim().toLowerCase()
  return SHARE_CHANNELS.includes(candidate) ? candidate : 'organic'
}

function path(value) { return model.PATHS.includes(String(value || '').toUpperCase()) ? String(value).toUpperCase() : 'GUIDED' }

function documentType(value) {
  const candidate = String(value || '').toUpperCase()
  const aliases = {
    CV: 'RESUME', LANGUAGE_SCORE: 'LANGUAGE', ENROLMENT_CERTIFICATE: 'ENROLLMENT',
    GRADUATION_CERTIFICATE: 'GRADUATION', DEGREE_CERTIFICATE: 'DEGREE', SUPPORTING_DOCUMENT: 'SUPPLEMENTAL'
  }
  return aliases[candidate] || candidate
}

module.exports = {
  API_PREFIX, CONSENT_VERSION, SERVICE_CONSENT_VERSION, MASTERS_ENABLED, MAX_DOCUMENT_SIZE, MAX_DOCUMENTS,
  DEFAULT_RETENTION_DAYS, MIN_RETENTION_DAYS, MAX_RETENTION_DAYS, SHARE_CHANNELS,
  channel, documentType, isEnabled, path, retentionDays,
  resetEnabledForTests, resetRetentionDaysForTests, setEnabledForTests, setRetentionDaysForTests
}
