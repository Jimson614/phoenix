import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { lstat, mkdtemp, readdir, rm } from 'node:fs/promises'
import { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PoolConfig } from 'pg'
import { unzipSync } from 'fflate'
import { MockWechatAuthProvider } from '../../src/auth/wechat-auth-provider'
import { validateSourceCatalog } from '../../src/domain/source-catalog'
import { createAppServer } from '../../src/http/app'
import { contentDigest, type ExportReport } from '../../src/masters/exports'
import { MastersHttp } from '../../src/masters/http'
import { PrivateFiles } from '../../src/masters/private-files'
import { makeSyntheticDocx, makeSyntheticJpeg, makeSyntheticPdf, makeSyntheticPng } from './masters-fixtures'
import { assistedReportPatch, sourcedProgram } from './masters-sourced-program'
import { AssessmentService } from '../../src/services/assessment-service'
import { AuthService } from '../../src/services/auth-service'
import { MastersService } from '../../src/services/masters-service'
import { OrderService } from '../../src/services/order-service'
import { ProfileService } from '../../src/services/profile-service'
import { ReportService } from '../../src/services/report-service'
import { MockPaymentProvider } from '../../src/payments/mock-payment-provider'
import { PostgresStore } from '../../src/store/postgres-store'
import {
  runMastersIsolatedBackupRestore,
  type MastersBackupRestoreConfig,
  type MastersBackupRestoreVerificationContext,
  type MastersIsolatedBackupRestoreResult
} from './masters-isolated-backup'

/**
 * This helper is deliberately Postgres-only.  It never accepts a Store
 * instance and never imports FileStore, so a passing result proves that the
 * HTTP stack exercised the same isolated database schema as the migration
 * tests.  All people and files are synthetic fixtures.
 */

// One per process: source/restart/restore HTTP stacks must share the same
// synthetic signing key, while no test token or key is stable across runs.
const sessionSecret = randomBytes(32).toString('hex')
const consent = { accepted: true as const, copyVersion: 'masters_service_consent_v1.1', locale: 'zh-CN' }
const pdfFontPath = process.env.MASTERS_TEST_PDF_FONT_PATH || process.env.MASTERS_PDF_FONT_PATH || 'C:\\Windows\\Fonts\\simhei.ttf'
const sourceCatalog = validateSourceCatalog({
  version: 'MASTERS-POSTGRES-HTTP-SYNTHETIC',
  dataAsOf: '2026-09-05',
  reviewedAt: '2026-09-05T00:00:00.000Z',
  reviewedBy: 'Synthetic PostgreSQL HTTP fixture',
  entries: [{
    sourceId: 'MASTERS-POSTGRES-HTTP-SYNTHETIC',
    title: 'Synthetic source used only for isolated tests',
    applicableYear: '2026',
    verifiedAt: '2026-09-05T00:00:00.000Z'
  }]
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

interface Session {
  accessToken: string
  user: { id: string; role: string }
  expiresAt: string
}

interface PostgresHttpApp {
  store: PostgresStore
  service: MastersService
  files: PrivateFiles
  server: ReturnType<typeof createAppServer>
  base: string
  call(path: string, token: string, method?: string, body?: unknown, key?: string): Promise<HttpResult>
  binary(path: string, token: string): Promise<BinaryResult>
  login(code: string): Promise<Session>
  upload(
    id: string,
    token: string,
    version: number,
    type: string,
    bytes: Buffer,
    name: string,
    mime: string,
    fields?: Record<string, string>,
    key?: string
  ): Promise<HttpResult>
  close(): Promise<void>
}

export interface MastersPostgresHttpFlowOptions {
  /** PoolConfig must point at the caller's UUID-named isolated schema. */
  poolConfig: PoolConfig
  backupRestore?: MastersBackupRestoreConfig
  pdfFontPath?: string
}

export interface MastersPostgresHttpFlowResult {
  status: 'PASS' | 'PASS_WITH_EXTERNAL_BLOCK'
  store: 'PostgresStore'
  databaseRows: 'PASS'
  multipartAndPrivateStorage: 'PASS'
  restartRecovery: 'PASS'
  authorizationAndReassignment: 'PASS'
  idempotentSubmitAndWorker: 'PASS'
  reviewApprovalRelease: 'PASS'
  staleAndWithdrawnAccess: 'PASS'
  xlsxExport: 'PASS'
  pdfExport: 'PASS' | 'BLOCKED_EXTERNAL'
  isolatedBackupRestore: 'PASS' | 'BLOCKED_EXTERNAL'
  isolatedBackupRestoreProof?: {
    released?: MastersIsolatedBackupRestoreResult
    withdrawn?: MastersIsolatedBackupRestoreResult
  }
  pdfReason?: string
}

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function parseBody(raw: string): any {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return raw }
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function unpackWorksheetText(xlsx: Buffer): string {
  const worksheet = unzipSync(xlsx)['xl/worksheets/sheet1.xml']
  assert.ok(worksheet, 'XLSX must contain the worksheet part')
  return decodeXml(Buffer.from(worksheet).toString('utf8'))
}

async function extractPdfText(bytes: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loading = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    disableFontFace: true,
    stopAtErrors: true,
    verbosity: 0,
    useWorkerFetch: false
  })
  try {
    const pdf = await loading.promise
    const pages: string[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      pages.push(content.items.map((item) => 'str' in item ? item.str : '').join(''))
      page.cleanup()
    }
    return pages.join('\n')
  } finally {
    await loading.destroy()
  }
}

function assertCode(result: HttpResult | BinaryResult, code: string): void {
  assert.equal(result.body?.error?.code, code, JSON.stringify(result.body))
}

async function listen(server: ReturnType<typeof createAppServer>): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  assert.ok(address && typeof address.port === 'number')
  return `http://127.0.0.1:${address.port}`
}

async function closeServer(server: ReturnType<typeof createAppServer>): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

