import { FeishuEntityType } from '../../domain/model'
import { invariant } from '../../domain/errors'

export type FeishuColumnKind = 'text' | 'number'

export interface FeishuTableContract {
  primaryField: string
  fields: Readonly<Record<string, FeishuColumnKind>>
}

export const CUSTOMER_PROFILE_FEISHU_CORE_FIELDS = Object.freeze({
  family_profile: Object.freeze([
    'family_id', 'status', 'created_at', 'schema_version', 'source_updated_at'
  ]),
  student_profile: Object.freeze([
    'student_id', 'family_id', 'student_version', 'created_at', 'schema_version', 'source_updated_at'
  ])
} as const)

export const CUSTOMER_PROFILE_FEISHU_OPTIONAL_FIELDS = Object.freeze({
  family_profile: Object.freeze([
    'family_name', 'parent_name', 'phone', 'location', 'goal'
  ]),
  student_profile: Object.freeze([
    'student_name', 'age', 'gender', 'school', 'education_system', 'grade', 'interest', 'goal'
  ])
} as const)

export const CUSTOMER_PROFILE_FEISHU_ALLOWLISTS = Object.freeze({
  family_profile: Object.freeze([
    ...CUSTOMER_PROFILE_FEISHU_CORE_FIELDS.family_profile,
    ...CUSTOMER_PROFILE_FEISHU_OPTIONAL_FIELDS.family_profile
  ]),
  student_profile: Object.freeze([
    ...CUSTOMER_PROFILE_FEISHU_CORE_FIELDS.student_profile,
    ...CUSTOMER_PROFILE_FEISHU_OPTIONAL_FIELDS.student_profile
  ])
} as const)

// V0.5 uses the exact CUSTOMER_PROFILE field names frozen by Founder. The
// existing tables may retain historical columns for legacy rows, but a V0.5
// payload is rejected if it contains any historical alias such as phone,
// family_name, student_name or grade.
export const V05_CUSTOMER_PROFILE_FEISHU_ALLOWLISTS = Object.freeze({
  family_profile: Object.freeze([
    'family_id', 'family_display_name', 'guardian_display_name', 'guardian_phone',
    'city_region', 'source_entry', 'advisor_status', 'consent_state', 'updated_at'
  ]),
  student_profile: Object.freeze([
    'student_id', 'family_id', 'student_display_name', 'education_system',
    'grade_stage', 'source_entry', 'advisor_status', 'consent_state', 'updated_at'
  ])
} as const)

const CUSTOMER_PROFILE_TEXT_LIMITS: Readonly<Record<string, number>> = Object.freeze({
  family_id: 80,
  student_id: 80,
  family_name: 80,
  parent_name: 80,
  phone: 30,
  location: 120,
  goal: 500,
  student_name: 80,
  gender: 30,
  school: 160,
  education_system: 80,
  grade: 80,
  interest: 500,
  family_display_name: 80,
  guardian_display_name: 80,
  guardian_phone: 30,
  city_region: 120,
  student_display_name: 80,
  grade_stage: 80,
  source_entry: 80,
  advisor_status: 80,
  consent_state: 40,
  updated_at: 40
})

function textFields(fieldNames: readonly string[]): Readonly<Record<string, FeishuColumnKind>> {
  return Object.freeze(Object.fromEntries(fieldNames.map((fieldName) => [fieldName, 'text' as const])))
}

/**
 * Exact API field names expected in Feishu Bitable.
 *
 * Every timestamp is deliberately stored as text (ISO-8601) so deployments do
 * not depend on a tenant's date-field formatting. This contract is also the
 * privacy boundary: the projector must never emit a key that is absent here.
 */
