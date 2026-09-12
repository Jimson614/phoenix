const crypto = require('node:crypto')
const { RequestError } = require('./validation')

const INSTALLATION_PATTERN = /^[A-Za-z0-9_-]{8,128}$/
const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function createDemoSession(database, installationId, options = {}) {
  if (typeof installationId !== 'string' || !INSTALLATION_PATTERN.test(installationId)) {
    throw new RequestError(400, 'invalid_request', 'installationId is invalid')
  }

  const now = new Date()
  const expiresAt = new Date(now.getTime() + (options.ttlMs || DEFAULT_SESSION_TTL_MS))
  const providerSubject = crypto.createHash('sha256').update(installationId).digest('hex')
  const userId = `usr_demo_${providerSubject.slice(0, 24)}`
  const token = crypto.randomBytes(32).toString('base64url')
  const tokenHash = hashToken(token)

  database.exec('BEGIN IMMEDIATE')
  try {
    database.prepare(`
      INSERT OR IGNORE INTO users (id, auth_provider, provider_subject, created_at)
      VALUES (?, 'local_demo', ?, ?)
    `).run(userId, providerSubject, now.toISOString())
    database.prepare('DELETE FROM demo_sessions WHERE expires_at <= ?').run(now.toISOString())
    database.prepare(`
      INSERT INTO demo_sessions (token_hash, user_id, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(tokenHash, userId, now.toISOString(), expiresAt.toISOString())
    database.prepare(`
      INSERT INTO audit_log (
        id, actor_user_id, action, resource_type, resource_id, occurred_at, metadata_json
      ) VALUES (?, ?, 'demo_session_created', 'session', NULL, ?, ?)
    `).run(
      `audit_${crypto.randomUUID()}`,
      userId,
      now.toISOString(),
      JSON.stringify({ authProvider: 'local_demo' })
    )
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }

  return { token, userId, expiresAt: expiresAt.toISOString(), authMode: 'local_demo' }
}

function authenticate(database, authorizationHeader) {
  const match = typeof authorizationHeader === 'string'
    ? authorizationHeader.match(/^Bearer\s+([^\s]+)$/i)
    : null
  if (!match) throw new RequestError(401, 'unauthorized', 'a valid session is required')

  const now = new Date().toISOString()
  const session = database.prepare(`
    SELECT user_id AS userId, expires_at AS expiresAt
    FROM demo_sessions
    WHERE token_hash = ? AND expires_at > ?
  `).get(hashToken(match[1]), now)

  if (!session) throw new RequestError(401, 'unauthorized', 'the session is invalid or expired')
  return session
}

module.exports = { authenticate, createDemoSession, hashToken }
