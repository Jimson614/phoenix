import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AgentContentCrypto,
  agentRunRequestAad
} from '../src/ai/crypto'
import {
  buildAssessmentAnalysisContext,
  buildPaidReportAnalysisContext,
  contextDigestForAssessment,
  contextDigestForPaidReportAnalysis
} from '../src/ai/context/assessment-context'
import { contextDigestForReport } from '../src/ai/context/report-context'
import { FrozenAgentRequest } from '../src/ai/provider/agent-provider'
import { MockAgentProvider } from '../src/ai/provider/mock-agent-provider'
import {
  Assessment,
  FeishuEntityType,
  Report,
  ReportModule
} from '../src/domain/model'
import { GROWTH_DISCOVERY_PRODUCT_CODE } from '../src/domain/products'
import {
  AI_ANALYSIS_CONSENT_VERSION,
  consentCopySha256,
  CORE_ASSESSMENT_CONSENT_COPY,
  CORE_ASSESSMENT_CONSENT_VERSION,
  STUDENT_ASSESSMENT_ASSENT_COPY,
  STUDENT_ASSESSMENT_ASSENT_VERSION
} from '../src/domain/education-compass/consent-policy'
import { FeishuBitableGateway } from '../src/integrations/feishu/bitable-client'
import { V05_CUSTOMER_PROFILE_FEISHU_ALLOWLISTS } from '../src/integrations/feishu/schema-contract'
import { FeishuSyncService } from '../src/integrations/feishu/sync-service'
import { AgentService } from '../src/services/agent-service'
import { EducationCompassService } from '../src/services/education-compass-service'
import { AgentRepository } from '../src/store/agent-repository'
import { InMemoryStore } from '../src/store/memory-store'
import { Clock } from '../src/utils/runtime'

const NOW = '2026-08-25T08:00:00.000Z'
const clock: Clock = () => new Date(NOW)
const userId = 'usr_v05_private_9001'
const familyId = 'fam_v05_private_9001'
const studentId = 'stu_v05_private_9001'
const assessmentId = 'asm_v05_private_9001'
const reportId = 'rpt_v05_private_9001'
const orderId = 'ord_v05_private_9001'

const allTables: Record<FeishuEntityType, string> = {
  family_profile: 'tblFamily',
  student_profile: 'tblStudent',
  assessment_session: 'tblAssessment',
  report_job: 'tblReport',
  order_payment: 'tblOrder',
  feedback: 'tblFeedback',
  advisor_request: 'tblAdvisor'
}

type GatewayInput = Parameters<FeishuBitableGateway['upsertRecord']>[0]

class ToggleGateway implements FeishuBitableGateway {
  readonly calls: GatewayInput[] = []
  failWrites = false

  async upsertRecord(input: GatewayInput): Promise<{ recordId: string; created: boolean }> {
    this.calls.push(structuredClone(input))
    if (this.failWrites) throw new Error('synthetic offline gateway')
    return {
      recordId: input.knownRecordId ?? `rec_${this.calls.length}`,
      created: !input.knownRecordId
    }
  }
}

function preview(currentReportId: string, currentAssessmentId: string) {
  return {
    reportId: currentReportId,
    assessmentId: currentAssessmentId,
    completenessScore: 100,
    confidence: 'high' as const,
    profileSummary: '本地预览',
    oneStrength: '结构化优势',
    oneRisk: '仍需验证',
    routeOverview: '小步验证',
    tableOfContents: ['本地报告'],
    dataAsOf: '2026-08-25',
    disclaimer: '仅供教育成长讨论。',
    canPurchase: false
  }
}

function versions() {
  return {
    studentVersion: 'student-v05-v1',
    ruleVersion: 'education_compass_deterministic_rules_v1.0.0-rc1',
    dataVersion: 'question-bank-v05',
    promptVersion: 'none',
    templateVersion: 'student_growth_discovery_report_v1.0.0'
  }
}

