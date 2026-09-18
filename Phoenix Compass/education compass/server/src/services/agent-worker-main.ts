import { randomUUID } from 'node:crypto'
import { AgentContentCrypto } from '../ai/crypto'
import { contextDigestForAssessment, contextDigestForPaidReportAnalysis } from '../ai/context/assessment-context'
import { contextDigestForReport } from '../ai/context/report-context'
import { AgentProvider } from '../ai/provider/agent-provider'
import { createAgentProvider } from '../ai/provider/create-agent-provider'
import { loadConfig } from '../config'
import { invariant } from '../domain/errors'
import { AgentRepository } from '../store/agent-repository'
import { PostgresStore } from '../store/postgres-store'
import { AgentWorker } from '../worker/agent-worker'
import { AgentService } from './agent-service'

async function main(): Promise<void> {
  const config = loadConfig()
  invariant(config.aiWorkerEnabled, 500, 'AGENT_WORKER_DISABLED', 'AI_WORKER_ENABLED 未开启')
  invariant(config.openaiAgentEnabled, 500, 'AGENT_DISABLED', 'OPENAI_AGENT_ENABLED 未开启')
  const currentAgentKey = config.aiContentKeyring[config.aiContentCurrentKeyVersion]
  invariant(currentAgentKey, 500, 'AGENT_CONTENT_KEY_REQUIRED', 'Agent 内容密钥未配置')

  const store = new PostgresStore({
    connectionString: config.databaseUrl,
    max: 3,
    statement_timeout: Math.max(10_000, config.openaiRequestTimeoutMs + 5_000),
    application_name: 'phoenix-family-os-agent-worker'
  })
  const crypto = new AgentContentCrypto({
    keyring: config.aiContentKeyring,
    currentKeyVersion: config.aiContentCurrentKeyVersion,
    digestRootKey: config.openaiSafetyHmacKey
  })
  const repository = new AgentRepository(
    store,
    undefined,
    undefined,
    (report) => contextDigestForReport(report, crypto),
    (assessment, report) => contextDigestForAssessment(assessment, report, crypto),
    (assessment, report) => contextDigestForPaidReportAnalysis(assessment, report, crypto)
  )
  const provider: AgentProvider = createAgentProvider(config)
  const executor = new AgentService(store, repository, crypto, provider, {
    enabled: config.openaiAgentEnabled,
    safetyHmacKey: config.openaiSafetyHmacKey,
    maxMessageCharacters: config.aiMaxMessageChars,
    maxRepliesPerReport: config.aiMaxTurnsPerReport,
    maxActiveRunsPerUser: config.aiMaxActiveRunsPerUser,
    messagesPerMinute: config.aiRateLimitMessagesPerMinute,
    retentionDays: config.aiConversationRetentionDays
  })
  const worker = new AgentWorker(repository, crypto, executor, {
    workerId: `agent-worker-${randomUUID()}`,
    buildVersion: process.env.BUILD_VERSION ?? 'v0.5.0',
    batchSize: config.aiWorkerBatchSize,
    leaseMs: config.aiWorkerLeaseMs,
    intervalMs: config.aiWorkerIntervalMs
  })
  const controller = new AbortController()
  let purgeRunning = false
  const purgeExpiredContent = async (): Promise<void> => {
    if (purgeRunning) return
    purgeRunning = true
    try {
      const contentBefore = new Date(Date.now() - config.aiConversationRetentionDays * 24 * 60 * 60 * 1000).toISOString()
      await repository.purgeExpired({ contentBefore, batchSize: 200 })
    } finally {
      purgeRunning = false
    }
  }
  const stop = (): void => {
    controller.abort(new Error('shutdown'))
    worker.stop()
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  const purgeTimer = setInterval(() => {
    void purgeExpiredContent().catch((error: unknown) => {
      process.stderr.write(`Agent retention purge failed: ${error instanceof Error ? error.name : 'UnknownError'}\n`)
    })
  }, 15 * 60 * 1000)
  purgeTimer.unref()
  try {
    await purgeExpiredContent()
    if (process.argv.includes('--once')) {
      const result = await worker.runOnce()
      process.stdout.write(`Agent worker once: claimed=${result.claimed} succeeded=${result.succeeded} blocked=${result.blocked} failed=${result.failed} stale=${result.stale}\n`)
    } else {
      await worker.runForever(controller.signal)
    }
  } finally {
    clearInterval(purgeTimer)
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
    await store.close()
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`Agent worker startup failed: ${error instanceof Error ? error.name : 'UnknownError'}\n`)
  process.exitCode = 1
})
