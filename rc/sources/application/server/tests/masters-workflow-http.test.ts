import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { MockWechatAuthProvider } from '../src/auth/wechat-auth-provider'
import { validateSourceCatalog } from '../src/domain/source-catalog'
import { createAppServer } from '../src/http/app'
import { MastersHttp } from '../src/masters/http'
import { PrivateFiles } from '../src/masters/private-files'
import { AssessmentService } from '../src/services/assessment-service'
import { AuthService } from '../src/services/auth-service'
import { MastersService } from '../src/services/masters-service'
import { OrderService } from '../src/services/order-service'
import { ProfileService } from '../src/services/profile-service'
import { ReportService } from '../src/services/report-service'
import { MockPaymentProvider } from '../src/payments/mock-payment-provider'
import { FileStore } from '../src/store/file-store'
import { makeSyntheticDocx } from './fixtures/masters-fixtures'
import { assistedReportPatch, sourcedProgram } from './fixtures/masters-sourced-program'
import { unzipSync } from 'fflate'
import { contentDigest } from '../src/masters/exports'

const secret = 'masters-workflow-http-synthetic-secret-with-enough-entropy'
const consent = { accepted: true as const, copyVersion: 'masters_service_consent_v1.1', locale: 'zh-CN' }
const pdfFontPath = process.env.MASTERS_TEST_PDF_FONT_PATH || 'C:\\Windows\\Fonts\\simhei.ttf'
const catalog = validateSourceCatalog({
  version: 'MASTERS-WORKFLOW-SYNTHETIC',
  dataAsOf: '2026-09-05',
  reviewedAt: '2026-09-05T00:00:00.000Z',
  reviewedBy: 'Synthetic workflow test',
  entries: [{ sourceId: 'MASTERS-WORKFLOW-SOURCE', title: 'Synthetic source', applicableYear: '2026', verifiedAt: '2026-09-05T00:00:00.000Z' }]
})

interface HttpResult {
  status: number
  body: any
}

interface BinaryResult {
  status: number
  contentType: string
  bytes: Buffer
  body: any | null
}

interface WorkflowApp {
  store: FileStore
  service: MastersService
  server: ReturnType<typeof createAppServer>
  base: string
  call(path: string, token: string, method?: string, body?: unknown, key?: string): Promise<HttpResult>
  binary(path: string, token: string): Promise<BinaryResult>
  login(code: string): Promise<any>
  upload(id: string, token: string, version: number, type: string, bytes: Buffer, name: string, mime: string): Promise<HttpResult>
  close(): Promise<void>
}

