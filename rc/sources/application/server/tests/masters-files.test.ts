import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer, request as httpRequest, IncomingMessage, ServerResponse } from 'node:http'
import { AddressInfo } from 'node:net'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { AppError, errorEnvelope } from '../src/domain/errors'
import { inspectDocument, readMultipart, UploadedFile, validateFileHeader } from '../src/masters/documents'
import { MAX_DOCUMENT_BYTES, PrivateFiles } from '../src/masters/private-files'
import {
  makeMultipartBody,
  makeSyntheticDocx,
  makeSyntheticJpeg,
  makeSyntheticMacroDocx,
  makeSyntheticPdf,
  makeSyntheticPng,
  makeSyntheticZipBomb,
  MultipartPart,
  syntheticProfileText
} from './fixtures/masters-fixtures'

function appErrorCode(error: unknown): string | undefined {
  return error instanceof AppError ? error.code : undefined
}

function expectCode(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => {
    assert.equal(appErrorCode(error), code)
    return true
  })
}

async function expectAsyncCode(action: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.equal(appErrorCode(error), code)
    return true
  })
}

interface MultipartResponse {
  status: number
  body: Record<string, unknown>
}

/**
 * Run the same multipart parser behind a real HTTP socket.  Omitting
 * Content-Length causes node:http to use chunked transfer encoding, while the
 * deliberately small writes model wx.uploadFile's segmented upload stream.
 */
