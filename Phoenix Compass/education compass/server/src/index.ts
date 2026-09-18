import { readFile } from 'node:fs/promises'
import { MockWechatAuthProvider, WechatApiAuthProvider } from './auth/wechat-auth-provider'
import { loadConfig } from './config'
import { loadSourceCatalog } from './domain/source-catalog'
import { AgentContentCrypto } from './ai/crypto'
import { contextDigestForAssessment, contextDigestForPaidReportAnalysis } from './ai/context/assessment-context'
import { contextDigestForReport } from './ai/context/report-context'
import { AgentProvider } from './ai/provider/agent-provider'
import { createAgentProvider } from './ai/provider/create-agent-provider'
import { createAppServer } from './http/app'
import { FeishuBitableClient } from './integrations/feishu/bitable-client'
import { FeishuSyncService } from './integrations/feishu/sync-service'
import { MockPaymentProvider } from './payments/mock-payment-provider'
import { PaymentProvider } from './payments/payment-provider'
import { WechatPayProvider } from './payments/wechat-pay-provider'
import { AssessmentService } from './services/assessment-service'
import { AuthService } from './services/auth-service'
import { OrderService, seedProducts } from './services/order-service'
import { ProfileService } from './services/profile-service'
import { ReportService } from './services/report-service'
import { AgentService } from './services/agent-service'
import { EducationCompassService } from './services/education-compass-service'
import { AgentRepository } from './store/agent-repository'
import { InMemoryStore } from './store/memory-store'
import { PostgresStore } from './store/postgres-store'
import { Store } from './store/store'

