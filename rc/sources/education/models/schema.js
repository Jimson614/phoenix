const SCHEMA_VERSION = '0.2.0'

const tables = {
  users: ['id', 'wechat_id', 'name', 'phone', 'role', 'created_at'],
  families: ['id', 'user_id', 'family_name', 'parent_name', 'phone', 'location', 'goal', 'created_at'],
  students: ['id', 'family_id', 'name', 'age', 'gender', 'school', 'education_system', 'grade', 'interest', 'goal'],
  assessments: ['id', 'student_id', 'type', 'questionnaire_version', 'student_version', 'consent', 'answers', 'completeness_score', 'missing_fields', 'status', 'report_id', 'created_at', 'updated_at', 'submitted_at'],
  reports: ['id', 'assessment_id', 'product_code', 'status', 'access', 'preview', 'full', 'summary', 'recommendation', 'created_at', 'updated_at'],
  orders: ['id', 'user_id', 'family_id', 'assessment_id', 'report_id', 'product_code', 'out_trade_no', 'amount_fen', 'currency', 'status', 'paid_at', 'refunded_at', 'created_at', 'updated_at'],
  reportFeedback: ['id', 'report_id', 'user_id', 'rating', 'tags', 'comment', 'advisor_contact_requested', 'created_at'],
  timelineEvents: ['id', 'family_id', 'event_type', 'description', 'date'],
  advisorNotes: ['id', 'family_id', 'advisor_id', 'note', 'follow_up_status', 'created_at'],
  advisorRequests: ['id', 'family_id', 'user_id', 'student_id', 'report_id', 'preferred_time', 'topic', 'status', 'created_at'],
  analyticsEvents: ['id', 'user_id', 'family_id', 'event_name', 'properties', 'created_at'],
  partners: ['partner_id', 'partner_type', 'name', 'organization', 'status'],
  permissions: ['permission_id', 'family_id', 'partner_id', 'access_scope']
}

const compassTypes = ['education', 'culture', 'health', 'identity', 'wealth']
const partnerTypes = ['culture', 'education', 'health', 'wealth']
const userRoles = ['family_user', 'admin', 'partner_expert']

module.exports = { SCHEMA_VERSION, tables, compassTypes, partnerTypes, userRoles }
