import { IncomingMessage } from 'node:http'
import { randomUUID } from 'node:crypto'
import { AppError, invariant } from '../domain/errors'
import { MastersDocumentExtraction, MastersDocument, MastersConsultationDetail, MastersReport, MastersServiceConsentInput } from '../domain/masters/contracts'
import { MastersService } from '../services/masters-service'
import { Store } from '../store/store'
import { FileInspection, inspectDocument, readMultipart } from './documents'
import { MAX_DOCUMENT_BYTES, MAX_DOCUMENTS, PrivateFiles } from './private-files'
import { contentDigest, ExportReport, renderMastersPdf, renderMastersXlsx } from './exports'
import { recordExtractionRetry } from './document-operations'
import { reportAssistance } from './report-assistance'

export interface MastersHttpResult { status: number; body?: Record<string, unknown>; binary?: Buffer; contentType?: string; filename?: string }

function exact(body: Record<string, unknown>, keys: string[]) {
  invariant(Object.keys(body).every(k => keys.includes(k)), 400, 'UNKNOWN_REQUEST_FIELDS', '请求包含不支持的字段')
  return body
}
function idempotency(request: IncomingMessage): string {
  const key = request.headers['idempotency-key']
  invariant(typeof key === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(key), 400, 'IDEMPOTENCY_KEY_REQUIRED', '请提供有效幂等键')
  return key
}
function version(value: unknown): number {
  invariant(Number.isInteger(value) && Number(value) > 0, 400, 'MASTERS_VERSION_INVALID', '请提供资料版本')
  return Number(value)
}
function extraction(inspection: FileInspection): MastersDocumentExtraction {
  const values: Record<string, string[]> = {}
  for (const field of inspection.fields) (values[field.field] ??= []).push(field.value)
  const conflicts = Object.entries(values).filter(([, values]) => new Set(values).size > 1)
    .map(([field, values]) => ({ field, values: [...new Set(values)], resolution: 'PENDING' as const }))
  return {
    status: inspection.status, candidates: Object.fromEntries(Object.entries(values).map(([field, items]) => [field, [...new Set(items)]])),
    fields: Object.fromEntries(Object.entries(values).map(([field, values]) => [field, values[0]])),
    evidence: inspection.fields.map(f => ({ field: f.field, location: f.location, excerpt: f.snippet, confidence: 'LOW' })),
    conflicts, errorCode: inspection.errorCode
  }
}
function documentDto(doc: MastersDocument) {
  const { storageKey: _key, userId: _owner, ...publicDocument } = doc
  return publicDocument
}
function reportDto(report: MastersReport) {
  return { id: report.id, consultationId: report.consultationId, version: report.version, sourceProfileVersion: report.sourceProfileVersion, status: report.status, payload: report.payload, releasedAt: report.releasedAt, assistance: reportAssistance(report) }
}
function detailDto(detail: MastersConsultationDetail, internal: boolean) {
  const { userId: _owner, serviceConsentId: _consentId, consent: _consent, assignments, currentReport, ...publicDetail } = detail
  return {
    ...publicDetail, documents: detail.documents.map(documentDto),
    ...(internal ? { assignments, currentReport: currentReport ? { ...currentReport, assistance: reportAssistance(currentReport, detail.applicationSeason) } : null } : { reportStatus: currentReport?.status ?? 'NOT_STARTED', currentReport: currentReport?.status === 'RELEASED' ? reportDto(currentReport) : null })
  }
}

export class MastersHttp {
  private activeParsers = 0
  constructor(readonly service: MastersService, readonly files: PrivateFiles, readonly store: Store, readonly pdfFontPath = '') {}

  private async staff(userId: string) {
    const staff = await this.store.read(tx => tx.findOne('mastersStaff', { userId, status: 'ACTIVE' }))
    invariant(staff, 403, 'MASTERS_STAFF_REQUIRED', '未获工作台授权')
    return staff
  }

