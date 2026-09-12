import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual
} from 'node:crypto'
import { AgentEncryptedEnvelope, AgentMessageRole, Report } from '../domain/model'

const ENVELOPE_SCHEMA_VERSION = 1 as const
const ENVELOPE_ALGORITHM = 'A256GCM' as const
const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16
const DIGEST_SALT = Buffer.from('phoenix-family-os:agent-digest:v1', 'utf8')

export interface AgentEnvelopeAad {
  table: 'agent_messages' | 'agent_runs'
  recordId: string
  conversationId: string
  role: AgentMessageRole | 'REQUEST'
  contentVersion: string
}

export interface AgentContentCryptoOptions {
  keyring: Readonly<Record<string, string | Buffer>>
  currentKeyVersion: string
  digestRootKey: string | Buffer
}

function validVersion(value: string): boolean {
  return /^[A-Za-z0-9_.:-]{1,64}$/.test(value)
}

function decodeBase64Key(value: string, label: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error(`${label} must be canonical Base64`)
  }
  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64') !== value || decoded.length !== KEY_BYTES) {
    throw new Error(`${label} must decode to exactly ${KEY_BYTES} bytes`)
  }
  return decoded
}

function keyBytes(value: string | Buffer, label: string): Buffer {
  const decoded = Buffer.isBuffer(value) ? Buffer.from(value) : decodeBase64Key(value, label)
  if (decoded.length !== KEY_BYTES) throw new Error(`${label} must contain exactly ${KEY_BYTES} bytes`)
  return decoded
}

function digestRootBytes(value: string | Buffer): Buffer {
  const result = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value, 'utf8')
  if (result.length < KEY_BYTES) throw new Error('Agent digest root key must contain at least 32 bytes')
  return result
}

function framed(values: readonly string[]): Buffer {
  return Buffer.from(values.map((value) => `${Buffer.byteLength(value, 'utf8')}:${value}`).join('|'), 'utf8')
}

function aadBytes(aad: AgentEnvelopeAad): Buffer {
  if (!aad.recordId || !aad.conversationId || !aad.contentVersion) throw new Error('Agent envelope AAD is incomplete')
  return framed([
    'phoenix-agent-envelope-v1', aad.table, aad.recordId, aad.conversationId, aad.role, aad.contentVersion
  ])
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value !== null && typeof value === 'object') {
    const input = value as Record<string, unknown>
    return Object.fromEntries(Object.keys(input).sort().map((key) => [key, canonicalValue(input[key])]))
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite numbers are not valid canonical JSON')
  return value
}

export function canonicalJson(value: unknown): string {
  const encoded = JSON.stringify(canonicalValue(value))
  if (encoded === undefined) throw new Error('Value is not JSON serializable')
  return encoded
}

export function parseAgentContentKeyring(raw: string): Readonly<Record<string, string>> {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('AI_CONTENT_KEYRING_JSON must be valid JSON')
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('AI_CONTENT_KEYRING_JSON must be a JSON object')
  }
  const result: Record<string, string> = {}
  for (const [version, encoded] of Object.entries(value as Record<string, unknown>)) {
    if (!validVersion(version) || typeof encoded !== 'string') throw new Error('AI content keyring entry is invalid')
    decodeBase64Key(encoded, `AI content key ${version}`)
    result[version] = encoded
  }
  return Object.freeze(result)
}

export class AgentContentCrypto {
  private readonly keys: ReadonlyMap<string, Buffer>
  private readonly currentKeyVersion: string
  private readonly digestRootKey: Buffer

  constructor(options: AgentContentCryptoOptions) {
    if (!validVersion(options.currentKeyVersion)) throw new Error('Current AI content key version is invalid')
    this.keys = new Map(Object.entries(options.keyring).map(([version, value]) => {
      if (!validVersion(version)) throw new Error(`AI content key version is invalid: ${version}`)
      return [version, keyBytes(value, `AI content key ${version}`)] as const
    }))
    if (!this.keys.has(options.currentKeyVersion)) throw new Error('Current AI content key is absent from keyring')
    this.currentKeyVersion = options.currentKeyVersion
    this.digestRootKey = digestRootBytes(options.digestRootKey)
  }

