import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import test from 'node:test'
import { unzipSync } from 'fflate'
import { contentDigest, ExportReport, renderMastersPdf, renderMastersXlsx } from '../src/masters/exports'

const syntheticReport: ExportReport = {
  id: 'rpt-export-synthetic-1',
  version: 7,
  profileVersion: 3,
  content: {
    backgroundSummary: '合成背景摘要：仅用于导出验证。',
    strengthsAndGaps: {
      strengths: ['合成英文能力证据'],
      gaps: ['合成成绩单待补充']
    },
    suggestedDirections: ['人工智能与数据科学'],
    candidatePrograms: [{
      institution: '香港合成大学',
      program: '计算机科学理学硕士',
      intakeYear: '2027',
      requirements: '合成申请要求',
      matchReason: '合成匹配理由',
      risks: ['合成风险：需人工核验'],
      officialUrl: 'https://example.invalid/synthetic-program',
      verifiedAt: '2026-09-05',
      sourceStatus: 'VERIFIED',
      studentAccepted: 'PENDING'
    }],
    preparationPlan: ['补齐合成成绩单', '核对合成语言成绩'],
    nextStepsAndLimitations: ['最终结果以官方要求和人工核验为准。']
  }
}

const pdfFontPath = process.env.MASTERS_TEST_PDF_FONT_PATH || 'C:\\Windows\\Fonts\\simhei.ttf'

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function unpackWorksheet(xlsx: Buffer): { names: string[]; xml: string; rows: string[][] } {
  const files = unzipSync(xlsx)
  const names = Object.keys(files).sort()
  const worksheet = files['xl/worksheets/sheet1.xml']
  assert.ok(worksheet, 'XLSX must contain the worksheet part')
  const xml = Buffer.from(worksheet).toString('utf8')
  const rows = [...xml.matchAll(/<row r="\d+">([\s\S]*?)<\/row>/g)].map((row) =>
    [...(row[1] ?? '').matchAll(/<c r="[A-Z]+\d+" t="inlineStr"><is><t xml:space="preserve">([\s\S]*?)<\/t><\/is><\/c>/g)]
      .map((cell) => decodeXml(cell[1] ?? ''))
  )
  return { names, xml, rows }
}

async function extractPdfText(bytes: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loading = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    disableFontFace: true,
    stopAtErrors: true,
    verbosity: 0,
    useWorkerFetch: false
  })
  try {
    const pdf = await loading.promise
    const pages: string[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      pages.push(content.items.map((item) => 'str' in item ? item.str : '').join(''))
      page.cleanup()
    }
    return pages.join('\n')
  } finally {
    await loading.destroy()
  }
}

test('XLSX export is a real unpackable workbook with inline strings and formula-injection resistance', () => {
  const formulaReport: ExportReport = {
    ...syntheticReport,
    id: 'rpt-export-formula-synthetic',
    content: {
      ...syntheticReport.content,
      candidatePrograms: [{
        institution: '=HYPERLINK("https://evil.invalid","open")',
        program: '+SUM(1,2)',
        intakeYear: '-1+2',
        requirements: '@malicious-command',
        matchReason: '<script>alert(1)</script>',
        risks: ['=CMD|\' /C calc\'!A0'],
        officialUrl: 'javascript:alert(1)',
        verifiedAt: '2026-09-05',
        sourceStatus: 'NEEDS_REVIEW',
        studentAccepted: 'PENDING'
      }]
    }
  }
  const xlsx = renderMastersXlsx(formulaReport)
  assert.ok(xlsx.subarray(0, 2).equals(Buffer.from('PK')), 'XLSX must be a ZIP package')
  const unpacked = unpackWorksheet(xlsx)
  assert.deepEqual(unpacked.names, [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/_rels/workbook.xml.rels',
    'xl/workbook.xml',
    'xl/worksheets/sheet1.xml'
  ])
  assert.equal(unpacked.rows[0]?.[0], 'Application Compass · 初评／待补报告')
  assert.deepEqual(unpacked.rows[1]?.slice(0, 5), [
    'report_id', formulaReport.id, 'report_version', '7', 'profile_version'
  ])
  assert.equal(unpacked.rows[2]?.[0], 'content_sha256')
  assert.equal(unpacked.rows[2]?.[1], contentDigest(formulaReport))
  const candidate = unpacked.rows.find(row => row[0] === '=HYPERLINK("https://evil.invalid","open")')
  assert.ok(candidate)
  assert.deepEqual(candidate.slice(0, 5), ['=HYPERLINK("https://evil.invalid","open")', '+SUM(1,2)', '-1+2', '@malicious-command', '<script>alert(1)</script>'])
  assert.match(unpacked.xml, /t="inlineStr"/)
  assert.doesNotMatch(unpacked.xml, /<f(?:\s|>)/i)
  assert.doesNotMatch(unpacked.xml, /<v(?:\s|>)/i)
  assert.doesNotMatch(unpacked.xml, /<hyperlink(?:\s|>)/i)
  assert.match(unpacked.xml, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(unpacked.xml, /javascript:alert\(1\)/)
})

test('PDF export embeds all six governed structures with report/profile versions and content digest', {
  skip: !existsSync(pdfFontPath) ? `test font unavailable: ${pdfFontPath}` : false
}, async () => {
  const digest = contentDigest(syntheticReport)
  const pdf = await renderMastersPdf(syntheticReport, pdfFontPath)
  assert.ok(pdf.subarray(0, 5).toString('ascii') === '%PDF-', 'export must be a PDF')
  const text = await extractPdfText(pdf)
  for (const expected of [
    'Application Compass',
    '初评／待补报告',
    '自动选校尚未实现',
    '背景摘要',
    '合成背景摘要：仅用于导出验证。',
    '优势与资料缺口',
    '合成英文能力证据',
    '合成成绩单待补充',
    '建议申请方向',
    '人工智能与数据科学',
    '候选学校专业表',
    '香港合成大学',
    '计算机科学理学硕士',
    '准备计划',
    '补齐合成成绩单',
    '下一步与限制说明',
    '最终结果以官方要求和人工核验为准。',
    `报告 ${syntheticReport.id} · 版本 ${syntheticReport.version} · 资料版本 ${syntheticReport.profileVersion}`,
    `内容校验 SHA-256: ${digest}`
  ]) assert.ok(text.includes(expected), `PDF text should contain ${expected}`)
})