function v05FeishuStore(): InMemoryStore {
  return new InMemoryStore({
    families: [{
      id: familyId,
      userId,
      familyName: '飞书授权家庭',
      parentName: '授权家长',
      phone: '13900009001',
      location: '测试地区',
      goal: '仅测试允许的客户资料镜像',
      createdAt: NOW,
      updatedAt: NOW
    }],
    students: [{
      id: studentId,
      familyId,
      name: '授权学生',
      age: 16,
      gender: '未披露',
      school: '测试学校',
      educationSystem: 'GAOKAO',
      grade: '高二',
      interest: '科学探索',
      goal: '完成近期学习行动',
      studentVersion: 'student-v05-v1',
      profileStatus: 'COMPLETE',
      profileSchemaVersion: 'student_profile_v1',
      gradeStage: 'UPPER_SECONDARY',
      createdAt: NOW,
      updatedAt: NOW
    }],
    assessments: [{
      id: assessmentId,
      userId,
      familyId,
      studentId,
      consentId: 'gcn_v05_private_9001',
      questionnaireVersion: 'free_parent_education_compass_v1.0.0-rc1',
      studentVersion: 'student-v05-v1',
      answers: {
        FP03: ['RAW_ANSWER_MUST_NEVER_LEAVE_9001'],
        private_note: 'RAW_PRIVATE_NOTE_9001'
      },
      status: 'SUBMITTED',
      completenessScore: 100,
      missingFields: [],
      reportId,
      createdAt: NOW,
      updatedAt: NOW,
      submittedAt: NOW,
      assessmentKind: 'FREE_PARENT_COMPASS',
      respondentRole: 'PARENT_GUARDIAN',
      sourceAssessmentId: null,
      educationSystem: 'GAOKAO',
      sourceEntry: 'MINIPROGRAM_HOME',
      bankVersions: { common: 'free_parent_education_compass_v1.0.0-rc1' },
      schemaDigest: 'v05-schema-digest',
      assessmentLevel: 'LEVEL_1',
      gradeStage: 'UPPER_SECONDARY',
      commonBankVersion: 'free_parent_education_compass_v1.0.0-rc1',
      systemBankVersion: null,
      respondentConfirmation: 'PARENT_GUARDIAN_CONFIRMED',
      coreConsentGrantId: 'cgr_core_v05_private_9001',
      studentAssentGrantId: null,
      resultKind: 'FAMILY_EDUCATION_SNAPSHOT',
      draftRevision: 2,
      submittedInputDigest: 'input-digest-v05'
    }],
    reports: [{
      id: reportId,
      userId,
      familyId,
      studentId,
      assessmentId,
      status: 'READY',
      deliveryStatus: 'DELIVERED',
      preview: preview(reportId, assessmentId),
      modules: null,
      sources: [],
      dataAsOf: '2026-08-25',
      disclaimer: '本地结果',
      confidence: 'high',
      versions: versions(),
      qaPassed: true,
      sourceCatalogVerified: false,
      sourceCatalogVersion: 'not-applicable',
      createdAt: NOW,
      updatedAt: NOW,
      reportKind: 'FAMILY_EDUCATION_SNAPSHOT',
      resultVersion: 'family_education_snapshot_v1.0.0',
      resultPayload: {
        family_id: familyId,
        student_id: studentId,
        assessment_id: assessmentId,
        observed_strength_signals: ['PRIVATE_SIGNAL_MUST_NEVER_LEAVE_9001']
      }
    }],
    orders: [{
      id: orderId,
      outTradeNo: 'TX_PRIVATE_OUT_TRADE_9001',
      userId,
      familyId,
      studentId,
      assessmentId,
      reportId,
      productCode: 'COMPASS_REPORT_SINGLE_39_9',
      amountFen: 3990,
      currency: 'CNY',
      status: 'PAID',
      idempotencyKey: 'PRIVATE_ORDER_KEY_9001',
      provider: 'wechat',
      providerPrepayId: 'PRIVATE_PREPAY_9001',
      paymentParams: {
        timeStamp: '1', nonceStr: 'PRIVATE_NONCE_9001', package: 'prepay_id=PRIVATE_9001',
        signType: 'RSA', paySign: 'PRIVATE_PAY_SIGN_9001'
      },
      providerTransactionId: 'PRIVATE_TRANSACTION_9001',
      lastProviderQueryAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
      expiresAt: '2026-08-25T08:30:00.000Z',
      paidAt: NOW,
      refundedAt: null
    }],
    feedback: [{
      id: 'fdb_v05_private_9001', userId, reportId, rating: 5,
      tags: ['PRIVATE_FEEDBACK_TAG_9001'], comment: 'PRIVATE_FEEDBACK_9001',
      advisorContactRequested: true, createdAt: NOW
    }],
    advisorRequests: [{
      id: 'adv_v05_private_9001', userId, familyId, studentId, assessmentId, reportId,
      preferredTime: 'PRIVATE_TIME_9001', topic: 'PRIVATE_TOPIC_9001', note: 'PRIVATE_NOTE_9001',
      status: 'PENDING', intent: 'GENERAL_ADVISOR', createdAt: NOW, updatedAt: NOW
    }]
  })
}

