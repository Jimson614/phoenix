'use strict'

// Real browser + loopback HTTP + persistent FileStore, using generated fiction
// only. This is internal-workbench evidence, never a WeChat device test.
const assert = require('node:assert/strict')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { randomUUID } = require('node:crypto')
const modulePath = process.env.MASTERS_BROWSER_TEST_MODULE
if (!modulePath) {
  process.stdout.write(JSON.stringify({ status: 'BLOCKED_EXTERNAL', suite: 'masters-workbench-browser', reason: 'Set MASTERS_BROWSER_TEST_MODULE to an installed Playwright module' }) + '\n')
  process.exit(0)
}
const { chromium } = require(modulePath)
const { FileStore } = require('../server/dist/src/store/file-store')
const { AuthService } = require('../server/dist/src/services/auth-service')
const { MockWechatAuthProvider } = require('../server/dist/src/auth/wechat-auth-provider')
const { ProfileService } = require('../server/dist/src/services/profile-service')
const { AssessmentService } = require('../server/dist/src/services/assessment-service')
const { OrderService } = require('../server/dist/src/services/order-service')
const { ReportService } = require('../server/dist/src/services/report-service')
const { MockPaymentProvider } = require('../server/dist/src/payments/mock-payment-provider')
const { validateSourceCatalog } = require('../server/dist/src/domain/source-catalog')
const { MastersService } = require('../server/dist/src/services/masters-service')
const { MastersHttp } = require('../server/dist/src/masters/http')
const { MastersWorker } = require('../server/dist/src/masters/worker')
const { PrivateFiles } = require('../server/dist/src/masters/private-files')
const { createAppServer } = require('../server/dist/src/http/app')
const { makeSyntheticPng, makeSyntheticJpeg } = require('../server/dist/tests/fixtures/masters-fixtures')
const { assistedReportPatch, sourcedProgram } = require('../server/dist/tests/fixtures/masters-sourced-program')
const { unzipSync } = require('../server/node_modules/fflate')

