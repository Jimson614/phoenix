import assert from 'node:assert/strict'
import test from 'node:test'
import { AppError } from '../src/domain/errors'
import { MastersService } from '../src/services/masters-service'
import { InMemoryStore } from '../src/store/memory-store'

const NOW = new Date('2026-09-05T00:00:00.000Z')
const CONSENT = { accepted: true as const, copyVersion: 'masters_service_consent_v1.1', locale: 'zh-CN' }
let idCounter = 0
type FixtureUsers = { owner: string; other: string; founder: string; advisor: string; admin: string }

function id(prefix: string): string {
  idCounter += 1
  return `${prefix}-domain-${idCounter}`
}

function makeUser(id: string, role: 'family_user' | 'admin' = 'family_user') {
  return { id, role, createdAt: NOW.toISOString() }
}

function serviceFixture(): { store: InMemoryStore; service: MastersService; users: FixtureUsers } {
  const users = {
    owner: 'usr-masters-domain-owner',
    other: 'usr-masters-domain-other',
    founder: 'usr-masters-domain-founder',
    advisor: 'usr-masters-domain-advisor',
    admin: 'usr-masters-domain-legacy-admin'
  }
  const store = new InMemoryStore({
    users: Object.values(users).map((userId) => makeUser(userId, userId === users.admin ? 'admin' : 'family_user'))
  })
  const service = new MastersService(store, () => new Date(NOW), id)
  return { store, service, users }
}

function leaseFixture(): { store: InMemoryStore; service: MastersService; users: FixtureUsers; advance: (milliseconds: number) => void } {
  const base = serviceFixture()
  let currentTime = NOW.getTime()
  const service = new MastersService(base.store, () => new Date(currentTime), id, { leaseMs: 1_000, maxAttempts: 2 })
  return { ...base, service, advance: (milliseconds) => { currentTime += milliseconds } }
}

async function expectCode(action: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(action, (error: unknown) => error instanceof AppError && error.code === code)
}

function profile() {
  return {
    name: '合成申请人',
    adultConfirmed: true,
    contact: { type: 'wechat' as const, value: 'wx-masters-domain' },
    educationStatus: 'ENROLLED' as const,
    institution: '合成大学',
    degree: 'Bachelor',
    major: 'Computer Science',
    graduationDate: '2027-06',
    averageScore: '88.5',
    gpa: '3.70',
    gpaScale: '4.00',
    classRank: '12/120',
    languageStatus: 'NONE' as const,
    languageType: 'NONE' as const,
    languageScores: null,
    targetYear: 'UNDECIDED' as const,
    targetMajors: ['Computer Science'],
    targetInstitutions: ['香港合成大学'],
    targetPreference: '请顾问建议',
    experiences: []
  }
}

function documentInput(version: number, type: 'RESUME' | 'TRANSCRIPT' | 'ENROLLMENT' | 'SUPPLEMENTAL', name: string, value: string) {
  return {
    version,
    type,
    storageKey: `private/${name}`,
    originalName: `${name}.pdf`,
    description: 'synthetic fixture',
    mimeType: 'application/pdf',
    sizeBytes: 128,
    sha256: 'a'.repeat(64),
    extraction: { status: 'SUCCEEDED' as const, fields: { name: value }, evidence: [{ field: 'name', location: 'p1', excerpt: value, confidence: 'HIGH' as const }] }
  }
}

async function prepareQueued(store: InMemoryStore, service: MastersService, users: FixtureUsers) {
  const draft = await service.create(users.owner, { targetYear: 'UNDECIDED', channel: 'organic', path: 'GUIDED' })
  await service.grantConsent(users.owner, draft.id, CONSENT)
  const patched = await service.patch(users.owner, draft.id, { version: draft.profileVersion, profile: profile() })
  const uploaded = await service.addDocument(users.owner, draft.id, documentInput(patched.profileVersion, 'RESUME', 'queued-resume', '合成申请人'))
  const snapshot = await service.confirm(users.owner, draft.id, { version: uploaded.profileVersion, accuracyConfirmed: true })
  await service.submit(users.owner, draft.id, { version: uploaded.profileVersion }, 'submit-queued-domain')
  const jobs = await store.read((tx) => tx.findMany('mastersReportJobs', { consultationId: draft.id }))
  assert.equal(jobs.length, 1)
  return { id: draft.id, version: uploaded.profileVersion, snapshot, job: jobs[0]! }
}

