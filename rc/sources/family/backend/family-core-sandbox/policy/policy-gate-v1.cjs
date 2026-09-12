'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const policyPath = path.join(__dirname, 'family-core-policy-v1.json')
const expectedPolicyIds = [
  'GUA-001',
  'GUA-002',
  'CON-001',
  'CON-002',
  'CON-003',
  'RET-001',
  'ENT-001',
  'ENT-002',
  'OPS-001',
  'BRK-001',
  'ID-001',
  'XDS-001',
  'XDS-002',
  'DSR-001',
]

function loadPolicy() {
  return JSON.parse(fs.readFileSync(policyPath, 'utf8'))
}

function policySha256() {
  return crypto.createHash('sha256').update(fs.readFileSync(policyPath)).digest('hex')
}

function findDuplicates(values) {
  return values.filter((value, index) => values.indexOf(value) !== index)
}

function validateBaseline(policy) {
  const problems = []
  const policyIds = Array.isArray(policy.policies) ? policy.policies.map(({ id }) => id) : []
  const sortedIds = [...policyIds].sort()
  const sortedExpected = [...expectedPolicyIds].sort()

  if (policy.schemaVersion !== 1) problems.push('SCHEMA_VERSION_NOT_1')
  if (policy.policyVersion !== 'FAMILY_CORE_POLICY_V1') problems.push('POLICY_VERSION_MISMATCH')
  if (policy.status !== 'FOUNDER_APPROVED') problems.push('POLICY_NOT_FOUNDER_APPROVED')
  if (policy.defaultDecision !== 'DENY') problems.push('DEFAULT_NOT_DENY')
  if (JSON.stringify(sortedIds) !== JSON.stringify(sortedExpected)) problems.push('POLICY_ID_SET_MISMATCH')
  if (findDuplicates(policyIds).length > 0) problems.push('DUPLICATE_POLICY_ID')

  const expectedReleaseGates = {
    production: 'NO_GO',
    realData: 'NO_GO',
    publicIndexing: 'NO_GO',
    databaseMigration: 'NO_GO',
    healthPullRequests12And13: 'HOLD',
  }
  for (const [gate, expected] of Object.entries(expectedReleaseGates)) {
    if (policy.releaseGates?.[gate] !== expected) problems.push(`RELEASE_GATE_${gate.toUpperCase()}_MISMATCH`)
  }

  if (policy.legalParameters?.status !== 'PENDING') problems.push('LEGAL_PARAMETERS_NOT_PENDING')
  if (!Array.isArray(policy.legalParameters?.required) || policy.legalParameters.required.length === 0) {
    problems.push('LEGAL_PARAMETER_LIST_EMPTY')
  }
  if (policy.crossDomain?.directDatabaseAccess !== false) problems.push('DIRECT_DATABASE_ACCESS_NOT_DENIED')
  if (policy.crossDomain?.inboundToCore?.directMutation !== false) problems.push('DIRECT_CORE_MUTATION_NOT_DENIED')

  const allowedConsumers = Object.keys(policy.crossDomain?.consumers || {}).sort()
  if (JSON.stringify(allowedConsumers) !== JSON.stringify(['EDUCATION', 'IDENTITY', 'WEALTH'])) {
    problems.push('CROSS_DOMAIN_CONSUMER_SET_MISMATCH')
  }
  const health = policy.crossDomain?.health
  if (health?.status !== 'HOLD') problems.push('HEALTH_NOT_HOLD')
  for (const collection of ['allowedFields', 'allowedRoutes', 'allowedEntitlements', 'allowedUi']) {
    if (!Array.isArray(health?.[collection]) || health[collection].length !== 0) {
      problems.push(`HEALTH_${collection.toUpperCase()}_NOT_EMPTY`)
    }
  }

  const prohibited = new Set([
    'name',
    'phone',
    'email',
    'address',
    'raw_identity_evidence',
    'raw_assessment_content',
    'health_data',
    'payment_details',
    'secrets',
  ])
  const fieldLists = [
    ...Object.values(policy.crossDomain?.consumers || {}).map(({ allowedFields }) => allowedFields),
    policy.crossDomain?.inboundToCore?.allowedFields,
  ]
  for (const fields of fieldLists) {
    if (!Array.isArray(fields) || fields.length === 0) {
      problems.push('ALLOWLIST_EMPTY_OR_INVALID')
      continue
    }
    if (findDuplicates(fields).length > 0) problems.push('DUPLICATE_ALLOWLIST_FIELD')
    if (fields.some((field) => prohibited.has(field))) problems.push('PROHIBITED_ALLOWLIST_FIELD')
  }

  return problems
}