async function main(): Promise<void> {
  const config = loadConfig()
  const sourceCatalog = await loadSourceCatalog(config.sourceCatalogMode, config.sourceCatalogPath)
  const store: Store = config.databaseUrl ? new PostgresStore(config.databaseUrl) : new InMemoryStore()
  const authProvider = config.wechatAppId && config.wechatAppSecret
    ? new WechatApiAuthProvider(config.wechatAppId, config.wechatAppSecret)
    : new MockWechatAuthProvider()
  let paymentProvider: PaymentProvider
  if (config.paymentProvider === 'wechat') {
    const [merchantPrivateKeyPem, wechatPayPublicKeyPem] = await Promise.all([
      readFile(config.wechatMchPrivateKeyPath, 'utf8'),
      readFile(config.wechatPayPublicKeyPath, 'utf8')
    ])
    paymentProvider = new WechatPayProvider({
      appId: config.wechatAppId,
      mchId: config.wechatMchId,
      merchantCertificateSerialNo: config.wechatMchCertSerialNo,
      merchantPrivateKeyPem,
      apiV3Key: config.wechatPayApiV3Key,
      wechatPayPublicKeyId: config.wechatPayPublicKeyId,
      wechatPayPublicKeyPem,
      transactionNotifyUrl: config.wechatPayNotifyUrl,
      refundNotifyUrl: config.wechatRefundNotifyUrl
    })
  } else {
    paymentProvider = new MockPaymentProvider(config.sessionSecret, {
      appId: config.wechatAppId || 'wx_mock_phoenix',
      mchId: config.wechatMchId || 'mock_mch_3990'
    })
  }

  await seedProducts(store, new Date().toISOString())
  const auth = new AuthService(store, authProvider, config.sessionSecret)
  const profiles = new ProfileService(store)
  const assessments = new AssessmentService(store, sourceCatalog)
  const orders = new OrderService(
    store, paymentProvider, sourceCatalog, config.paidCompassEnabled,
    undefined, undefined, config.growthDiscoveryPaymentEnabled
  )
  const reports = new ReportService(store)
  const education = new EducationCompassService(store, config.growthDiscoveryPaymentEnabled)
  let agent: AgentService | undefined
  const currentAgentKey = config.aiContentKeyring[config.aiContentCurrentKeyVersion]
  if (currentAgentKey && Buffer.byteLength(config.openaiSafetyHmacKey, 'utf8') >= 32) {
    const agentCrypto = new AgentContentCrypto({
      keyring: config.aiContentKeyring,
      currentKeyVersion: config.aiContentCurrentKeyVersion,
      digestRootKey: config.openaiSafetyHmacKey
    })
    const agentRepository = new AgentRepository(
      store,
      undefined,
      undefined,
      (report) => contextDigestForReport(report, agentCrypto),
      (assessment, report) => contextDigestForAssessment(assessment, report, agentCrypto),
      (assessment, report) => contextDigestForPaidReportAnalysis(assessment, report, agentCrypto)
    )
    const agentProvider: AgentProvider = createAgentProvider(config)
    agent = new AgentService(store, agentRepository, agentCrypto, agentProvider, {
      enabled: config.openaiAgentEnabled,
      safetyHmacKey: config.openaiSafetyHmacKey,
      maxMessageCharacters: config.aiMaxMessageChars,
      maxRepliesPerReport: config.aiMaxTurnsPerReport,
      maxActiveRunsPerUser: config.aiMaxActiveRunsPerUser,
      messagesPerMinute: config.aiRateLimitMessagesPerMinute,
      retentionDays: config.aiConversationRetentionDays
    })
  }
  const feishuGateway = config.feishuBitableEnabled
    ? new FeishuBitableClient({
        appId: config.feishuAppId,
        appSecret: config.feishuAppSecret,
        appToken: config.feishuBitableAppToken
      })
    : null
  const feishu = new FeishuSyncService(
    store, feishuGateway, config.feishuBitableTables, config.feishuPseudonymKey,
    config.nodeEnv, config.feishuSyncBatchSize, undefined, undefined,
    config.feishuCustomerProfileFieldsEnabled
  )
  const server = createAppServer({
    auth, profiles, assessments, orders, reports, education, feishu,
    // `/health` is a readiness check in the deployed API contract. Keep it
    // read-only, but verify that the authoritative store can still answer so a
    // disconnected PostgreSQL backend is not advertised as usable to clients.
    readiness: async () => {
      await store.read(async (tx) => {
        const product = await tx.findById('products', 'EDUCATION_GROWTH_DISCOVERY_SINGLE_V1')
        if (!product || product.code !== 'EDUCATION_GROWTH_DISCOVERY_SINGLE_V1' ||
          product.amountFen !== 3990 || product.currency !== 'CNY' || product.scope !== 'SINGLE_REPORT') {
          throw new Error('Authoritative product catalog is not ready')
        }
      })
    },
    ...(agent ? { agent } : {})
  })
  let refundSweepRunning = false
  const reconcileRefunds = async (): Promise<void> => {
    if (refundSweepRunning) return
    refundSweepRunning = true
    try {
      const result = await orders.reconcilePendingRefunds()
      if (result.failed > 0) process.stderr.write(`Refund reconciliation failed for ${result.failed} item(s)\n`)
    } catch (error) {
      process.stderr.write(`Refund reconciliation worker failed: ${error instanceof Error ? error.name : 'UnknownError'}\n`)
    } finally {
      refundSweepRunning = false
    }
  }
  const refundSweepTimer = setInterval(() => { void reconcileRefunds() }, 60_000)
  refundSweepTimer.unref()
  void reconcileRefunds()
  let feishuSyncRunning = false
  const reconcileFeishu = async (): Promise<void> => {
    if (!feishu.enabled || feishuSyncRunning) return
    feishuSyncRunning = true
    try {
      const result = await feishu.reconcile()
      if (result.failed > 0) process.stderr.write(`Feishu reconciliation failed for ${result.failed} item(s)\n`)
    } catch (error) {
      process.stderr.write(`Feishu reconciliation worker failed: ${error instanceof Error ? error.name : 'UnknownError'}\n`)
    } finally {
      feishuSyncRunning = false
    }
  }
  const feishuSyncTimer = setInterval(() => { void reconcileFeishu() }, config.feishuSyncIntervalMs)
  feishuSyncTimer.unref()
  void reconcileFeishu()
  server.listen(config.port, config.listenHost, () => {
    process.stdout.write(`Phoenix Family OS server listening on port ${config.port}\n`)
  })

  const shutdown = (): void => {
    clearInterval(refundSweepTimer)
    clearInterval(feishuSyncTimer)
    server.close(() => {
      void store.close?.().finally(() => process.exit(0))
    })
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

void main().catch((error: unknown) => {
  process.stderr.write(`Server startup failed: ${error instanceof Error ? error.name : 'UnknownError'}\n`)
  process.exitCode = 1
})
