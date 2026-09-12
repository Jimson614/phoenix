'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const identity = read('migrations/0010_core_identity_family.up.sql')
const authority = read('migrations/0020_core_authority_mapping_audit.up.sql')
const rls = read('migrations/0030_family_domain_rls_adapter.up.sql')
const fixture = read('fixtures/001_two_synthetic_families.sql')
const gate = read('scripts/run-gate.cjs')

assert.doesNotMatch(identity, /UNIQUE\s*\(family_id,\s*member_pk\)\s*[,)]/)
assert.match(identity, /family_memberships_one_active_idx/)
assert.match(identity, /UNIQUE\s*\(family_id,\s*member_pk,\s*valid_from\)/)
assert.match(identity, /CREATE TABLE core\.student_family_memberships/)
assert.match(identity, /student_family_memberships_one_active_idx/)
assert.match(
  identity,
  /FOREIGN KEY \(user_id, member_pk\)\s+REFERENCES core\.users\(user_id, member_pk\)/,
)

assert.doesNotMatch(authority, /UNIQUE\s*\(family_id,\s*guardian_id,\s*student_id\)\s*[,)]/)
assert.match(authority, /guardian_student_relationships_one_active_idx/)
assert.match(authority, /UNIQUE\s*\(family_id,\s*guardian_id,\s*student_id,\s*valid_from\)/)
assert.match(authority, /scope text NOT NULL/)
assert.match(authority, /'ASKWISE_HANDOFF'/)
assert.match(authority, /document_version text NOT NULL/)
assert.match(authority, /document_hash text NOT NULL/)
assert.match(authority, /CREATE OR REPLACE FUNCTION core\.authorize_student_access/)
assert.match(
  authority,
  /FUNCTION core\.has_active_consent\([\s\S]*?p_scope text,[\s\S]*?p_purpose_code text,[\s\S]*?p_actor_user_id text/,
)
assert.match(authority, /c\.scope = p_scope/)
assert.match(authority, /c\.purpose_code = p_purpose_code/)
assert.match(authority, /c\.granted_by_user_id = p_actor_user_id/)
assert.match(authority, /m\.source_system = 'ASKWISE_SQLITE'/)
assert.match(authority, /se\.service_code = 'ASKWISE'/)
assert.match(authority, /INSERT INTO audit\.audit_logs/)
assert.match(authority, /'ASKWISE_STUDENT_ACCESS_DECISION'/)
assert.match(authority, /'ASKWISE_ADAPTER'/)

for (const table of [
  'members',
  'families',
  'family_memberships',
  'students',
  'student_family_memberships',
  'guardians',
  'guardian_student_relationships',
  'consents',
  'consent_events',
]) {
  assert.match(rls, new RegExp(`ALTER TABLE core\\.${table} ENABLE ROW LEVEL SECURITY`))
  assert.match(rls, new RegExp(`ALTER TABLE core\\.${table} FORCE ROW LEVEL SECURITY`))
}

assert.match(fixture, /ASKWISE_HANDOFF/)
assert.match(fixture, /SYNTHETIC_ASKWISE_HANDOFF_V1/)
assert.match(fixture, /'ASKWISE_SQLITE'/)
assert.match(fixture, /'ASKWISE', 'ACTIVE'/)
assert.match(rls, /guardian_relationships_self_select[\s\S]*?core\.has_active_family_membership/)
assert.match(rls, /role_assignments_self_select[\s\S]*?scope_id = core\.current_family_id\(\)/)
assert.match(rls, /role_assignments_self_select[\s\S]*?core\.has_active_family_membership/)
assert.match(gate, /historical family membership is retained alongside current membership/)
assert.match(gate, /historical guardian relationship is retained alongside current authority/)
assert.match(gate, /AskWise consent withdrawal denies the next adapter decision/)
assert.match(gate, /family A Core RLS cannot switch to family B/)
assert.match(gate, /Consent requires exact AskWise scope and purpose/)
assert.match(gate, /AskWise missing entitlement is denied and audited/)
assert.match(gate, /AskWise active mapping and entitlement allow is audited/)
assert.match(gate, /AskWise source mapping is required and denial is audited/)
assert.match(gate, /role assignment RLS excludes cross-family assignment/)
console.log('FAMILY_CORE_RECONCILIATION_STATIC=PASS')
