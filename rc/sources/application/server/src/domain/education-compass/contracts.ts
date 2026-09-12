export const EDUCATION_COMPASS_CONTRACT_VERSION = 'education_compass_contract_v1.1.0' as const
export const FREE_PARENT_QUESTIONNAIRE_VERSION = 'free_parent_compass_v1.1.0' as const
export const GROWTH_DISCOVERY_QUESTIONNAIRE_VERSION = 'education_growth_discovery_v1.1.0' as const
export const LEGACY_FREE_PARENT_QUESTIONNAIRE_VERSION = 'free_parent_compass_v1.0.0-rc1' as const
export const LEGACY_GROWTH_DISCOVERY_QUESTIONNAIRE_VERSION = 'education_growth_discovery_v1.0.0-rc1' as const
export type FreeParentQuestionnaireVersion =
  | typeof LEGACY_FREE_PARENT_QUESTIONNAIRE_VERSION
  | typeof FREE_PARENT_QUESTIONNAIRE_VERSION
export type GrowthDiscoveryQuestionnaireVersion =
  | typeof LEGACY_GROWTH_DISCOVERY_QUESTIONNAIRE_VERSION
  | typeof GROWTH_DISCOVERY_QUESTIONNAIRE_VERSION
export const FAMILY_SNAPSHOT_VERSION = 'family_education_snapshot_v1.0.0' as const
export const GROWTH_DISCOVERY_REPORT_VERSION = 'student_growth_discovery_report_v1.0.0' as const
export const EDUCATION_COMPASS_TAXONOMY_VERSION = 'education_compass_taxonomy_v1.0.0-rc1' as const
export const EDUCATION_COMPASS_DISCLAIMER_VERSION = 'education_compass_disclaimer_v1.0.0-rc1' as const

export const EDUCATION_COMPASS_DISCLAIMER =
  '本结果基于本次学生自我报告、家长观察（如有）及用户自愿提供的区间资料形成成长快照，不是心理、医疗或学业能力诊断，也不构成提分、升学或录取承诺。教育体系、成绩与兴趣信息可能随时间变化；重要决定请结合学校、合格专业人士及最新官方信息复核。' as const

export const EDUCATION_COMPASS_SHORT_DISCLAIMER =
  '成长快照仅供教育支持参考，不是诊断、排名、录取预测或结果保证。' as const

export type AssessmentLevel = 'LEVEL_1' | 'LEVEL_2'
export type AssessmentKind = 'FREE_PARENT_COMPASS' | 'STUDENT_GROWTH_DISCOVERY'
export type EducationSystem = 'GAOKAO' | 'DSE' | 'IGCSE' | 'A_LEVEL' | 'AP_US' | 'IB' | 'OTHER'
export type FormalEducationSystem = Exclude<EducationSystem, 'IB' | 'OTHER'>
export type QuestionnaireQuestionType =
  | 'SINGLE_CHOICE'
  | 'MULTI_CHOICE'
  | 'MULTI_CHOICE_DYNAMIC'
  | 'YEAR_SELECT'
  | 'PROVINCE_REGION_SELECT'
  | 'SUBJECT_RANGE_MATRIX'

export type ResultSignalStatus = 'SUPPORTED' | 'NEEDS_VALIDATION' | 'UNKNOWN'
export type ResultSignalSource = 'PARENT_OBSERVATION' | 'STUDENT_SELF_REPORT' | 'OPTIONAL_RANGE_CONTEXT'
export type GrowthDimension =
  | 'ACADEMIC_PERFORMANCE'
  | 'LEARNING_PROCESS'
  | 'THINKING_LEARNING_STYLE'
  | 'INTEREST_DIRECTION'
  | 'CONTEXT'
  | 'RESPONDENT'
  | 'FAMILY_CONCERN'
  | 'PARENT_OBSERVATION'
  | 'READINESS'
  | 'FAMILY_GOAL'
  | 'NEXT_STEP'

export interface FrozenOption {
  code: string
  label: string
}

export interface FrozenQuestionValidation {
  minSelections?: number
  maxSelections?: number
  exclusiveOptions?: readonly string[]
  allowedSubmitValues?: readonly string[]
  min?: number | 'CURRENT_YEAR'
  max?: number | 'CURRENT_YEAR_PLUS_8'
  sentinelValues?: readonly string[]
  allowNotProvided?: boolean
  maxRows?: number
  allowEmpty?: boolean
}

export interface FrozenQuestion {
  id: string
  key: string
  label: string
  type: QuestionnaireQuestionType
  required: boolean
  options: readonly FrozenOption[]
  validation: Readonly<FrozenQuestionValidation>
  dimensions: readonly GrowthDimension[]
  signalCodes: readonly string[]
  scored: false
  systemApplicability: readonly EducationSystem[]
  matrixSubjectOptions?: readonly FrozenOption[]
  matrixRangeOptions?: readonly FrozenOption[]
  exitRule?: string
  privacyNote?: string
}

export interface RegistrySourceIntegrity {
  relativePath: string
  resolvedPath: string
  expectedSha256: string
  actualSha256: string
  verified: true
}

export interface QuestionnairePresentationMetaV1 {
  version: 'education_compass_presentation_v1'
  estimatedMinutesMin: number
  estimatedMinutesMax: number
  totalQuestions: number
  requiredQuestions: number
  progressMode: 'QUESTION_COUNT'
  scoringMode: 'NONE'
  /** Server-owned wording only; deliberately excluded from schemaDigest. */
  experienceTitle: string
  experienceEyebrow: string
  experienceSummary: string
  respondentHint: string
  completionOutcome: string
  primaryActionHint: string
}