test('domain workflow persists consent, documents, snapshot, one queued job, review and release with owner isolation', async () => {
  const { store, service, users } = serviceFixture()
  const draft = await service.create(users.owner, { targetYear: 'UNDECIDED', channel: 'organic', path: 'GUIDED' })
  assert.equal(draft.status, 'DRAFT')
  assert.equal(draft.consent, null)
  await expectCode(() => service.patch(users.owner, draft.id, { version: draft.profileVersion, profile: profile() }), 'MASTERS_CONSENT_REQUIRED')
  await service.grantConsent(users.owner, draft.id, CONSENT)
  const patched = await service.patch(users.owner, draft.id, { version: draft.profileVersion, profile: profile() })
  const uploaded = await service.addDocument(users.owner, draft.id, documentInput(patched.profileVersion, 'RESUME', 'resume', '合成申请人'))
  const version = uploaded.profileVersion
  const studentDetail = await service.detail(users.owner, draft.id)
  const safeDocument = studentDetail.documents[0] as unknown as Record<string, unknown>
  assert.equal(safeDocument.storageKey, undefined)
  assert.equal(safeDocument.userId, undefined)
  assert.deepEqual((safeDocument.extraction as Record<string, unknown>).fields, { name: '合成申请人' })
  await expectCode(() => service.detail(users.other, draft.id), 'MASTERS_CONSULTATION_FORBIDDEN')
  await expectCode(() => service.authorizeDocument(users.other, draft.id), 'MASTERS_CONSULTATION_FORBIDDEN')

  const snapshot = await service.confirm(users.owner, draft.id, { version, accuracyConfirmed: true })
  assert.equal(snapshot.profileVersion, version)
  const submitted = await service.submit(users.owner, draft.id, { version }, 'submit-domain-1')
  assert.equal(submitted.status, 'SUBMITTED')
  assert.equal((await store.read((tx) => tx.findMany('mastersReportJobs', { consultationId: draft.id }))).length, 1)
  await service.submit(users.owner, draft.id, { version }, 'submit-domain-1')
  assert.equal((await store.read((tx) => tx.findMany('mastersReportJobs', { consultationId: draft.id }))).length, 1)

  const claimed = await service.claimJob('domain-worker')
  assert.ok(claimed?.leaseToken)
  const completed = await service.completeJob(claimed.id, claimed.leaseToken as string)
  assert.equal(completed.status, 'NEEDS_REVIEW')
  await store.transaction((tx) => tx.insert('mastersStaff', {
    id: id('staff'), userId: users.founder, role: 'founder', status: 'ACTIVE', grantedBy: null,
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString()
  }))
  await service.grantStaff(users.founder, users.advisor, 'advisor')
  await service.assign(users.founder, draft.id, { advisorUserId: users.advisor, version })
  await expectCode(() => service.approveReport(users.founder, draft.id, { version: 1 }), 'MASTERS_REPORT_REVIEW_REQUIRED')
  await service.reviewReport(users.advisor, draft.id, { version: 1 })
  const approved = await service.approveReport(users.founder, draft.id, { version: 1 })
  assert.equal(approved.status, 'APPROVED')
  const released = await service.releaseReport(users.founder, draft.id, { version: 1 })
  assert.equal(released.status, 'RELEASED')
  assert.equal((await service.getReleasedReport(users.owner, draft.id)).id, released.id)
  await expectCode(() => service.getReleasedReport(users.other, draft.id), 'MASTERS_REPORT_FORBIDDEN')
})

test('cross-document extraction values stay pending until each source is explicitly resolved', async () => {
  const { service, users } = serviceFixture()
  const draft = await service.create(users.owner, { targetYear: '2028' })
  await service.grantConsent(users.owner, draft.id, CONSENT)
  const patched = await service.patch(users.owner, draft.id, { version: 1, profile: { ...profile(), name: '原始称呼' } })
  const first = await service.addDocument(users.owner, draft.id, documentInput(patched.profileVersion, 'RESUME', 'resume-a', 'Alice'))
  const second = await service.addDocument(users.owner, draft.id, documentInput(first.profileVersion, 'SUPPLEMENTAL', 'supplement-b', 'Bob'))
  const detail = await service.detail(users.owner, draft.id)
  assert.ok(detail.documents.every((document) => document.extraction?.conflicts?.some((conflict) => conflict.field === 'name' && conflict.resolution === 'PENDING')))
  await expectCode(() => service.confirm(users.owner, draft.id, { version: second.profileVersion, accuracyConfirmed: true }), 'MASTERS_EXTRACTION_CONFLICT')
  await service.resolveExtraction(users.owner, draft.id, { version: second.profileVersion, documentId: first.id, field: 'name', value: 'Alice', accepted: true })
  const current = await service.detail(users.owner, draft.id)
  assert.equal(current.profile.name, 'Alice')
  const resolved = await service.resolveExtraction(users.owner, draft.id, { version: current.profileVersion, documentId: second.id, field: 'name', value: 'Bob', accepted: false })
  assert.equal(resolved.extraction?.conflicts?.find((conflict) => conflict.field === 'name')?.resolution, 'REJECTED')
  const afterResolution = await service.detail(users.owner, draft.id)
  const confirmed = await service.confirm(users.owner, draft.id, { version: afterResolution.profileVersion, accuracyConfirmed: true })
  assert.equal(confirmed.accuracyConfirmed, true)
})

