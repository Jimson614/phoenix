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

assert.doesNotMatch(authority, /UNIQUE\s*\(family_id,\s*guardian_id,\s*student_id\)\s*[,)]/)
assert.match(authority, /guardian_student_relationships_one_active_idx/)
assert.match(authority, /UNIQUE\s*\(family_id,\s*guardian_id,\s*student_id,\s*valid_from\)/)
assert.match(authority, /scope text NOT NULL/)
assert.match(authority, /'ASKWISE_HANDOFF'/)
assert.match(authority, /document_version text NOT NULL/)
assert.match(authority, /document_hash text NOT NULL/)
assert.match(authority, /CREATE OR REPLACE FUNCTION core\.authorize_student_access/)

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
assert.match(gate, /historical family membership is retained alongside current membership/)
assert.match(gate, /historical guardian relationship is retained alongside current authority/)
assert.match(gate, /AskWise consent withdrawal denies the next adapter decision/)
assert.match(gate, /family A Core RLS cannot switch to family B/)
console.log('FAMILY_CORE_RECONCILIATION_STATIC=PASS')
