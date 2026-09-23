import { createHash } from 'node:crypto'
import { AppError, invariant } from '../domain/errors'
import {
  consentCopySha256,
  CORE_ASSESSMENT_CONSENT_COPY,
  CORE_ASSESSMENT_CONSENT_VERSION,
  STUDENT_ASSESSMENT_ASSENT_COPY,
  STUDENT_ASSESSMENT_ASSENT_VERSION
} from '../domain/education-compass/consent-policy'
import { COMPASS_PRODUCT_CODE, defaultProductDeliverables, defaultProducts, GROWTH_DISCOVERY_PRODUCT_CODE } from '../domain/products'
import { Order, OrderStatus, Refund, RefundStatus } from '../domain/model'
import { PLACEHOLDER_SOURCE_CATALOG, SourceCatalog } from '../domain/source-catalog'
import { HeaderBag, MiniProgramPaymentParams, PaymentProvider, RefundResult, TransactionResult } from '../payments/payment-provider'
import { Store, StoreTransaction } from '../store/store'
import { addMilliseconds, Clock, IdFactory, iso, outTradeNo, randomId, systemClock } from '../utils/runtime'
import { appendTimeline } from './profile-service'

const PROVIDER_QUERY_MIN_INTERVAL_MS = 5_000
const REFUND_RECONCILIATION_MIN_INTERVAL_MS = 60_000

export interface OrderDto {
  orderId: string
  outTradeNo: string
  status: OrderStatus
  productCode: string
  amountFen: number
  currency: string
  reportId: string | null
  expiresAt: string
  paidAt?: string
  refundedAt?: string
}

/**
 * 账号注销后订单保留为财务凭证，但与个人数据的关联被置空（见 migrations/007）。
 * 这类订单不可能再进入任何业务流程——会话、家庭、测评和报告都已删除——
 * 所以在入口处一次性断言，而不是让下游拿着 null 去查库、报出难以追查的错。
 */
type LinkedOrder = Order & {
  familyId: string
  studentId: string
  assessmentId: string
  reportId: string
}

function linkedOrder(order: Order): LinkedOrder {
  invariant(
    order.familyId !== null && order.studentId !== null &&
    order.assessmentId !== null && order.reportId !== null,
    409, 'ORDER_DETACHED', '该订单关联的账号已注销，仅保留为财务凭证'
  )
  return order as LinkedOrder
}

/**
 * 退款政策（OD-07）。
 *
 * 数字内容一经交付就收不回来，所以窗口用两个可自动判定的客观标准，避免逐案争议：
 * 支付后 7 天内，且从未下载过 PDF（下载视为已消费完毕）。
 *
 * 因我方原因的退款不受此限——来源目录撤回、报告事实错误、系统故障导致无法交付。
 * 运维手册明确规定"不得以拒绝交付代替退款"，所以这条豁免不是可选项：
 * 没有它，出了内容事故就会变成"想退也退不了"。
 */
const REFUND_WINDOW_DAYS = 7
const MERCHANT_FAULT_EXCEPTION = 'MERCHANT_FAULT'

function dto(order: Order): OrderDto {
  return {
    orderId: order.id,
    outTradeNo: order.outTradeNo,
    status: order.status,
    productCode: order.productCode,
    amountFen: order.amountFen,
    currency: order.currency,
    reportId: order.reportId,
    expiresAt: order.expiresAt,
    ...(order.paidAt ? { paidAt: order.paidAt } : {}),
    ...(order.refundedAt ? { refundedAt: order.refundedAt } : {})
  }
}

export async function seedProducts(store: Store, at: string): Promise<void> {
  await store.transaction(async (tx) => {
    for (const product of defaultProducts(at)) {
      if (!await tx.findById('products', product.id)) await tx.insert('products', product)
    }
    for (const deliverable of defaultProductDeliverables(at)) {
      if (!await tx.findById('productDeliverables', deliverable.id)) await tx.insert('productDeliverables', deliverable)
    }
  })
}

export class OrderService {
  constructor(
    private readonly store: Store,
    private readonly provider: PaymentProvider,
    private readonly sourceCatalog: SourceCatalog = PLACEHOLDER_SOURCE_CATALOG,
    private readonly paidCompassEnabled = false,
    private readonly clock: Clock = systemClock,
    private readonly ids: IdFactory = randomId,
    private readonly growthDiscoveryPaymentEnabled = false
  ) {}

