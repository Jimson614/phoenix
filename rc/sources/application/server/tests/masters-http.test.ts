import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID, createHash } from 'node:crypto'
import { mkdtemp, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AddressInfo } from 'node:net'
import { request as httpRequest } from 'node:http'
import { MockWechatAuthProvider } from '../src/auth/wechat-auth-provider'
import { AuthService } from '../src/services/auth-service'
import { ProfileService } from '../src/services/profile-service'
import { AssessmentService } from '../src/services/assessment-service'
import { OrderService } from '../src/services/order-service'
import { ReportService } from '../src/services/report-service'
import { MastersService } from '../src/services/masters-service'
import { MastersHttp } from '../src/masters/http'
import { MastersWorker } from '../src/masters/worker'
import { PrivateFiles } from '../src/masters/private-files'
import { MockPaymentProvider } from '../src/payments/mock-payment-provider'
import { validateSourceCatalog } from '../src/domain/source-catalog'
import { createAppServer } from '../src/http/app'
import { FileStore } from '../src/store/file-store'
import { loadMastersConfig } from '../src/masters/config'
import { makeSyntheticDocx, makeSyntheticPdf, makeSyntheticPng, makeSyntheticJpeg } from './fixtures/masters-fixtures'

const secret = 'masters-http-fictional-test-session-secret-only'
const consent = { accepted: true as const, copyVersion: 'masters_service_consent_v1.1' }
const profile = {
  name: '合成申请人甲', adultConfirmed: true, contact: { type: 'email', value: 'synthetic@example.invalid' },
  educationStatus: 'ENROLLED', institution: 'Synthetic University', major: 'Synthetic Studies',
  degree: '', graduationDate: '2027-06', averageScore: '', gpa: '3.70', gpaScale: '4.00', classRank: '12/120',
  languageType: 'NONE', languageStatus: 'NONE', languageScores: null,
  targetYear: 'UNDECIDED', targetMajors: ['尚未确定'], targetInstitutions: ['希望顾问建议'],
  targetPreference: '希望顾问建议', experiences: []
}
// Import the actual client serializer; do not hand-write a cleaner server-only payload.
const clientProfilePayload = require('../../../models/masters-profile-payload') as (value: unknown) => Record<string, unknown>
const catalog = validateSourceCatalog({ version: 'MASTERS-SYNTHETIC-TEST', dataAsOf: '2026-09-05', reviewedAt: '2026-09-05T00:00:00.000Z', reviewedBy: 'Synthetic fixture', entries: [{ sourceId: 'SYNTHETIC-TEST', title: 'Synthetic source', applicableYear: '2026', verifiedAt: '2026-09-05T00:00:00.000Z' }] })

async function start(directory: string) {
  const store = await FileStore.open(join(directory, 'database.json'))
  const files = new PrivateFiles(join(directory, 'private'))
  await files.initialize()
  const service = new MastersService(store)
  const auth = new AuthService(store, new MockWechatAuthProvider(), secret)
  const server = createAppServer({ auth, profiles: new ProfileService(store), assessments: new AssessmentService(store, catalog), orders: new OrderService(store, new MockPaymentProvider(secret), catalog, false), reports: new ReportService(store), masters: new MastersHttp(service, files, store, process.env.MASTERS_TEST_PDF_FONT_PATH ?? '') })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = async (path: string, token = '', method = 'GET', body?: unknown, key = randomUUID()): Promise<{ status: number; body: any }> => {
    const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': key }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, body: await response.json() }
  }
  const login = async (code: string) => (await call('/v1/auth/wechat/session', '', 'POST', { code })).body
  const upload = async (id: string, token: string, version: number, type: string, bytes: Buffer, name: string, mime: string, key = randomUUID(), extra: Record<string, string> = {}) => {
    const data = new FormData()
    data.append('version', String(version)); data.append('type', type)
    for (const [key, value] of Object.entries(extra)) data.append(key, value)
    data.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), name)
    const response = await fetch(`${base}/v1/masters/consultations/${id}/documents`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': key }, body: data })
    return { status: response.status, body: await response.json() }
  }
  return { store, files, service, auth, server, base, call, login, upload, close: () => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())) }
}