async function start(directory: string): Promise<WorkflowApp> {
  const store = await FileStore.open(join(directory, 'database.json'))
  const files = new PrivateFiles(join(directory, 'private'))
  await files.initialize()
  const service = new MastersService(store)
  const auth = new AuthService(store, new MockWechatAuthProvider(), secret)
  const server = createAppServer({
    auth,
    profiles: new ProfileService(store),
    assessments: new AssessmentService(store, catalog),
    orders: new OrderService(store, new MockPaymentProvider(secret), catalog, false),
    reports: new ReportService(store),
    masters: new MastersHttp(service, files, store, existsSync(pdfFontPath) ? pdfFontPath : '')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  const base = `http://127.0.0.1:${address.port}`
  const call = async (path: string, token: string, method = 'GET', body?: unknown, key = randomUUID()): Promise<HttpResult> => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': key
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
    const raw = response.status === 204 ? '' : await response.text()
    let parsed: any = null
    if (raw) {
      try { parsed = JSON.parse(raw) } catch { parsed = raw }
    }
    return { status: response.status, body: parsed }
  }
  const binary = async (path: string, token: string): Promise<BinaryResult> => {
    const response = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } })
    const bytes = Buffer.from(await response.arrayBuffer())
    let body: any | null = null
    if (!response.ok && bytes.length > 0) {
      try { body = JSON.parse(bytes.toString('utf8')) } catch { body = null }
    }
    return { status: response.status, contentType: response.headers.get('content-type') ?? '', bytes, body }
  }
  const login = async (code: string): Promise<any> => {
    const result = await call('/v1/auth/wechat/session', '', 'POST', { code })
    assert.equal(result.status, 200, JSON.stringify(result.body))
    return result.body
  }
  const upload = async (id: string, token: string, version: number, type: string, bytes: Buffer, name: string, mime: string): Promise<HttpResult> => {
    const data = new FormData()
    data.append('version', String(version))
    data.append('type', type)
    data.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), name)
    const response = await fetch(`${base}/v1/masters/consultations/${id}/documents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': randomUUID() },
      body: data
    })
    return { status: response.status, body: await response.json() }
  }
  return {
    store, service, server, base, call, binary, login, upload,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

function assertCode(result: HttpResult | BinaryResult, code: string): void {
  assert.equal(result.body?.error?.code, code, JSON.stringify(result.body))
}

async function seedStaff(app: WorkflowApp, founder: any, manager: any, advisorA: any, advisorB: any, unassigned: any): Promise<void> {
  const now = new Date().toISOString()
  await app.store.transaction(async (tx) => {
    await tx.insert('mastersStaff', {
      id: 'mstf-workflow-founder', userId: founder.user.id, role: 'founder', status: 'ACTIVE', grantedBy: null,
      createdAt: now, updatedAt: now
    })
  })
  await app.service.grantStaff(founder.user.id, manager.user.id, 'assignment_manager')
  await app.service.grantStaff(founder.user.id, advisorA.user.id, 'advisor')
  await app.service.grantStaff(founder.user.id, advisorB.user.id, 'advisor')
  await app.service.grantStaff(founder.user.id, unassigned.user.id, 'advisor')
}

async function prepareSubmittedReport(app: WorkflowApp, candidate: any, targetYear = 'UNDECIDED'): Promise<{
  id: string
  path: string
  version: number
  documentId: string
  jobId: string
}> {
  const created = await app.call('/v1/masters/consultations', candidate.accessToken, 'POST', {
    targetYear, channel: 'organic', path: 'GUIDED', serviceConsent: consent
  })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  const id = created.body.consultation.id as string
  const path = `/v1/masters/consultations/${id}`
  const profile = {
    name: '合成申请人乙', adultConfirmed: true, contact: { type: 'email', value: 'workflow@example.invalid' },
    educationStatus: 'ENROLLED', institution: 'Synthetic University', degree: 'Bachelor', major: targetYear === '2027' ? 'Computer Science' : 'Synthetic Studies',
    graduationDate: '2027-06', averageScore: '88.5', gpa: '3.70', gpaScale: '4.00', classRank: '12/120',
    languageStatus: 'NONE', languageType: 'NONE', languageScores: null,
    targetYear, targetMajors: ['Synthetic Studies'], targetInstitutions: ['Synthetic University'],
    targetPreference: '请顾问建议', experiences: []
  }
  const patched = await app.call(path, candidate.accessToken, 'PATCH', {
    version: created.body.consultation.profileVersion, profile
  })
  assert.equal(patched.status, 200, JSON.stringify(patched.body))
  const uploaded = await app.upload(
    id, candidate.accessToken, patched.body.consultation.profileVersion, 'RESUME',
    makeSyntheticDocx(`姓名：合成申请人乙\n本科院校：Synthetic University\n本科专业：${profile.major}`),
    'workflow-resume.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body))
  const version = uploaded.body.consultation.profileVersion as number
  const documentId = uploaded.body.document.id as string
  const confirmed = await app.call(`${path}/confirm`, candidate.accessToken, 'POST', {
    version, accuracyConfirmed: true, consent
  })
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body))
  const submitted = await app.call(`${path}/submit`, candidate.accessToken, 'POST', { version })
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body))
  assert.equal(submitted.body.consultation.status, 'SUBMITTED')
  const jobs = await app.store.read((tx) => tx.findMany('mastersReportJobs', { consultationId: id }))
  // Submission itself owns report enqueueing.  A workflow test must not hide a
  // missing enqueue by manually creating a job before this assertion.
  assert.equal(jobs.length, 1, 'submit must atomically enqueue exactly one report job')
  const job = jobs[0]
  assert.ok(job)
  const claimed = await app.service.claimJob('workflow-http-worker')
  assert.ok(claimed)
  assert.equal(claimed.id, job.id)
  assert.equal(claimed.status, 'RUNNING')
  assert.ok(claimed.leaseToken)
  const completed = await app.service.completeJob(claimed.id, claimed.leaseToken as string)
  assert.equal(completed.status, 'NEEDS_REVIEW')
  return { id, path, version, documentId, jobId: job.id }
}

test('HTTP review workflow enforces assignment, self-review, role gates, return/review, and release exports', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'masters-workflow-http-'))
  const app = await start(directory)
  try {
    const candidate = await app.login('masters-workflow-candidate')
    const founder = await app.login('masters-workflow-founder')
    const manager = await app.login('masters-workflow-manager')
    const advisorA = await app.login('masters-workflow-advisor-a')
    const advisorB = await app.login('masters-workflow-advisor-b')
    const unassigned = await app.login('masters-workflow-unassigned')
    await seedStaff(app, founder, manager, advisorA, advisorB, unassigned)
    const prepared = await prepareSubmittedReport(app, candidate)
    const { id, path, version, documentId } = prepared
    const internalPath = `/v1/internal/masters/consultations/${id}`

    let assignment = await app.call(`${internalPath}/assignment`, manager.accessToken, 'POST', {
      advisorUserId: advisorA.user.id, version
    })
    assert.equal(assignment.status, 200, JSON.stringify(assignment.body))

    const unassignedDetail = await app.call(internalPath, unassigned.accessToken)
    assert.equal(unassignedDetail.status, 403)
    assertCode(unassignedDetail, 'MASTERS_ASSIGNMENT_REQUIRED')
    const unassignedDownload = await app.binary(`${internalPath}/documents/${documentId}`, unassigned.accessToken)
    assert.equal(unassignedDownload.status, 403)
    assertCode(unassignedDownload, 'MASTERS_ASSIGNMENT_REQUIRED')

    const advisorDownload = await app.binary(`${internalPath}/documents/${documentId}`, advisorA.accessToken)
    assert.equal(advisorDownload.status, 200, JSON.stringify(advisorDownload.body))
    assert.equal(advisorDownload.contentType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')

    const founderEarlyApprove = await app.call(`${internalPath}/report/approve`, founder.accessToken, 'POST', { version: 1, note: '尚未复核' })
    assert.equal(founderEarlyApprove.status, 409)

    const founderEarlyReview = await app.call(`${internalPath}/report/review`, founder.accessToken, 'POST', {
      version: 1, note: 'Founder 不应绕过顾问复核'
    })
    assert.equal(founderEarlyReview.status, 403)
    assertCode(founderEarlyReview, 'MASTERS_REVIEW_FORBIDDEN')

    const edit = await app.call(`${internalPath}/report/edit`, advisorA.accessToken, 'POST', {
      version: 1, payload: { backgroundSummary: '顾问 A 编辑的合成草稿' }
    })
    assert.equal(edit.status, 200, JSON.stringify(edit.body))
    assert.equal(edit.body.consultation.currentReport.editedBy, advisorA.user.id)
    const reportVersion = edit.body.consultation.currentReport.version as number
    assert.equal(reportVersion, 2)

    const advisorSelfReview = await app.call(`${internalPath}/report/review`, advisorA.accessToken, 'POST', {
      version: reportVersion, note: '顾问 A 复核自己编辑的草稿'
    })
    assert.equal(advisorSelfReview.status, 200, JSON.stringify(advisorSelfReview.body))
    assert.equal(advisorSelfReview.body.consultation.currentReport.reviewedBy, advisorA.user.id)
    const advisorApprove = await app.call(`${internalPath}/report/approve`, advisorA.accessToken, 'POST', { version: reportVersion })
    assert.equal(advisorApprove.status, 403)
    assertCode(advisorApprove, 'MASTERS_ROLE_FORBIDDEN')
    const advisorRelease = await app.call(`${internalPath}/report/release`, advisorA.accessToken, 'POST', { version: reportVersion })
    assert.equal(advisorRelease.status, 403)
    assertCode(advisorRelease, 'MASTERS_ROLE_FORBIDDEN')

    assignment = await app.call(`${internalPath}/assignment`, manager.accessToken, 'POST', {
      advisorUserId: advisorB.user.id, version
    })
    assert.equal(assignment.status, 200, JSON.stringify(assignment.body))

    const revokedDetail = await app.call(internalPath, advisorA.accessToken)
    assert.equal(revokedDetail.status, 403)
    assertCode(revokedDetail, 'MASTERS_ASSIGNMENT_REQUIRED')
    const revokedDownload = await app.binary(`${internalPath}/documents/${documentId}`, advisorA.accessToken)
    assert.equal(revokedDownload.status, 403)
    assertCode(revokedDownload, 'MASTERS_ASSIGNMENT_REQUIRED')
    const reassignedDownload = await app.binary(`${internalPath}/documents/${documentId}`, advisorB.accessToken)
    assert.equal(reassignedDownload.status, 200)

    const advisorReview = await app.call(`${internalPath}/report/review`, advisorB.accessToken, 'POST', {
      version: reportVersion, note: '顾问 B 完成独立复核'
    })
    assert.equal(advisorReview.status, 200, JSON.stringify(advisorReview.body))
    assert.equal(advisorReview.body.consultation.currentReport.reviewedBy, advisorB.user.id)
    assert.ok(advisorReview.body.consultation.currentReport.reviewedAt)

    const managerApprove = await app.call(`${internalPath}/report/approve`, manager.accessToken, 'POST', { version: reportVersion })
    assert.equal(managerApprove.status, 403)
    assertCode(managerApprove, 'MASTERS_ROLE_FORBIDDEN')

    const approved = await app.call(`${internalPath}/report/approve`, founder.accessToken, 'POST', { version: reportVersion, note: 'Founder 批准' })
    assert.equal(approved.status, 200, JSON.stringify(approved.body))
    assert.equal(approved.body.consultation.currentReport.status, 'APPROVED')
    assert.equal(approved.body.consultation.currentReport.reviewedBy, advisorB.user.id)
    assert.equal(approved.body.consultation.currentReport.approvedBy, founder.user.id)

    const returned = await app.call(`${internalPath}/report/return`, founder.accessToken, 'POST', { version: reportVersion, note: '退回补充风险说明' })
    assert.equal(returned.status, 200, JSON.stringify(returned.body))
    assert.equal(returned.body.consultation.currentReport.status, 'NEEDS_REVIEW')
    assert.equal(returned.body.consultation.currentReport.approvedBy, null)
    assert.equal(returned.body.consultation.currentReport.reviewedBy, null)
    assert.equal(returned.body.consultation.currentReport.reviewedAt, null)

    const secondReview = await app.call(`${internalPath}/report/review`, advisorB.accessToken, 'POST', {
      version: reportVersion, note: '顾问 B 二次复核'
    })
    assert.equal(secondReview.status, 200, JSON.stringify(secondReview.body))
    const approvedAgain = await app.call(`${internalPath}/report/approve`, founder.accessToken, 'POST', { version: reportVersion })
    assert.equal(approvedAgain.status, 200, JSON.stringify(approvedAgain.body))
    const released = await app.call(`${internalPath}/report/release`, founder.accessToken, 'POST', { version: reportVersion })
    assert.equal(released.status, 200, JSON.stringify(released.body))
    assert.equal(released.body.consultation.currentReport.status, 'RELEASED')
    assert.equal(released.body.consultation.currentReport.releasedBy, founder.user.id)

    const studentReport = await app.call(`${path}/report`, candidate.accessToken)
    assert.equal(studentReport.status, 200, JSON.stringify(studentReport.body))
    assert.equal(studentReport.body.report.status, 'RELEASED')
    assert.equal(studentReport.body.report.assistance.level, 'INITIAL_ASSESSMENT')
    assert.equal(studentReport.body.report.assistance.complete, false)
    assert.equal(studentReport.body.report.assistance.autoSchoolMatching, 'NOT_IMPLEMENTED')
    assert.equal(studentReport.body.report.payload.templateVersion, 'masters_application_report_v1.1')

    const xlsx = await app.binary(`${path}/report/export?format=xlsx`, candidate.accessToken)
    assert.equal(xlsx.status, 200, JSON.stringify(xlsx.body))
    assert.match(xlsx.contentType, /spreadsheetml\.sheet/)
    assert.ok(xlsx.bytes.subarray(0, 2).equals(Buffer.from('PK')))

    const pdf = await app.binary(`${path}/report/export?format=pdf`, candidate.accessToken)
    if (existsSync(pdfFontPath)) {
      assert.equal(pdf.status, 200, JSON.stringify(pdf.body))
      assert.equal(pdf.contentType, 'application/pdf')
      assert.equal(pdf.bytes.subarray(0, 5).toString('ascii'), '%PDF-')
    } else {
      assert.equal(pdf.status, 503)
      assertCode(pdf, 'PDF_FONT_REQUIRED')
    }

    const changed = await app.call(path, candidate.accessToken, 'PATCH', {
      version, profile: { targetPreference: '资料更新后的合成偏好' }
    })
    assert.equal(changed.status, 200, JSON.stringify(changed.body))
    const changedVersion = changed.body.consultation.profileVersion as number
    assert.equal(changedVersion, version + 1)
    const staleReport = await app.store.read((tx) => tx.findMany('mastersReports', { consultationId: id }))
    assert.equal(staleReport.length, 2)
    assert.ok(staleReport.every((report) => report.status === 'STALE'))
    assert.equal(staleReport.find((report) => report.version === reportVersion)?.status, 'STALE')

    const staleRead = await app.call(`${path}/report`, candidate.accessToken)
    assert.equal(staleRead.status, 409)
    assertCode(staleRead, 'MASTERS_REPORT_STALE')
    const staleReview = await app.call(`${internalPath}/report/review`, advisorB.accessToken, 'POST', {
      version: reportVersion, note: '旧报告不应重新复核'
    })
    assert.equal(staleReview.status, 409)
    assertCode(staleReview, 'MASTERS_REPORT_STALE')
    const staleExport = await app.binary(`${path}/report/export?format=xlsx`, candidate.accessToken)
    assert.equal(staleExport.status, 409)
    assertCode(staleExport, 'MASTERS_REPORT_STALE')

    const withdrawn = await app.call(`${path}/withdraw`, candidate.accessToken, 'POST', { version: changedVersion })
    assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn.body))
    const endedAssignments = await app.store.read((tx) => tx.findMany('mastersAssignments', { consultationId: id }))
    assert.ok(endedAssignments.length >= 2)
    assert.ok(endedAssignments.every((item) => item.status === 'ENDED'))
    const withdrawnDetail = await app.call(path, candidate.accessToken)
    assert.equal(withdrawnDetail.status, 410)
    assertCode(withdrawnDetail, 'MASTERS_CONSULTATION_WITHDRAWN')
    const withdrawnReport = await app.call(`${path}/report`, candidate.accessToken)
    assert.equal(withdrawnReport.status, 410)
    const withdrawnStaff = await app.call(internalPath, advisorB.accessToken)
    assert.equal(withdrawnStaff.status, 410)
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('submit enqueues the report job exactly once over HTTP and does not duplicate on idempotent replay', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'masters-submit-enqueue-http-'))
  const app = await start(directory)
  try {
    const candidate = await app.login('masters-submit-enqueue-candidate')
    const founder = await app.login('masters-submit-enqueue-founder')
    const manager = await app.login('masters-submit-enqueue-manager')
    const advisor = await app.login('masters-submit-enqueue-advisor')
    const unassigned = await app.login('masters-submit-enqueue-unassigned')
    await seedStaff(app, founder, manager, advisor, await app.login('masters-submit-enqueue-advisor-b'), unassigned)
    const prepared = await prepareSubmittedReport(app, candidate)
    const jobs = await app.store.read((tx) => tx.findMany('mastersReportJobs', { consultationId: prepared.id }))
    assert.equal(jobs.length, 1)
    assert.equal(jobs[0]?.id, prepared.jobId)
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('sourced assisted plan binds advisor editing, source/season gates, Founder release and real exports to one version', {
  skip: !existsSync(pdfFontPath) ? 'BLOCKED_EXTERNAL: licensed Chinese PDF test font unavailable' : false
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'masters-sourced-plan-http-'))
  const app = await start(directory)
  try {
    const student = await app.login('sourced-synthetic-student')
    const founder = await app.login('sourced-synthetic-founder')
    const manager = await app.login('sourced-synthetic-manager')
    const advisor = await app.login('sourced-synthetic-advisor')
    await seedStaff(app, founder, manager, advisor, await app.login('sourced-synthetic-other'), await app.login('sourced-synthetic-unassigned'))
    const { id, path, version } = await prepareSubmittedReport(app, student, '2027')
    const internal = `/v1/internal/masters/consultations/${id}`
    assert.equal((await app.call(`${internal}/assignment`, manager.accessToken, 'POST', { advisorUserId: advisor.user.id, version })).status, 200)
    let report = (await app.call(internal, advisor.accessToken)).body.consultation.currentReport
    assert.equal(report.assistance.level, 'RULE_DRAFT')
    assert.equal((await app.call(`${path}/report`, student.accessToken)).status, 404)
    for (const [override, errorCode] of [
      [{ sourceStatus: 'NEEDS_REVIEW' }, 'MASTERS_SOURCES_UNVERIFIED'],
      [{ officialUrl: 'https://example.invalid/program' }, 'MASTERS_SOURCES_UNVERIFIED'],
      [{ verifiedAt: '2099-01-01' }, 'MASTERS_SOURCES_UNVERIFIED'],
      [{ intakeYear: '2028' }, 'MASTERS_SOURCE_SEASON_MISMATCH']
    ] as const) {
      const edited = await app.call(`${internal}/report/edit`, advisor.accessToken, 'POST', { version: report.version, payload: { ...assistedReportPatch, candidatePrograms: [{ ...sourcedProgram, ...override }] } })
      assert.equal(edited.status, 200, JSON.stringify(edited.body))
      report = edited.body.consultation.currentReport
      assert.equal(report.reviewedAt, null, 'each edit must clear the previous review')
      assert.equal((await app.call(`${internal}/report/review`, advisor.accessToken, 'POST', { version: report.version })).status, 200)
      const rejected = await app.call(`${internal}/report/approve`, founder.accessToken, 'POST', { version: report.version })
      assert.equal(rejected.status, 409)
      assertCode(rejected, errorCode)
      assert.ok((await app.binary(`${path}/report/export?format=xlsx`, student.accessToken)).status >= 400)
    }
    const edited = await app.call(`${internal}/report/edit`, advisor.accessToken, 'POST', { version: report.version, payload: assistedReportPatch })
    assert.equal(edited.status, 200, JSON.stringify(edited.body))
    report = edited.body.consultation.currentReport
    assert.equal(report.assistance.level, 'RULE_DRAFT')
    const reviewed = await app.call(`${internal}/report/review`, advisor.accessToken, 'POST', { version: report.version, note: '虚构顾问测试角色核对固定官网来源，不代表真实客户审核' })
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body))
    assert.equal(reviewed.body.consultation.currentReport.assistance.level, 'ADVISOR_VERIFIED_PLAN')
    assert.equal((await app.call(`${internal}/report/approve`, founder.accessToken, 'POST', { version: report.version })).status, 200)
    assert.equal((await app.call(`${internal}/report/release`, founder.accessToken, 'POST', { version: report.version })).status, 200)
    const visible = (await app.call(`${path}/report`, student.accessToken)).body.report
    assert.equal(visible.version, report.version)
    assert.equal(visible.sourceProfileVersion, version)
    assert.equal(visible.assistance.level, 'ADVISOR_VERIFIED_PLAN')
    assert.equal(visible.assistance.autoSchoolMatching, 'NOT_IMPLEMENTED')
    assert.deepEqual(visible.payload.candidatePrograms, [sourcedProgram])
    const digest = contentDigest({ id: visible.id, version: visible.version, profileVersion: version, content: visible.payload })
    const xlsx = await app.binary(`${path}/report/export?format=xlsx`, student.accessToken)
    assert.equal(xlsx.status, 200)
    const worksheet = Buffer.from(unzipSync(xlsx.bytes)['xl/worksheets/sheet1.xml']!).toString('utf8')
    const cells = [...worksheet.matchAll(/<t xml:space="preserve">([\s\S]*?)<\/t>/g)].map(match => match[1]!.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))
    assert.ok(cells.includes(JSON.stringify([sourcedProgram])), 'XLSX must preserve every approved candidate field exactly')
    assert.ok(cells.includes(digest))
    assert.ok(cells.includes('顾问核验后的申请方案'))
    const pdf = await app.binary(`${path}/report/export?format=pdf`, student.accessToken)
    assert.equal(pdf.status, 200)
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const loading = pdfjs.getDocument({ data: new Uint8Array(pdf.bytes), useSystemFonts: false, disableFontFace: true, useWorkerFetch: false, verbosity: 0 })
    try {
      const document = await loading.promise
      let text = ''
      for (let n = 1; n <= document.numPages; n++) text += (await (await document.getPage(n)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join('')
      for (const expected of [sourcedProgram.program, sourcedProgram.officialUrl, sourcedProgram.verifiedAt, digest, '顾问核验后的申请方案', '自动选校尚未实现']) assert.ok(text.includes(expected), `PDF missing ${expected}`)
    } finally { await loading.destroy() }
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }) }
})
