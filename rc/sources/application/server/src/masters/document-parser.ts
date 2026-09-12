// Child process only. Document bytes are untrusted data; no macro/script/tool execution.
import { unzipSync } from 'fflate'
import { PNG } from 'pngjs'
import jpeg from 'jpeg-js'

const MAX_EXPANDED = 20 * 1024 * 1024
const MAX_TEXT = 80_000
type Piece = { text: string; location: string }

function decodeXml(value: string): string {
  return value.replace(/&#(x[0-9a-f]+|\d+);|&(amp|lt|gt|quot|apos);/gi, (_match, numeric: string | undefined, named: string | undefined) => {
    if (numeric) {
      const n = numeric[0]?.toLowerCase() === 'x' ? parseInt(numeric.slice(1), 16) : parseInt(numeric, 10)
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[named?.toLowerCase() ?? ''] ?? ''
  })
}

function docx(bytes: Buffer): Piece[] {
  let total = 0
  let count = 0
  let contentTypes = false
  const files = unzipSync(bytes, { filter(file) {
    count++
    total += file.originalSize
    if (count > 200 || total > MAX_EXPANDED || file.originalSize > MAX_EXPANDED || /(^|\/)\.\.(\/|$)|\\|vbaProject|embeddings\/|\.exe$|\.js$/i.test(file.name)) throw new Error('INVALID_CONTAINER')
    if (file.name === '[Content_Types].xml') contentTypes = true
    return file.name === '[Content_Types].xml' || file.name === 'word/document.xml'
  } })
  if (!contentTypes || !files['word/document.xml']) throw new Error('INVALID_DOCX')
  const types = Buffer.from(files['[Content_Types].xml'] ?? []).toString('utf8')
  if (!types.includes('wordprocessingml.document.main+xml') || /macroEnabled|vbaProject/i.test(types)) throw new Error('INVALID_DOCX')
  const xml = Buffer.from(files['word/document.xml']).toString('utf8')
  if (/<!DOCTYPE|<!ENTITY|<w:altChunk/i.test(xml)) throw new Error('INVALID_XML')
  const paragraphs = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? []
  const pieces = paragraphs.slice(0, 2000).map((p, i) => ({
    text: [...p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m => decodeXml(m[1] ?? '')).join(''),
    location: `paragraph:${i + 1}`
  }))
  if (pieces.reduce((n, p) => n + p.text.length, 0) > MAX_TEXT) throw new Error('TEXT_LIMIT')
  return pieces
}

function extract(pieces: Piece[]) {
  // Only explicit labelled facts; ambiguous prose stays for manual verification.
  const labels: Array<[string, RegExp]> = [
    ['name', /^(?:姓名|称呼|Name)\s*[:：]\s*(.{1,80})$/i],
    ['institution', /^(?:本科院校|毕业院校|院校|University|Institution)\s*[:：]\s*(.{1,160})$/i],
    ['major', /^(?:本科专业|专业|Major)\s*[:：]\s*(.{1,160})$/i],
    ['degree', /^(?:学位名称|学位|Degree)\s*[:：]\s*(.{1,160})$/i],
    ['averageScore', /^(?:百分制均分|均分|Average)\s*[:：]\s*(.{1,40})$/i],
    ['gpa', /^GPA\s*[:：]\s*([^/\n]{1,40})(?:\s*\/\s*[^\n]+)?$/i],
    ['gpaScale', /^(?:GPA满分|GPA Scale)\s*[:：]\s*(.{1,40})$/i],
    ['graduationDate', /^(?:毕业年月|预计毕业年月|Graduation Date)\s*[:：]\s*(\d{4}-\d{2})$/i]
  ]
  const fields = []
  for (const piece of pieces) for (const line of piece.text.split(/[\r\n]+/)) for (const [field, re] of labels) {
    const match = line.trim().match(re)
    if (match?.[1]) fields.push({ field, value: match[1].trim(), location: piece.location, snippet: line.trim().slice(0, 220), confidence: 'NEEDS_CONFIRMATION' })
  }
  for (const piece of pieces) for (const line of piece.text.split(/[\r\n]+/)) {
    const explicitScale = line.trim().match(/^GPA\s*[:：]\s*[^/\n]+\s*\/\s*([^\n]{1,40})$/i)
    if (explicitScale?.[1]) fields.push({ field: 'gpaScale', value: explicitScale[1].trim(), location: piece.location, snippet: line.trim().slice(0, 220), confidence: 'NEEDS_CONFIRMATION' })
  }
  return fields.slice(0, 150)
}

async function parse(bytes: Buffer, mime: string) {
  let pieces: Piece[] = []
  if (mime === 'image/png') {
    if (bytes.length < 24 || bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > 8_000_000) throw new Error('INVALID_IMAGE')
    PNG.sync.read(bytes, { checkCRC: true })
  } else if (mime === 'image/jpeg') {
    jpeg.decode(bytes, { maxResolutionInMP: 8, maxMemoryUsageInMB: 64, tolerantDecoding: false })
  } else if (mime.includes('wordprocessingml')) {
    pieces = docx(bytes)
  } else {
    // Preserve native import in CommonJS output; PDF.js is ESM.
    const pdfjs = await (new Function('return import("pdfjs-dist/legacy/build/pdf.mjs")')() as Promise<any>)
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, stopAtErrors: true, verbosity: 0, useWorkerFetch: false })
    try {
      const pdf = await task.promise
      if (pdf.numPages > 40) return { status: 'MANUAL_REVIEW', fields: [], errorCode: 'PAGE_LIMIT' }
      let textSize = 0
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p)
        const content = await page.getTextContent()
        let line = ''
        for (const item of content.items) {
          if (!('str' in item)) continue
          line += item.str
          if (item.hasEOL) { pieces.push({ text: line, location: `page:${p}` }); line = '' }
        }
        if (line) pieces.push({ text: line, location: `page:${p}` })
        textSize += pieces.filter(x => x.location === `page:${p}`).reduce((sum, x) => sum + x.text.length, 0)
        if (textSize > MAX_TEXT) return { status: 'MANUAL_REVIEW', fields: [], errorCode: 'TEXT_LIMIT' }
        page.cleanup()
      }
    } finally { await task.destroy() }
  }
  const fields = extract(pieces)
  return { status: fields.length ? 'NEEDS_CONFIRMATION' : 'MANUAL_REVIEW', fields, errorCode: fields.length ? null : 'MANUAL_VERIFICATION_REQUIRED' }
}

async function main() {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of process.stdin) {
    length += (chunk as Buffer).length
    if (length > 10 * 1024 * 1024) throw new Error('INPUT_LIMIT')
    chunks.push(chunk as Buffer)
  }
  const mime = process.argv[2] ?? ''
  // Suppress parser diagnostics so neither document text nor internal details reach logs.
  console.log = () => undefined
  console.warn = () => undefined
  try { process.stdout.write(JSON.stringify(await parse(Buffer.concat(chunks), mime))) }
  catch {
    // PDFs can be password protected/scanned/malformed: retain the original for authorized manual review.
    process.stdout.write(JSON.stringify(mime === 'application/pdf'
      ? { status: 'FAILED', fields: [], errorCode: 'PARSER_FAILED' }
      : { invalid: true, status: 'FAILED', fields: [], errorCode: 'INVALID_DOCUMENT' }))
  }
}
void main().catch(() => { process.exitCode = 1 })