test('P0 flags fail closed; no production, model or transient-store activation', () => {
  assert.equal(loadMastersConfig({}).enabled, false)
  assert.throws(() => loadMastersConfig({ NODE_ENV: 'production', MASTERS_INTAKE_ENABLED: 'true' }))
  assert.throws(() => loadMastersConfig({ MASTERS_AI_ENABLED: 'true' }))
  assert.throws(() => loadMastersConfig({ MASTERS_INTAKE_ENABLED: 'true' }))
})

test('guided path switch persists with the profile across HTTP restart and keeps consent, owner and version gates', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'masters-guided-recovery-'))
  let app = await start(dir)
  try {
    const owner = await app.login('synthetic-guided-owner'), other = await app.login('synthetic-guided-other')
    const created = await app.call('/v1/masters/consultations', owner.accessToken, 'POST', { path: 'RESUME', targetYear: 'UNDECIDED' })
    assert.equal(created.status, 201)
    const path = `/v1/masters/consultations/${created.body.consultation.id}`
    const patch = { version: 1, profile: clientProfilePayload({ institution: 'Synthetic draft university' }), path: 'GUIDED' }
    const denied = await app.call(path, owner.accessToken, 'PATCH', patch)
    assert.equal(denied.status, 403, JSON.stringify(denied.body))
    assert.equal(denied.body.error.code, 'MASTERS_CONSENT_REQUIRED')
    // Seed consent for this legacy empty draft; normal clients supply it at creation.
    await app.service.grantConsent(owner.user.id, created.body.consultation.id, consent)
    assert.ok((await app.call(path, other.accessToken, 'PATCH', patch)).status >= 400)
    assert.equal((await app.call(path, owner.accessToken, 'PATCH', { ...patch, path: 'admin' })).status, 400)
    const saved = await app.call(path, owner.accessToken, 'PATCH', patch)
    assert.equal(saved.status, 200, JSON.stringify(saved.body))
    assert.equal(saved.body.consultation.profileVersion, 2)
    assert.equal(saved.body.consultation.path, 'GUIDED')
    assert.equal((await app.call(path, owner.accessToken, 'PATCH', { ...patch, path: 'RESUME' })).status, 409)
    await app.close()
    app = await start(dir)
    const restored = await app.call(path, owner.accessToken)
    assert.equal(restored.body.consultation.path, 'GUIDED')
    assert.equal(restored.body.consultation.profile.institution, patch.profile.institution)
    assert.equal(restored.body.consultation.profileVersion, 2)
    assert.equal(restored.body.consultation.profile.contact, null)
    assert.equal(restored.body.consultation.profile.graduationDate, null)
    assert.equal(restored.body.consultation.profile.languageScores, null)
    const scored = await app.call(path, owner.accessToken, 'PATCH', {
      version: 2, path: 'GUIDED', profile: clientProfilePayload({
        ...profile, graduationYear: '', languageStatus: 'AVAILABLE', languageType: 'IELTS',
        languageScores: { total: '7.0', subscores: { listening: '7.5' }, examDate: '' },
        experiences: [{ type: 'RESEARCH', title: 'Synthetic project', startDate: '', endDate: '' }]
      })
    })
    assert.equal(scored.status, 200, JSON.stringify(scored.body))
    assert.equal(scored.body.consultation.profile.languageScores.total, '7.0')
    assert.equal(scored.body.consultation.profile.languageScores.subscores.listening, '7.5')
    assert.equal(scored.body.consultation.profile.languageScores.examDate, null)
    assert.equal(scored.body.consultation.profile.experiences[0].startDate, null)
    for (const invalid of [{ graduationDate: 'not-a-date' }, { contact: { type: 'email', value: 'not-an-email' } }]) {
      assert.equal((await app.call(path, owner.accessToken, 'PATCH', { version: 3, profile: clientProfilePayload(invalid), path: 'GUIDED' })).status, 400)
    }
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }) }
})

