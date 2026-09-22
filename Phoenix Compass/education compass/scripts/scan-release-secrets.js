'use strict'

const { spawnSync } = require('node:child_process')
const { readdir, readFile, stat } = require('node:fs/promises')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const ignoredDirectories = new Set([
  '.git', '.npm-cache', 'node_modules', 'dist', 'coverage', 'outputs'
])
const ignoredExtensions = new Set([
  '.docx', '.gif', '.ico', '.jpeg', '.jpg', '.pdf', '.png', '.webp', '.zip'
])
const maxFileBytes = 2 * 1024 * 1024
const literalRules = [
  { id: 'private-key-block', pattern: /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/ },
  { id: 'openai-api-key', pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/ },
  { id: 'github-token', pattern: /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/ },
  { id: 'aws-access-key', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ }
]
const sensitiveEnvKeys = new Set([
  'AI_CONTENT_ENCRYPTION_KEY',
  'AI_CONTENT_KEYRING_JSON',
  'DATABASE_URL',
  'FEISHU_APP_SECRET',
  'FEISHU_BITABLE_APP_TOKEN',
  'FEISHU_PSEUDONYM_KEY',
  'OPENAI_API_KEY',
  'OPENAI_SAFETY_HMAC_KEY',
  'SESSION_SECRET',
  'WECHAT_APP_SECRET',
  'WECHATPAY_API_V3_KEY',
  'WECHAT_PAY_API_V3_KEY'
])

function looksLikePlaceholder(value) {
  const normalized = value.trim().replace(/^['"]|['"]$/g, '')
  if (!normalized) return true
  return /^(?:\{\}|\[\]|mock|placeholder|test|x{4,}|<[^>]+>|\$\{[^}]+\}|(?:change[-_ ]?me|replace|your[-_ ])[\w .:/-]*)$/i.test(normalized)
}

async function files(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) result.push(...await files(absolute))
      continue
    }
    if (!entry.isFile() || ignoredExtensions.has(path.extname(entry.name).toLowerCase())) continue
    const metadata = await stat(absolute)
    if (metadata.size <= maxFileBytes) result.push(absolute)
  }
  return result
}

/**
 * git 忽略的文件既不会提交，也不会进 dist 产物，所以不属于发布面。
 * 扫描它们只会让本机和服务器上真实的 .env 卡住门禁，掩盖真正的问题。
 * git 不可用时返回空集合，宁可多扫也不漏扫。
 */
function gitIgnored(absolutePaths) {
  if (absolutePaths.length === 0) return new Set()
  const relatives = absolutePaths.map((absolute) => path.relative(root, absolute).replaceAll('\\', '/'))
  const result = spawnSync('git', ['-C', root, 'check-ignore', '--stdin', '-z'], {
    input: `${relatives.join('\0')}\0`,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
  // 退出码 0 = 有忽略项，1 = 没有，其他（含 git 缺失）视为无法判断
  if (result.error || result.status === null || result.status > 1) return new Set()
  const ignored = new Set()
  for (const relative of result.stdout.split('\0')) {
    if (relative) ignored.add(path.resolve(root, relative))
  }
  return ignored
}

async function main() {
  const findings = []
  const candidates = await files(root)
  const ignored = gitIgnored(candidates)
  for (const absolute of candidates) {
    if (ignored.has(absolute)) continue
    let content
    try {
      content = await readFile(absolute, 'utf8')
    } catch {
      continue
    }
    const relative = path.relative(root, absolute).replaceAll('\\', '/')
    for (const rule of literalRules) {
      if (rule.pattern.test(content)) findings.push({ file: relative, rule: rule.id })
    }
    if (/^\.env(?:\.|$)/.test(path.basename(absolute))) {
      for (const line of content.split(/\r?\n/)) {
        const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
        if (!match || !sensitiveEnvKeys.has(match[1]) || looksLikePlaceholder(match[2])) continue
        findings.push({ file: relative, rule: `non-placeholder-${match[1].toLowerCase()}` })
      }
    }
  }

  if (findings.length) {
    process.stderr.write(`${JSON.stringify({ status: 'FAIL', findings }, null, 2)}\n`)
    process.exitCode = 1
    return
  }
  process.stdout.write(`${JSON.stringify({ status: 'PASS', scannedRoot: '.', findings: 0 })}\n`)
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`Release secret scan failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}

module.exports = { gitIgnored, looksLikePlaceholder, main, sensitiveEnvKeys }
