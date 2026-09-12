'use strict'

// Run BEFORE starting the development server. Never mutate a running FileStore.
// This utility only creates synthetic identities in a fresh local temporary lab.
const { mkdtemp, writeFile } = require('node:fs/promises')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { FileStore } = require('../dist/src/store/file-store')
const { AuthService } = require('../dist/src/services/auth-service')
const { MockWechatAuthProvider } = require('../dist/src/auth/wechat-auth-provider')

async function main() {
  if (process.env.NODE_ENV !== 'test' || process.env.MASTERS_BOOTSTRAP_SYNTHETIC !== 'YES' || process.env.DATABASE_URL) {
    throw new Error('Requires NODE_ENV=test, MASTERS_BOOTSTRAP_SYNTHETIC=YES and no DATABASE_URL; creates only a new isolated local lab')
  }
  const root = await mkdtemp(join(tmpdir(), 'masters-synthetic-lab-'))
  const storePath = join(root, 'state.json')
  const store = await FileStore.open(storePath)
  const secret = process.env.SESSION_SECRET || 'development-only-session-secret-32-bytes'
  const auth = new AuthService(store, new MockWechatAuthProvider(), secret)
  const sessions = {}
  for (const role of ['student', 'founder', 'advisor', 'assignment_manager']) {
    sessions[role] = await auth.createWechatSession(`synthetic-masters-${role}`)
    if (role !== 'student') {
      const now = new Date().toISOString()
      await store.transaction(tx => tx.insert('mastersStaff', { id: `synthetic-staff-${role}`, userId: sessions[role].user.id, role, status: 'ACTIVE', grantedBy: null, createdAt: now, updatedAt: now }))
    }
  }
  const credentials = join(root, 'private-test-sessions.json')
  await writeFile(credentials, JSON.stringify(sessions, null, 2), { mode: 0o600, flag: 'wx' })
  const environment = {
    NODE_ENV: 'test', MASTERS_INTAKE_ENABLED: 'true', MASTERS_AI_ENABLED: 'false', MASTERS_WORKER_ENABLED: 'true',
    MASTERS_DEVELOPMENT_STORE_PATH: storePath, MASTERS_PRIVATE_STORAGE_DIR: join(root, 'attachments'),
    PAID_COMPASS_ENABLED: 'false', OPENAI_AGENT_ENABLED: 'false', AI_WORKER_ENABLED: 'false', FEISHU_BITABLE_ENABLED: 'false'
  }
  await writeFile(join(root, 'runtime-environment.json'), JSON.stringify(environment, null, 2), { mode: 0o600, flag: 'wx' })
  process.stdout.write(JSON.stringify({ status: 'SYNTHETIC_LAB_CREATED', directory: root, sessionFile: credentials, environmentFile: join(root, 'runtime-environment.json'), productionEnabled: false }) + '\n')
}
main().catch(() => { process.stderr.write('Synthetic bootstrap blocked; verify test-only configuration and build first\n'); process.exitCode = 1 })