test('real HTTP DOCX/PDF uploads survive restart, group by type, enforce ownership and permit incomplete submission', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'masters-http-synthetic-'))
  let app = await start(dir)
  try {
    const owner = await app.login('masters-owner-synthetic'), other = await app.login('masters-other-synthetic')
    const key = randomUUID()
    const input = { targetYear: 'UNDECIDED', channel: 'organic', path: 'RESUME', serviceConsent: consent }
    const created = await app.call('/v1/masters/consultations', owner.accessToken, 'POST', input, key)
    assert.equal(created.status, 201, JSON.stringify(created.body))
    const id = created.body.consultation.id, path = `/v1/masters/consultations/${id}`
    const capabilities = (await app.call('/v1/masters/capabilities', owner.accessToken)).body
    assert.equal(capabilities.retentionDays, 30)
    assert.ok(capabilities.serviceConsentText.includes('30 天'))
    const savedConsents = await app.store.read(tx => tx.findMany('mastersConsents', { consultationId: id }))
    assert.ok(savedConsents[0])
    assert.equal(savedConsents[0].copyTextHash, createHash('sha256').update(capabilities.serviceConsentText).digest('hex'), 'consent must bind the actual displayed policy, including retention')
    const replay = await app.call('/v1/masters/consultations', owner.accessToken, 'POST', input, key)
    assert.equal(replay.body.consultation.id, id)
    let result = await app.call(path, owner.accessToken, 'PATCH', { version: created.body.consultation.profileVersion, profile })
    assert.equal(result.status, 200, JSON.stringify(result.body))
    let version = result.body.consultation.profileVersion
    const docx = makeSyntheticDocx('姓名：合成申请人甲\n本科院校：Synthetic University\n本科专业：Synthetic Studies\nGPA：3.70\nGPA满分：4.00')
    const resume = await app.upload(id, owner.accessToken, version, 'RESUME', docx, 'synthetic-resume.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    assert.equal(resume.status, 201, JSON.stringify(resume.body))
    assert.ok(resume.body.document.id)
    assert.equal(resume.body.document.extractionStatus, 'NEEDS_CONFIRMATION')
    assert.equal(resume.body.document.storageKey, undefined)
    version = resume.body.consultation.profileVersion
    const pdf = await makeSyntheticPdf({ text: 'Synthetic academic transcript - no real person' })
    const transcript = await app.upload(id, owner.accessToken, version, 'TRANSCRIPT', pdf, 'synthetic-transcript-en.pdf', 'application/pdf')
    assert.equal(transcript.status, 201, JSON.stringify(transcript.body))
    version = transcript.body.consultation.profileVersion
    const more = await app.upload(id, owner.accessToken, version, 'TRANSCRIPT', pdf, 'synthetic-transcript-page2.pdf', 'application/pdf')
    assert.equal(more.status, 201)
    version = more.body.consultation.profileVersion
    assert.equal(more.body.consultation.documents.filter((d: any) => d.type === 'TRANSCRIPT').length, 2)
    const denied = await app.call(path, other.accessToken)
    assert.ok([403, 404].includes(denied.status))
    assert.ok(denied.body.request_id)
    const deniedFile = await fetch(`${app.base}${path}/documents/${resume.body.document.id}`, { headers: { Authorization: `Bearer ${other.accessToken}` } })
    assert.ok([403, 404].includes(deniedFile.status))
    const stale = await app.call(path, owner.accessToken, 'PATCH', { version: 1, profile: { major: 'cannot overwrite' } })
    assert.equal(stale.status, 409)
    const draft = await app.call(`${path}/report`, owner.accessToken)
    assert.ok(draft.status >= 400)
    await app.close()
    app = await start(dir)
    const restored = await app.call(path, owner.accessToken)
    assert.equal(restored.body.consultation.documents.length, 3)
    assert.equal(restored.body.consultation.profile.gpa, '3.70')
    assert.equal(restored.body.consultation.profile.gpaScale, '4.00')
    const download = await fetch(`${app.base}${path}/documents/${resume.body.document.id}`, { headers: { Authorization: `Bearer ${owner.accessToken}` } })
    assert.equal(download.status, 200)
    assert.equal(createHash('sha256').update(Buffer.from(await download.arrayBuffer())).digest('hex'), createHash('sha256').update(docx).digest('hex'))
    const confirmed = await app.call(`${path}/confirm`, owner.accessToken, 'POST', { version, accuracyConfirmed: true, consent })
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body))
    const submitKey = randomUUID()
    const submitted = await app.call(`${path}/submit`, owner.accessToken, 'POST', { version }, submitKey)
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body))
    assert.equal(submitted.body.consultation.status, 'SUBMITTED')
    assert.ok(submitted.body.consultation.missingDocuments.includes('ENROLLMENT'))
    assert.equal(submitted.body.consultation.verificationStatus, 'NEEDS_REVIEW')
    assert.equal((await app.call(`${path}/submit`, owner.accessToken, 'POST', { version }, submitKey)).status, 200)
    assert.equal((await app.store.read(tx => tx.findMany('mastersReportJobs', { consultationId: id }))).length, 1)
    assert.equal((await app.store.read(tx => tx.findMany('families'))).length, 0)
    assert.equal((await app.store.read(tx => tx.findMany('orders'))).length, 0)
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }) }
})