const feishuConsentBody = {
  studentId,
  copyVersion: 'feishu_profile_mirror_opt_in_v1.0.0-rc1',
  locale: 'zh-CN',
  guardianAuthorityConfirmed: true
} as const

test('V0.5 Feishu mirror requires both gates, uses only profile allowlists, and fences withdrawal retries', async () => {
  const store = v05FeishuStore()
  const gateway = new ToggleGateway()
  const key = 'v05-feishu-pseudonym-key-at-least-32-bytes'

  const disabled = new FeishuSyncService(store, gateway, allTables, key, 'test', 10, clock)
  const enabled = new FeishuSyncService(store, gateway, allTables, key, 'test', 10, clock, undefined, true)

  assert.deepEqual(await disabled.reconcile(), {
    enabled: true, discovered: 0, attempted: 0, succeeded: 0, failed: 0, skipped: 0
  })
  assert.deepEqual(await enabled.reconcile(), {
    enabled: true, discovered: 0, attempted: 0, succeeded: 0, failed: 0, skipped: 0
  })
  assert.equal(gateway.calls.length, 0, 'a V0.5 assessment without mirror consent must produce no egress')

  const education = new EducationCompassService(store, true, clock, (prefix) => `${prefix}_integration_9001`)
  const granted = await education.setFeishuProfileConsent(userId, { ...feishuConsentBody, enabled: true })
  assert.equal(granted.enabled, true)

  assert.deepEqual(await disabled.reconcile(), {
    enabled: true, discovered: 0, attempted: 0, succeeded: 0, failed: 0, skipped: 0
  })
  assert.equal(gateway.calls.length, 0, 'consent alone must not bypass the deployment field flag')

  const mirrored = await enabled.reconcile()
  assert.deepEqual(mirrored, {
    enabled: true, discovered: 2, attempted: 2, succeeded: 2, failed: 0, skipped: 0
  })
  assert.equal(gateway.calls.length, 2)
  assert.deepEqual(gateway.calls.map((call) => call.tableId).sort(), ['tblFamily', 'tblStudent'])

  const entityByTable: Record<string, 'family_profile' | 'student_profile'> = {
    tblFamily: 'family_profile', tblStudent: 'student_profile'
  }
  const forbiddenFieldNames = [
    'session_id', 'assessment_id', 'report_id', 'order_id', 'answers', 'answer_payload',
    'result_payload', 'family_concerns', 'strength_signals', 'learning_bottlenecks',
    'amount_fen', 'product_code', 'out_trade_no', 'provider_transaction_id', 'payment_params',
    'family_name', 'parent_name', 'phone', 'location', 'student_name', 'grade',
    'schema_version', 'source_updated_at'
  ]
  for (const call of gateway.calls) {
    const entityType = entityByTable[call.tableId]
    assert.ok(entityType)
    assert.deepEqual(
      Object.keys(call.fields).sort(),
      [...V05_CUSTOMER_PROFILE_FEISHU_ALLOWLISTS[entityType]].sort()
    )
    assert.match(call.uniqueValue, /^PHX-[0-9a-f]{24}$/)
    forbiddenFieldNames.forEach((field) => assert.equal(Object.hasOwn(call.fields, field), false))
    assert.equal(call.requestBody, JSON.stringify({ fields: call.fields }))
  }
  const outbound = JSON.stringify(gateway.calls)
  for (const forbidden of [
    userId, familyId, studentId, assessmentId, reportId, orderId,
    'RAW_ANSWER_MUST_NEVER_LEAVE_9001', 'RAW_PRIVATE_NOTE_9001',
    'PRIVATE_SIGNAL_MUST_NEVER_LEAVE_9001', 'PRIVATE_TRANSACTION_9001',
    'TX_PRIVATE_OUT_TRADE_9001', 'PRIVATE_PAY_SIGN_9001', 'PRIVATE_FEEDBACK_9001'
  ]) assert.equal(outbound.includes(forbidden), false, `${forbidden} must not leave through Feishu`)

  await store.transaction(async (tx) => {
    await tx.update('families', familyId, { updatedAt: '2026-08-25T09:00:00.000Z' })
    await tx.update('students', studentId, { updatedAt: '2026-08-25T09:01:00.000Z' })
  })
  gateway.failWrites = true
  assert.deepEqual(await enabled.reconcile(), {
    enabled: true, discovered: 2, attempted: 2, succeeded: 0, failed: 2, skipped: 0
  })
  const frozen = await store.read((tx) => tx.findMany('integrationLinks', { status: 'FAILED' }))
  assert.equal(frozen.length, 2)
  assert.ok(frozen.every((link) => Boolean(link.operationToken && link.operationDigest && link.operationBody)))

  const withdrawn = await education.setFeishuProfileConsent(userId, { ...feishuConsentBody, enabled: false })
  assert.equal(withdrawn.enabled, false)
  const fenced = await store.read((tx) => tx.findMany('integrationLinks'))
  assert.equal(fenced.length, 2)
  assert.ok(fenced.every((link) =>
    link.status === 'BLOCKED' && link.lastErrorCode === 'FEISHU_CONSENT_WITHDRAWN' &&
    link.leaseToken === null && link.operationToken === null && link.operationDigest === null &&
    link.operationBody === null && link.nextAttemptAt === null
  ))
  const grantRows = await store.read((tx) => tx.findMany('consentGrants', {
    userId, studentId, scope: 'FEISHU_PROFILE_MIRROR'
  }))
  assert.equal(grantRows.length, 1)
  assert.equal(grantRows[0]?.withdrawnAt, NOW)
  const minimizationReviews = await store.read((tx) => tx.findMany('auditLogs', {
    action: 'FEISHU_REMOTE_MINIMIZATION_REVIEW_REQUIRED', entityId: studentId
  }))
  assert.equal(minimizationReviews.length, 1)
  assert.deepEqual(minimizationReviews[0]?.metadata, {
    reason: 'CONSENT_WITHDRAWN', remoteRecordCount: 2,
    sopStatus: 'BLOCKED_EXTERNAL_PRIVACY_APPROVAL'
  })
  assert.equal(JSON.stringify(minimizationReviews).includes('record_'), false,
    'privacy review task must not copy remote record identifiers into audit metadata')

  gateway.failWrites = false
  const callsBeforeRetry = gateway.calls.length
  assert.deepEqual(await enabled.manualReconcile('usr_admin_integration_9001', 10), {
    enabled: true, discovered: 0, attempted: 0, succeeded: 0, failed: 0, skipped: 0
  })
  assert.equal(gateway.calls.length, callsBeforeRetry, 'withdrawn frozen operations must never retry')
})