async function postMultipart(parts: MultipartPart[], validate = true): Promise<MultipartResponse> {
  const boundary = `----phoenix-masters-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const body = makeMultipartBody(boundary, parts)
  const server = createServer((request, response) => {
    void handleMultipart(request, response, validate)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  try {
    return await new Promise<MultipartResponse>((resolve, reject) => {
      const request = httpRequest({
        hostname: '127.0.0.1',
        port: address.port,
        method: 'POST',
        path: '/v1/masters/consultations/consultation-1/documents',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }
      }, (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.once('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          try {
            resolve({ status: response.statusCode ?? 0, body: JSON.parse(raw) as Record<string, unknown> })
          } catch (error) {
            reject(error)
          }
        })
      })
      request.once('error', reject)
      // Several writes ensure the server sees real segmented/chunked input.
      for (let offset = 0; offset < body.length; offset += 17) {
        request.write(body.subarray(offset, Math.min(offset + 17, body.length)))
      }
      request.end()
    })
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

async function handleMultipart(request: IncomingMessage, response: ServerResponse, validate: boolean): Promise<void> {
  try {
    const file = await readMultipart(request)
    const mimeType = validate ? validateFileHeader(file) : file.mimeType
    const result = {
      originalName: file.originalName,
      mimeType,
      declaredMimeType: file.mimeType,
      sizeBytes: file.bytes.length,
      fields: file.fields
    }
    const raw = Buffer.from(JSON.stringify(result), 'utf8')
    response.statusCode = 200
    response.setHeader('Content-Type', 'application/json')
    response.setHeader('Content-Length', raw.length)
    response.end(raw)
  } catch (error) {
    const envelope = errorEnvelope(error)
    const raw = Buffer.from(JSON.stringify(envelope.body), 'utf8')
    response.statusCode = envelope.status
    response.setHeader('Content-Type', 'application/json')
    response.setHeader('Content-Length', raw.length)
    response.end(raw)
  }
}

const profileFile = (name: string, mimeType: string, bytes: Buffer): UploadedFile => ({
  originalName: name,
  mimeType,
  bytes,
  fields: {}
})

test('synthetic PDF and DOCX preserve labelled extraction evidence', async () => {
  const pdf = await makeSyntheticPdf()
  const inspectedPdf = await inspectDocument(profileFile('synthetic-profile.pdf', 'application/pdf', pdf))
  assert.equal(inspectedPdf.status, 'NEEDS_CONFIRMATION')
  assert.equal(inspectedPdf.errorCode, null)
  const pdfName = inspectedPdf.fields.find((field) => field.field === 'name')
  assert.deepEqual(pdfName && { value: pdfName.value, location: pdfName.location, confidence: pdfName.confidence }, {
    value: 'Synthetic Applicant', location: 'page:1', confidence: 'NEEDS_CONFIRMATION'
  })
  assert.ok(inspectedPdf.fields.some((field) => field.field === 'gpa' && field.value.startsWith('3.72')))
  assert.ok(inspectedPdf.fields.every((field) => field.snippet.length <= 220))

  const docx = makeSyntheticDocx(syntheticProfileText)
  const inspectedDocx = await inspectDocument(profileFile(
    'synthetic-profile.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    docx
  ))
  assert.equal(inspectedDocx.status, 'NEEDS_CONFIRMATION')
  assert.equal(inspectedDocx.errorCode, null)
  assert.ok(inspectedDocx.fields.some((field) => field.field === 'institution' && field.value === 'Synthetic University'))
  assert.ok(inspectedDocx.fields.every((field) => field.confidence === 'NEEDS_CONFIRMATION'))
  assert.equal(inspectedDocx.fields.find((field) => field.field === 'graduationDate')?.value, '2027-06')
})

test('valid PNG and JPEG are decoded for manual review without pretending to OCR them', async () => {
  const png = makeSyntheticPng()
  const inspectedPng = await inspectDocument(profileFile('synthetic-transcript.png', 'image/png', png))
  assert.equal(inspectedPng.status, 'MANUAL_REVIEW')
  assert.equal(inspectedPng.errorCode, 'MANUAL_VERIFICATION_REQUIRED')
  assert.deepEqual(inspectedPng.fields, [])

  const jpeg = makeSyntheticJpeg()
  const inspectedJpeg = await inspectDocument(profileFile('synthetic-transcript.jpg', 'image/jpeg', jpeg))
  assert.equal(inspectedJpeg.status, 'MANUAL_REVIEW')
  assert.equal(inspectedJpeg.errorCode, 'MANUAL_VERIFICATION_REQUIRED')
  assert.deepEqual(inspectedJpeg.fields, [])
})

test('file validation rejects old DOC, extension/content mismatches, and oversized files', async () => {
  expectCode(() => validateFileHeader(profileFile('legacy.doc', 'application/msword', Buffer.from('legacy'))), 'FILE_TYPE_UNSUPPORTED')

  const pdf = await makeSyntheticPdf()
  expectCode(() => validateFileHeader(profileFile(
    'wrong-extension.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pdf
  )), 'FILE_CONTENT_MISMATCH')
  expectCode(() => validateFileHeader(profileFile('wrong-declared.pdf', 'image/png', pdf)), 'FILE_MIME_MISMATCH')

  const large = Buffer.alloc(MAX_DOCUMENT_BYTES + 1)
  large.write('%PDF-')
  expectCode(() => validateFileHeader(profileFile('oversized.pdf', 'application/pdf', large)), 'FILE_SIZE_INVALID')
})

test('parser rejects damaged images, macro DOCX, and compressed zip bombs', async () => {
  const damagedPng = makeSyntheticPng()
  damagedPng[damagedPng.length - 1] = (damagedPng[damagedPng.length - 1] ?? 0) ^ 0xff
  await expectAsyncCode(() => inspectDocument(profileFile('damaged.png', 'image/png', damagedPng)), 'FILE_CONTENT_INVALID')

  // Keep SOI/EOI so header validation passes, but remove every valid JPEG
  // segment; jpeg-js must reject it during the isolated parser step.
  const damagedJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
  await expectAsyncCode(() => inspectDocument(profileFile('damaged.jpg', 'image/jpeg', damagedJpeg)), 'FILE_CONTENT_INVALID')

  await expectAsyncCode(() => inspectDocument(profileFile(
    'macro-enabled.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    makeSyntheticMacroDocx()
  )), 'FILE_CONTENT_INVALID')

  const zipBomb = makeSyntheticZipBomb()
  assert.ok(zipBomb.length < MAX_DOCUMENT_BYTES, 'compressed synthetic bomb should fit the transport limit')
  await expectAsyncCode(() => inspectDocument(profileFile(
    'expanded-beyond-budget.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    zipBomb
  )), 'FILE_CONTENT_INVALID')
})

test('malformed PDF fails closed and parser timeout has an explicit bounded result', async () => {
  const malformedPdf = Buffer.from('%PDF-not-a-complete-document', 'utf8')
  const failed = await inspectDocument(profileFile('malformed.pdf', 'application/pdf', malformedPdf))
  assert.equal(failed.status, 'FAILED')
  assert.equal(failed.errorCode, 'PARSER_FAILED')
  assert.deepEqual(failed.fields, [])

  const validPdf = await makeSyntheticPdf()
  const timedOut = await inspectDocument(profileFile('deadline.pdf', 'application/pdf', validPdf), 1)
  assert.equal(timedOut.status, 'FAILED')
  assert.equal(timedOut.errorCode, 'PARSER_TIMEOUT')
  assert.deepEqual(timedOut.fields, [])
})

test('PrivateFiles writes atomically with a hash, survives re-instantiation, and rejects opaque-key traversal', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-masters-private-files-'))
  try {
    const bytes = Buffer.from('synthetic-private-document-内容', 'utf8')
    const expectedHash = createHash('sha256').update(bytes).digest('hex')
    const first = new PrivateFiles(directory)
    await first.initialize()
    const saved = await first.put(bytes)
    assert.match(saved.storageKey, /^[0-9a-f-]{36}$/)
    assert.equal(saved.sha256, expectedHash)
    assert.equal(saved.sizeBytes, bytes.length)
    assert.deepEqual(await first.get(saved.storageKey), bytes)
    const savedStat = await stat(join(directory, saved.storageKey))
    assert.equal(savedStat.isFile(), true)
    // Windows does not expose POSIX mode bits; the implementation still uses
    // 0600 when the underlying filesystem supports them.
    if (process.platform !== 'win32') assert.equal(savedStat.mode & 0o777, 0o600)

    const reopened = new PrivateFiles(directory)
    assert.deepEqual(await reopened.get(saved.storageKey), bytes)
    await reopened.remove(saved.storageKey)
    await expectAsyncCode(() => reopened.get(saved.storageKey), 'DOCUMENT_NOT_FOUND')
    await expectAsyncCode(() => reopened.get('../outside'), 'DOCUMENT_NOT_FOUND')
    await expectAsyncCode(() => reopened.remove('../../outside'), 'DOCUMENT_NOT_FOUND')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('real segmented HTTP multipart accepts one multi-page file per request and validates its bytes', async () => {
  const twoPagePdf = await makeSyntheticPdf({ pages: 2 })
  const first = await postMultipart([
    { name: 'version', value: '1' },
    { name: 'type', value: 'TRANSCRIPT' },
    { name: 'file', filename: 'transcript-pages-1-2.pdf', contentType: 'application/pdf', value: twoPagePdf }
  ])
  assert.equal(first.status, 200, JSON.stringify(first.body))
  assert.equal(first.body.originalName, 'transcript-pages-1-2.pdf')
  assert.equal(first.body.mimeType, 'application/pdf')
  assert.equal(first.body.sizeBytes, twoPagePdf.length)
  assert.deepEqual(first.body.fields, { version: '1', type: 'TRANSCRIPT' })

  // A second page upload remains a separate one-file request for the same category.
  const secondPage = await makeSyntheticPdf({ pages: 1, text: '第二份合成成绩单页' })
  const second = await postMultipart([
    { name: 'version', value: '1' },
    { name: 'type', value: 'TRANSCRIPT' },
    { name: 'file', filename: 'transcript-page-3.pdf', contentType: 'application/pdf', value: secondPage }
  ])
  assert.equal(second.status, 200, JSON.stringify(second.body))
  assert.equal(second.body.fields && (second.body.fields as Record<string, string>).type, 'TRANSCRIPT')

  const badFormat = await postMultipart([
    { name: 'version', value: '1' },
    { name: 'type', value: 'RESUME' },
    { name: 'file', filename: 'resume.pdf', contentType: 'application/pdf', value: makeSyntheticPng() }
  ])
  assert.equal(badFormat.status, 415)
  assert.equal((badFormat.body.error as Record<string, unknown>).code, 'FILE_CONTENT_MISMATCH')
})

test('multipart rejects unknown fields, wrong file field names, and multiple files in one wx.uploadFile request', async () => {
  const pdf = await makeSyntheticPdf()
  const unknown = await postMultipart([
    { name: 'version', value: '1' },
    { name: 'type', value: 'RESUME' },
    { name: 'unexpected', value: 'must be rejected' },
    { name: 'file', filename: 'resume.pdf', contentType: 'application/pdf', value: pdf }
  ])
  assert.equal(unknown.status, 400)
  assert.equal((unknown.body.error as Record<string, unknown>).code, 'UPLOAD_FIELD_INVALID')

  const wrongName = await postMultipart([
    { name: 'version', value: '1' },
    { name: 'type', value: 'RESUME' },
    { name: 'upload', filename: 'resume.pdf', contentType: 'application/pdf', value: pdf }
  ], false)
  assert.equal(wrongName.status, 400)
  assert.equal((wrongName.body.error as Record<string, unknown>).code, 'FILE_FIELD_INVALID')

  const multiple = await postMultipart([
    { name: 'version', value: '1' },
    { name: 'type', value: 'RESUME' },
    { name: 'file', filename: 'resume-a.pdf', contentType: 'application/pdf', value: pdf },
    { name: 'file', filename: 'resume-b.pdf', contentType: 'application/pdf', value: pdf }
  ], false)
  assert.ok([400, 413].includes(multiple.status), `multiple files must be rejected: ${multiple.status}`)
  assert.ok(['FILE_FIELD_INVALID', 'UPLOAD_LIMIT'].includes((multiple.body.error as Record<string, unknown>).code as string))
})