export const FEISHU_TABLE_CONTRACTS: Readonly<Record<FeishuEntityType, FeishuTableContract>> = Object.freeze({
  family_profile: {
    primaryField: 'family_id',
    fields: textFields([
      ...CUSTOMER_PROFILE_FEISHU_ALLOWLISTS.family_profile,
      ...V05_CUSTOMER_PROFILE_FEISHU_ALLOWLISTS.family_profile
    ])
  },
  student_profile: {
    primaryField: 'student_id',
    fields: Object.freeze({
      ...textFields([
        ...CUSTOMER_PROFILE_FEISHU_ALLOWLISTS.student_profile,
        ...V05_CUSTOMER_PROFILE_FEISHU_ALLOWLISTS.student_profile
      ]),
      age: 'number'
    })
  },
  assessment_session: {
    primaryField: 'session_id',
    fields: {
      session_id: 'text', family_id: 'text', student_id: 'text', questionnaire_version: 'text',
      student_version: 'text', status: 'text', completeness: 'number', submitted_at: 'text',
      created_at: 'text', schema_version: 'text', source_updated_at: 'text'
    }
  },
  report_job: {
    primaryField: 'report_id',
    fields: {
      report_id: 'text', family_id: 'text', student_id: 'text', assessment_id: 'text',
      status: 'text', delivery_status: 'text', qa_status: 'text', data_version: 'text',
      rule_version: 'text', prompt_version: 'text', template_version: 'text',
      source_catalog_version: 'text', data_as_of: 'text', created_at: 'text',
      schema_version: 'text', source_updated_at: 'text'
    }
  },
  order_payment: {
    primaryField: 'order_id',
    fields: {
      order_id: 'text', family_id: 'text', student_id: 'text', assessment_id: 'text',
      report_id: 'text', product_code: 'text', amount_fen: 'number', currency: 'text',
      channel: 'text', status: 'text', paid_at: 'text', refunded_at: 'text',
      created_at: 'text', schema_version: 'text', source_updated_at: 'text'
    }
  },
  feedback: {
    primaryField: 'feedback_id',
    fields: {
      feedback_id: 'text', report_id: 'text', rating: 'number', consult_intent: 'text',
      created_at: 'text', schema_version: 'text', source_updated_at: 'text'
    }
  },
  advisor_request: {
    primaryField: 'request_id',
    fields: {
      request_id: 'text', family_id: 'text', student_id: 'text', report_id: 'text',
      status: 'text', created_at: 'text', schema_version: 'text', source_updated_at: 'text'
    }
  }
})

/**
 * Runtime egress guard for both newly generated and persisted retry payloads.
 * TypeScript types alone cannot protect a payload restored from PostgreSQL.
 */