function freeAssessment(): Assessment {
  return {
    id: 'asm_agent_free_internal_9101',
    userId: 'usr_agent_internal_9101',
    familyId: 'fam_agent_internal_9101',
    studentId: 'stu_agent_internal_9101',
    consentId: 'gcn_agent_internal_9101',
    questionnaireVersion: 'free_parent_education_compass_v1.0.0-rc1',
    studentVersion: 'student-v05-v1',
    answers: {
      FP03: ['RAW_FREE_ANSWER_9101'],
      private_text: '张小明 13800138000 private@example.invalid 凤凰学校 私人地址'
    },
    status: 'SUBMITTED',
    completenessScore: 100,
    missingFields: [],
    reportId: 'rpt_agent_free_internal_9101',
    createdAt: NOW,
    updatedAt: NOW,
    submittedAt: NOW,
    assessmentKind: 'FREE_PARENT_COMPASS',
    respondentRole: 'PARENT_GUARDIAN',
    educationSystem: 'GAOKAO',
    assessmentLevel: 'LEVEL_1',
    gradeStage: 'UPPER_SECONDARY',
    resultKind: 'FAMILY_EDUCATION_SNAPSHOT',
    draftRevision: 2
  }
}

function freeReport(assessment: Assessment): Report {
  return {
    id: assessment.reportId as string,
    userId: assessment.userId,
    familyId: assessment.familyId,
    studentId: assessment.studentId,
    assessmentId: assessment.id,
    status: 'READY',
    deliveryStatus: 'DELIVERED',
    preview: preview(assessment.reportId as string, assessment.id),
    modules: [{
      key: 'student_profile', title: '张小明',
      summary: '13800138000 private@example.invalid 凤凰学校 私人地址 RAW_REPORT_MODULE_9101'
    }],
    sources: [],
    dataAsOf: '2026-08-25',
    disclaimer: '仅供教育成长讨论。',
    confidence: 'high',
    versions: versions(),
    qaPassed: true,
    sourceCatalogVerified: false,
    sourceCatalogVersion: 'not-applicable',
    createdAt: NOW,
    updatedAt: NOW,
    reportKind: 'FAMILY_EDUCATION_SNAPSHOT',
    resultVersion: 'family_education_snapshot_v1.0.0',
    resultPayload: {
      result_kind: 'FAMILY_EDUCATION_SNAPSHOT',
      result_version: 'family_education_snapshot_v1.0.0',
      family_id: assessment.familyId,
      student_id: assessment.studentId,
      assessment_id: assessment.id,
      education_system: 'GAOKAO',
      grade_stage: 'UPPER_SECONDARY',
      family_concerns: ['LEARNING_MOTIVATION'],
      observed_strength_signals: ['CURIOSITY'],
      observed_difficulty_signals: ['PLANNING'],
      student_readiness: 'WILLING',
      family_priorities: ['LEARNING_HABITS'],
      preferred_next_support: 'STUDENT_ASSESSMENT',
      next_step_status: 'AVAILABLE',
      next_step_reason_codes: ['STUDENT_READY_FOR_SELF_ASSESSMENT']
    }
  }
}