test('graduate has separate persistent degree/graduation images; upload failure preserves fields; withdraw revokes all downloads', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'masters-http-graduate-'))
  const app = await start(dir)
  try {
    const owner = await app.login('masters-graduate-synthetic')
    let result = await app.call('/v1/masters/consultations', owner.accessToken, 'POST', { targetYear: '2028', path: 'GUIDED', channel: 'organic', serviceConsent: consent })
    const id = result.body.consultation.id, path = `/v1/masters/consultations/${id}`
    result = await app.call(path, owner.accessToken, 'PATCH', { version: result.body.consultation.profileVersion, profile: { ...profile, educationStatus: 'GRADUATED', targetYear: '2028' } })
    const graduation = await app.upload(id, owner.accessToken, result.body.consultation.profileVersion, 'GRADUATION', makeSyntheticPng(), 'synthetic-graduation.png', 'image/png')
    assert.equal(graduation.status, 201, JSON.stringify(graduation.body))
    const degree = await app.upload(id, owner.accessToken, graduation.body.consultation.profileVersion, 'DEGREE', makeSyntheticJpeg(), 'synthetic-degree.jpg', 'image/jpeg')
    assert.equal(degree.status, 201, JSON.stringify(degree.body))
    assert.equal(degree.body.document.extractionStatus, 'MANUAL_REVIEW')
    const bad = await app.upload(id, owner.accessToken, degree.body.consultation.profileVersion, 'TRANSCRIPT', Buffer.from('invalid'), 'synthetic-old.doc', 'application/msword')
    assert.equal(bad.status, 415)
    const restored = (await app.call(path, owner.accessToken)).body.consultation
    assert.equal(restored.profile.gpa, '3.70')
    assert.deepEqual(restored.documents.map((d: any) => d.type).sort(), ['DEGREE', 'GRADUATION'])
    assert.equal((await app.call(`${path}/withdraw`, owner.accessToken, 'POST', {})).status, 200)
    const withdrawnFile = await fetch(`${app.base}${path}/documents/${degree.body.document.id}`, { headers: { Authorization: `Bearer ${owner.accessToken}` } })
    assert.ok(withdrawnFile.status >= 400)
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }) }
})

