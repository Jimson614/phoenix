const http = require('node:http')
const path = require('node:path')
const crypto = require('node:crypto')
const { openDatabase } = require('./database')
const { authenticate, createDemoSession } = require('./auth')
const { saveQuestionnaireSubmission } = require('./questionnaire-service')
const { RequestError } = require('./validation')

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 8787
const MAX_BODY_BYTES = 64 * 1024

function isLoopback(host) {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

function sendJson(response, statusCode, payload, requestId) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Request-Id': requestId
  })
  response.end(JSON.stringify(payload))
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const contentType = String(request.headers['content-type'] || '').toLowerCase()
    if (!contentType.startsWith('application/json')) {
      reject(new RequestError(415, 'unsupported_media_type', 'Content-Type must be application/json'))
      return
    }

    let size = 0
    let tooLarge = false
    const chunks = []
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        tooLarge = true
        chunks.length = 0
        return
      }
      if (!tooLarge) chunks.push(chunk)
    })
    request.on('end', () => {
      if (tooLarge) {
        reject(new RequestError(413, 'payload_too_large', 'request body exceeds the size limit'))
        return
      }
      try {
        const body = Buffer.concat(chunks).toString('utf8')
        resolve(body ? JSON.parse(body) : {})
      } catch (_error) {
        reject(new RequestError(400, 'invalid_json', 'request body must be valid JSON'))
      }
    })
    request.on('error', reject)
  })
}

function createBackend(options = {}) {
  const host = options.host || process.env.PFS_BACKEND_HOST || DEFAULT_HOST
  const port = options.port === undefined
    ? Number(process.env.PFS_BACKEND_PORT || DEFAULT_PORT)
    : options.port
  const databasePath = options.databasePath || process.env.PFS_DATABASE_PATH || path.join(__dirname, 'data', 'phoenix-family-os.sqlite')
  const enableDemoAuth = options.enableDemoAuth === undefined
    ? (process.env.PFS_ENABLE_DEMO_AUTH === undefined
        ? isLoopback(host)
        : process.env.PFS_ENABLE_DEMO_AUTH === 'true')
    : options.enableDemoAuth

  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PFS_BACKEND_PORT must be a valid port')
  if (!enableDemoAuth) {
    throw new Error('External authentication is not implemented; this backend is Local Demo only')
  }
  if (!isLoopback(host)) {
    throw new Error('Local Demo authentication may only bind to a loopback host')
  }

  const database = openDatabase(databasePath)
  const server = http.createServer(async (request, response) => {
    const requestId = crypto.randomUUID()
    try {
      if (request.method === 'GET' && request.url === '/health') {
        sendJson(response, 200, { status: 'ok', database: 'connected', mode: 'local_demo' }, requestId)
        return
      }

      if (request.method === 'POST' && request.url === '/v1/demo/sessions' && enableDemoAuth) {
        const body = await readJson(request)
        const session = createDemoSession(database, body.installationId)
        sendJson(response, 201, session, requestId)
        return
      }

      if (request.method === 'POST' && request.url === '/v1/questionnaire-submissions') {
        const session = authenticate(database, request.headers.authorization)
        const body = await readJson(request)
        const saved = saveQuestionnaireSubmission(database, session.userId, body)
        sendJson(response, saved.duplicate ? 200 : 201, {
          status: 'synced',
          submissionId: saved.id,
          receivedAt: saved.receivedAt,
          duplicate: saved.duplicate
        }, requestId)
        return
      }

      throw new RequestError(404, 'not_found', 'route not found')
    } catch (error) {
      const safeError = error instanceof RequestError
        ? error
        : new RequestError(500, 'internal_error', 'the request could not be completed')
      if (!(error instanceof RequestError)) {
        console.error('[backend] request failed', { requestId, code: safeError.code })
      }
      if (!response.headersSent && !response.destroyed) {
        sendJson(response, safeError.statusCode, {
          error: { code: safeError.code, message: safeError.message },
          requestId
        }, requestId)
      }
    }
  })

  return {
    database,
    server,
    config: { host, port, databasePath, enableDemoAuth },
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, host, () => {
          server.off('error', reject)
          resolve(server.address())
        })
      })
    },
    close() {
      return new Promise((resolve, reject) => {
        const finish = (error) => {
          try {
            database.close()
          } catch (closeError) {
            if (!error) error = closeError
          }
          if (error) reject(error)
          else resolve()
        }
        if (!server.listening) finish()
        else server.close(finish)
      })
    }
  }
}

if (require.main === module) {
  const backend = createBackend()
  backend.listen().then((address) => {
    console.log(`Phoenix Family OS questionnaire backend listening on http://${address.address}:${address.port}`)
    console.log(`Database: ${backend.config.databasePath}`)
    console.log(`Authentication: ${backend.config.enableDemoAuth ? 'Local Demo only' : 'external provider required'}`)
  }).catch((error) => {
    console.error(`Backend failed to start: ${error.message}`)
    process.exitCode = 1
  })

  const shutdown = () => backend.close().finally(() => process.exit())
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

module.exports = { createBackend, DEFAULT_HOST, DEFAULT_PORT, MAX_BODY_BYTES }