const paidModuleKeys = [
  'student_snapshot',
  'strength_signals',
  'learning_bottlenecks',
  'subject_focus',
  'growth_direction',
  'action_plan_30d'
] as const

function paidModules(): ReportModule[] {
  return paidModuleKeys.map((key) => ({
    key,
    title: `PRIVATE_LOCAL_TITLE_${key}`,
    summary: `张小明 13800138000 private@example.invalid 凤凰学校 私人地址 PRIVATE_LOCAL_${key}`,
    items: [`RAW_LOCAL_ITEM_${key}`]
  }))
}

function paidAssessment(): Assessment {
  return {
    id: 'asm_agent_paid_internal_9201',
    userId: 'usr_agent_paid_internal_9201',
    familyId: 'fam_agent_paid_internal_9201',
    studentId: 'stu_agent_paid_internal_9201',
    consentId: 'gcn_agent_paid_internal_9201',
    questionnaireVersion: 'education_growth_discovery_v1.0.0-rc1',
    studentVersion: 'student-v05-v1',
    answers: {
      EGD01: 'CONFIRM_STUDENT_SELF',
      RAW_PRIVATE_ANSWER: '张小明 13800138000 private@example.invalid 凤凰学校 私人地址 RAW_PAID_ANSWER_9201'
    },
    status: 'SUBMITTED',
    completenessScore: 100,
    missingFields: [],
    reportId: 'rpt_agent_paid_internal_9201',
    createdAt: NOW,
    updatedAt: NOW,
    submittedAt: NOW,
    assessmentKind: 'STUDENT_GROWTH_DISCOVERY',
    respondentRole: 'STUDENT',
    educationSystem: 'GAOKAO',
    assessmentLevel: 'LEVEL_2',
    gradeStage: 'UPPER_SECONDARY',
    respondentConfirmation: 'CONFIRM_STUDENT_SELF',
    coreConsentGrantId: 'cgr_agent_paid_core_9201',
    studentAssentGrantId: 'cgr_agent_paid_assent_9201',
    resultKind: 'STUDENT_GROWTH_DISCOVERY',
    draftRevision: 2
  }
}