test('HTTP upload replay, replacement, removal, oversize and parser retry preserve the authoritative file state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'masters-http-edges-'))
  const app = await start(dir)
  try {
    const owner = await app.login('masters-upload-edges-synthetic')
    const created = await app.call('/v1/masters/consultations', owner.accessToken, 'POST', { targetYear: '2029', path: 'GUIDED', channel: 'organic', serviceConsent: consent })
    const id = created.body.consultation.id, path = `/v1/masters/consultations/${id}`
    const bytes = makeSyntheticPng(), uploadKey = randomUUID()
    const first = await app.upload(id, owner.accessToken, 1, 'TRANSCRIPT', bytes, 'synthetic-page.png', 'image/png', uploadKey)
    assert.equal(first.status, 201)
    const replay = await app.upload(id, owner.accessToken, 1, 'TRANSCRIPT', bytes, 'synthetic-page.png', 'image/png', uploadKey)
    assert.equal(replay.status, 201)
    assert.equal(replay.body.document.id, first.body.document.id)
    assert.equal(replay.body.consultation.documents.length, 1)
    const replaced = await app.upload(id, owner.accessToken, first.body.consultation.profileVersion, 'TRANSCRIPT', bytes, 'synthetic-new-page.png', 'image/png', randomUUID(), { replaceDocumentId: first.body.document.id })
    assert.equal(replaced.status, 201)
    assert.equal(replaced.body.consultation.documents.length, 1)
    const old = await app.call(`${path}/documents/${first.body.document.id}`, owner.accessToken)
    assert.equal(old.status, 404)
    const oldKey = await app.store.read(tx => tx.findById('mastersDocuments', first.body.document.id))
    await assert.rejects(app.files.get(oldKey!.storageKey))
    const removedReplay = await app.upload(id, owner.accessToken, 1, 'TRANSCRIPT', bytes, 'synthetic-page.png', 'image/png', uploadKey)
    assert.equal(removedReplay.status, 409)
    const version = replaced.body.consultation.profileVersion
    const tooLarge = await app.upload(id, owner.accessToken, version, 'TRANSCRIPT', Buffer.alloc(10 * 1024 * 1024 + 1), 'synthetic-large.pdf', 'application/pdf')
    assert.equal(tooLarge.status, 413)
    const wrongType = await app.upload(id, owner.accessToken, version, 'toString', bytes, 'synthetic-category.png', 'image/png')
    assert.equal(wrongType.status, 400)
    assert.equal((await app.call(path, owner.accessToken)).body.consultation.profileVersion, version)
    await new Promise<void>(resolve => {
      const boundary = 'syntheticInterruptedUpload'
      const request = httpRequest(`${app.base}${path}/documents`, { method: 'POST', headers: { Authorization: `Bearer ${owner.accessToken}`, 'Idempotency-Key': randomUUID(), 'Content-Type': `multipart/form-data; boundary=${boundary}` } })
      request.on('error', () => resolve())
      request.on('response', response => { response.resume(); resolve() })
      request.write(`--${boundary}\r\nContent-Disposition: form-data; name="version"\r\n\r\n${version}\r\n--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\nTRANSCRIPT\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic-interrupted.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.7\n`)
      setTimeout(() => request.destroy(new Error('synthetic network interruption')), 30)
    })
    await new Promise(resolve => setTimeout(resolve, 30))
    const afterInterruption = (await app.call(path, owner.accessToken)).body.consultation
    assert.equal(afterInterruption.documents.length, 1)
    assert.equal(afterInterruption.profileVersion, version)
    const broken = await app.upload(id, owner.accessToken, version, 'SUPPLEMENTAL', Buffer.from('%PDF-1.7\nSynthetic malformed PDF\n%%EOF'), 'synthetic-broken.pdf', 'application/pdf', randomUUID(), { description: '科研：虚构课程项目证明' })
    assert.equal(broken.status, 201, JSON.stringify(broken.body))
    assert.equal(broken.body.document.uploadStatus, 'UPLOADED')
    assert.equal((await app.call(path, owner.accessToken)).body.consultation.documents.find((document: any) => document.id === broken.body.document.id).description, '科研：虚构课程项目证明')
    assert.equal(broken.body.document.extractionStatus, 'FAILED')
    const retried = await app.call(`${path}/documents/${broken.body.document.id}/retry`, owner.accessToken, 'POST', { version: broken.body.consultation.profileVersion })
    assert.equal(retried.status, 200)
    assert.equal(retried.body.document.extractionStatus, 'FAILED')
    assert.equal(retried.body.consultation.documents.length, 2)
    const removed = await app.call(`${path}/documents/${broken.body.document.id}?version=${retried.body.consultation.profileVersion}`, owner.accessToken, 'DELETE')
    assert.equal(removed.status, 200)
    assert.equal(removed.body.consultation.documents.length, 1)
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }) }
})