async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'masters-browser-synthetic-'))
  let browser, server
  try {
    const store = await FileStore.open(join(directory, 'state.json'))
    const secret = 'synthetic-workbench-test-session-secret-only'
    const auth = new AuthService(store, new MockWechatAuthProvider(), secret)
    const sessions = {}
    for (const role of ['student', 'founder', 'advisor']) {
      sessions[role] = await auth.createWechatSession(`synthetic-browser-${role}`)
      if (role !== 'student') await store.transaction(tx => tx.insert('mastersStaff', {
        id: `browser-staff-${role}`, userId: sessions[role].user.id, role, status: 'ACTIVE', grantedBy: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      }))
    }
    const files = new PrivateFiles(join(directory, 'private'))
    await files.initialize()
    const service = new MastersService(store)
    const catalog = validateSourceCatalog({ version: 'SYNTHETIC-BROWSER', dataAsOf: '2026-09-05', reviewedAt: '2026-09-05T00:00:00.000Z', reviewedBy: 'Synthetic fixture', entries: [{ sourceId: 'SYNTHETIC', title: 'Synthetic', applicableYear: '2026', verifiedAt: '2026-09-05T00:00:00.000Z' }] })
    server = createAppServer({ auth, profiles: new ProfileService(store), assessments: new AssessmentService(store, catalog), orders: new OrderService(store, new MockPaymentProvider(secret), catalog, false), reports: new ReportService(store), masters: new MastersHttp(service, files, store) })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${server.address().port}`
    async function call(path, body, method = 'POST') {
      const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${sessions.student.accessToken}`, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body: JSON.stringify(body) })
      const result = await response.json()
      assert.ok(response.ok, `HTTP ${response.status}: ${result.error?.code}`)
      return result.consultation
    }
    const consent = { accepted: true, copyVersion: 'masters_service_consent_v1.1' }
    let consultation = await call('/v1/masters/consultations', { targetYear: '2027', path: 'GUIDED', channel: 'organic', serviceConsent: consent })
    const path = `/v1/masters/consultations/${consultation.id}`
    consultation = await call(path, { version: consultation.profileVersion, profile: { name: '合成浏览器申请人', adultConfirmed: true, contact: { type: 'email', value: 'browser-synthetic@example.invalid' }, educationStatus: 'GRADUATED', institution: 'Synthetic University', major: 'Computer Science', languageStatus: 'NONE', languageType: 'NONE', targetYear: '2027' } }, 'PATCH')
    const png = makeSyntheticPng(), jpeg = makeSyntheticJpeg()
    for (const [type, name, bytes, mime] of [['GRADUATION', 'synthetic-graduation.png', png, 'image/png'], ['DEGREE', 'synthetic-degree.jpg', jpeg, 'image/jpeg']]) {
      const form = new FormData()
      form.append('version', String(consultation.profileVersion)); form.append('type', type)
      form.append('file', new Blob([bytes], { type: mime }), name)
      const response = await fetch(base + path + '/documents', { method: 'POST', headers: { Authorization: `Bearer ${sessions.student.accessToken}`, 'Idempotency-Key': randomUUID() }, body: form })
      assert.equal(response.status, 201)
      consultation = (await response.json()).consultation
    }
    await call(path + '/confirm', { version: consultation.profileVersion, accuracyConfirmed: true, consent })
    await call(path + '/submit', { version: consultation.profileVersion })
    await new MastersWorker(service, files, store).runOnce()
    browser = await chromium.launch({ headless: true, ...(process.env.MASTERS_BROWSER_EXECUTABLE ? { executablePath: process.env.MASTERS_BROWSER_EXECUTABLE } : {}) })
    const page = await browser.newPage({ acceptDownloads: true })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    async function connect(role) {
      await page.goto(base + '/internal/masters')
      await page.locator('#token').fill(sessions[role].accessToken)
      await page.locator('#connect').click()
      await page.locator('#message').filter({ hasText: '操作完成' }).waitFor()
    }
    async function openCase() {
      await page.locator('#list button').filter({ hasText: '合成浏览器申请人' }).click()
      await page.locator('#case').waitFor({ state: 'visible' })
      await page.locator('#case-title').filter({ hasText: '合成浏览器申请人' }).waitFor()
    }
    async function clickAndWait(id) {
      const response = page.waitForResponse(r => r.url().includes('/v1/internal/masters/consultations/') && r.request().method() === 'POST')
      await page.locator(id).click()
      assert.equal((await response).status(), 200)
      await page.locator(id).waitFor({ state: 'visible' })
      await page.waitForFunction(selector => !document.querySelector(selector).disabled, id)
    }
    await page.goto(base + '/internal/masters')
    await page.locator('#token').fill(sessions.student.accessToken)
    await page.locator('#connect').click()
    await page.locator('#message').filter({ hasText: '未获工作台授权' }).waitFor()
    assert.equal(await page.locator('#list button').count(), 0)
    await connect('advisor')
    assert.equal(await page.locator('#list button').count(), 0)
    await connect('founder')
    await openCase()
    assert.equal(await page.locator('#documents .card').count(), 7)
    const graduationCard = page.locator('#documents .card').filter({ has: page.locator('strong', { hasText: '毕业证书' }) })
    const degreeCard = page.locator('#documents .card').filter({ has: page.locator('strong', { hasText: '学位证书' }) })
    assert.match(await graduationCard.textContent(), /synthetic-graduation\.png/)
    assert.match(await degreeCard.textContent(), /synthetic-degree\.jpg/)
    assert.doesNotMatch(await graduationCard.textContent(), /synthetic-degree/)
    await clickAndWait('#assign')
    await connect('advisor')
    await openCase()
    const downloaded = page.waitForEvent('download')
    await graduationCard.getByRole('button', { name: '授权查看／下载' }).click()
    assert.deepEqual(await readFile(await (await downloaded).path()), png)
    const draft = JSON.parse(await page.locator('#report-editor').inputValue())
    await page.locator('#report-editor').fill(JSON.stringify({ ...draft, ...assistedReportPatch }))
    await clickAndWait('#save-report')
    await clickAndWait('#review')
    await page.locator('#report-capability').filter({ hasText: '顾问核验后的申请方案' }).waitFor()
    await connect('founder')
    await openCase()
    await clickAndWait('#approve')
    await page.locator('#report-state').filter({ hasText: 'APPROVED' }).waitFor()
    await clickAndWait('#release')
    await page.locator('#report-state').filter({ hasText: 'RELEASED' }).waitFor()
    const exported = page.waitForEvent('download')
    await page.locator('#xlsx').click()
    const workbook = await readFile(await (await exported).path())
    assert.equal(workbook.subarray(0, 2).toString(), 'PK')
    const sheet = Buffer.from(unzipSync(workbook)['xl/worksheets/sheet1.xml']).toString('utf8')
    assert.ok(sheet.includes(sourcedProgram.officialUrl) && sheet.includes(sourcedProgram.program))
    await page.reload()
    assert.equal(await page.locator('#list button').count(), 0)
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0)
    assert.deepEqual(errors, [])
    process.stdout.write(JSON.stringify({ status: 'PASS', suite: 'masters-workbench-browser', browser: 'headless Chromium', realHttp: true, fileStore: true, syntheticOnly: true, cases: ['student-denied', 'unassigned-advisor-empty', 'seven-categories', 'distinct-graduation-degree', 'assignment', 'authorized-download-byte-equality', 'sourced-program-edit', 'advisor-review', 'assisted-plan-classification', 'founder-approval-release', 'xlsx-download', 'no-token-in-browser-storage'], wechatDevice: 'NOT_TESTED' }) + '\n')
  } finally {
    if (browser) await browser.close()
    if (server) await new Promise(resolve => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  }
}
main().catch(error => { process.stderr.write(`masters-workbench-browser: ${error.message}\n`); process.exitCode = 1 })