async function startPostgresApp(
  poolConfig: PoolConfig,
  filesRoot: string,
  serviceOptions?: { retentionDays?: number },
  configuredPdfFontPath?: string
): Promise<PostgresHttpApp> {
  const store = new PostgresStore(poolConfig)
  assert.ok(store instanceof PostgresStore, 'HTTP flow must use PostgresStore')
  const files = new PrivateFiles(filesRoot)
  await files.initialize()
  const service = new MastersService(store, undefined, undefined, serviceOptions)
  const auth = new AuthService(store, new MockWechatAuthProvider(), sessionSecret)
  const selectedPdfFontPath = configuredPdfFontPath || pdfFontPath
  const server = createAppServer({
    auth,
    profiles: new ProfileService(store),
    assessments: new AssessmentService(store, sourceCatalog),
    orders: new OrderService(store, new MockPaymentProvider(sessionSecret), sourceCatalog, false),
    reports: new ReportService(store),
    masters: new MastersHttp(service, files, store, existsSync(selectedPdfFontPath) ? selectedPdfFontPath : '')
  })
  const base = await listen(server)

  const call = async (
    path: string,
    token: string,
    method = 'GET',
    body?: unknown,
    key = randomUUID()
  ): Promise<HttpResult> => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': key
    }
    const response = await fetch(`${base}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
    return { status: response.status, body: parseBody(await response.text()) }
  }

  const binary = async (path: string, token: string): Promise<BinaryResult> => {
    const response = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } })
    const bytes = Buffer.from(await response.arrayBuffer())
    return {
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      bytes,
      body: response.ok ? null : parseBody(bytes.toString('utf8'))
    }
  }

  const login = async (code: string): Promise<Session> => {
    const result = await call('/v1/auth/wechat/session', '', 'POST', { code })
    assert.equal(result.status, 200, JSON.stringify(result.body))
    return result.body as Session
  }

  const upload = async (
    id: string,
    token: string,
    version: number,
    type: string,
    bytes: Buffer,
    name: string,
    mime: string,
    fields: Record<string, string> = {},
    key = randomUUID()
  ): Promise<HttpResult> => {
    const data = new FormData()
    data.append('version', String(version))
    data.append('type', type)
    for (const [field, value] of Object.entries(fields)) data.append(field, value)
    data.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), name)
    const response = await fetch(`${base}/v1/masters/consultations/${id}/documents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': key },
      body: data
    })
    return { status: response.status, body: parseBody(await response.text()) }
  }

  const close = async (): Promise<void> => {
    await closeServer(server)
    await store.close()
  }

  return { store, service, files, server, base, call, binary, login, upload, close }
}

function applicantProfile() {
  return {
    name: 'PG合成申请人',
    adultConfirmed: true,
    contact: { type: 'email', value: 'pg-http-applicant@example.invalid' },
    educationStatus: 'ENROLLED',
    institution: 'Synthetic University',
    major: 'Computer Science',
    degree: 'Bachelor of Science',
    graduationDate: '2027-06',
    averageScore: '88.5',
    gpa: '3.72',
    gpaScale: '4.0',
    classRank: '12/120',
    languageStatus: 'NONE',
    languageType: 'NONE',
    languageScores: null,
    targetYear: 'UNDECIDED',
    targetMajors: ['Computer Science'],
    targetInstitutions: ['Synthetic University'],
    targetPreference: '尚未确定，希望顾问建议',
    experiences: []
  }
}

function resumeBytes(): Buffer {
  return makeSyntheticDocx([
    '姓名：PG合成申请人',
    '本科院校：Synthetic University',
    '本科专业：Computer Science',
    '学位名称：Bachelor of Science',
    '百分制均分：88.5',
    'GPA：3.72 / 4.0',
    'GPA满分：4.0',
    '预计毕业年月：2027-06'
  ].join('\n'))
}

interface RestoreExpectedState {
  consultationId: string
  path: string
  internalPath: string
  profile: Record<string, unknown>
  profileVersion: number
  report: { id: string; version: number; profileVersion: number; payload: Record<string, unknown> }
  documentIds: Record<string, string>
  bytesByType: Record<string, Buffer>
  candidateToken: string
  otherStudentToken: string
  currentAdvisorToken: string
  formerAdvisorToken: string
}

async function assertRestoredPrivateRoot(root: string, expectedCount: number): Promise<number> {
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = `${root}/${entry.name}`
    const info = await lstat(entryPath)
    assert.equal(info.isSymbolicLink(), false, 'restored private root must not contain symlinks')
    assert.ok(info.isFile(), 'restored private root must contain files only')
  }
  assert.equal(entries.length, expectedCount)
  return entries.length
}

