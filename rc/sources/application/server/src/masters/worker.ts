import { randomUUID } from 'node:crypto'
import { MastersService } from '../services/masters-service'
import { PrivateFiles } from './private-files'
import { Store } from '../store/store'

/** In-process development worker for the same durable queue used by the API.
 * No external AI/search adapter is enabled. The service owns transactional fencing.
 */
export class MastersWorker {
  private readonly owner = `masters-rules-${randomUUID()}`
  constructor(private readonly service: MastersService, private readonly files: PrivateFiles, private readonly store: Store, private readonly retentionDays = 30) {}

  async runOnce(): Promise<void> {
    const job = await this.service.claimJob(this.owner, { leaseMs: 30_000 })
    if (job?.leaseToken) {
      try { await this.service.completeJob(job.id, job.leaseToken) }
      catch { await this.service.failJob(job.id, job.leaseToken, 'RULE_GENERATION_FAILED') }
    }
    await this.purgeRemovedFiles()
  }

  async purgeRemovedFiles(): Promise<void> {
    const documents = await this.store.read(tx => tx.findMany('mastersDocuments'))
    const consultations = await this.store.read(tx => tx.findMany('mastersConsultations'))
    const now = Date.now()
    for (const consultation of consultations) {
      const expired = now - new Date(consultation.updatedAt).getTime() > this.retentionDays * 86_400_000
      if (consultation.status !== 'WITHDRAWN' && expired) await this.service.withdraw(consultation.userId, consultation.id)
    }
    const withdrawnConsultations = await this.store.read(tx => tx.findMany('mastersConsultations', { status: 'WITHDRAWN' }))
    const withdrawn = new Set(withdrawnConsultations.map(c => c.id))
    for (const document of documents) {
      if (document.removedAt || withdrawn.has(document.consultationId)) await this.files.remove(document.storageKey)
    }
    for (const consultation of withdrawnConsultations) {
      if (Object.keys(consultation.profile).length > 0 || documents.some(d => d.consultationId === consultation.id && (!d.removedAt || d.extraction || d.originalName !== 'withdrawn-material'))) await this.service.purgeWithdrawn(consultation.userId, consultation.id)
    }
    const referenced = await this.store.read(tx => tx.findMany('mastersDocuments'))
    await this.files.sweepOrphans(new Set(referenced.filter(document => !document.removedAt).map(document => document.storageKey)))
  }
}
