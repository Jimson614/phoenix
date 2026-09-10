'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const {
  evaluatePolicy,
  expectedPolicyIds,
  loadPolicy,
  policyPath,
  policySha256,
  validateBaseline,
} = require('../policy/policy-gate-v1.cjs')

const sandboxRoot = path.resolve(__dirname, '..')
const projectRoot = path.resolve(sandboxRoot, '..', '..')
const repositoryRoot = path.resolve(projectRoot, '..', '..')
const startedAt = new Date().toISOString()
const evidenceDirectory = path.resolve(
  process.env.FAMILY_CORE_POLICY_EVIDENCE_DIR
    || process.env.FAMILY_CORE_EVIDENCE_DIR
    || path.join(sandboxRoot, 'artifacts', startedAt.replace(/[:.]/g, '-')),
)
const tests = []

function record(name, passed, evidence, policyId = null) {
  tests.push({ name, policyId, status: passed ? 'PASS' : 'FAIL', evidence })
}

function runGit(args) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true,
  })
  return result.status === 0 ? result.stdout.trim() : 'unknown'
}

function assertDenied(policy, policyId, name, facts, expectedCode) {
  const result = evaluatePolicy(policy, policyId, facts)
  record(
    name,
    result.allowed === false && result.code === expectedCode,
    `decision=${result.decision}; code=${result.code}; expected=${expectedCode}`,
    policyId,
  )
}

function assertAllowed(policy, policyId, name, facts, expectedCode) {
  const result = evaluatePolicy(policy, policyId, facts)
  record(
    name,
    result.allowed === true && result.code === expectedCode,
    `decision=${result.decision}; code=${result.code}; expected=${expectedCode}`,
    policyId,
  )
}

function writeEvidence(evidence) {
  fs.mkdirSync(evidenceDirectory, { recursive: true })
  const jsonPath = path.join(evidenceDirectory, 'family-core-policy-v1-evidence.json')
  const markdownPath = path.join(evidenceDirectory, 'FAMILY_CORE_POLICY_V1_EVIDENCE.md')
  fs.writeFileSync(jsonPath, `${JSON.stringify(evidence, null, 2)}\n`)
  const lines = [
    '# Family Core Policy V1 Gate Evidence',
    '',
    `Status: \`${evidence.status}\``,
    `Policy version: \`${evidence.policy.version}\``,
    `Policy SHA-256: \`${evidence.policy.sha256}\``,
    `Founder approval: \`${evidence.policy.approvedAt}\``,
    `Repository SHA: \`${evidence.repository.sha}\``,
    `Branch: \`${evidence.repository.branch}\``,
    '',
    '## Executable checks',
    '',
    ...evidence.tests.map((test) => `- ${test.status} — ${test.policyId ? `${test.policyId}: ` : ''}${test.name} (${test.evidence})`),
    '',
    `Policy IDs with an executable deny-path: \`${evidence.coverage.covered}/${evidence.coverage.expected}\``,
    '',
    'This is synthetic sandbox evidence only. It does not authorize production, real data, public indexing, database migration, Health scope, or PR #12/#13.',
    '',
  ]
  fs.writeFileSync(markdownPath, lines.join('\n'))
  return { jsonPath, markdownPath }
}

const policy = loadPolicy()
const baselineProblems = validateBaseline(policy)
record(
  'approved baseline is internally consistent and fail closed',
  baselineProblems.length === 0,
  baselineProblems.length === 0 ? 'no validation problems' : baselineProblems.join(','),
)