  private async detail(userId: string, id: string, internal: boolean) {
    return detailDto(await this.service.detail(userId, id, internal), internal)
  }

  private async download(userId: string, id: string, docId: string, internal: boolean): Promise<MastersHttpResult> {
    const doc = await this.service.authorizeDocument(userId, id, docId, internal)
    invariant(doc, 404, 'DOCUMENT_NOT_FOUND', '材料不存在')
    const bytes = await this.files.get(doc.storageKey)
    await this.service.authorizeDocument(userId, id, docId, internal)
    await this.store.transaction(tx => tx.insert('mastersAuditLogs', { id: `maud_${randomUUID()}`, consultationId: id, actorUserId: userId, action: 'DOCUMENT_DOWNLOADED', metadata: { documentId: docId, internal }, createdAt: new Date().toISOString() }))
    return { status: 200, binary: bytes, contentType: doc.mimeType, filename: doc.originalName }
  }

  private async export(userId: string, id: string, internal: boolean, format: string | null): Promise<MastersHttpResult> {
    invariant(format === 'pdf' || format === 'xlsx', 400, 'EXPORT_FORMAT_INVALID', '仅支持 PDF 或 XLSX')
    const report = await this.service.getReleasedReport(userId, id, internal)
    const payload: ExportReport = { id: report.id, version: report.version, profileVersion: report.sourceProfileVersion, content: report.payload as unknown as Record<string, unknown>, assistance: reportAssistance(report) }
    const bytes = format === 'pdf' ? await renderMastersPdf(payload, this.pdfFontPath) : renderMastersXlsx(payload)
    const current = await this.service.getReleasedReport(userId, id, internal)
    invariant(current.id === report.id && current.version === report.version && contentDigest({ ...payload, content: current.payload as unknown as Record<string, unknown> }) === contentDigest(payload), 409, 'REPORT_STALE', '报告版本已变化，请刷新')
    return { status: 200, binary: bytes, contentType: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: `application-plan-v${report.version}.${format}` }
  }