  private async validatePayableDependencies(tx: StoreTransaction, rawOrder: Order): Promise<void> {
    const order = linkedOrder(rawOrder)
    invariant(
      (order.productCode === COMPASS_PRODUCT_CODE || order.productCode === GROWTH_DISCOVERY_PRODUCT_CODE) &&
        order.amountFen === 3990 && order.currency === 'CNY',
      500, 'ORDER_PRICE_INVALID', '订单商品或金额配置无效'
    )
    const assessment = await tx.findById('assessments', order.assessmentId, { forUpdate: true })
    invariant(assessment?.reportId === order.reportId, 409, 'ASSESSMENT_NOT_READY', '问卷已不满足支付条件')
    const product = await tx.findById('products', order.productCode, { forUpdate: true })
    invariant(product?.active && product.scope === 'SINGLE_REPORT', 409, 'PRODUCT_UNAVAILABLE', '39.9报告商品暂不可购买')
    invariant(product.amountFen === 3990 && product.currency === 'CNY', 500, 'PRODUCT_PRICE_INVALID', '商品价格配置无效')
    const report = await tx.findById('reports', order.reportId, { forUpdate: true })
    const deliverable = await tx.findOne('productDeliverables', { productCode: order.productCode })
    invariant(deliverable?.active && report?.reportKind === deliverable.reportKind,
      409, 'PRODUCT_DELIVERABLE_MISMATCH', '商品与报告类型不匹配或当前交付映射已停用')
    if (order.productCode === GROWTH_DISCOVERY_PRODUCT_CODE) {
      invariant(this.growthDiscoveryPaymentEnabled, 503, 'GROWTH_DISCOVERY_PAYMENT_DISABLED', '学生成长发现支付尚未启用')
      invariant(assessment.assessmentKind === 'STUDENT_GROWTH_DISCOVERY' && assessment.status === 'SUBMITTED' &&
        assessment.resultKind === 'STUDENT_GROWTH_DISCOVERY' &&
        assessment.respondentConfirmation === 'CONFIRM_STUDENT_SELF' && assessment.studentAssentGrantId,
        409, 'ASSESSMENT_NOT_READY', '学生成长发现尚未完成有效提交')
      invariant(await this.hasActiveGrowthConsents(tx, order), 403,
        'GROWTH_DISCOVERY_CONSENT_REQUIRED', '核心测评或学生本人同意无效、版本不匹配或已撤回')
      invariant(report.status === 'LOCKED' && report.deliveryStatus === 'LOCKED' && report.qaPassed &&
        report.resultVersion === 'student_growth_discovery_report_v1.0.0' && report.resultPayload,
        409, 'REPORT_QA_REQUIRED', '成长发现报告尚未通过收费前QA')
      return
    }
    invariant(assessment.status === 'PREVIEW_READY' && assessment.completenessScore >= 70, 409, 'ASSESSMENT_NOT_READY', '问卷已不满足支付条件')
    const consent = await tx.findById('consents', assessment.consentId, { forUpdate: true })
    invariant(consent?.guardianConfirmed && !consent.revokedAt, 403, 'GUARDIAN_CONSENT_REQUIRED', '监护人同意无效或已撤回')
    invariant(this.sourceCatalog.verified && report?.sourceCatalogVerified, 503, 'SOURCE_CATALOG_NOT_VERIFIED', '来源目录尚未通过审核，暂不能支付')
    invariant(report.sourceCatalogVersion === this.sourceCatalog.version && report.status === 'LOCKED' && report.deliveryStatus === 'LOCKED', 409, 'REPORT_NOT_PAYABLE', '报告锁定状态或来源版本无效')
    invariant(report.qaPassed && report.modules?.length === 6, 409, 'REPORT_QA_REQUIRED', '报告尚未通过收费前QA')
  }