async function verifyRestoredCheckpoint(
  app: PostgresHttpApp,
  context: MastersBackupRestoreVerificationContext,
  expected: RestoreExpectedState,
  effectivePdfFontPath: string
): Promise<Record<string, unknown>> {
  if (context.checkpoint === 'RELEASED') {
    const detail = await app.call(expected.path, expected.candidateToken)
    assert.equal(detail.status, 200, JSON.stringify(detail.body))
    const consultation = detail.body.consultation
    assert.equal(consultation.id, expected.consultationId)
    assert.equal(consultation.profileVersion, expected.profileVersion)
    assert.deepEqual(consultation.profile, expected.profile)
    assert.equal(consultation.documents.filter((item: any) => item.uploadStatus === 'UPLOADED').length, 7)

    const reportResult = await app.call(`${expected.path}/report`, expected.candidateToken)
    assert.equal(reportResult.status, 200, JSON.stringify(reportResult.body))
    const restoredReport = reportResult.body.report
    assert.equal(restoredReport.id, expected.report.id)
    assert.equal(restoredReport.version, expected.report.version)
    assert.equal(restoredReport.sourceProfileVersion, expected.report.profileVersion)
    assert.deepEqual(restoredReport.payload, expected.report.payload)
    assert.equal(restoredReport.assistance.level, 'ADVISOR_VERIFIED_PLAN')
    assert.equal(restoredReport.assistance.autoSchoolMatching, 'NOT_IMPLEMENTED')
    assert.deepEqual(restoredReport.payload.candidatePrograms, [sourcedProgram])

    // Every active category is checked through both owner and current-advisor
    // routes. The replacement row is included; the removed old row is not.
    for (const type of Object.keys(expected.documentIds).sort()) {
      const documentId = expected.documentIds[type]
      const expectedBytes = expected.bytesByType[type]
      assert.ok(documentId && expectedBytes)
      const ownerDownload = await app.binary(`${expected.path}/documents/${documentId}`, expected.candidateToken)
      assert.equal(ownerDownload.status, 200, JSON.stringify(ownerDownload.body))
      assert.equal(digest(ownerDownload.bytes), digest(expectedBytes))
      const advisorDownload = await app.binary(`${expected.internalPath}/documents/${documentId}`, expected.currentAdvisorToken)
      assert.equal(advisorDownload.status, 200, JSON.stringify(advisorDownload.body))
      assert.equal(digest(advisorDownload.bytes), digest(expectedBytes))
      const formerAdvisorDownload = await app.binary(`${expected.internalPath}/documents/${documentId}`, expected.formerAdvisorToken)
      assert.equal(formerAdvisorDownload.status, 403, JSON.stringify(formerAdvisorDownload.body))
      assertCode(formerAdvisorDownload, 'MASTERS_ASSIGNMENT_REQUIRED')
    }
    const otherStudent = await app.call(expected.path, expected.otherStudentToken)
    assert.ok([403, 404].includes(otherStudent.status), JSON.stringify(otherStudent.body))
    const otherStudentDownload = await app.binary(`${expected.path}/documents/${expected.documentIds.RESUME}`, expected.otherStudentToken)
    assert.ok([403, 404].includes(otherStudentDownload.status), JSON.stringify(otherStudentDownload.body))

    const expectedExportDigest = contentDigest({
      id: expected.report.id,
      version: expected.report.version,
      profileVersion: expected.report.profileVersion,
      content: expected.report.payload
    })
    const xlsx = await app.binary(`${expected.path}/report/export?format=xlsx`, expected.candidateToken)
    assert.equal(xlsx.status, 200, JSON.stringify(xlsx.body))
    const worksheetText = unpackWorksheetText(xlsx.bytes)
    assert.match(worksheetText, new RegExp(expected.report.id))
    assert.match(worksheetText, new RegExp(`report_version`))
    assert.match(worksheetText, new RegExp(String(expected.report.version)))
    assert.match(worksheetText, new RegExp(`profile_version`))
    assert.match(worksheetText, new RegExp(String(expected.report.profileVersion)))
    assert.match(worksheetText, new RegExp(expectedExportDigest))
    assert.ok(worksheetText.includes(sourcedProgram.officialUrl) && worksheetText.includes(sourcedProgram.program))

    let pdfExport: 'PASS' | 'BLOCKED_EXTERNAL' = 'PASS'
    if (existsSync(effectivePdfFontPath)) {
      const pdf = await app.binary(`${expected.path}/report/export?format=pdf`, expected.candidateToken)
      assert.equal(pdf.status, 200, JSON.stringify(pdf.body))
      assert.equal(pdf.contentType, 'application/pdf')
      const pdfText = await extractPdfText(pdf.bytes)
      for (const value of [expected.report.id, String(expected.report.version), String(expected.report.profileVersion), expectedExportDigest, sourcedProgram.officialUrl, sourcedProgram.institution]) {
        assert.ok(pdfText.includes(value), `restored PDF must contain released report value: ${value}`)
      }
    } else {
      const pdf = await app.binary(`${expected.path}/report/export?format=pdf`, expected.candidateToken)
      assert.equal(pdf.status, 503, JSON.stringify(pdf.body))
      assertCode(pdf, 'PDF_FONT_REQUIRED')
      throw new Error('Restored PDF export is blocked because no Chinese test font is available')
    }
    const fileCount = await assertRestoredPrivateRoot(context.filesRoot, 7)
    return {
      consultationId: expected.consultationId,
      reportId: expected.report.id,
      reportVersion: expected.report.version,
      profileVersion: expected.profileVersion,
      activeDocumentCount: 7,
      restoredPrivateFileCount: fileCount,
      exportDigest: expectedExportDigest,
      reportAssistance: 'ADVISOR_VERIFIED_PLAN',
      sourcedCandidateCount: 1,
      pdfExport,
      tlsVerifyFull: context.tlsVerified
    }
  }

  const ownerDetail = await app.call(expected.path, expected.candidateToken)
  assert.ok([403, 410].includes(ownerDetail.status), JSON.stringify(ownerDetail.body))
  const ownerReport = await app.call(`${expected.path}/report`, expected.candidateToken)
  assert.ok(ownerReport.status >= 400, JSON.stringify(ownerReport.body))
  const ownerDownload = await app.binary(`${expected.path}/documents/${expected.documentIds.RESUME}`, expected.candidateToken)
  assert.ok(ownerDownload.status >= 400, JSON.stringify(ownerDownload.body))
  const advisorDetail = await app.call(expected.internalPath, expected.currentAdvisorToken)
  assert.equal(advisorDetail.status, 410, JSON.stringify(advisorDetail.body))
  const otherStudent = await app.call(expected.path, expected.otherStudentToken)
  assert.ok([403, 404, 410].includes(otherStudent.status), JSON.stringify(otherStudent.body))
  const consultationRow = await app.store.pool.query<{ status: string; profile: Record<string, unknown> }>(
    'SELECT status, profile FROM masters_consultations WHERE id = $1', [expected.consultationId]
  )
  assert.equal(consultationRow.rows[0]?.status, 'WITHDRAWN')
  assert.deepEqual(consultationRow.rows[0]?.profile, {})
  const documents = await app.store.pool.query<{ upload_status: string; original_name: string; extraction: unknown; description: string | null }>(
    'SELECT upload_status, original_name, extraction, description FROM masters_consultation_documents WHERE consultation_id = $1', [expected.consultationId]
  )
  assert.ok(documents.rowCount && documents.rowCount >= 7)
  assert.ok(documents.rows.every((row) => row.upload_status === 'REMOVED' && row.original_name === 'withdrawn-material' && row.extraction === null && row.description === null))
  const fileCount = await assertRestoredPrivateRoot(context.filesRoot, 0)
  return {
    consultationId: expected.consultationId,
    withdrawnStatus: 'WITHDRAWN',
    redactedDocumentRows: documents.rowCount,
    restoredPrivateFileCount: fileCount,
    removedOriginalBytesResurrected: false,
    tlsVerifyFull: context.tlsVerified
  }
}