  async route(userId: string, method: string, url: URL, request: IncomingMessage, readJson: () => Promise<Record<string, unknown>>): Promise<MastersHttpResult> {
    const internal = url.pathname.startsWith('/v1/internal/masters')
    const prefix = internal ? '/v1/internal/masters' : '/v1/masters'
    if (internal) await this.staff(userId)
    const json = (body: Record<string, unknown>, status = 200): MastersHttpResult => ({ status, body })
    if (method === 'GET' && url.pathname === '/v1/masters/capabilities') return json({ ...this.service.contract(), maxFileBytes: MAX_DOCUMENT_BYTES, maxDocuments: MAX_DOCUMENTS, extensions: ['pdf', 'docx', 'jpg', 'jpeg', 'png'], aiEnabled: false })
    if (internal && method === 'GET' && url.pathname === `${prefix}/me`) return json({ staff: await this.staff(userId) })
    if (internal && method === 'GET' && url.pathname === `${prefix}/advisors`) return json({ advisors: (await this.store.read(tx => tx.findMany('mastersStaff', { role: 'advisor', status: 'ACTIVE' }))).map(s => ({ userId: s.userId })) })
    const base = `${prefix}/consultations`
    if (url.pathname === base) {
      if (method === 'GET') {
        const consultations = internal ? await this.service.internalList(userId) : await this.service.list(userId)
        return json({ consultations: consultations.map(d => detailDto(d, internal)) })
      }
      if (method === 'POST' && !internal) {
        const body = exact(await readJson(), ['targetYear', 'channel', 'path', 'serviceConsent'])
        const detail = await this.service.create(userId, body, idempotency(request))
        return json({ consultation: detailDto(detail, false) }, 201)
      }
    }
    const match = url.pathname.slice(base.length).match(/^\/([A-Za-z0-9_-]+)(?:\/(.*))?$/)
    invariant(url.pathname.startsWith(`${base}/`) && match?.[1], 404, 'ROUTE_NOT_FOUND', '接口不存在')
    const id = match[1], tail = match[2] ?? ''
    if (!tail && method === 'GET') return json({ consultation: await this.detail(userId, id, internal) })
    if (!tail && method === 'PATCH' && !internal) {
      const body = exact(await readJson(), ['version', 'profile', 'path'])
      await this.service.patch(userId, id, body)
      return json({ consultation: await this.detail(userId, id, false) })
    }
    if (tail === 'documents' && method === 'POST' && !internal) {
      await this.service.authorizeDocument(userId, id)
      const key = idempotency(request)
      invariant(this.activeParsers < 2, 429, 'UPLOAD_BUSY', '上传处理中，请稍后重试')
      this.activeParsers++
      let storageKey: string | undefined
      try {
        const file = await readMultipart(request)
        if (file.fields.originalName) file.originalName = file.fields.originalName
        const inspection = await inspectDocument(file)
        const stored = await this.files.put(file.bytes)
        storageKey = stored.storageKey
        const doc = await this.service.addDocument(userId, id, {
          version: version(Number(file.fields.version)), type: file.fields.type,
          originalName: file.originalName, mimeType: inspection.mimeType, ...stored,
          extraction: extraction(inspection),
          ...(file.fields.description ? { description: file.fields.description } : {}),
          ...(file.fields.replaceDocumentId ? { replaceDocumentId: file.fields.replaceDocumentId } : {})
        }, key)
        invariant(doc.uploadStatus === 'UPLOADED' && !doc.removedAt, 409, 'UPLOAD_REPLAY_REMOVED', '原请求对应的材料已撤除，请重新选择文件上传')
        if (doc.storageKey !== storageKey) await this.files.remove(storageKey)
        if (file.fields.replaceDocumentId) {
          const replaced = await this.store.read(tx => tx.findById('mastersDocuments', file.fields.replaceDocumentId!))
          if (replaced?.consultationId === id && replaced.removedAt) await this.files.remove(replaced.storageKey)
        }
        storageKey = undefined
        return json({ document: documentDto(doc), consultation: await this.detail(userId, id, false) }, 201)
      } finally {
        this.activeParsers--
        if (storageKey) await this.files.remove(storageKey)
      }
    }
    const document = tail.match(/^documents\/([A-Za-z0-9_-]+)(?:\/(retry))?$/)
    if (document?.[1]) {
      if (method === 'GET' && !document[2]) return this.download(userId, id, document[1], internal)
      if (method === 'DELETE' && !internal && !document[2]) {
        const doc = await this.service.authorizeDocument(userId, id, document[1])
        await this.service.removeDocument(userId, id, document[1], version(Number(url.searchParams.get('version'))))
        if (doc) await this.files.remove(doc.storageKey)
        return json({ consultation: await this.detail(userId, id, false) })
      }
      if (method === 'POST' && !internal && document[2] === 'retry') {
        const body = exact(await readJson(), ['version'])
        const doc = await this.service.authorizeDocument(userId, id, document[1])
        invariant(doc, 404, 'MASTERS_DOCUMENT_NOT_FOUND', '材料不存在')
        invariant(this.activeParsers < 2, 429, 'UPLOAD_BUSY', '解析处理中，请稍后重试')
        this.activeParsers++
        try {
          const inspection = await inspectDocument({ originalName: doc.originalName, mimeType: doc.mimeType, bytes: await this.files.get(doc.storageKey), fields: {} })
          const result = await recordExtractionRetry(this.store, userId, id, doc.id, version(body.version), extraction(inspection))
          return json({ document: documentDto(result), consultation: await this.detail(userId, id, false) })
        } finally { this.activeParsers-- }
      }
    }
    if (tail === 'extraction' && method === 'GET' && !internal) {
      const data = await this.service.getExtraction(userId, id)
      return json({ ...data, documents: data.documents.map(documentDto),
        fields: data.documents.flatMap(doc => Object.entries(doc.extraction?.fields ?? {}).map(([field, value]) => ({ field, value, documentId: doc.id, sourceName: doc.originalName,
          location: doc.extraction?.evidence?.find(e => e.field === field)?.location ?? '', snippet: doc.extraction?.evidence?.find(e => e.field === field)?.excerpt ?? '', confidence: 'NEEDS_CONFIRMATION',
          ...(() => { const decision = doc.extraction?.confirmations?.filter(c => c.field === field).at(-1); return decision ? { accepted: decision.value !== null } : {} })() }))),
        conflicts: data.documents.flatMap(doc => (doc.extraction?.conflicts ?? []).map(c => ({ ...c, documentId: doc.id }))) })
    }
    if (tail === 'extraction/resolve' && method === 'POST' && !internal) {
      const result = await this.service.resolveExtraction(userId, id, exact(await readJson(), ['version', 'documentId', 'field', 'value', 'accepted']))
      return json({ document: documentDto(result), consultation: await this.detail(userId, id, false) })
    }
    if (tail === 'confirm' && method === 'POST' && !internal) {
      await this.service.confirm(userId, id, exact(await readJson(), ['version', 'accuracyConfirmed', 'consent']), idempotency(request))
      return json({ consultation: await this.detail(userId, id, false) })
    }
    if (tail === 'submit' && method === 'POST' && !internal) {
      const body = exact(await readJson(), ['version'])
      await this.service.submit(userId, id, { version: version(body.version) }, idempotency(request))
      return json({ consultation: await this.detail(userId, id, false) })
    }
    if (tail === 'withdraw' && method === 'POST' && !internal) {
      const body = exact(await readJson(), ['version'])
      if (body.version !== undefined) {
        const current = await this.service.detail(userId, id)
        invariant(current.profileVersion === version(body.version), 409, 'MASTERS_VERSION_CONFLICT', '资料版本已变化，请刷新后撤回')
      }
      await this.service.withdraw(userId, id)
      for (const doc of await this.store.read(tx => tx.findMany('mastersDocuments', { consultationId: id }))) await this.files.remove(doc.storageKey)
      await this.service.purgeWithdrawn(userId, id)
      return json({ withdrawn: true })
    }
    if (tail === 'report' && method === 'GET') return json({ report: reportDto(await this.service.getReleasedReport(userId, id, internal)) })
    if (tail === 'report/export' && method === 'GET') return this.export(userId, id, internal, url.searchParams.get('format'))
    if (internal && method === 'POST') {
      const body = await readJson()
      if (tail === 'assignment') {
        exact(body, ['advisorUserId', 'version'])
        await this.service.assign(userId, id, body, idempotency(request))
      } else if (tail === 'request-documents') {
        exact(body, ['types', 'note'])
        await this.service.requestDocuments(userId, id, body)
      } else if (tail === 'reports') {
        exact(body, ['version'])
        await this.service.enqueueReport(userId, id, { version: version(body.version) }, idempotency(request))
      } else if (tail === 'report/edit') {
        exact(body, ['version', 'reportId', 'payload', 'note'])
        delete body.note
        await this.service.editReport(userId, id, body)
      } else if (tail === 'report/review') {
        await this.service.reviewReport(userId, id, exact(body, ['version', 'reportId', 'note']))
      } else if (tail === 'report/approve') {
        await this.service.approveReport(userId, id, exact(body, ['version', 'reportId', 'note']))
      } else if (tail === 'report/return') {
        await this.service.returnReport(userId, id, exact(body, ['version', 'reportId', 'note']))
      } else if (tail === 'report/release') {
        await this.service.releaseReport(userId, id, exact(body, ['version', 'reportId', 'note']))
      } else throw new AppError(404, 'ROUTE_NOT_FOUND', '接口不存在')
      return json({ consultation: await this.detail(userId, id, true) })
    }
    throw new AppError(404, 'ROUTE_NOT_FOUND', '接口不存在')
  }
}
