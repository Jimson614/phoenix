'use strict'

class AskWiseAuthorizationAdapter {
  constructor(query) {
    if (typeof query !== 'function') throw new TypeError('query must be a function')
    this.query = query
  }

  async authorizeStudentAccess(memberId, studentId, action, requiredScope) {
    try {
      const result = await this.query(
        `SELECT decision, reason_code, relationship_id, consent_id
         FROM core.authorize_student_access($1::uuid, $2::text, $3::text, $4::text)`,
        [memberId, studentId, action, requiredScope],
      )
      const row = result && Array.isArray(result.rows) ? result.rows[0] : null
      if (!row) return this.denied(memberId, studentId, 'TEMPORARILY_UNAVAILABLE', true)
      return {
        decision: row.decision,
        reasonCode: row.reason_code,
        memberId,
        studentId,
        ...(row.relationship_id ? { relationshipId: row.relationship_id } : {}),
        ...(row.consent_id ? { consentGrantId: row.consent_id } : {}),
        retryable: false,
      }
    } catch {
      return this.denied(memberId, studentId, 'TEMPORARILY_UNAVAILABLE', true)
    }
  }

  denied(memberId, studentId, reasonCode, retryable) {
    return { decision: 'DENY', reasonCode, memberId, studentId, retryable }
  }
}

module.exports = { AskWiseAuthorizationAdapter }