assertDenied(policy, 'GUA-001', 'self-attestation cannot establish Guardian authority', {
  verifiedAccount: true,
  evidenceOnApprovedAllowlist: false,
  manualApprovalRecorded: false,
  authorizedReviewer: false,
}, 'GUARDIAN_AUTHORITY_REVIEW_REQUIRED')
assertDenied(policy, 'GUA-002', 'disputed high-risk Guardian action discloses nothing new', {
  explicitRelationship: true,
  scopeAndDatesRecorded: true,
  disputed: true,
  highRiskAction: true,
  allApplicableAuthorityRulesSatisfied: false,
  secondReviewer: false,
}, 'GUARDIAN_ACTION_SUSPENDED')
assertDenied(policy, 'CON-001', 'missing purpose-specific receipt denies sharing', {
  activeReceipt: false,
  immutableReceipt: true,
  purposeMatches: false,
  destinationMatches: true,
  policyVersionMatches: true,
  localeRecorded: true,
  actorRecorded: true,
}, 'CONSENT_REQUIRED')
assertDenied(policy, 'CON-002', 'unknown jurisdiction denies elevated processing', {
  jurisdictionKnown: false,
  ageKnown: false,
  capacityResolved: false,
  processingLevel: 'ELEVATED',
}, 'CAPACITY_QUARANTINE')
assertDenied(policy, 'CON-003', 'withdrawn consent denies future processing', {
  withdrawn: true,
  activeReceipt: false,
  cachedAuthorityValid: false,
}, 'CONSENT_WITHDRAWN_OR_STALE')
assertDenied(policy, 'RET-001', 'real-data retention remains on policy hold', {
  realData: true,
  legalScheduleApproved: false,
  dataClassScheduled: false,
}, 'RETENTION_POLICY_HOLD')
assertDenied(policy, 'ENT-001', 'stale entitlement denies access', {
  authority: 'FAMILY_CORE_LEDGER',
  status: 'ACTIVE',
  withinEffectiveInterval: true,
  stale: true,
  conflicting: false,
}, 'ENTITLEMENT_REQUIRED')
assertDenied(policy, 'ENT-002', 'ambiguous family context denies access', {
  selectedFamilyId: 'fam_a',
  activeMembershipFamilyId: 'fam_b',
  serverRevalidated: false,
  automaticInheritance: true,
}, 'FAMILY_CONTEXT_DENIED')
assertDenied(policy, 'OPS-001', 'operator without explicit assignment is denied', {
  leastPrivilegeRole: true,
  explicitAssignment: false,
  purposeCodeRecorded: true,
  withinTimeWindow: true,
  immutableAuditEnabled: true,
  globalBrowse: false,
}, 'OPERATOR_ACCESS_DENIED')
assertDenied(policy, 'BRK-001', 'break-glass remains disabled', {
  twoPersonApproval: true,
  mfa: true,
}, 'BREAK_GLASS_DISABLED')
assertDenied(policy, 'ID-001', 'weak-identifier automatic merge is quarantined', {
  autoMerge: true,
  matchBasis: 'NAME_PHONE_EMAIL_ADDRESS_DEVICE_OR_PAYMENT',
}, 'IDENTITY_CONFLICT_QUARANTINED')
assertDenied(policy, 'XDS-001', 'unlisted cross-domain field is denied', {
  producer: 'CORE',
  consumer: 'EDUCATION',
  transport: 'AUTHENTICATED_ADAPTER',
  fields: ['subject_id', 'raw_assessment_content'],
  activePurposeSpecificConsent: true,
  approvedPurposeCode: true,
  entitlementRequired: true,
  activeEntitlement: true,
  idempotencyKeyPresent: true,
  auditCorrelationPresent: true,
}, 'CROSS_DOMAIN_DENIED')
assertDenied(policy, 'XDS-002', 'all Health scope remains held', {
  route: '/v1/health',
}, 'HEALTH_SCOPE_HOLD')
assertDenied(policy, 'DSR-001', 'export remains held while Legal parameters are pending', {
  requesterIdentityVerified: true,
  requesterAuthorityVerified: true,
  scopeUnambiguous: true,
  encryptedDelivery: true,
  expiringDelivery: true,
  provenanceRecorded: true,
  accessAudited: true,
}, 'EXPORT_POLICY_HOLD')

assertAllowed(policy, 'RET-001', 'deterministic non-personal synthetic evidence may be retained', {
  syntheticNonPersonal: true,
  realData: false,
}, 'RETENTION_SCOPE_ALLOWED')
assertAllowed(policy, 'XDS-001', 'minimum Education synthetic handoff shape passes the reference gate', {
  producer: 'CORE',
  consumer: 'EDUCATION',
  transport: 'AUTHENTICATED_ADAPTER',
  fields: ['subject_id', 'family_id', 'consent_receipt_reference', 'request_correlation_id'],
  activePurposeSpecificConsent: true,
  approvedPurposeCode: true,
  entitlementRequired: true,
  activeEntitlement: true,
  idempotencyKeyPresent: true,
  auditCorrelationPresent: true,
}, 'CROSS_DOMAIN_MINIMUM_ALLOWED')

const deniedPolicyIds = new Set(
  tests.filter((test) => test.policyId && test.status === 'PASS' && test.evidence.includes('decision=DENY'))
    .map((test) => test.policyId),
)
record(
  'every approved policy ID has an executable deny-path check',
  expectedPolicyIds.every((policyId) => deniedPolicyIds.has(policyId)),
  `covered=${deniedPolicyIds.size}; expected=${expectedPolicyIds.length}`,
)

const failed = tests.filter(({ status }) => status === 'FAIL')
const evidence = {
  schemaVersion: 1,
  status: failed.length === 0 ? 'PASS' : 'FAIL',
  startedAt,
  completedAt: new Date().toISOString(),
  repository: {
    sha: runGit(['rev-parse', 'HEAD']),
    branch: runGit(['branch', '--show-current']),
  },
  policy: {
    path: path.relative(repositoryRoot, policyPath).replaceAll('\\', '/'),
    version: policy.policyVersion,
    status: policy.status,
    approvedAt: policy.approvedAt,
    sha256: policySha256(),
  },
  releaseGates: policy.releaseGates,
  legalParameters: policy.legalParameters,
  coverage: {
    expected: expectedPolicyIds.length,
    covered: deniedPolicyIds.size,
    policyIds: expectedPolicyIds,
  },
  assertions: {
    passed: tests.length - failed.length,
    failed: failed.length,
    total: tests.length,
  },
  tests,
}
const paths = writeEvidence(evidence)

console.log(`FAMILY_CORE_POLICY_GATE=${evidence.status}`)
console.log(`POLICY_DENY_PATH_COVERAGE=${evidence.coverage.covered}/${evidence.coverage.expected}`)
console.log(`POLICY_ASSERTIONS=${evidence.assertions.passed}/${evidence.assertions.total}`)
console.log(`EVIDENCE_JSON=${paths.jsonPath}`)
console.log(`EVIDENCE_MD=${paths.markdownPath}`)

if (failed.length > 0) process.exitCode = 1
