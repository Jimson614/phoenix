import { randomUUID } from 'node:crypto'
import { invariant } from '../domain/errors'
import { MastersDocumentExtraction } from '../domain/masters/contracts'
import { Store } from '../store/store'

/** Persist a bounded parser retry against the exact still-authorized evidence version. */
export async function recordExtractionRetry(store: Store, userId: string, consultationId: string, documentId: string, version: number, extraction: MastersDocumentExtraction) {
  return store.transaction(async tx => {
    const consultation = await tx.findById('mastersConsultations', consultationId, { forUpdate: true })
    invariant(consultation?.userId === userId, 404, 'MASTERS_CONSULTATION_NOT_FOUND', '咨询不存在')
    invariant(consultation.status !== 'WITHDRAWN' && !consultation.withdrawnAt, 410, 'MASTERS_CONSULTATION_WITHDRAWN', '咨询已撤回')
    const consent = consultation.serviceConsentId ? await tx.findById('mastersConsents', consultation.serviceConsentId) : null
    invariant(consent?.accepted && !consent.withdrawnAt, 403, 'MASTERS_CONSENT_REQUIRED', '咨询授权已撤回')
    invariant(consultation.profileVersion === version, 409, 'MASTERS_VERSION_CONFLICT', '资料已更新，请重新核对')
    const document = await tx.findById('mastersDocuments', documentId, { forUpdate: true })
    invariant(document?.consultationId === consultationId && document.uploadStatus === 'UPLOADED' && !document.removedAt, 404, 'MASTERS_DOCUMENT_NOT_FOUND', '材料不存在')
    const now = new Date().toISOString()
    const result = await tx.update('mastersDocuments', documentId, { extraction, extractionStatus: extraction.status ?? 'MANUAL_REVIEW', updatedAt: now })
    await tx.update('mastersConsultations', consultationId, { profileVersion: version + 1, accuracyConfirmed: false, confirmedSnapshotId: null, status: consultation.status === 'DRAFT' ? 'DRAFT' : 'NEEDS_INFO', updatedAt: now })
    for (const job of await tx.findMany('mastersReportJobs', { consultationId })) {
      if (['QUEUED', 'RUNNING', 'FAILED'].includes(job.status)) await tx.update('mastersReportJobs', job.id, { status: 'STALE', leaseToken: null, leaseOwner: null, leaseExpiresAt: null, updatedAt: now })
    }
    for (const report of await tx.findMany('mastersReports', { consultationId })) await tx.update('mastersReports', report.id, { status: 'STALE', updatedAt: now })
    await tx.insert('mastersAuditLogs', { id: `maud_${randomUUID()}`, consultationId, actorUserId: userId, action: 'EXTRACTION_RETRIED', metadata: { documentId, profileVersion: version + 1, status: result.extractionStatus }, createdAt: now })
    return result
  })
}
