'use strict'

/**
 * 从仓库根目录的 .env.feishu-v05 读取飞书凭据。
 *
 * 这个文件被 .gitignore 的 .env.* 规则排除，不会进仓库。
 * 已经设在环境变量里的值优先，文件只补没设的那些，
 * 所以 PowerShell 里 $env: 设过的照常生效。
 *
 * 格式就是最朴素的 KEY=VALUE，# 开头是注释：
 *   FEISHU_APP_ID=cli_xxxxxxxx
 *   FEISHU_APP_SECRET=xxxxxxxx
 *   FEISHU_V05_BITABLE_APP_TOKEN=<FEISHU_V05_BITABLE_APP_TOKEN>
 */

const fs = require('node:fs')
const path = require('node:path')

const ENV_FILENAME = '.env.feishu-v05'

/** 从工具目录往上找，直到找到凭据文件或走到盘根 */
function locate(startDir) {
  let dir = startDir
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(dir, ENV_FILENAME)
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

function parse(text) {
  const values = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key) values[key] = value
  }
  return values
}

/** 返回这次从文件补进来的 key（只回 key，不回值） */
function loadEnvFile({ cwd = process.cwd() } = {}) {
  const file = locate(cwd) || locate(__dirname)
  if (!file) return { file: null, loaded: [] }

  const loaded = []
  for (const [key, value] of Object.entries(parse(fs.readFileSync(file, 'utf8')))) {
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value
      loaded.push(key)
    }
  }
  return { file, loaded }
}

module.exports = { loadEnvFile, ENV_FILENAME }