test('legacy admin and revoked users cannot enter the masters staff surface, and withdrawal blocks content access', async () => {
  const { service, users } = serviceFixture()
  await expectCode(() => service.internalList(users.admin), 'MASTERS_STAFF_REQUIRED')
  const draft = await service.create(users.owner, { targetYear: 'UNDECIDED' })
  await service.grantConsent(users.owner, draft.id, CONSENT)
  await service.withdraw(users.owner, draft.id)
  await expectCode(() => service.detail(users.owner, draft.id), 'MASTERS_CONSULTATION_WITHDRAWN')
  await expectCode(() => service.authorizeDocument(users.owner, draft.id), 'MASTERS_CONSULTATION_WITHDRAWN')
})

test('a replacement keeps the active attachment count at the twenty document cap', async () => {
  const { service, store, users } = serviceFixture()
  const draft = await service.create(users.owner, { targetYear: 'UNDECIDED' })
  await service.grantConsent(users.owner, draft.id, CONSENT)
  const patched = await service.patch(users.owner, draft.id, { version: 1, profile: profile() })
  let version = patched.profileVersion
  let firstId = ''
  for (let index = 0; index < 20; index += 1) {
    const document = await service.addDocument(users.owner, draft.id, documentInput(version, 'SUPPLEMENTAL', `supplement-${index}`, 'same value'))
    version = document.profileVersion
    if (index === 0) firstId = document.id
  }
  const replacement = await service.addDocument(users.owner, draft.id, {
    ...documentInput(version, 'RESUME', 'replacement', 'same value'), replaceDocumentId: firstId
  })
  const active = await store.read((tx) => tx.findMany('mastersDocuments', { consultationId: draft.id }))
  assert.equal(active.filter((document) => document.uploadStatus === 'UPLOADED' && !document.removedAt).length, 20)
  assert.equal(active.find((document) => document.id === firstId)?.uploadStatus, 'REMOVED')
  assert.equal(replacement.uploadStatus, 'UPLOADED')
})

test('expired workers cannot write stale results and retry attempts are capped', async () => {
  const fixture = leaseFixture()
  const prepared = await prepareQueued(fixture.store, fixture.service, fixture.users)
  const first = await fixture.service.claimJob('domain-worker-a', { leaseMs: 1_000, maxAttempts: 2 })
  assert.ok(first?.leaseToken)
  fixture.advance(1_001)
  await expectCode(() => fixture.service.completeJob(prepared.job.id, first!.leaseToken as string), 'MASTERS_LEASE_EXPIRED')
  const second = await fixture.service.claimJob('domain-worker-b', { leaseMs: 1_000, maxAttempts: 2 })
  assert.ok(second?.leaseToken)
  await expectCode(() => fixture.service.completeJob(prepared.job.id, first!.leaseToken as string), 'MASTERS_LEASE_CONFLICT')
  fixture.advance(1_001)
  const exhausted = await fixture.service.claimJob('domain-worker-c', { leaseMs: 1_000, maxAttempts: 2 })
  assert.equal(exhausted?.status, 'FAILED')
  assert.equal(exhausted?.attempts, 2)
  const report = await fixture.store.read((tx) => tx.findById('mastersReports', prepared.job.reportId))
  assert.equal(report?.status, 'FAILED')
  assert.equal(await fixture.service.claimJob('domain-worker-d', { leaseMs: 1_000, maxAttempts: 2 }), null)
})

test('withdrawal purge keeps audit/status rows while removing profile, document and report payloads', async () => {
  const { service, store, users } = serviceFixture()
  const prepared = await prepareQueued(store, service, users)
  await service.withdraw(users.owner, prepared.id)
  await service.purgeWithdrawn(users.owner, prepared.id)
  const state = await store.read(async (tx) => ({
    consultation: await tx.findById('mastersConsultations', prepared.id),
    documents: await tx.findMany('mastersDocuments', { consultationId: prepared.id }),
    snapshots: await tx.findMany('mastersSnapshots', { consultationId: prepared.id }),
    reports: await tx.findMany('mastersReports', { consultationId: prepared.id }),
    audits: await tx.findMany('mastersAuditLogs', { consultationId: prepared.id })
  }))
  assert.deepEqual(state.consultation?.profile, {})
  assert.ok(state.documents.length > 0)
  assert.ok(state.documents.every((document) => document.uploadStatus === 'REMOVED' && document.originalName === 'withdrawn-material' && document.description === null && document.extraction === null))
  assert.ok(state.snapshots.every((snapshot) => Object.keys(snapshot.profile).length === 0 && snapshot.documentIds.length === 0))
  assert.ok(state.reports.every((report) => report.status === 'STALE' && report.payload.verificationStatus === 'NEEDS_REVIEW'))
  assert.ok(state.audits.length > 0)
})