function decision(policyId, allowed, code) {
  return { policyId, allowed, decision: allowed ? 'ALLOW' : 'DENY', code }
}

function evaluatePolicy(policy, policyId, facts = {}) {
  if (!expectedPolicyIds.includes(policyId)) return decision(policyId, false, 'UNKNOWN_POLICY_ID')

  switch (policyId) {
    case 'GUA-001': {
      const allowed = facts.verifiedAccount === true
        && facts.evidenceOnApprovedAllowlist === true
        && facts.manualApprovalRecorded === true
        && facts.authorizedReviewer === true
      return decision(policyId, allowed, allowed ? 'GUARDIAN_AUTHORITY_VERIFIED' : 'GUARDIAN_AUTHORITY_REVIEW_REQUIRED')
    }
    case 'GUA-002': {
      const allowed = facts.explicitRelationship === true
        && facts.scopeAndDatesRecorded === true
        && facts.disputed !== true
        && (facts.highRiskAction !== true
          || (facts.allApplicableAuthorityRulesSatisfied === true && facts.secondReviewer === true))
      return decision(policyId, allowed, allowed ? 'GUARDIAN_ACTION_AUTHORIZED' : 'GUARDIAN_ACTION_SUSPENDED')
    }
    case 'CON-001': {
      const allowed = facts.activeReceipt === true
        && facts.immutableReceipt === true
        && facts.purposeMatches === true
        && facts.destinationMatches === true
        && facts.policyVersionMatches === true
        && facts.localeRecorded === true
        && facts.actorRecorded === true
        && facts.bundledOrInferred !== true
      return decision(policyId, allowed, allowed ? 'CONSENT_MATCHED' : 'CONSENT_REQUIRED')
    }
    case 'CON-002': {
      const resolved = facts.jurisdictionKnown === true
        && facts.ageKnown === true
        && facts.capacityResolved === true
        && facts.conflictingEvidence !== true
      const conservativeMinor = facts.processingLevel === 'MINOR_BASELINE'
        && facts.guardianConsentIfRequired === true
        && facts.subjectAssentIfRequired === true
      const allowed = resolved || conservativeMinor
      return decision(policyId, allowed, allowed ? 'CAPACITY_PATH_RESOLVED' : 'CAPACITY_QUARANTINE')
    }
    case 'CON-003': {
      const allowed = facts.withdrawn !== true
        && facts.activeReceipt === true
        && facts.cachedAuthorityValid === true
      return decision(policyId, allowed, allowed ? 'CONSENT_ACTIVE' : 'CONSENT_WITHDRAWN_OR_STALE')
    }
    case 'RET-001': {
      const syntheticEvidence = facts.syntheticNonPersonal === true && facts.realData !== true
      const realDataApproved = policy.releaseGates.realData === 'GO'
        && facts.legalScheduleApproved === true
        && facts.dataClassScheduled === true
      const allowed = syntheticEvidence || realDataApproved
      return decision(policyId, allowed, allowed ? 'RETENTION_SCOPE_ALLOWED' : 'RETENTION_POLICY_HOLD')
    }
    case 'ENT-001': {
      const allowed = facts.authority === 'FAMILY_CORE_LEDGER'
        && facts.status === 'ACTIVE'
        && facts.withinEffectiveInterval === true
        && facts.stale !== true
        && facts.conflicting !== true
      return decision(policyId, allowed, allowed ? 'ENTITLEMENT_ACTIVE' : 'ENTITLEMENT_REQUIRED')
    }
    case 'ENT-002': {
      const allowed = typeof facts.selectedFamilyId === 'string'
        && facts.selectedFamilyId.length > 0
        && facts.selectedFamilyId === facts.activeMembershipFamilyId
        && facts.serverRevalidated === true
        && facts.automaticInheritance !== true
        && facts.crossFamilyQuery !== true
      return decision(policyId, allowed, allowed ? 'FAMILY_CONTEXT_ACTIVE' : 'FAMILY_CONTEXT_DENIED')
    }
    case 'OPS-001': {
      const allowed = facts.leastPrivilegeRole === true
        && facts.explicitAssignment === true
        && facts.purposeCodeRecorded === true
        && facts.withinTimeWindow === true
        && facts.immutableAuditEnabled === true
        && facts.globalBrowse !== true
      return decision(policyId, allowed, allowed ? 'OPERATOR_ASSIGNMENT_ACTIVE' : 'OPERATOR_ACCESS_DENIED')
    }
    case 'BRK-001':
      return decision(policyId, false, 'BREAK_GLASS_DISABLED')
    case 'ID-001': {
      const weakSignals = facts.matchBasis === 'NAME_PHONE_EMAIL_ADDRESS_DEVICE_OR_PAYMENT'
      const allowed = facts.autoMerge !== true
        && weakSignals !== true
        && facts.verifiedControlOrEvidence === true
        && facts.secondReviewer === true
        && facts.immutableDecisionRecord === true
        && facts.reversibleSplitTested === true
      return decision(policyId, allowed, allowed ? 'IDENTITY_REVIEW_APPROVED' : 'IDENTITY_CONFLICT_QUARANTINED')
    }
    case 'XDS-001': {
      if (facts.producer === 'HEALTH' || facts.consumer === 'HEALTH') {
        return decision(policyId, false, 'HEALTH_SCOPE_EXCLUDED')
      }
      const consumer = policy.crossDomain.consumers[facts.consumer]
      const requestedFields = Array.isArray(facts.fields) ? facts.fields : []
      const listedFields = consumer?.allowedFields || []
      const fieldsAllowed = requestedFields.length > 0
        && requestedFields.every((field) => listedFields.includes(field))
      const allowed = Boolean(consumer)
        && policy.crossDomain.allowedTransports.includes(facts.transport)
        && facts.directDatabaseAccess !== true
        && fieldsAllowed
        && facts.activePurposeSpecificConsent === true
        && facts.approvedPurposeCode === true
        && (facts.entitlementRequired !== true || facts.activeEntitlement === true)
        && facts.idempotencyKeyPresent === true
        && facts.auditCorrelationPresent === true
      return decision(policyId, allowed, allowed ? 'CROSS_DOMAIN_MINIMUM_ALLOWED' : 'CROSS_DOMAIN_DENIED')
    }
    case 'XDS-002':
      return decision(policyId, false, 'HEALTH_SCOPE_HOLD')
    case 'DSR-001': {
      const allowed = policy.legalParameters.status === 'APPROVED'
        && facts.requesterIdentityVerified === true
        && facts.requesterAuthorityVerified === true
        && facts.scopeUnambiguous === true
        && facts.crossFamilyExpansion !== true
        && facts.encryptedDelivery === true
        && facts.expiringDelivery === true
        && facts.provenanceRecorded === true
        && facts.accessAudited === true
      return decision(policyId, allowed, allowed ? 'EXPORT_AUTHORIZED' : 'EXPORT_POLICY_HOLD')
    }
    default:
      return decision(policyId, false, 'UNKNOWN_POLICY_ID')
  }
}

module.exports = {
  evaluatePolicy,
  expectedPolicyIds,
  loadPolicy,
  policyPath,
  policySha256,
  validateBaseline,
}
