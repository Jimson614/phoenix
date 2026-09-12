'use strict'
const http = require('node:http')
const net = require('node:net')
const path = require('node:path')
const { spawn } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const production = process.argv.includes('--production')
const apps = [
  { name: 'portal', dir: path.join(root, 'website', 'phoenix-nova-website-v5'), port: 4310 },
  { name: 'education', dir: path.join(__dirname, 'education-web'), port: 4311 },
]
const children = []
let server
async function checkPort(port) {
  await new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', () => reject(new Error('Port already occupied: ' + port)))
    probe.listen(port, '127.0.0.1', () => probe.close(resolve))
  })
}
async function ready(port) {
  for (let n = 0; n < 240; n++) {
    const ok = await new Promise(resolve => {
      const socket = net.connect(port, '127.0.0.1')
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('error', () => resolve(false))
    })
    if (ok) return
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error('Frontend did not start: ' + port)
}
function target(url) {
  return /^\/education(?:\/|\?|$)/.test(url) ? 4311 : 4310
}
function close() {
  server?.close()
  for (const child of children) child.kill()
}
async function main() {
  for (const port of [4300, ...apps.map(a => a.port)]) await checkPort(port)
  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }
  for (const key of Object.keys(env)) if (/DATABASE|PGPASSWORD|OPENAI|WECHAT|FEISHU|SESSION_SECRET|MASTERS_TEST|FAMILY_CORE_PG/.test(key)) delete env[key]
  for (const app of apps) {
    const cli = path.join(app.dir, 'node_modules', 'next', 'dist', 'bin', 'next')
    const args = production ? ['start'] : ['dev', '--webpack']
    args.push('--hostname', '127.0.0.1', '--port', String(app.port))
    const child = spawn(process.execPath, [cli, ...args], { cwd: app.dir, env, stdio: 'inherit', windowsHide: true })
    children.push(child)
    child.on('exit', code => { if (code) { console.error(app.name + ' exited: ' + code); close(); process.exitCode = 1 } })
  }
  await Promise.all(apps.map(app => ready(app.port)))
  server = http.createServer((req, res) => {
    if (req.url === '/rc/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ status: 'frontend-preview', backend: 'deferred', production: false }))
      return
    }
    if (req.url.startsWith('/education/internal/')) { res.writeHead(404); res.end('Not in this RC'); return }
    const proxy = http.request({ hostname: '127.0.0.1', port: target(req.url), path: req.url, method: req.method, headers: req.headers }, upstream => {
      res.writeHead(upstream.statusCode, { ...upstream.headers, 'X-Robots-Tag': 'noindex, nofollow' })
      upstream.pipe(res)
    })
    proxy.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Frontend renderer unavailable') })
    req.pipe(proxy)
  })
  server.on('upgrade', (req, socket, head) => {
    const upstream = net.connect(target(req.url), '127.0.0.1', () => {
      upstream.write(req.method + ' ' + req.url + ' HTTP/' + req.httpVersion + '\r\n' + Object.entries(req.headers).map(([k,v]) => k + ': ' + v).join('\r\n') + '\r\n\r\n')
      if (head.length) upstream.write(head)
      socket.pipe(upstream).pipe(socket)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
  })
  server.listen(4300, '127.0.0.1', () => console.log('Phoenix Nova RC: http://127.0.0.1:4300/zh'))
}
process.on('SIGINT', () => { close(); process.exit() })
process.on('SIGTERM', () => { close(); process.exit() })
main().catch(error => { console.error(error.message); close(); process.exitCode = 1 })