  async createOrder(
    userId: string,
    assessmentId: string,
    input: { productCode: string; idempotencyKey: string }
  ): Promise<OrderDto> {
    const productCode = input.productCode
    invariant(productCode === COMPASS_PRODUCT_CODE || productCode === GROWTH_DISCOVERY_PRODUCT_CODE,
      400, 'PRODUCT_NOT_SUPPORTED', '该测评不支持所选商品')
    if (productCode === COMPASS_PRODUCT_CODE) {
      invariant(this.paidCompassEnabled, 503, 'PAID_COMPASS_DISABLED', '付费报告尚未完成上线审批，暂不能购买')
    } else {
      invariant(this.growthDiscoveryPaymentEnabled, 503, 'GROWTH_DISCOVERY_PAYMENT_DISABLED', '学生成长发现支付尚未启用')
    }
    invariant(/^[A-Za-z0-9_.:-]{8,128}$/.test(input.idempotencyKey), 400, 'IDEMPOTENCY_KEY_INVALID', '幂等键格式无效')
    const nowDate = this.clock()
    const now = nowDate.toISOString()
    return this.store.transaction(async (tx) => {
      const isGrowthDiscovery = productCode === GROWTH_DISCOVERY_PRODUCT_CODE
      const keyDigest = createHash('sha256').update(input.idempotencyKey, 'utf8').digest('hex')
      const orderInputDigest = createHash('sha256')
        .update(JSON.stringify([assessmentId, productCode]), 'utf8').digest('hex')
      if (isGrowthDiscovery) {
        const replay = await tx.findOne('idempotencyRecords', {
          userId, domain: 'ORDER_CREATE', keyDigest
        }, { forUpdate: true })
        if (replay) {
          invariant(replay.inputDigest === orderInputDigest, 409, 'IDEMPOTENCY_KEY_REUSED', '幂等键已用于其他订单')
          invariant(replay.status === 'COMPLETED' && replay.resourceType === 'order' && replay.resourceId,
            409, 'IDEMPOTENCY_IN_PROGRESS', '订单幂等请求仍在处理中')
          const replayOrder = await tx.findById('orders', replay.resourceId, { forUpdate: true })
          invariant(replayOrder?.userId === userId, 500, 'IDEMPOTENCY_RESOURCE_MISSING', '订单幂等资源不存在')
          return dto(replayOrder)
        }
      }
      const storedIdempotencyKey = isGrowthDiscovery ? `v05_order_${keyDigest}` : input.idempotencyKey
      const byKey = await tx.findOne('orders', { userId, idempotencyKey: storedIdempotencyKey }, { forUpdate: true }) ??
        (isGrowthDiscovery
          ? await tx.findOne('orders', { userId, idempotencyKey: input.idempotencyKey }, { forUpdate: true })
          : null)
      if (byKey) {
        invariant(byKey.assessmentId === assessmentId && byKey.productCode === input.productCode, 409, 'IDEMPOTENCY_KEY_REUSED', '幂等键已用于其他订单')
        if (isGrowthDiscovery) {
          await tx.insert('idempotencyRecords', {
            id: this.ids('idem'), userId, domain: 'ORDER_CREATE', keyDigest, inputDigest: orderInputDigest,
            status: 'COMPLETED', resourceType: 'order', resourceId: byKey.id, responseStatus: 201,
            responseDigest: createHash('sha256').update(JSON.stringify(['order', byKey.id, 201])).digest('hex'),
            createdAt: now, updatedAt: now, completedAt: now
          })
        }
        return dto(byKey)
      }
      const assessment = await tx.findById('assessments', assessmentId, { forUpdate: true })
      invariant(assessment, 404, 'ASSESSMENT_NOT_FOUND', '问卷不存在')
      invariant(assessment.userId === userId, 403, 'ORDER_FORBIDDEN', '无权为该问卷创建订单')
      invariant(assessment.reportId, 409, 'ASSESSMENT_NOT_READY', '问卷尚未达到付费条件')
      const product = await tx.findById('products', productCode)
      invariant(product?.active && product.scope === 'SINGLE_REPORT', 409, 'PRODUCT_UNAVAILABLE', '39.9报告商品暂不可购买')
      invariant(product.amountFen === 3990 && product.currency === 'CNY', 500, 'PRODUCT_PRICE_INVALID', '商品价格配置无效')
      const report = await tx.findById('reports', assessment.reportId, { forUpdate: true })
      invariant(report, 409, 'REPORT_NOT_LOCKED', '报告未处于可购买锁定状态')

      const dependencyOrder: Order = {
        id: 'validation-only', outTradeNo: 'VALIDATION', userId,
        familyId: assessment.familyId, studentId: assessment.studentId,
        assessmentId, reportId: assessment.reportId, productCode: productCode as Order['productCode'],
        amountFen: product.amountFen, currency: product.currency, status: 'CREATED', idempotencyKey: storedIdempotencyKey,
        provider: this.provider.name, createdAt: now, updatedAt: now,
        expiresAt: addMilliseconds(nowDate, 2 * 60 * 60 * 1000)
      }
      await this.validatePayableDependencies(tx, dependencyOrder)

      const existingOrders = await tx.findMany('orders', { userId, assessmentId, productCode: productCode as Order['productCode'] })
      const active = existingOrders.find((order) => ['CREATED', 'PENDING', 'PAID', 'REFUNDING'].includes(order.status))
      if (active) {
        if (isGrowthDiscovery) {
          await tx.insert('idempotencyRecords', {
            id: this.ids('idem'), userId, domain: 'ORDER_CREATE', keyDigest, inputDigest: orderInputDigest,
            status: 'COMPLETED', resourceType: 'order', resourceId: active.id, responseStatus: 201,
            responseDigest: createHash('sha256').update(JSON.stringify(['order', active.id, 201])).digest('hex'),
            createdAt: now, updatedAt: now, completedAt: now
          })
        }
        return dto(active)
      }

      const order: Order = {
        id: this.ids('ord'), outTradeNo: outTradeNo('PX'), userId,
        familyId: assessment.familyId, studentId: assessment.studentId,
        assessmentId, reportId: assessment.reportId, productCode: productCode as Order['productCode'],
        amountFen: product.amountFen, currency: product.currency, status: 'CREATED', idempotencyKey: storedIdempotencyKey,
        provider: this.provider.name, providerPrepayId: null, paymentParams: null,
        providerTransactionId: null, lastProviderQueryAt: null,
        createdAt: now, updatedAt: now, expiresAt: addMilliseconds(nowDate, 2 * 60 * 60 * 1000),
        paidAt: null, refundedAt: null
      }
      await tx.insert('orders', order)
      if (isGrowthDiscovery) {
        await tx.insert('idempotencyRecords', {
          id: this.ids('idem'), userId, domain: 'ORDER_CREATE', keyDigest, inputDigest: orderInputDigest,
          status: 'COMPLETED', resourceType: 'order', resourceId: order.id, responseStatus: 201,
          responseDigest: createHash('sha256').update(JSON.stringify(['order', order.id, 201])).digest('hex'),
          createdAt: now, updatedAt: now, completedAt: now
        })
      }
      const created = linkedOrder(order)
      await appendTimeline(tx, this.ids, now, {
        userId, familyId: created.familyId, eventType: 'order_created', description: '已创建 Education Compass 报告订单',
        reportId: created.reportId, orderId: created.id
      })
      return dto(order)
    })
  }