async function runFlow(options: MastersPostgresHttpFlowOptions, filesRoot: string): Promise<MastersPostgresHttpFlowResult> {
  let app = await startPostgresApp(options.poolConfig, filesRoot, undefined, options.pdfFontPath)
  try {
    assert.ok(app.store instanceof PostgresStore)
    const candidate = await app.login('masters-pg-http-candidate')
    const otherStudent = await app.login('masters-pg-http-other-student')
    const founder = await app.login('masters-pg-http-founder')
    const manager = await app.login('masters-pg-http-assignment-manager')
    const advisorA = await app.login('masters-pg-http-advisor-a')
    const advisorB = await app.login('masters-pg-http-advisor-b')
    const unassignedAdvisor = await app.login('masters-pg-http-unassigned-advisor')

    const created = await app.call('/v1/masters/consultations', candidate.accessToken, 'POST', {
      targetYear: 'UNDECIDED', channel: 'organic', path: 'RESUME', serviceConsent: consent
    }, 'pg-http-create-key')
    assert.equal(created.status, 201, JSON.stringify(created.body))
    const consultationId = created.body.consultation.id as string
    const path = `/v1/masters/consultations/${consultationId}`
    const internalPath = `/v1/internal/masters/consultations/${consultationId}`

    let version = created.body.consultation.profileVersion as number
    const patched = await app.call(path, candidate.accessToken, 'PATCH', { version, path: 'GUIDED', profile: applicantProfile() })
    assert.equal(patched.status, 200, JSON.stringify(patched.body))
    version = patched.body.consultation.profileVersion as number

    const commonPdf = await makeSyntheticPdf({ text: 'Synthetic attachment for isolated PostgreSQL HTTP verification' })
    const initialResumeBytes = resumeBytes()
    const materials: Array<{ type: string; bytes: Buffer; name: string; mime: string }> = [
      { type: 'RESUME', bytes: initialResumeBytes, name: 'pg-http-resume.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      { type: 'TRANSCRIPT', bytes: commonPdf, name: 'pg-http-transcript.pdf', mime: 'application/pdf' },
      { type: 'LANGUAGE', bytes: commonPdf, name: 'pg-http-language.pdf', mime: 'application/pdf' },
      { type: 'ENROLLMENT', bytes: makeSyntheticPng(), name: 'pg-http-enrollment.png', mime: 'image/png' },
      { type: 'GRADUATION', bytes: makeSyntheticPng(5, 4), name: 'pg-http-graduation.png', mime: 'image/png' },
      { type: 'DEGREE', bytes: makeSyntheticJpeg(5, 4), name: 'pg-http-degree.jpg', mime: 'image/jpeg' },
      { type: 'SUPPLEMENTAL', bytes: commonPdf, name: 'pg-http-supplement.pdf', mime: 'application/pdf' }
    ]
    const documentIds: Record<string, string> = {}
    const bytesByType: Record<string, Buffer> = {}
    for (const material of materials) {
      const result = await app.upload(
        consultationId, candidate.accessToken, version, material.type,
        material.bytes, material.name, material.mime,
        material.type === 'SUPPLEMENTAL' ? { description: '虚构课程项目证明，仅用于隔离测试' } : {}
      )
      assert.equal(result.status, 201, JSON.stringify(result.body))
      documentIds[material.type] = result.body.document.id as string
      bytesByType[material.type] = material.bytes
      version = result.body.consultation.profileVersion as number
    }
    assert.equal(Object.keys(documentIds).length, 7)
    assert.equal(new Set(Object.keys(documentIds)).size, 7)

    const activeRows = await app.store.pool.query<{
      id: string
      type: string
      storage_key: string
      upload_status: string
      user_id: string
      size_bytes: number
    }>(
      `SELECT id, type, storage_key, upload_status, user_id, size_bytes
         FROM masters_consultation_documents
        WHERE consultation_id = $1 AND upload_status = 'UPLOADED'
        ORDER BY type`,
      [consultationId]
    )
    assert.equal(activeRows.rowCount, 7)
    assert.deepEqual(activeRows.rows.map((row) => row.type), [
      'DEGREE', 'ENROLLMENT', 'GRADUATION', 'LANGUAGE', 'RESUME', 'SUPPLEMENTAL', 'TRANSCRIPT'
    ])
    assert.ok(activeRows.rows.every((row) => row.user_id === candidate.user.id && row.size_bytes > 0))
    const resumeRow = activeRows.rows.find((row) => row.type === 'RESUME')
    assert.ok(resumeRow)
    assert.deepEqual(await app.files.get(resumeRow.storage_key), initialResumeBytes)

    const studentDenied = await app.call(path, otherStudent.accessToken)
    assert.ok([403, 404].includes(studentDenied.status), JSON.stringify(studentDenied.body))
    const crossDownload = await app.binary(`${path}/documents/${documentIds.RESUME}`, otherStudent.accessToken)
    assert.ok([403, 404].includes(crossDownload.status), JSON.stringify(crossDownload.body))

    // Replacement leaves an auditable REMOVED row and immediately removes the
    // old private object.  The active category count remains seven.
    const oldResumeId = documentIds.RESUME!
    const oldResumeStorageKey = resumeRow!.storage_key
    const replacementBytes = makeSyntheticDocx([
      '姓名：PG合成申请人',
      '本科院校：Synthetic University',
      '本科专业：Computer Science',
      '学位名称：Bachelor of Science',
      '百分制均分：88.5',
      'GPA：3.72 / 4.0',
      'GPA满分：4.0',
      '预计毕业年月：2027-06',
      '材料版本：替换后的虚构简历'
    ].join('\n'))
    const replacement = await app.upload(
      consultationId, candidate.accessToken, version, 'RESUME', replacementBytes,
      'pg-http-resume-replacement.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      { replaceDocumentId: oldResumeId }, 'pg-http-replace-key'
    )
    assert.equal(replacement.status, 201, JSON.stringify(replacement.body))
    documentIds.RESUME = replacement.body.document.id as string
    bytesByType.RESUME = replacementBytes
    version = replacement.body.consultation.profileVersion as number
    const oldResumeUrl = await app.binary(`${path}/documents/${oldResumeId}`, candidate.accessToken)
    assert.equal(oldResumeUrl.status, 404, JSON.stringify(oldResumeUrl.body))
    await assert.rejects(app.files.get(oldResumeStorageKey))
    const removedRow = await app.store.pool.query<{ upload_status: string; removed_at: Date | string | null }>(
      'SELECT upload_status, removed_at FROM masters_consultation_documents WHERE id = $1', [oldResumeId]
    )
    assert.equal(removedRow.rows[0]?.upload_status, 'REMOVED')
    assert.ok(removedRow.rows[0]?.removed_at)

    const restoredBeforeStaff = await app.call(path, candidate.accessToken)
    assert.equal(restoredBeforeStaff.status, 200, JSON.stringify(restoredBeforeStaff.body))
    assert.equal(restoredBeforeStaff.body.consultation.documents.filter((item: any) => item.uploadStatus === 'UPLOADED').length, 7)

    // Close both HTTP and Store, then rebuild the complete stack.  The old
    // session token and private root are intentionally reused to prove
    // database/session/file persistence instead of fixture reconstruction.
    await app.close()
    app = await startPostgresApp(options.poolConfig, filesRoot, undefined, options.pdfFontPath)
    assert.ok(app.store instanceof PostgresStore)
    const restored = await app.call(path, candidate.accessToken)
    assert.equal(restored.status, 200, JSON.stringify(restored.body))
    assert.equal(restored.body.consultation.profile.name, 'PG合成申请人')
    assert.equal(restored.body.consultation.path, 'GUIDED')
    assert.equal(restored.body.consultation.documents.filter((item: any) => item.uploadStatus === 'UPLOADED').length, 7)
    const restoredDownload = await app.binary(`${path}/documents/${documentIds.RESUME}`, candidate.accessToken)
    assert.equal(restoredDownload.status, 200, JSON.stringify(restoredDownload.body))
    assert.equal(digest(restoredDownload.bytes), digest(replacementBytes))

    const directConsultation = await app.store.pool.query<{ profile: any; profile_version: number; service_consent_id: string | null }>(
      'SELECT profile, profile_version, service_consent_id FROM masters_consultations WHERE id = $1 AND user_id = $2',
      [consultationId, candidate.user.id]
    )
    assert.equal(directConsultation.rowCount, 1)
    assert.equal(directConsultation.rows[0]?.profile?.gpa, '3.72')
    assert.equal(directConsultation.rows[0]?.profile_version, version)
    assert.ok(directConsultation.rows[0]?.service_consent_id)

    await app.store.transaction(async (tx) => {
      await tx.insert('mastersStaff', {
        id: 'mstf-pg-http-founder', userId: founder.user.id, role: 'founder', status: 'ACTIVE', grantedBy: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      })
    })
    await app.service.grantStaff(founder.user.id, manager.user.id, 'assignment_manager')
    await app.service.grantStaff(founder.user.id, advisorA.user.id, 'advisor')
    await app.service.grantStaff(founder.user.id, advisorB.user.id, 'advisor')
    await app.service.grantStaff(founder.user.id, unassignedAdvisor.user.id, 'advisor')

    const unassignedDetail = await app.call(internalPath, unassignedAdvisor.accessToken)
    assert.equal(unassignedDetail.status, 403, JSON.stringify(unassignedDetail.body))
    assertCode(unassignedDetail, 'MASTERS_ASSIGNMENT_REQUIRED')
    const unassignedFile = await app.binary(`${internalPath}/documents/${documentIds.TRANSCRIPT}`, unassignedAdvisor.accessToken)
    assert.equal(unassignedFile.status, 403, JSON.stringify(unassignedFile.body))
    assertCode(unassignedFile, 'MASTERS_ASSIGNMENT_REQUIRED')

    const assigned = await app.call(`${internalPath}/assignment`, manager.accessToken, 'POST', {
      advisorUserId: advisorA.user.id, version
    }, 'pg-http-assignment-a')
    assert.equal(assigned.status, 200, JSON.stringify(assigned.body))
    const advisorADownload = await app.binary(`${internalPath}/documents/${documentIds.TRANSCRIPT}`, advisorA.accessToken)
    assert.equal(advisorADownload.status, 200, JSON.stringify(advisorADownload.body))
    assert.equal(digest(advisorADownload.bytes), digest(commonPdf))

    const reassigned = await app.call(`${internalPath}/assignment`, manager.accessToken, 'POST', {
      advisorUserId: advisorB.user.id, version
    }, 'pg-http-assignment-b')
    assert.equal(reassigned.status, 200, JSON.stringify(reassigned.body))
    const oldAdvisorDetail = await app.call(internalPath, advisorA.accessToken)
    assert.equal(oldAdvisorDetail.status, 403, JSON.stringify(oldAdvisorDetail.body))
    assertCode(oldAdvisorDetail, 'MASTERS_ASSIGNMENT_REQUIRED')
    const oldAdvisorDownload = await app.binary(`${internalPath}/documents/${documentIds.TRANSCRIPT}`, advisorA.accessToken)
    assert.equal(oldAdvisorDownload.status, 403, JSON.stringify(oldAdvisorDownload.body))
    assertCode(oldAdvisorDownload, 'MASTERS_ASSIGNMENT_REQUIRED')
    const newAdvisorDownload = await app.binary(`${internalPath}/documents/${documentIds.TRANSCRIPT}`, advisorB.accessToken)
    assert.equal(newAdvisorDownload.status, 200, JSON.stringify(newAdvisorDownload.body))
    const assignmentRows = await app.store.pool.query<{ advisor_user_id: string; status: string }>(
      'SELECT advisor_user_id, status FROM masters_consultation_assignments WHERE consultation_id = $1',
      [consultationId]
    )
    assert.equal(assignmentRows.rowCount, 2)
    assert.ok(assignmentRows.rows.some((row) => row.advisor_user_id === advisorA.user.id && row.status === 'ENDED'))
    assert.ok(assignmentRows.rows.some((row) => row.advisor_user_id === advisorB.user.id && row.status === 'ACTIVE'))

    // The draft/restart path above preserves UNDECIDED. The synthetic student
    // now explicitly chooses the intake year covered by the fixed source.
    const chosenIntake = await app.call(path, candidate.accessToken, 'PATCH', { version, profile: { targetYear: sourcedProgram.intakeYear } })
    assert.equal(chosenIntake.status, 200, JSON.stringify(chosenIntake.body))
    version = chosenIntake.body.consultation.profileVersion
    const confirmed = await app.call(`${path}/confirm`, candidate.accessToken, 'POST', {
      version, accuracyConfirmed: true, consent
    }, 'pg-http-confirm-key')
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body))
    const submitKey = 'pg-http-submit-key'
    const submitted = await app.call(`${path}/submit`, candidate.accessToken, 'POST', { version }, submitKey)
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body))
    const replayed = await app.call(`${path}/submit`, candidate.accessToken, 'POST', { version }, submitKey)
    assert.equal(replayed.status, 200, JSON.stringify(replayed.body))
    assert.equal(replayed.body.consultation.id, consultationId)
    const queued = await app.store.pool.query<{ id: string; status: string; source_profile_version: number }>(
      'SELECT id, status, source_profile_version FROM masters_report_jobs WHERE consultation_id = $1', [consultationId]
    )
    assert.equal(queued.rowCount, 1)
    assert.equal(queued.rows[0]?.status, 'QUEUED')
    assert.equal(queued.rows[0]?.source_profile_version, version)
    const submitIdempotency = await app.store.pool.query<{ status: string; resource_id: string | null }>(
      `SELECT status, resource_id
         FROM masters_idempotency_records
        WHERE user_id = $1 AND domain = 'SUBMIT'`, [candidate.user.id]
    )
    assert.equal(submitIdempotency.rowCount, 1)
    assert.equal(submitIdempotency.rows[0]?.status, 'COMPLETED')
    assert.equal(submitIdempotency.rows[0]?.resource_id, consultationId)

    const claimed = await app.service.claimJob('pg-http-worker')
    assert.ok(claimed)
    assert.equal(claimed?.status, 'RUNNING')
    assert.equal(claimed?.sourceProfileVersion, version)
    const completed = await app.service.completeJob(claimed!.id, claimed!.leaseToken as string)
    assert.equal(completed.status, 'NEEDS_REVIEW')

    const internalBeforeEdit = await app.call(internalPath, advisorB.accessToken)
    assert.equal(internalBeforeEdit.status, 200, JSON.stringify(internalBeforeEdit.body))
    const initialReport = internalBeforeEdit.body.consultation.currentReport
    assert.equal(initialReport.status, 'NEEDS_REVIEW')
    assert.equal(initialReport.assistance.level, 'RULE_DRAFT')
    assert.deepEqual(initialReport.payload.candidatePrograms, [])
    const edited = await app.call(`${internalPath}/report/edit`, advisorB.accessToken, 'POST', {
      version: initialReport.version,
      reportId: initialReport.id,
      payload: { ...assistedReportPatch, backgroundSummary: 'PG_HTTP_APPROVED_SUMMARY；完全虚构的申请人，由顾问核验官网来源后的辅助方案' },
      note: '仅用于 PostgreSQL HTTP 审核流程'
    }, 'pg-http-edit-key')
    assert.equal(edited.status, 200, JSON.stringify(edited.body))
    const editedReport = edited.body.consultation.currentReport
    assert.equal(editedReport.version, initialReport.version + 1)
    assert.equal(editedReport.editedBy, advisorB.user.id)
    const reviewed = await app.call(`${internalPath}/report/review`, advisorB.accessToken, 'POST', {
      version: editedReport.version, reportId: editedReport.id, note: '顾问已核对资料和缺件状态'
    }, 'pg-http-review-key')
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body))
    assert.equal(reviewed.body.consultation.currentReport.reviewedBy, advisorB.user.id)
    assert.equal(reviewed.body.consultation.currentReport.assistance.level, 'ADVISOR_VERIFIED_PLAN')
    const approved = await app.call(`${internalPath}/report/approve`, founder.accessToken, 'POST', {
      version: editedReport.version, reportId: editedReport.id, note: 'Founder 批准有来源项目的合成辅助方案'
    }, 'pg-http-approve-key')
    assert.equal(approved.status, 200, JSON.stringify(approved.body))
    const released = await app.call(`${internalPath}/report/release`, founder.accessToken, 'POST', {
      version: editedReport.version, reportId: editedReport.id, note: 'Founder 开放有来源项目的合成辅助方案'
    }, 'pg-http-release-key')
    assert.equal(released.status, 200, JSON.stringify(released.body))
    assert.equal(released.body.consultation.currentReport.status, 'RELEASED')

    const studentReport = await app.call(`${path}/report`, candidate.accessToken)
    assert.equal(studentReport.status, 200, JSON.stringify(studentReport.body))
    assert.equal(studentReport.body.report.status, 'RELEASED')
    assert.equal(studentReport.body.report.assistance.level, 'ADVISOR_VERIFIED_PLAN')
    assert.equal(studentReport.body.report.assistance.autoSchoolMatching, 'NOT_IMPLEMENTED')
    assert.deepEqual(studentReport.body.report.payload.candidatePrograms, [sourcedProgram])
    const releasedReport = studentReport.body.report as {
      id: string
      version: number
      sourceProfileVersion: number
      payload: Record<string, unknown>
    }
    const exportReport: ExportReport = {
      id: releasedReport.id,
      version: releasedReport.version,
      profileVersion: releasedReport.sourceProfileVersion,
      content: releasedReport.payload
    }
    const expectedExportDigest = contentDigest(exportReport)
    const persistedReport = await app.store.pool.query<{ payload: unknown; version: number; source_profile_version: number }>(
      'SELECT payload, version, source_profile_version FROM masters_reports WHERE id = $1', [releasedReport.id]
    )
    assert.equal(persistedReport.rowCount, 1)
    assert.deepEqual(persistedReport.rows[0]?.payload, releasedReport.payload)
    assert.equal(persistedReport.rows[0]?.version, releasedReport.version)
    assert.equal(persistedReport.rows[0]?.source_profile_version, releasedReport.sourceProfileVersion)
    const xlsx = await app.binary(`${path}/report/export?format=xlsx`, candidate.accessToken)
    assert.equal(xlsx.status, 200, JSON.stringify(xlsx.body))
    assert.match(xlsx.contentType, /spreadsheetml\.sheet/)
    assert.ok(xlsx.bytes.subarray(0, 2).equals(Buffer.from('PK')))
    const worksheetText = unpackWorksheetText(xlsx.bytes)
    const worksheetCells = [...worksheetText.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((match) => match[1] ?? '')
    assert.match(worksheetText, /Application Compass/)
    assert.ok(worksheetText.includes(sourcedProgram.officialUrl) && worksheetText.includes(sourcedProgram.program))
    assert.ok(worksheetCells.includes('report_id'))
    assert.ok(worksheetCells.includes(releasedReport.id))
    assert.ok(worksheetCells.includes('report_version'))
    assert.ok(worksheetCells.includes(String(releasedReport.version)))
    assert.ok(worksheetCells.includes('profile_version'))
    assert.ok(worksheetCells.includes(String(releasedReport.sourceProfileVersion)))
    assert.ok(worksheetCells.includes('content_sha256'))
    assert.ok(worksheetCells.includes(expectedExportDigest))
    // XLSX contains the governed candidate table, not the PDF background prose.
    for (const [label, expected] of [
      ['report_id', releasedReport.id], ['report_version', String(releasedReport.version)],
      ['profile_version', String(releasedReport.sourceProfileVersion)], ['content_sha256', expectedExportDigest],
      ['approved_candidates_json', JSON.stringify(releasedReport.payload.candidatePrograms)]
    ]) assert.equal(worksheetCells[worksheetCells.indexOf(label!) + 1], expected)
    assert.match(worksheetText, /t="inlineStr"/)
    assert.doesNotMatch(worksheetText, /<f(?:\s|>)/i)
    assert.doesNotMatch(worksheetText, /<hyperlink(?:\s|>)/i)

    const effectivePdfFontPath = options.pdfFontPath || pdfFontPath
    const pdf = await app.binary(`${path}/report/export?format=pdf`, candidate.accessToken)
    let pdfExport: 'PASS' | 'BLOCKED_EXTERNAL' = 'PASS'
    let pdfReason: string | undefined
    if (existsSync(effectivePdfFontPath)) {
      assert.equal(pdf.status, 200, JSON.stringify(pdf.body))
      assert.equal(pdf.contentType, 'application/pdf')
      assert.equal(pdf.bytes.subarray(0, 5).toString('ascii'), '%PDF-')
      const pdfText = await extractPdfText(pdf.bytes)
      for (const expected of [
        'Application Compass', releasedReport.id, String(releasedReport.version),
        String(releasedReport.sourceProfileVersion), expectedExportDigest,
        'PG_HTTP_APPROVED_SUMMARY', sourcedProgram.officialUrl, sourcedProgram.institution
      ]) assert.ok(pdfText.includes(expected), `PDF must contain released report value: ${expected}`)
    } else {
      assert.equal(pdf.status, 503, JSON.stringify(pdf.body))
      assertCode(pdf, 'PDF_FONT_REQUIRED')
      pdfExport = 'BLOCKED_EXTERNAL'
      pdfReason = 'Chinese PDF font is unavailable at the configured test path; HTTP 503 was recorded and is not counted as export success'
    }

    const releasedDetail = await app.call(path, candidate.accessToken)
    assert.equal(releasedDetail.status, 200, JSON.stringify(releasedDetail.body))
    const releasedExpected: RestoreExpectedState = {
      consultationId,
      path,
      internalPath,
      profile: releasedDetail.body.consultation.profile,
      profileVersion: releasedDetail.body.consultation.profileVersion,
      report: {
        id: releasedReport.id,
        version: releasedReport.version,
        profileVersion: releasedReport.sourceProfileVersion,
        payload: releasedReport.payload
      },
      documentIds: { ...documentIds },
      bytesByType: { ...bytesByType },
      candidateToken: candidate.accessToken,
      otherStudentToken: otherStudent.accessToken,
      currentAdvisorToken: advisorB.accessToken,
      formerAdvisorToken: advisorA.accessToken
    }
    let isolatedBackupRestoreProof: {
      released?: MastersIsolatedBackupRestoreResult
      withdrawn?: MastersIsolatedBackupRestoreResult
    } | undefined
    if (options.backupRestore) {
      const runBackupCheckpoint = async (checkpoint: 'RELEASED' | 'WITHDRAWN'): Promise<MastersIsolatedBackupRestoreResult> => runMastersIsolatedBackupRestore({
        backupRestore: options.backupRestore!,
        poolConfig: options.poolConfig,
        checkpoint,
        privateRoot: filesRoot,
        stopSource: async () => { await app.close() },
        restartSource: async () => { app = await startPostgresApp(options.poolConfig, filesRoot, undefined, options.pdfFontPath) },
        startRestoredApp: async (poolConfig, restoredFilesRoot) => startPostgresApp(poolConfig, restoredFilesRoot, undefined, options.pdfFontPath),
        verifyRestored: async (restoredApp, context) => verifyRestoredCheckpoint(restoredApp as PostgresHttpApp, context, releasedExpected, effectivePdfFontPath)
      })
      isolatedBackupRestoreProof = { released: await runBackupCheckpoint('RELEASED') }
    }

    const changed = await app.call(path, candidate.accessToken, 'PATCH', {
      version, profile: { targetPreference: '资料变化后的合成偏好' }
    })
    assert.equal(changed.status, 200, JSON.stringify(changed.body))
    const changedVersion = changed.body.consultation.profileVersion as number
    assert.equal(changedVersion, version + 1)
    const staleRows = await app.store.pool.query<{ version: number; status: string; source_profile_version: number }>(
      'SELECT version, status, source_profile_version FROM masters_reports WHERE consultation_id = $1 ORDER BY version',
      [consultationId]
    )
    assert.equal(staleRows.rowCount, 2)
    assert.ok(staleRows.rows.every((row) => row.status === 'STALE' && row.source_profile_version < changedVersion))
    const staleRead = await app.call(`${path}/report`, candidate.accessToken)
    assert.equal(staleRead.status, 409, JSON.stringify(staleRead.body))
    assertCode(staleRead, 'MASTERS_REPORT_STALE')
    const staleExport = await app.binary(`${path}/report/export?format=xlsx`, candidate.accessToken)
    assert.equal(staleExport.status, 409, JSON.stringify(staleExport.body))

    const withdrawn = await app.call(`${path}/withdraw`, candidate.accessToken, 'POST', { version: changedVersion }, 'pg-http-withdraw-key')
    assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn.body))
    const withdrawnReport = await app.call(`${path}/report`, candidate.accessToken)
    assert.ok(withdrawnReport.status >= 400, JSON.stringify(withdrawnReport.body))
    const withdrawnDownload = await app.binary(`${path}/documents/${documentIds.RESUME}`, candidate.accessToken)
    assert.ok(withdrawnDownload.status >= 400, JSON.stringify(withdrawnDownload.body))
    const withdrawnInternal = await app.call(internalPath, advisorB.accessToken)
    assert.equal(withdrawnInternal.status, 410, JSON.stringify(withdrawnInternal.body))
    const withdrawnRows = await app.store.pool.query<{ status: string; withdrawn_at: Date | string | null }>(
      'SELECT status, withdrawn_at FROM masters_consultations WHERE id = $1', [consultationId]
    )
    assert.equal(withdrawnRows.rows[0]?.status, 'WITHDRAWN')
    assert.ok(withdrawnRows.rows[0]?.withdrawn_at)
    const withdrawnJobs = await app.store.pool.query<{ status: string }>(
      'SELECT status FROM masters_report_jobs WHERE consultation_id = $1', [consultationId]
    )
    // A completed NEEDS_REVIEW job is terminal for the worker queue; queued,
    // running, and retryable jobs are fenced to STALE by withdrawal.  In both
    // cases a post-withdrawal claim must be impossible.
    assert.ok(withdrawnJobs.rows.every((row) => row.status === 'STALE' || row.status === 'NEEDS_REVIEW'))
    assert.equal(await app.service.claimJob('pg-http-worker-after-withdrawal'), null)
    const purgedRows = await app.store.pool.query<{ original_name: string; extraction: any; description: string | null }>(
      `SELECT original_name, extraction, description
         FROM masters_consultation_documents
        WHERE consultation_id = $1
        ORDER BY original_name`, [consultationId]
    )
    assert.ok(purgedRows.rowCount && purgedRows.rowCount >= 7)
    assert.ok(purgedRows.rows.every((row) => row.original_name === 'withdrawn-material' && row.extraction === null && row.description === null))

    if (options.backupRestore) {
      const withdrawnProof = await runMastersIsolatedBackupRestore({
        backupRestore: options.backupRestore,
        poolConfig: options.poolConfig,
        checkpoint: 'WITHDRAWN',
        privateRoot: filesRoot,
        stopSource: async () => { await app.close() },
        restartSource: async () => { app = await startPostgresApp(options.poolConfig, filesRoot, undefined, options.pdfFontPath) },
        startRestoredApp: async (poolConfig, restoredFilesRoot) => startPostgresApp(poolConfig, restoredFilesRoot, undefined, options.pdfFontPath),
        verifyRestored: async (restoredApp, context) => verifyRestoredCheckpoint(restoredApp as PostgresHttpApp, context, releasedExpected, effectivePdfFontPath)
      })
      isolatedBackupRestoreProof = { ...(isolatedBackupRestoreProof ?? {}), withdrawn: withdrawnProof }
    }

    return {
      status: pdfExport === 'PASS' ? 'PASS' : 'PASS_WITH_EXTERNAL_BLOCK',
      store: 'PostgresStore',
      databaseRows: 'PASS',
      multipartAndPrivateStorage: 'PASS',
      restartRecovery: 'PASS',
      authorizationAndReassignment: 'PASS',
      idempotentSubmitAndWorker: 'PASS',
      reviewApprovalRelease: 'PASS',
      staleAndWithdrawnAccess: 'PASS',
      xlsxExport: 'PASS',
      pdfExport,
      isolatedBackupRestore: options.backupRestore ? 'PASS' : 'BLOCKED_EXTERNAL',
      ...(isolatedBackupRestoreProof ? { isolatedBackupRestoreProof } : {}),
      ...(pdfReason ? { pdfReason } : {})
    }
  } finally {
    await app.close().catch(() => undefined)
  }
}

/**
 * Run the complete HTTP proof in a disposable private root.  The caller owns
 * the database/schema lifecycle; this function only owns its temporary
 * private files and the Postgres-backed HTTP stack.
 */
export async function runMastersPostgresHttpFlow(options: MastersPostgresHttpFlowOptions): Promise<MastersPostgresHttpFlowResult> {
  const directory = await mkdtemp(join(tmpdir(), 'masters-postgres-http-flow-'))
  const privateRoot = join(directory, 'private')
  try {
    return await runFlow(options, privateRoot)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
