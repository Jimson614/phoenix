'use strict'
// Grants the first Masters founder from that person's own enrolment code (Mini Program: 我的申请咨询 →
// 工作人员入口 → 生成工作台申请码). It refuses once an active founder exists; every later grant is made
// by a founder in the workbench. Run on the server with the running service's environment so the
// database and SESSION_SECRET match, after `npm run build`:
//   node --env-file=<service env file> scripts/masters-grant-first-founder.js --code ABCDE-FGHJK
const { loadConfig } = require('../dist/src/config')
const { PostgresStore } = require('../dist/src/store/postgres-store')
const { MastersWorkbenchAuth } = require('../dist/src/masters/workbench-auth')

function codeArgument(argv) {
  const index = argv.indexOf('--code')
  const value = index >= 0 ? argv[index + 1] : (argv.find((item) => item.startsWith('--code=')) || '').slice('--code='.length)
  if (!value) throw new Error('Usage: masters-grant-first-founder.js --code ABCDE-FGHJK')
  return value
}

async function main() {
  const code = codeArgument(process.argv.slice(2))
  const config = loadConfig(process.env)
  if (!config.databaseUrl) throw new Error('DATABASE_URL is required; the founder grant must be stored in PostgreSQL')
  const store = new PostgresStore(config.databaseUrl)
  try {
    const staff = await new MastersWorkbenchAuth(store, config.sessionSecret).bootstrapFounder(code)
    process.stdout.write(`${JSON.stringify({ status: 'GRANTED', role: staff.role, staffId: staff.id, userId: staff.userId })}\n`)
  } finally {
    await store.close()
  }
}

main().catch((error) => {
  // Never echo the code or connection details.
  process.stderr.write(`${JSON.stringify({ status: 'FAILED', code: error.code || 'ERROR', message: error.message })}\n`)
  process.exitCode = 1
})