  async createWechatPrepay(userId: string, orderId: string): Promise<{
    orderId: string
    status: 'PENDING'
    paymentParams: MiniProgramPaymentParams
  }> {
    const snapshot = await this.store.transaction(async (tx) => {
      const order = await tx.findById('orders', orderId, { forUpdate: true })
      invariant(order, 404, 'ORDER_NOT_FOUND', '订单不存在')
      invariant(order.userId === userId, 403, 'ORDER_FORBIDDEN', '无权访问该订单')
      if (order.productCode === GROWTH_DISCOVERY_PRODUCT_CODE) {
        invariant(this.growthDiscoveryPaymentEnabled, 503, 'GROWTH_DISCOVERY_PAYMENT_DISABLED', '学生成长发现支付尚未启用')
      } else {
        invariant(this.paidCompassEnabled, 503, 'PAID_COMPASS_DISABLED', '付费报告尚未完成上线审批，暂不能支付')
      }
      invariant(!['PAID', 'REFUNDING', 'REFUNDED'].includes(order.status), 409, 'ORDER_ALREADY_PAID', '订单已支付或退款中')
      invariant(!['FAILED', 'CANCELLED'].includes(order.status), 409, 'ORDER_NOT_PAYABLE', '订单已失效，请重新创建')
      invariant(new Date(order.expiresAt).getTime() > this.clock().getTime(), 409, 'ORDER_EXPIRED', '订单已过期，请重新创建')
      await this.validatePayableDependencies(tx, order)
      const identity = await tx.findOne('wechatIdentities', { userId })
      invariant(identity, 409, 'WECHAT_IDENTITY_REQUIRED', '当前用户未绑定微信身份')
      return { order, payerOpenid: identity.openid }
    })
    if (snapshot.order.status === 'PENDING' && snapshot.order.paymentParams) {
      return { orderId, status: 'PENDING', paymentParams: snapshot.order.paymentParams }
    }
    const prepay = await this.provider.createPrepay(snapshot.order, snapshot.payerOpenid)
    try {
      await this.store.transaction(async (tx) => {
        const current = await tx.findById('orders', orderId, { forUpdate: true })
        invariant(current?.userId === userId, 409, 'ORDER_STATE_CHANGED', '订单状态已变化')
        invariant(current.status === 'CREATED' || current.status === 'PENDING', 409, 'ORDER_STATE_CHANGED', '订单状态已变化')
        invariant(new Date(current.expiresAt).getTime() > this.clock().getTime(), 409, 'ORDER_EXPIRED', '订单已过期，请重新创建')
        await this.validatePayableDependencies(tx, current)
        await tx.update('orders', orderId, {
          status: 'PENDING', providerPrepayId: prepay.providerPrepayId,
          paymentParams: prepay.paymentParams, updatedAt: iso(this.clock)
        })
      })
    } catch (error) {
      // A consent/product/report change during the provider call must not leave
      // an untracked payable transaction. Only cancel locally after close succeeds.
      await this.provider.closeOrder(snapshot.order.outTradeNo)
      await this.store.transaction(async (tx) => {
        const current = await tx.findById('orders', orderId, { forUpdate: true })
        if (current && ['CREATED', 'PENDING'].includes(current.status)) {
          await tx.update('orders', orderId, { status: 'CANCELLED', paymentParams: null, updatedAt: iso(this.clock) })
        }
      })
      throw error
    }
    return { orderId, status: 'PENDING', paymentParams: prepay.paymentParams }
  }

  async getOrder(userId: string, orderId: string, reconcile = true): Promise<OrderDto> {
    let order = await this.store.read(async (tx) => {
      const found = await tx.findById('orders', orderId)
      invariant(found, 404, 'ORDER_NOT_FOUND', '订单不存在')
      invariant(found.userId === userId, 403, 'ORDER_FORBIDDEN', '无权访问该订单')
      return found
    })
    const expired = new Date(order.expiresAt).getTime() <= this.clock().getTime()
    if (order.status === 'CREATED' && expired) {
      order = await this.store.transaction(async (tx) => tx.update('orders', order.id, { status: 'CANCELLED', updatedAt: iso(this.clock) }))
    } else if (reconcile && order.status === 'PENDING') {
      const queryAt = iso(this.clock)
      const claimed = await this.store.transaction(async (tx) => {
        const current = await tx.findById('orders', order.id, { forUpdate: true })
        if (!current || current.status !== 'PENDING') return false
        const lastQuery = current.lastProviderQueryAt ? Date.parse(current.lastProviderQueryAt) : 0
        if (Number.isFinite(lastQuery) && this.clock().getTime() - lastQuery < PROVIDER_QUERY_MIN_INTERVAL_MS) return false
        await tx.update('orders', current.id, { lastProviderQueryAt: queryAt, updatedAt: queryAt })
        return true
      })
      if (claimed) {
        const result = await this.provider.queryOrder(order.outTradeNo)
        const queryResult = { ...result, eventId: `query:${order.outTradeNo}:${result.tradeState}:${result.transactionId}` }
        await this.applyTransaction(queryResult, 'QUERY_RECONCILIATION', createHash('sha256').update(JSON.stringify(queryResult)).digest('hex'))
        if (expired && result.tradeState === 'NOTPAY') {
          await this.provider.closeOrder(order.outTradeNo)
          const closedResult: TransactionResult = {
            ...result,
            eventId: `close:${order.outTradeNo}:${result.transactionId}`,
            tradeState: 'CLOSED'
          }
          await this.applyTransaction(closedResult, 'QUERY_RECONCILIATION', createHash('sha256').update(JSON.stringify(closedResult)).digest('hex'))
        }
      }
      order = await this.store.read(async (tx) => (await tx.findById('orders', order.id))!)
    }
    return dto(order)
  }

  async handleTransactionNotification(headers: HeaderBag, rawBody: Buffer): Promise<{ duplicate: boolean; orderId: string }> {
    const result = await this.provider.parseTransactionNotification(headers, rawBody)
    return this.applyTransaction(result, 'TRANSACTION', createHash('sha256').update(rawBody).digest('hex'))
  }