export interface QuestionnaireBank {
  schemaVersion: 'phoenix_question_bank_schema_v1'
  assessmentKind: AssessmentKind
  assessmentLevel: AssessmentLevel
  questionnaireVersion: string
  commonBankVersion: string
  systemBankVersion: string | null
  educationSystem: EducationSystem | null
  systemResultMarker: 'FULL_SYSTEM_BANK' | 'SYSTEM_BANK_PENDING' | null
  questions: readonly FrozenQuestion[]
  commonQuestionIds: readonly string[]
  systemQuestionIds: readonly string[]
  requiredQuestionIds: readonly string[]
  optionalQuestionIds: readonly string[]
  schemaDigest: string
  scoringMode: 'NONE'
  /** Additive display metadata. It is deliberately excluded from schemaDigest. */
  presentation?: Readonly<QuestionnairePresentationMetaV1>
}

/** Canonical matrix shape persisted for optional achievement-band answers. */
export interface SubjectRangeAnswerRow {
  subject_code: string
  range_code: string
}

export type CanonicalQuestionAnswer = string | readonly string[] | readonly SubjectRangeAnswerRow[]
export type CanonicalAnswerMap = Readonly<Record<string, CanonicalQuestionAnswer>>

export interface QuestionnaireValidationResult {
  answers: CanonicalAnswerMap
  missingRequiredQuestionIds: readonly string[]
  answeredRequiredCount: number
  requiredCount: number
  completenessCoverage: number
  canSubmit: boolean
  respondentExitRequested: boolean
  schemaDigest: string
}

export interface EducationSystemSwitchResult {
  answers: CanonicalAnswerMap
  removedQuestionIds: readonly string[]
  previousEducationSystem: EducationSystem | null
  educationSystem: EducationSystem
}

export interface FamilyEducationSnapshotV1 {
  result_kind: 'FAMILY_EDUCATION_SNAPSHOT'
  result_version: typeof FAMILY_SNAPSHOT_VERSION
  family_id: string
  student_id: string
  assessment_id: string
  education_system: EducationSystem
  grade_stage: string
  family_concerns: readonly string[]
  observed_strength_signals: readonly string[]
  observed_difficulty_signals: readonly string[]
  student_readiness: string
  family_priorities: readonly string[]
  preferred_next_support: string
  next_step_status: 'AVAILABLE' | 'CONSIDER' | 'NOT_RECOMMENDED' | 'DEFERRED'
  next_step_reason_codes: readonly string[]
  questionnaire_version: FreeParentQuestionnaireVersion
  disclaimer_version: typeof EDUCATION_COMPASS_DISCLAIMER_VERSION
  disclaimer: typeof EDUCATION_COMPASS_DISCLAIMER
}

export interface EvidenceSignal {
  code: string
  dimension: Extract<GrowthDimension,
    'ACADEMIC_PERFORMANCE' | 'LEARNING_PROCESS' | 'THINKING_LEARNING_STYLE' | 'INTEREST_DIRECTION'>
  status: ResultSignalStatus
  evidence_refs: readonly string[]
  source: Extract<ResultSignalSource, 'STUDENT_SELF_REPORT' | 'OPTIONAL_RANGE_CONTEXT'>
}

export interface StudentSnapshotV1 {
  education_system: EducationSystem
  grade_stage: string
  major_exam_year: string
  target_regions: readonly string[]
  performance_self_view: string
  evidence_refs: readonly string[]
}

export interface EducationPathwayContextV1 {
  selected_codes: readonly string[]
  respondent: 'STUDENT'
  intent: 'CONSIDERING' | 'UNKNOWN'
  status: 'USER_STATED_CONTEXT' | 'UNKNOWN'
  evidence_refs: readonly ['EGD19'] | readonly []
  taxonomy_version: typeof EDUCATION_COMPASS_TAXONOMY_VERSION
}

export interface ActionPlanGoalV1 {
  code: string
  status: ResultSignalStatus
  evidence_refs: readonly string[]
}

export interface ActionPlan30DayV1 {
  horizon_days: 30
  selected_action_code: string
  goals: readonly ActionPlanGoalV1[]
}

export interface StudentGrowthDiscoveryReportV1 {
  result_kind: 'STUDENT_GROWTH_DISCOVERY'
  result_version: typeof GROWTH_DISCOVERY_REPORT_VERSION
  education_pathway_context: EducationPathwayContextV1
  student_snapshot: StudentSnapshotV1
  strength_signals: readonly EvidenceSignal[]
  learning_bottlenecks: readonly EvidenceSignal[]
  subject_focus: readonly EvidenceSignal[]
  growth_direction: readonly EvidenceSignal[]
  action_plan_30d: ActionPlan30DayV1
  learning_signals: readonly EvidenceSignal[]
  interest_signals: readonly EvidenceSignal[]
  recommended_focus: readonly string[]
  system_result_marker: 'FULL_SYSTEM_BANK' | 'SYSTEM_BANK_PENDING'
  evidence_refs: readonly string[]
  questionnaire_versions: readonly string[]
  disclaimer_version: typeof EDUCATION_COMPASS_DISCLAIMER_VERSION
  disclaimer: typeof EDUCATION_COMPASS_DISCLAIMER
  scoring_mode: 'NONE'
}

export interface ResultBuildIdentity {
  familyId: string
  studentId: string
  assessmentId: string
}
