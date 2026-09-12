const SCHEMA_VERSION = '0.1.0'

const tables = {
  users: ['id', 'wechat_id', 'name', 'phone', 'role', 'created_at'],
  families: ['id', 'user_id', 'family_name', 'parent_name', 'phone', 'location', 'goal', 'created_at'],
  students: ['id', 'family_id', 'name', 'age', 'gender', 'school', 'education_system', 'grade', 'interest', 'goal'],
  assessments: ['id', 'student_id', 'type', 'answers', 'status', 'sync_requested_at', 'created_at'],
  reports: ['id', 'assessment_id', 'summary', 'recommendation', 'created_at'],
  timelineEvents: ['id', 'family_id', 'event_type', 'description', 'date'],
  advisorNotes: ['id', 'family_id', 'advisor_id', 'note', 'follow_up_status', 'created_at'],
  advisorRequests: ['id', 'family_id', 'user_id', 'preferred_time', 'topic', 'status', 'created_at'],
  partnerExplorations: ['id', 'family_id', 'student_id', 'partner_experience_id', 'answers', 'result', 'status', 'created_at'],
  partnerApplications: ['id', 'family_id', 'user_id', 'partner_experience_id', 'child_name', 'age_stage', 'parent_name', 'contact', 'music_interest', 'preferred_direction', 'privacy_consent', 'status', 'created_at'],
  analyticsEvents: ['id', 'user_id', 'family_id', 'event_name', 'properties', 'created_at'],
  partners: ['partner_id', 'partner_type', 'name', 'organization', 'status'],
  permissions: ['permission_id', 'family_id', 'partner_id', 'access_scope']
}

const compassTypes = ['education', 'culture', 'health', 'identity', 'wealth']
const partnerTypes = ['culture', 'education', 'health', 'wealth']
const userRoles = ['family_user', 'admin', 'partner_expert']

module.exports = { SCHEMA_VERSION, tables, compassTypes, partnerTypes, userRoles }