  async requestRefund(
    adminUserId: string,
    orderId: string,
    input: { idempotencyKey: string; reason: string; policyException?: string }
  ): Promise<Refund> {
    invariant(/^[A-Za-z0-9_.:-]{8,128}$/.test(input.idempotencyKey), 400, 'IDEMPOTENCY_KEY_INVALID', '退款幂等键格式无效')
    const reason = input.reason.trim()
    invariant(reason.length > 0 && reason.length <= 80, 400, 'REFUND_REASON_INVALID', '退款原因需要1至80个字符')
    const now = iso(this.clock)
    const prepared = await this.store.transaction(async (tx) => {
      const admin = await tx.findById('users', adminUserId)
      invariant(admin?.role === 'admin', 403, 'ADMIN_REQUIRED', '只有管理员可以发起退款')
      const byKey = await tx.findOne('refunds', { requestedBy: adminUserId, idempotencyKey: input.idempotencyKey }, { forUpdate: true })
      if (byKey) {
        invariant(byKey.orderId === orderId, 409, 'IDEMPOTENCY_KEY_REUSED', '退款幂等键已用于其他订单')
        const priorOrder = await tx.findById('orders', orderId)
        invariant(priorOrder, 404, 'ORDER_NOT_FOUND', '订单不存在')
        return { order: priorOrder, refund: byKey }
      }
      const order = await tx.findById('orders', orderId, { forUpdate: true })
      invariant(order, 404, 'ORDER_NOT_FOUND', '订单不存在')
      invariant(order.status === 'PAID' || order.status === 'REFUNDING', 409, 'ORDER_NOT_REFUNDABLE', '订单当前不可退款')
      const existing = await tx.findOne('refunds', { orderId }, { forUpdate: true })
      // 放在这之后：已在途的退款重试永远不该被政策挡住，否则会把它卡死在中间状态。
      if (existing) return { order, refund: existing }

      const merchantFault = input.policyException === MERCHANT_FAULT_EXCEPTION
      if (!merchantFault) {
        invariant(order.paidAt, 409, 'REFUND_WINDOW_EXPIRED', '订单没有支付时间，无法判断退款窗口')
        const elapsedDays = (Date.parse(now) - Date.parse(order.paidAt)) / 86_400_000
        invariant(elapsedDays <= REFUND_WINDOW_DAYS, 409, 'REFUND_WINDOW_EXPIRED',
          `超过支付后 ${REFUND_WINDOW_DAYS} 天的退款窗口；因我方原因退款请走 ${MERCHANT_FAULT_EXCEPTION}`)
        // 账号注销后订单与报告脱钩（reportId 为空），查不到下载状态。
        // 此时不阻断：数据已经删了，用"查不到"去拒绝退款是拿我方的删除行为惩罚用户。
        if (order.reportId) {
          const report = await tx.findById('reports', order.reportId)
          invariant(!report?.pdfFirstDownloadedAt, 409, 'REFUND_REPORT_DOWNLOADED',
            `报告已于 ${report?.pdfFirstDownloadedAt} 下载，视为已消费；因我方原因退款请走 ${MERCHANT_FAULT_EXCEPTION}`)
        }
      }

      const refund = await tx.insert('refunds', {
        id: this.ids('rfd'), outRefundNo: outTradeNo('PR'), orderId,
        requestedBy: adminUserId, idempotencyKey: input.idempotencyKey, reason,
        amountFen: order.amountFen, currency: order.currency, status: 'PROCESSING',
        providerRefundId: null, createdAt: now, updatedAt: now, succeededAt: null
      })
      await tx.update('orders', order.id, { status: 'REFUNDING', updatedAt: now })
      await tx.insert('auditLogs', {
        id: this.ids('aud'), actorUserId: adminUserId, action: 'refund_requested',
        entityType: 'order', entityId: order.id,
        // 记下是否绕过了窗口政策：不记的话，事后无法回答"这笔为什么能退"。
        metadata: {
          outRefundNo: refund.outRefundNo, amountFen: refund.amountFen,
          ...(merchantFault ? { policyException: MERCHANT_FAULT_EXCEPTION } : {})
        },
        createdAt: now
      })
      return { order, refund }
    })
    if (prepared.refund.providerRefundId) {
      return this.reconcileRefund(await this.provider.queryRefund(prepared.refund.outRefundNo))
    }
    let providerResult: { providerRefundId: string; status: RefundStatus }
    let queriedResult: RefundResult | null = null
    try {
      providerResult = await this.provider.requestRefund(prepared.order, prepared.refund)
      if (providerResult.status !== 'PROCESSING') queriedResult = await this.provider.queryRefund(prepared.refund.outRefundNo)
    } catch (originalError) {
      try {
        queriedResult = await this.provider.queryRefund(prepared.refund.outRefundNo)
        providerResult = { providerRefundId: queriedResult.providerRefundId, status: queriedResult.refundStatus }
      } catch {
        throw originalError
      }
    }
    if (queriedResult) return this.reconcileRefund(queriedResult)
    return this.store.transaction(async (tx) => {
      const current = await tx.findById('refunds', prepared.refund.id, { forUpdate: true })
      invariant(current, 404, 'REFUND_NOT_FOUND', '退款记录不存在')
      if (current.status !== 'PROCESSING') return current
      return tx.update('refunds', current.id, {
        providerRefundId: providerResult.providerRefundId,
        status: providerResult.status,
        updatedAt: iso(this.clock)
      })
    })
  }

  async handleRefundNotification(headers: HeaderBag, rawBody: Buffer): Promise<{ duplicate: boolean; orderId: string }> {
    const result = await this.provider.parseRefundNotification(headers, rawBody)
    return this.applyRefund(result, createHash('sha256').update(rawBody).digest('hex'))
  }

  async reconcilePendingRefunds(
    limit = 50,
    minIntervalMs = REFUND_RECONCILIATION_MIN_INTERVAL_MS
  ): Promise<{ checked: number; succeeded: number; failed: number }> {
    invariant(Number.isInteger(limit) && limit > 0 && limit <= 200, 500, 'REFUND_RECONCILIATION_LIMIT_INVALID', '退款对账批量上限无效')
    const candidates = await this.store.read(async (tx) => (await tx.findMany('refunds', { status: 'PROCESSING' }))
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .slice(0, limit))
    let checked = 0
    let succeeded = 0
    let failed = 0
    for (const candidate of candidates) {
      const claimedAt = iso(this.clock)
      const claimed = await this.store.transaction(async (tx) => {
        const current = await tx.findById('refunds', candidate.id, { forUpdate: true })
        if (!current || current.status !== 'PROCESSING') return false
        const lastAttempt = Date.parse(current.updatedAt)
        if (Number.isFinite(lastAttempt) && this.clock().getTime() - lastAttempt < minIntervalMs) return false
        await tx.update('refunds', current.id, { updatedAt: claimedAt })
        return true
      })
      if (!claimed) continue
      checked += 1
      try {
        if (!candidate.providerRefundId) {
          const order = await this.store.read(async (tx) => tx.findById('orders', candidate.orderId))
          invariant(order, 404, 'ORDER_NOT_FOUND', '退款对应订单不存在')
          try {
            const requested = await this.provider.requestRefund(order, candidate)
            await this.store.transaction(async (tx) => {
              const current = await tx.findById('refunds', candidate.id, { forUpdate: true })
              if (current?.status === 'PROCESSING' && !current.providerRefundId) {
                await tx.update('refunds', current.id, { providerRefundId: requested.providerRefundId, updatedAt: claimedAt })
              }
            })
          } catch {
            // out_refund_no is the provider idempotency key. An uncertain prior
            // request is resolved by the signed query immediately below.
          }
        }
        const refund = await this.reconcileRefund(await this.provider.queryRefund(candidate.outRefundNo))
        if (refund.status === 'SUCCESS') succeeded += 1
      } catch {
        // The claim timestamp provides durable backoff. The scheduler reports the
        // aggregate failure count without logging payment or family payloads.
        failed += 1
      }
    }
    return { checked, succeeded, failed }
  }