function paidReport(assessment: Assessment): Report {
  return {
    id: assessment.reportId as string,
    userId: assessment.userId,
    familyId: assessment.familyId,
    studentId: assessment.studentId,
    assessmentId: assessment.id,
    status: 'READY',
    deliveryStatus: 'DELIVERED',
    preview: preview(assessment.reportId as string, assessment.id),
    modules: paidModules(),
    sources: [],
    dataAsOf: '2026-08-25',
    disclaimer: '仅供教育成长讨论。',
    confidence: 'high',
    versions: versions(),
    qaPassed: true,
    sourceCatalogVerified: false,
    sourceCatalogVersion: 'not-applicable',
    createdAt: NOW,
    updatedAt: NOW,
    reportKind: 'STUDENT_GROWTH_DISCOVERY',
    resultVersion: 'student_growth_discovery_report_v1.0.0',
    resultPayload: {
      result_kind: 'STUDENT_GROWTH_DISCOVERY',
      result_version: 'student_growth_discovery_report_v1.0.0',
      student_snapshot: {
        education_system: 'GAOKAO', grade_stage: 'UPPER_SECONDARY', major_exam_year: '2027',
        target_regions: ['MAINLAND_CHINA'], performance_self_view: 'GOOD_BUT_UNSTABLE',
        evidence_refs: ['EGD02', 'EGD03', 'EGD04', 'EGD05', 'EGD07']
      },
      strength_signals: [{
        code: 'PLANNING_AND_REVIEW', dimension: 'LEARNING_PROCESS', status: 'SUPPORTED',
        evidence_refs: ['EGD12', 'EGD18'], source: 'STUDENT_SELF_REPORT'
      }],
      learning_bottlenecks: [{
        code: 'PLANNING_GAP', dimension: 'LEARNING_PROCESS', status: 'SUPPORTED',
        evidence_refs: ['EGD06', 'EGD12'], source: 'STUDENT_SELF_REPORT'
      }],
      subject_focus: [{
        code: 'MATHEMATICS', dimension: 'ACADEMIC_PERFORMANCE', status: 'NEEDS_VALIDATION',
        evidence_refs: ['EGD09'], source: 'STUDENT_SELF_REPORT'
      }],
      growth_direction: [{
        code: 'SCIENCE_TECH', dimension: 'INTEREST_DIRECTION', status: 'NEEDS_VALIDATION',
        evidence_refs: ['EGD15'], source: 'STUDENT_SELF_REPORT'
      }],
      action_plan_30d: {
        horizon_days: 30,
        selected_action_code: 'LEARNING_METHOD_PRACTICE',
        goals: [{ code: 'ACTION_LEARNING_METHOD_PRACTICE', status: 'SUPPORTED', evidence_refs: ['EGD18'] }]
      },
      learning_signals: [],
      interest_signals: [],
      recommended_focus: ['PLANNING_GAP'],
      scoring_mode: 'NONE'
    }
  }
}

