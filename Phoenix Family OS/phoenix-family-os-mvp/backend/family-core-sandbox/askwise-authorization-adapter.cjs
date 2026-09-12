'use strict'

class AskWiseAuthorizationAdapter {
  constructor(query) {
    if (typeof query !== 'function') throw new TypeError('query must be a function')
    this.query = query
  }

  async authorizeStudentAccess(memberId, sourceStudentId, action, requiredScope, requestId, auditId) {
    const normalizedSourceStudentId = String(sourceStudentId ?? '')
    if (!requestId || !auditId) {
      return this.denied(memberId, normalizedSourceStudentId, 'AUDIT_CONTEXT_REQUIRED', false)
    }

    try {
      const result = await this.query(
        `SELECT decision, reason_code, relationship_id, consent_id,
                entitlement_id, mapping_id, student_id, audit_id
         FROM core.authorize_student_access(
           $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::uuid
         )`,
        [memberId, normalizedSourceStudentId, action, requiredScope, requestId, auditId],
      )
      const row = result && Array.isArray(result.rows) ? result.rows[0] : null
      if (!row) {
        return this.denied(memberId, normalizedSourceStudentId, 'TEMPORARILY_UNAVAILABLE', true)
      }
      if (!['ALLOW', 'DENY'].includes(row.decision) || typeof row.reason_code !== 'string') {
        return this.denied(memberId, normalizedSourceStudentId, 'INVALID_CORE_DECISION', false)
      }
      if (!row.audit_id) {
        return this.denied(memberId, normalizedSourceStudentId, 'INVALID_CORE_DECISION', false)
      }
      if (
        row.decision === 'ALLOW' &&
        (!row.relationship_id || !row.consent_id || !row.entitlement_id ||
          !row.mapping_id || !row.student_id)
      ) {
        return this.denied(memberId, normalizedSourceStudentId, 'INVALID_CORE_DECISION', false)
      }
      return {
        decision: row.decision,
        reasonCode: row.reason_code,
        memberId,
        sourceStudentId: normalizedSourceStudentId,
        ...(row.student_id ? { coreStudentId: row.student_id } : {}),
        ...(row.relationship_id ? { relationshipId: row.relationship_id } : {}),
        ...(row.consent_id ? { consentGrantId: row.consent_id } : {}),
        ...(row.entitlement_id ? { entitlementId: row.entitlement_id } : {}),
        ...(row.mapping_id ? { mappingId: row.mapping_id } : {}),
        auditId: row.audit_id,
        retryable: false,
      }
    } catch {
      return this.denied(memberId, normalizedSourceStudentId, 'TEMPORARILY_UNAVAILABLE', true)
    }
  }

  denied(memberId, sourceStudentId, reasonCode, retryable) {
    return { decision: 'DENY', reasonCode, memberId, sourceStudentId, retryable }
  }
}

module.exports = { AskWiseAuthorizationAdapter }