  private async reconcileRefund(result: RefundResult): Promise<Refund> {
    if (result.refundStatus !== 'PROCESSING') {
      await this.applyRefund(result, createHash('sha256').update(JSON.stringify(result)).digest('hex'))
    } else {
      await this.store.transaction(async (tx) => {
        const refund = await tx.findOne('refunds', { outRefundNo: result.outRefundNo }, { forUpdate: true })
        invariant(refund, 404, 'REFUND_NOT_FOUND', '退款记录不存在')
        if (refund.status === 'PROCESSING') {
          await tx.update('refunds', refund.id, {
            providerRefundId: result.providerRefundId,
            status: result.refundStatus,
            updatedAt: iso(this.clock)
          })
        }
      })
    }
    return this.store.read(async (tx) => {
      const refund = await tx.findOne('refunds', { outRefundNo: result.outRefundNo })
      invariant(refund, 404, 'REFUND_NOT_FOUND', '退款记录不存在')
      return refund
    })
  }

  private async applyTransaction(
    result: TransactionResult,
    eventKind: 'TRANSACTION' | 'QUERY_RECONCILIATION',
    bodyDigest: string
  ): Promise<{ duplicate: boolean; orderId: string }> {
    const now = iso(this.clock)
    return this.store.transaction(async (tx) => {
      const duplicate = await tx.findOne('paymentEvents', { providerEventId: result.eventId }, { forUpdate: true })
      if (duplicate) {
        invariant(duplicate.bodyDigest === bodyDigest && duplicate.outTradeNo === result.outTradeNo, 409, 'PAYMENT_EVENT_CONFLICT', '相同支付事件ID对应了不同内容')
        const priorOrder = await tx.findOne('orders', { outTradeNo: duplicate.outTradeNo })
        return { duplicate: true, orderId: priorOrder?.id ?? '' }
      }
      const order = await tx.findOne('orders', { outTradeNo: result.outTradeNo }, { forUpdate: true })
      invariant(order, 404, 'PAYMENT_ORDER_NOT_FOUND', '支付通知对应订单不存在')
      await this.validateTransaction(tx, order, result)
      await tx.insert('paymentEvents', {
        id: this.ids('pev'), providerEventId: result.eventId, eventKind,
        outTradeNo: result.outTradeNo, bodyDigest, verified: true, processedAt: now
      })

      // The kill switch and current catalog are checked before creating prepay.
      // Once signed payment parameters have been issued, a later verified SUCCESS
      // is honored against that immutable QA-passed report snapshot; otherwise a
      // configuration rollback could leave a charged family without delivery.
      if (result.tradeState === 'SUCCESS' && !['REFUNDED', 'REFUNDING'].includes(order.status)) {
        if (order.status !== 'PAID') {
          const settling = linkedOrder(order)
          const report = await tx.findById('reports', settling.reportId, { forUpdate: true })
          const job = await tx.findOne('reportJobs', { reportId: settling.reportId }, { forUpdate: true })
          invariant(report?.status === 'LOCKED' && report.deliveryStatus === 'LOCKED', 500, 'REPORT_DELIVERY_PRECONDITION_FAILED', '报告未处于收费前锁定状态')
          const deliverable = await tx.findOne('productDeliverables', { productCode: order.productCode })
          invariant(deliverable?.reportKind === report.reportKind, 500, 'REPORT_DELIVERY_PRECONDITION_FAILED', '商品与报告交付类型不匹配')
          const legacyReady = order.productCode === COMPASS_PRODUCT_CODE && report.qaPassed &&
            report.modules?.length === 6 && report.sourceCatalogVerified
          const growthReady = order.productCode === GROWTH_DISCOVERY_PRODUCT_CODE && report.qaPassed &&
            report.reportKind === 'STUDENT_GROWTH_DISCOVERY' && report.resultPayload &&
            report.resultVersion === 'student_growth_discovery_report_v1.0.0'
          invariant(Boolean(legacyReady || growthReady), 500, 'REPORT_DELIVERY_PRECONDITION_FAILED', '报告未通过收费前QA或来源审核')
          invariant(job?.status === 'SUCCEEDED', 500, 'REPORT_DELIVERY_PRECONDITION_FAILED', '收费前报告任务未成功')
          const paidAt = result.successTime ?? now
          if (order.productCode === GROWTH_DISCOVERY_PRODUCT_CODE && !await this.hasActiveGrowthConsents(tx, order)) {
            await tx.update('orders', order.id, {
              status: 'REFUNDING', providerTransactionId: result.transactionId,
              paidAt, updatedAt: now, paymentParams: null
            })
            if (!await tx.findOne('refunds', { orderId: order.id }, { forUpdate: true })) {
              const refund = await tx.insert('refunds', {
                id: this.ids('rfd'), outRefundNo: outTradeNo('PR'), orderId: order.id,
                requestedBy: order.userId,
                idempotencyKey: `auto-consent-withdrawn-${order.id}`.slice(0, 128),
                reason: 'CONSENT_WITHDRAWN_BEFORE_DELIVERY', amountFen: order.amountFen,
                currency: order.currency, status: 'PROCESSING', providerRefundId: null,
                createdAt: now, updatedAt: now, succeededAt: null
              })
              await tx.insert('auditLogs', {
                id: this.ids('aud'), actorUserId: order.userId,
                action: 'automatic_refund_requested', entityType: 'order', entityId: order.id,
                metadata: { outRefundNo: refund.outRefundNo, reason: refund.reason }, createdAt: now
              })
              await appendTimeline(tx, this.ids, now, {
                userId: settling.userId, familyId: settling.familyId,
                eventType: 'order_refund_pending',
                description: '支付成功前相关同意已撤回，完整报告未解锁并已自动进入退款处理',
                reportId: settling.reportId, orderId: settling.id
              })
            }
            return { duplicate: false, orderId: order.id }
          }
          await tx.update('orders', order.id, {
            status: 'PAID', providerTransactionId: result.transactionId,
            paidAt, updatedAt: now, paymentParams: null
          })
          if (!await tx.findOne('entitlements', { orderId: order.id })) {
            await tx.insert('entitlements', {
              id: this.ids('ent'), userId: order.userId, orderId: order.id,
              reportId: order.reportId, productCode: order.productCode,
              status: 'ACTIVE', grantedAt: now, revokedAt: null
            })
          }
          await tx.update('reports', report.id, { status: 'READY', deliveryStatus: 'DELIVERED', updatedAt: now })
          await tx.update('reportJobs', job.id, { orderId: order.id, updatedAt: now })
          await appendTimeline(tx, this.ids, now, {
            userId: settling.userId, familyId: settling.familyId, eventType: 'report_unlocked',
            description: '支付已确认，完整报告已解锁', reportId: settling.reportId, orderId: settling.id
          })
        }
      } else if (result.tradeState !== 'SUCCESS' && !['PAID', 'REFUNDING', 'REFUNDED'].includes(order.status)) {
        const next = this.orderStatusForTradeState(result.tradeState)
        if (next) await tx.update('orders', order.id, { status: next, updatedAt: now })
      }
      return { duplicate: false, orderId: order.id }
    })
  }