function assertNoPrivateAgentEgress(value: unknown, assessment: Assessment, report: Report): void {
  const serialized = JSON.stringify(value)
  for (const forbidden of [
    assessment.userId, assessment.familyId, assessment.studentId, assessment.id, report.id,
    'RAW_FREE_ANSWER_9101', 'RAW_REPORT_MODULE_9101', 'RAW_PAID_ANSWER_9201',
    'PRIVATE_LOCAL_', 'RAW_LOCAL_ITEM_', '张小明', '13800138000',
    'private@example.invalid', '凤凰学校', '私人地址'
  ]) assert.equal(serialized.includes(forbidden), false, `${forbidden} must not enter an Agent request`)
  assert.equal(serialized.includes('"answers"'), false)
  assert.equal(serialized.includes('"family_id"'), false)
  assert.equal(serialized.includes('"student_id"'), false)
  assert.equal(serialized.includes('"assessment_id"'), false)
  assert.equal(serialized.includes('"report_id"'), false)
}

test('V0.5 Free and Paid Agent serializers emit no PII, raw answers, or internal IDs and keep the frozen structure', () => {
  const free = freeAssessment()
  const freeResult = freeReport(free)
  const freeOutbound = buildAssessmentAnalysisContext(free, freeResult)
  assert.deepEqual(freeOutbound.context.modules.map((module) => module.key), [
    'family_concerns', 'parent_observation_signals', 'next_step'
  ])
  assertNoPrivateAgentEgress(freeOutbound, free, freeResult)

  const paid = paidAssessment()
  const paidResult = paidReport(paid)
  const paidOutbound = buildPaidReportAnalysisContext(paid, paidResult)
  assert.deepEqual(paidOutbound.context.modules.map((module) => module.key), paidModuleKeys)
  assert.equal(paidOutbound.context.modules.length, 6)
  assert.ok(paidOutbound.context.modules.find((module) => module.key === 'action_plan_30d')?.items
    .includes('recommended_focus：PLANNING_GAP'))
  assertNoPrivateAgentEgress(paidOutbound, paid, paidResult)
})

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.equal((error as { code?: string }).code, code)
    return true
  })
}