  encryptJson(value: unknown, aad: AgentEnvelopeAad): AgentEncryptedEnvelope {
    const key = this.keys.get(this.currentKeyVersion)
    if (!key) throw new Error('Current AI content key is unavailable')
    const iv = randomBytes(IV_BYTES)
    const authenticatedData = aadBytes(aad)
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES })
    cipher.setAAD(authenticatedData)
    const ciphertext = Buffer.concat([cipher.update(canonicalJson(value), 'utf8'), cipher.final()])
    return {
      schemaVersion: ENVELOPE_SCHEMA_VERSION,
      algorithm: ENVELOPE_ALGORITHM,
      keyVersion: this.currentKeyVersion,
      iv: iv.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      authenticationTag: cipher.getAuthTag().toString('base64'),
      aadDigest: createHash('sha256').update(authenticatedData).digest('base64url')
    }
  }

  decryptJson<T>(envelope: AgentEncryptedEnvelope, aad: AgentEnvelopeAad): T {
    if (envelope.schemaVersion !== ENVELOPE_SCHEMA_VERSION || envelope.algorithm !== ENVELOPE_ALGORITHM) {
      throw new Error('Unsupported AI content envelope')
    }
    const key = this.keys.get(envelope.keyVersion)
    if (!key) throw new Error(`AI content key is unavailable: ${envelope.keyVersion}`)
    const authenticatedData = aadBytes(aad)
    const expectedAadDigest = Buffer.from(createHash('sha256').update(authenticatedData).digest('base64url'), 'utf8')
    const actualAadDigest = Buffer.from(envelope.aadDigest, 'utf8')
    if (expectedAadDigest.length !== actualAadDigest.length || !timingSafeEqual(expectedAadDigest, actualAadDigest)) {
      throw new Error('AI content envelope AAD does not match')
    }
    const iv = Buffer.from(envelope.iv, 'base64')
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64')
    const authenticationTag = Buffer.from(envelope.authenticationTag, 'base64')
    if (iv.length !== IV_BYTES || authenticationTag.length !== TAG_BYTES) throw new Error('AI content envelope is malformed')
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES })
    decipher.setAAD(authenticatedData)
    decipher.setAuthTag(authenticationTag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    return JSON.parse(plaintext) as T
  }

  keyedDigest(purpose: string, value: string | Buffer | unknown): string {
    if (!/^[A-Za-z0-9_.:-]{1,100}$/.test(purpose)) throw new Error('Agent digest purpose is invalid')
    const info = Buffer.from(`phoenix-agent:${purpose}:v1`, 'utf8')
    const purposeKey = Buffer.from(hkdfSync('sha256', this.digestRootKey, DIGEST_SALT, info, KEY_BYTES))
    const payload = Buffer.isBuffer(value)
      ? value
      : Buffer.from(typeof value === 'string' ? value : canonicalJson(value), 'utf8')
    return `v1.${createHmac('sha256', purposeKey).update(payload).digest('base64url')}`
  }
}

export function agentMessageAad(input: {
  messageId: string
  conversationId: string
  role: AgentMessageRole
  contentVersion: string
}): AgentEnvelopeAad {
  return {
    table: 'agent_messages', recordId: input.messageId, conversationId: input.conversationId,
    role: input.role, contentVersion: input.contentVersion
  }
}

export function agentRunRequestAad(input: {
  runId: string
  conversationId: string
  promptVersion: string
}): AgentEnvelopeAad {
  return {
    table: 'agent_runs', recordId: input.runId, conversationId: input.conversationId,
    role: 'REQUEST', contentVersion: input.promptVersion
  }
}

export function agentReportVersion(report: Report): string {
  return [
    report.versions.studentVersion,
    report.versions.ruleVersion,
    report.versions.dataVersion,
    report.versions.promptVersion,
    report.versions.templateVersion,
    report.sourceCatalogVersion
  ].join('|')
}
