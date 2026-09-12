const crypto = require('node:crypto')
const { RequestError, validateSubmission } = require('./validation')

function payloadHash(submission) {
  return crypto.createHash('sha256').update(JSON.stringify(submission)).digest('hex')
}

function audit(database, event) {
  database.prepare(`
    INSERT INTO audit_log (
      id, actor_user_id, action, resource_type, resource_id,
      family_id, occurred_at, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `audit_${crypto.randomUUID()}`,
    event.userId,
    event.action,
    event.resourceType,
    event.resourceId || null,
    event.familyId || null,
    event.occurredAt,
    JSON.stringify(event.metadata || {})
  )
}

function assertOwnedFamily(database, familyId, userId, now) {
  const family = database.prepare('SELECT user_id AS userId FROM families WHERE id = ?').get(familyId)
  if (family && family.userId !== userId) {
    throw new RequestError(403, 'forbidden', 'the family is not authorized for this session')
  }
  if (!family) {
    database.prepare(`
      INSERT INTO families (id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?)
    `).run(familyId, userId, now, now)
  }
}

function assertStudentInFamily(database, studentId, familyId, now) {
  const student = database.prepare('SELECT family_id AS familyId FROM students WHERE id = ?').get(studentId)
  if (student && student.familyId !== familyId) {
    throw new RequestError(403, 'forbidden', 'the student is not authorized for this family')
  }
  if (!student) {
    database.prepare(`
      INSERT INTO students (id, family_id, created_at, updated_at) VALUES (?, ?, ?, ?)
    `).run(studentId, familyId, now, now)
  }
}

function saveQuestionnaireSubmission(database, userId, rawSubmission) {
  const submission = validateSubmission(rawSubmission)
  const hash = payloadHash(submission)
  const now = new Date().toISOString()

  database.exec('BEGIN IMMEDIATE')
  try {
    assertOwnedFamily(database, submission.familyId, userId, now)
    assertStudentInFamily(database, submission.studentId, submission.familyId, now)

    const existing = database.prepare(`
      SELECT id, payload_hash AS payloadHash, received_at AS receivedAt
      FROM questionnaire_submissions
      WHERE user_id = ? AND client_submission_id = ?
    `).get(userId, submission.clientSubmissionId)

    if (existing) {
      if (existing.payloadHash !== hash) {
        throw new RequestError(409, 'idempotency_conflict', 'clientSubmissionId was already used for different content')
      }
      audit(database, {
        userId,
        action: 'questionnaire_submission_duplicate',
        resourceType: 'questionnaire_submission',
        resourceId: existing.id,
        familyId: submission.familyId,
        occurredAt: now,
        metadata: { clientSubmissionId: submission.clientSubmissionId }
      })
      database.exec('COMMIT')
      return { id: existing.id, receivedAt: existing.receivedAt, duplicate: true }
    }

    const id = `qsub_${crypto.randomUUID()}`
    database.prepare(`
      INSERT INTO questionnaire_submissions (
        id, client_submission_id, user_id, family_id, student_id,
        questionnaire_type, answers_json, payload_hash, source,
        client_submitted_at, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'wechat_miniprogram', ?, ?)
    `).run(
      id,
      submission.clientSubmissionId,
      userId,
      submission.familyId,
      submission.studentId,
      submission.questionnaireType,
      JSON.stringify(submission.answers),
      hash,
      submission.submittedAt,
      now
    )
    audit(database, {
      userId,
      action: 'questionnaire_submission_created',
      resourceType: 'questionnaire_submission',
      resourceId: id,
      familyId: submission.familyId,
      occurredAt: now,
      metadata: {
        clientSubmissionId: submission.clientSubmissionId,
        questionnaireType: submission.questionnaireType,
        source: 'wechat_miniprogram'
      }
    })
    database.exec('COMMIT')
    return { id, receivedAt: now, duplicate: false }
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

module.exports = { payloadHash, saveQuestionnaireSubmission }