test('V0.5 Paid Agent rejects a legacy entitlement and queues only the matching Growth Discovery SKU', async () => {
  const assessment = paidAssessment()
  const report = paidReport(assessment)
  const store = new InMemoryStore({
    users: [{ id: assessment.userId, role: 'family_user', createdAt: NOW }],
    families: [{
      id: assessment.familyId, userId: assessment.userId, familyName: '本地家庭', parentName: '本地家长',
      phone: '13900009201', location: '测试地区', goal: '测试 Agent 权益', createdAt: NOW, updatedAt: NOW
    }],
    students: [{
      id: assessment.studentId, familyId: assessment.familyId, name: '本地学生', age: 16,
      studentVersion: assessment.studentVersion, createdAt: NOW, updatedAt: NOW
    }],
    assessments: [assessment],
    reports: [report],
    consentGrants: [{
      id: assessment.coreConsentGrantId as string, userId: assessment.userId,
      familyId: assessment.familyId, studentId: assessment.studentId,
      subjectType: 'STUDENT', subjectId: assessment.studentId, scope: 'CORE_ASSESSMENT',
      subjectRole: 'PARENT_GUARDIAN', copyVersion: CORE_ASSESSMENT_CONSENT_VERSION,
      copyTextHash: consentCopySha256(CORE_ASSESSMENT_CONSENT_COPY), locale: 'zh-CN',
      guardianAuthorityStatus: 'CONFIRMED', sourceEntry: 'INTERNAL_UAT',
      auditMetadata: { guardianConfirmed: true, studentConfirmed: false, channel: 'TEST' },
      grantedAt: NOW, withdrawnAt: null, createdAt: NOW, updatedAt: NOW
    }, {
      id: assessment.studentAssentGrantId as string, userId: assessment.userId,
      familyId: assessment.familyId, studentId: assessment.studentId,
      subjectType: 'STUDENT', subjectId: assessment.studentId, scope: 'STUDENT_ASSESSMENT_ASSENT',
      subjectRole: 'STUDENT', copyVersion: STUDENT_ASSESSMENT_ASSENT_VERSION,
      copyTextHash: consentCopySha256(STUDENT_ASSESSMENT_ASSENT_COPY), locale: 'zh-CN',
      guardianAuthorityStatus: 'NOT_APPLICABLE', sourceEntry: 'INTERNAL_UAT',
      auditMetadata: { guardianConfirmed: false, studentConfirmed: true, channel: 'TEST' },
      grantedAt: NOW, withdrawnAt: null, createdAt: NOW, updatedAt: NOW
    }],
    entitlements: [{
      id: 'ent_agent_paid_internal_9201', userId: assessment.userId, orderId: 'ord_agent_paid_internal_9201',
      reportId: report.id, productCode: 'COMPASS_REPORT_SINGLE_39_9', status: 'ACTIVE',
      grantedAt: NOW, revokedAt: null
    }]
  })
  const crypto = new AgentContentCrypto({
    keyring: { v1: Buffer.alloc(32, 17) },
    currentKeyVersion: 'v1',
    digestRootKey: Buffer.alloc(32, 19)
  })
  const repository = new AgentRepository(
    store,
    clock,
    undefined,
    (value) => contextDigestForReport(value, crypto),
    (value, linkedReport) => contextDigestForAssessment(value, linkedReport, crypto),
    (value, linkedReport) => contextDigestForPaidReportAnalysis(value, linkedReport, crypto)
  )
  const service = new AgentService(store, repository, crypto, new MockAgentProvider(), {
    enabled: true,
    safetyHmacKey: 'v05-agent-safety-key-is-at-least-32-bytes',
    maxMessageCharacters: 2000,
    maxRepliesPerReport: 3,
    maxActiveRunsPerUser: 2,
    messagesPerMinute: 6,
    retentionDays: 30
  }, clock)
  const consent = {
    consentVersion: AI_ANALYSIS_CONSENT_VERSION,
    scope: 'AI_ANALYSIS' as const,
    locale: 'zh-CN' as const,
    studentConfirmed: true as const,
    guardianConfirmed: true as const
  }

  await expectCode(service.createReportAnalysis(
    assessment.userId, report.id, consent, 'v05-wrong-sku-analysis-9201'
  ), 'REPORT_PAYMENT_REQUIRED')
  const rejectedArtifacts = await store.read(async (tx) => ({
    conversations: (await tx.findMany('agentConversations')).length,
    runs: (await tx.findMany('agentRuns')).length
  }))
  assert.deepEqual(rejectedArtifacts, { conversations: 0, runs: 0 })

  await store.transaction((tx) => tx.update('entitlements', 'ent_agent_paid_internal_9201', {
    productCode: GROWTH_DISCOVERY_PRODUCT_CODE
  }))
  const queued = await service.createReportAnalysis(
    assessment.userId, report.id, consent, 'v05-correct-sku-analysis-9201'
  )
  assert.equal(queued.status, 'QUEUED')
  assert.equal(queued.analysisType, 'REPORT_ANALYSIS')

  const run = await store.read((tx) => tx.findById('agentRuns', queued.runId))
  assert.ok(run?.requestEnvelope)
  const frozenRequest = crypto.decryptJson<FrozenAgentRequest>(run.requestEnvelope, agentRunRequestAad({
    runId: run.id,
    conversationId: run.conversationId,
    promptVersion: run.promptVersion
  }))
  assert.equal(frozenRequest.taskType, 'REPORT_ANALYSIS')
  assert.deepEqual(frozenRequest.report.modules.map((module) => module.key), paidModuleKeys)
  assert.equal(frozenRequest.report.modules.length, 6)
  assert.ok(frozenRequest.report.modules.find((module) => module.key === 'action_plan_30d')?.items
    .includes('recommended_focus：PLANNING_GAP'))
  assertNoPrivateAgentEgress(frozenRequest, assessment, report)
})