  private async validateTransaction(tx: StoreTransaction, order: Order, result: TransactionResult): Promise<void> {
    invariant(result.appId === this.provider.appId, 400, 'PAYMENT_APPID_MISMATCH', '支付通知 AppID 不匹配')
    invariant(result.mchId === this.provider.mchId, 400, 'PAYMENT_MCHID_MISMATCH', '支付通知商户号不匹配')
    invariant(result.tradeType === 'JSAPI', 400, 'PAYMENT_TRADE_TYPE_INVALID', '支付交易类型无效')
    const success = result.tradeState === 'SUCCESS'
    if (success || result.totalFen !== undefined) {
      invariant(result.totalFen === order.amountFen && result.totalFen === 3990, 400, 'PAYMENT_AMOUNT_MISMATCH', '支付金额不匹配')
    }
    if (success || result.currency !== undefined) {
      invariant(result.currency === order.currency && result.currency === 'CNY', 400, 'PAYMENT_CURRENCY_MISMATCH', '支付币种不匹配')
    }
    if (success || result.payerOpenid !== undefined) {
      const identity = await tx.findOne('wechatIdentities', { userId: order.userId })
      invariant(identity?.openid === result.payerOpenid, 400, 'PAYMENT_PAYER_MISMATCH', '支付人身份不匹配')
    }
    if (success) invariant(result.transactionId.length > 0, 400, 'PAYMENT_TRANSACTION_ID_MISSING', '微信支付交易号缺失')
  }

  private async hasActiveGrowthConsents(tx: StoreTransaction, rawOrder: Order): Promise<boolean> {
    const order = linkedOrder(rawOrder)
    const assessment = await tx.findById('assessments', order.assessmentId, { forUpdate: true })
    if (!assessment || assessment.userId !== order.userId || assessment.familyId !== order.familyId ||
      assessment.studentId !== order.studentId || assessment.assessmentKind !== 'STUDENT_GROWTH_DISCOVERY') return false
    const core = assessment.coreConsentGrantId
      ? await tx.findById('consentGrants', assessment.coreConsentGrantId, { forUpdate: true })
      : null
    const coreValid = core?.userId === order.userId && core.familyId === order.familyId &&
      core.studentId === order.studentId && core.subjectType === 'STUDENT' &&
      core.subjectId === order.studentId && core.scope === 'CORE_ASSESSMENT' &&
      core.subjectRole === 'PARENT_GUARDIAN' && core.copyVersion === CORE_ASSESSMENT_CONSENT_VERSION &&
      core.copyTextHash === consentCopySha256(CORE_ASSESSMENT_CONSENT_COPY) && core.locale === 'zh-CN' &&
      core.guardianAuthorityStatus === 'CONFIRMED' && !core.withdrawnAt
    const assent = assessment.studentAssentGrantId
      ? await tx.findById('consentGrants', assessment.studentAssentGrantId, { forUpdate: true })
      : null
    const assentValid = assent?.userId === order.userId && assent.familyId === order.familyId &&
      assent.studentId === order.studentId && assent.subjectType === 'STUDENT' &&
      assent.subjectId === order.studentId && assent.scope === 'STUDENT_ASSESSMENT_ASSENT' &&
      assent.subjectRole === 'STUDENT' && assent.copyVersion === STUDENT_ASSESSMENT_ASSENT_VERSION &&
      assent.copyTextHash === consentCopySha256(STUDENT_ASSESSMENT_ASSENT_COPY) && assent.locale === 'zh-CN' &&
      assent.guardianAuthorityStatus === 'NOT_APPLICABLE' && !assent.withdrawnAt
    return Boolean(coreValid && assentValid)
  }