test('retention worker removes expired originals and old crash orphans while protecting a new pending upload', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'masters-http-retention-'))
  const app = await start(dir)
  try {
    const owner = await app.login('masters-retention-synthetic')
    const created = await app.call('/v1/masters/consultations', owner.accessToken, 'POST', { targetYear: '2030', serviceConsent: consent })
    const id = created.body.consultation.id, path = `/v1/masters/consultations/${id}`
    const uploaded = await app.upload(id, owner.accessToken, 1, 'TRANSCRIPT', makeSyntheticPng(), 'synthetic-expiring.png', 'image/png')
    assert.equal(uploaded.status, 201)
    await app.store.transaction(tx => tx.update('mastersConsultations', id, { updatedAt: new Date(Date.now() - 31 * 86_400_000).toISOString() }))
    const oldOrphan = await app.files.put(makeSyntheticPng()), newPending = await app.files.put(makeSyntheticPng())
    const oldTime = new Date(Date.now() - 2 * 3_600_000)
    await utimes(join(app.files.root, oldOrphan.storageKey), oldTime, oldTime)
    await new MastersWorker(app.service, app.files, app.store, 30).runOnce()
    await assert.rejects(app.files.get(oldOrphan.storageKey))
    assert.deepEqual(await app.files.get(newPending.storageKey), makeSyntheticPng())
    const retained = await app.store.read(tx => tx.findById('mastersDocuments', uploaded.body.document.id))
    assert.equal(retained?.originalName, 'withdrawn-material')
    assert.equal(retained?.extraction, null)
    await assert.rejects(app.files.get(retained!.storageKey))
    assert.equal((await app.call(`${path}/documents/${retained!.id}`, owner.accessToken)).status, 410)
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }) }
})

test('ordinary DOCX, text PDF and scanned PDF stay saved for manual review without reformatting or blocking incomplete consultation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'masters-ordinary-documents-'))
  const app = await start(dir)
  try {
    const owner = await app.login('ordinary-synthetic-student')
    const created = await app.call('/v1/masters/consultations', owner.accessToken, 'POST', { targetYear: 'UNDECIDED', path: 'RESUME', serviceConsent: consent })
    const id = created.body.consultation.id, path = `/v1/masters/consultations/${id}`
    let version = created.body.consultation.profileVersion
    const ordinary = 'FICTIONAL RESUME\nSynthetic Applicant\nEducation\n2023-2027 | Synthetic University | Computer Science\nCourse project\nBuilt an entirely fictional classroom demonstration. No real person is represented.'
    const fixtures = [
      { type: 'RESUME', name: 'ordinary-resume.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: makeSyntheticDocx(ordinary) },
      { type: 'TRANSCRIPT', name: 'ordinary-text.pdf', mime: 'application/pdf', bytes: await makeSyntheticPdf({ text: 'FICTIONAL academic record\nExample Course A 88\nExample Course B 90' }) },
      { type: 'SUPPLEMENTAL', name: 'scanned-proof.pdf', mime: 'application/pdf', bytes: await makeSyntheticPdf({ image: makeSyntheticPng() }) }
    ]
    for (const fixture of fixtures) {
      const saved = await app.upload(id, owner.accessToken, version, fixture.type, fixture.bytes, fixture.name, fixture.mime)
      assert.equal(saved.status, 201, JSON.stringify(saved.body))
      assert.equal(saved.body.document.uploadStatus, 'UPLOADED')
      assert.equal(saved.body.document.extractionStatus, 'MANUAL_REVIEW')
      const response = await fetch(`${app.base}${path}/documents/${saved.body.document.id}`, { headers: { Authorization: `Bearer ${owner.accessToken}` } })
      assert.equal(response.status, 200)
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), fixture.bytes)
      version = saved.body.consultation.profileVersion
    }
    const patched = await app.call(path, owner.accessToken, 'PATCH', { version, profile })
    version = patched.body.consultation.profileVersion
    assert.equal((await app.call(`${path}/confirm`, owner.accessToken, 'POST', { version, accuracyConfirmed: true, consent })).status, 200)
    const submitted = await app.call(`${path}/submit`, owner.accessToken, 'POST', { version })
    assert.equal(submitted.status, 200)
    assert.equal(submitted.body.consultation.verificationStatus, 'NEEDS_REVIEW')
    assert.equal(submitted.body.consultation.documents.length, 3)
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }) }
})