export function assertFeishuProjectionFields(
  entityType: FeishuEntityType,
  fields: Readonly<Record<string, unknown>>,
  customerProfileFieldsEnabled = false,
  v05ConsentBoundProfile = false
): void {
  const contract = FEISHU_TABLE_CONTRACTS[entityType]
  const profileEntity = entityType === 'family_profile' || entityType === 'student_profile'
  const optionalProfileFields: readonly string[] = profileEntity
    ? CUSTOMER_PROFILE_FEISHU_OPTIONAL_FIELDS[entityType]
    : []
  const v05ProfileFields: readonly string[] = profileEntity
    ? V05_CUSTOMER_PROFILE_FEISHU_ALLOWLISTS[entityType]
    : []
  invariant(fields !== null && typeof fields === 'object' && !Array.isArray(fields), 500,
    'FEISHU_PROJECTION_BODY_INVALID', '飞书投影载荷无效')
  for (const fieldName of Object.keys(fields)) {
    invariant(Object.hasOwn(contract.fields, fieldName), 500,
      'FEISHU_PROJECTION_FIELD_FORBIDDEN', '飞书投影包含未授权字段')
    invariant(customerProfileFieldsEnabled || (!optionalProfileFields.includes(fieldName) && !v05ProfileFields.includes(fieldName)), 500,
      'FEISHU_PROFILE_FIELD_DISABLED', '飞书客户资料字段未启用')
    if (v05ConsentBoundProfile && profileEntity) {
      const allowed = V05_CUSTOMER_PROFILE_FEISHU_ALLOWLISTS[entityType as 'family_profile' | 'student_profile']
      invariant(allowed.includes(fieldName as never), 500,
        'FEISHU_V05_PROFILE_FIELD_FORBIDDEN', 'V0.5 飞书资料投影包含未冻结字段')
    }
    const value = fields[fieldName]
    const expectedKind = contract.fields[fieldName]
    invariant(
      expectedKind === 'number'
        ? typeof value === 'number' && Number.isFinite(value)
        : typeof value === 'string' && value.length > 0,
      500,
      'FEISHU_PROJECTION_FIELD_TYPE_INVALID',
      '飞书投影字段类型无效'
    )
    if (optionalProfileFields.includes(fieldName) || v05ProfileFields.includes(fieldName)) {
      if (fieldName === 'age') {
        invariant(typeof value === 'number' && Number.isInteger(value) && value >= 3 && value <= 100, 500,
          'FEISHU_PROFILE_FIELD_VALUE_INVALID', '飞书客户资料年龄字段无效')
      } else {
        invariant(typeof value === 'string' && value.length <= (CUSTOMER_PROFILE_TEXT_LIMITS[fieldName] ?? 0), 500,
          'FEISHU_PROFILE_FIELD_TOO_LONG', '飞书客户资料字段超过长度限制')
        invariant(!/[\u0000-\u001f\u007f]/.test(String(value)), 500,
          'FEISHU_PROFILE_CONTROL_CHARACTER', '飞书客户资料字段包含控制字符')
        if (fieldName === 'phone' || fieldName === 'guardian_phone') {
          invariant(/^[0-9+() -]{3,30}$/.test(String(value)), 500,
            'FEISHU_PROFILE_PHONE_INVALID', '飞书客户资料电话字段无效')
        } else {
          invariant(!/^\s*[=+\-@]/.test(String(value)), 500,
            'FEISHU_PROFILE_FORMULA_INJECTION', '飞书客户资料字段包含公式注入前缀')
        }
      }
    }
  }
  const pseudonym = fields[contract.primaryField]
  invariant(typeof pseudonym === 'string' && /^PHX-[0-9a-f]{24}$/.test(pseudonym),
    500, 'FEISHU_PROJECTION_PSEUDONYM_INVALID', '飞书投影伪名主键无效')
  if (v05ConsentBoundProfile && profileEntity) {
    invariant(fields.consent_state === 'ACTIVE', 500,
      'FEISHU_V05_CONSENT_STATE_INVALID', 'V0.5 飞书资料投影缺少有效同意状态')
    invariant(typeof fields.updated_at === 'string' && fields.updated_at.length > 0, 500,
      'FEISHU_PROJECTION_SOURCE_TIME_INVALID', 'V0.5 飞书资料投影源更新时间无效')
  } else {
    invariant(fields.schema_version === 'phoenix_feishu_ops_v1', 500,
      'FEISHU_PROJECTION_VERSION_INVALID', '飞书投影版本无效')
    invariant(typeof fields.source_updated_at === 'string' && fields.source_updated_at.length > 0, 500,
      'FEISHU_PROJECTION_SOURCE_TIME_INVALID', '飞书投影源更新时间无效')
  }

  if (profileEntity && !v05ConsentBoundProfile) {
    const coreFields = CUSTOMER_PROFILE_FEISHU_CORE_FIELDS[entityType]
    invariant(coreFields.every((fieldName) => Object.hasOwn(fields, fieldName)),
      500, 'FEISHU_PROFILE_PROJECTION_INCOMPLETE', '飞书客户资料镜像字段不完整')
  }
}

export function requiredFeishuSchemaFields(
  entityType: FeishuEntityType,
  customerProfileFieldsEnabled = false
): Readonly<Record<string, FeishuColumnKind>> {
  const contract = FEISHU_TABLE_CONTRACTS[entityType]
  if (customerProfileFieldsEnabled || (entityType !== 'family_profile' && entityType !== 'student_profile')) {
    return contract.fields
  }
  const coreFields = CUSTOMER_PROFILE_FEISHU_CORE_FIELDS[entityType]
  return Object.freeze(Object.fromEntries(coreFields.map((fieldName) => {
    const kind = contract.fields[fieldName]
    invariant(kind, 500, 'FEISHU_SCHEMA_CONTRACT_INVALID', '飞书客户资料字段合同无效')
    return [fieldName, kind] as const
  })))
}