  private orderStatusForTradeState(state: TransactionResult['tradeState']): OrderStatus | null {
    if (state === 'CLOSED' || state === 'REVOKED') return 'CANCELLED'
    if (state === 'PAYERROR') return 'FAILED'
    return null
  }

  private async applyRefund(result: RefundResult, bodyDigest: string): Promise<{ duplicate: boolean; orderId: string }> {
    const now = iso(this.clock)
    return this.store.transaction(async (tx) => {
      const duplicate = await tx.findOne('paymentEvents', { providerEventId: result.eventId }, { forUpdate: true })
      if (duplicate) {
        invariant(duplicate.bodyDigest === bodyDigest && duplicate.outTradeNo === result.outTradeNo, 409, 'PAYMENT_EVENT_CONFLICT', '相同退款事件ID对应了不同内容')
        const priorOrder = await tx.findOne('orders', { outTradeNo: duplicate.outTradeNo })
        return { duplicate: true, orderId: priorOrder?.id ?? '' }
      }
      const order = await tx.findOne('orders', { outTradeNo: result.outTradeNo }, { forUpdate: true })
      invariant(order, 404, 'REFUND_ORDER_NOT_FOUND', '退款通知对应订单不存在')
      const refund = await tx.findOne('refunds', { outRefundNo: result.outRefundNo }, { forUpdate: true })
      invariant(refund?.orderId === order.id, 404, 'REFUND_NOT_FOUND', '退款记录不存在')
      invariant(result.mchId === this.provider.mchId, 400, 'REFUND_MCHID_MISMATCH', '退款商户号不匹配')
      invariant(result.refundFen === refund.amountFen && result.totalFen === order.amountFen, 400, 'REFUND_AMOUNT_MISMATCH', '退款金额不匹配')
      invariant(result.currency === 'CNY' && result.currency === order.currency, 400, 'REFUND_CURRENCY_MISMATCH', '退款币种不匹配')
      await tx.insert('paymentEvents', {
        id: this.ids('pev'), providerEventId: result.eventId, eventKind: 'REFUND',
        outTradeNo: order.outTradeNo, bodyDigest, verified: true, processedAt: now
      })
      // Provider notifications can arrive late or out of order. SUCCESS is
      // monotonic; a later PROCESSING/CLOSED/ABNORMAL event must never restore
      // access or make the ledger disagree with an already completed refund.
      if (refund.status === 'SUCCESS') return { duplicate: false, orderId: order.id }
      if ((refund.status === 'CLOSED' || refund.status === 'ABNORMAL') && result.refundStatus === 'PROCESSING') {
        return { duplicate: false, orderId: order.id }
      }
      await tx.update('refunds', refund.id, {
        status: result.refundStatus,
        providerRefundId: result.providerRefundId,
        updatedAt: now,
        ...(result.refundStatus === 'SUCCESS' ? { succeededAt: result.successTime ?? now } : {})
      })
      if (result.refundStatus === 'SUCCESS') {
        await tx.update('orders', order.id, { status: 'REFUNDED', refundedAt: result.successTime ?? now, updatedAt: now })
        const entitlement = await tx.findOne('entitlements', { orderId: order.id }, { forUpdate: true })
        if (entitlement && entitlement.status !== 'REVOKED') {
          await tx.update('entitlements', entitlement.id, { status: 'REVOKED', revokedAt: now })
        }
        // 账号注销后退款回调仍会到达：财务处理照常，但时间线写不进去——
        // 家庭记录已经删除，时间线本身就是个人数据。跳过，不要因此让退款失败。
        if (order.familyId !== null && order.reportId !== null) {
          await appendTimeline(tx, this.ids, now, {
            userId: order.userId, familyId: order.familyId, eventType: 'order_refunded',
            description: '报告订单已退款，付费访问权益已撤回', reportId: order.reportId, orderId: order.id
          })
        }
      } else if ((result.refundStatus === 'CLOSED' || result.refundStatus === 'ABNORMAL') && order.status === 'REFUNDING') {
        if (refund.reason === 'CONSENT_WITHDRAWN_BEFORE_DELIVERY') {
          // The customer was charged after the required assessment consent was
          // withdrawn, so restoring PAID would falsely imply an active
          // entitlement. Keep the order fail-closed in REFUNDING and create an
          // explicit, auditable manual-review boundary. A real retry/refund is
          // an external financial action and is never launched implicitly here.
          await tx.insert('auditLogs', {
            id: this.ids('aud'), actorUserId: null,
            action: 'AUTOMATIC_REFUND_MANUAL_REVIEW_REQUIRED',
            entityType: 'order', entityId: order.id,
            metadata: { refundStatus: result.refundStatus, reason: refund.reason }, createdAt: now
          })
          if (order.familyId !== null && order.reportId !== null) {
            await appendTimeline(tx, this.ids, now, {
              userId: order.userId, familyId: order.familyId,
              eventType: 'order_refund_manual_review',
              description: '自动退款未完成，报告仍保持锁定，退款已进入人工复核',
              reportId: order.reportId, orderId: order.id
            })
          }
        } else {
          await tx.update('orders', order.id, { status: 'PAID', updatedAt: now })
        }
      }
      return { duplicate: false, orderId: order.id }
    })
  }
}
