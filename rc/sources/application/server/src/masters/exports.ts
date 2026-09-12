import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { access } from 'node:fs/promises'
import PDFDocument from 'pdfkit'
import { zipSync, strToU8 } from 'fflate'
import { invariant } from '../domain/errors'
import type { ReportAssistance } from './report-assistance'

export interface ExportReport {
  id: string
  version: number
  profileVersion: number
  content: Record<string, unknown>
  assistance?: ReportAssistance
}

export function contentDigest(report: ExportReport): string {
  return createHash('sha256').update(JSON.stringify(report.content)).digest('hex')
}

const displayLabels: Record<string, string> = {
  institution: '院校', program: '正式项目名称', intakeYear: '入学年份', requirements: '申请要求', matchReason: '顾问匹配理由', risks: '风险', officialUrl: '官网来源', verifiedAt: '核验日期', sourceStatus: '来源状态', studentAccepted: '学生接受情况', strengths: '优势', gaps: '资料缺口',
  UNDECIDED: '尚未确定，希望顾问建议', VERIFIED: '顾问已核验', NEEDS_REVIEW: '待核验', PENDING: '待确认', ACCEPTED: '已接受', DECLINED: '未接受',
  name: '姓名／称呼', adultConfirmed: '成年确认', contact: '联系方式', educationStatus: '学籍状态', degree: '学位名称', major: '本科专业', graduationDate: '毕业年月', academicScore: '学业成绩', gpaScale: 'GPA 满分制', languageScores: '语言成绩', targetYear: '入学年份',
  TRANSCRIPT: '本科成绩单', ENROLLMENT: '在读证明', GRADUATION: '毕业证书', DEGREE: '学位证书', LANGUAGE: '语言成绩证明', RESUME: '个人简历', SUPPLEMENTAL: '补充证明'
}
function plain(value: unknown): string {
  if (value === null || value === undefined) return '待核验'
  if (Array.isArray(value)) return value.length ? value.map(plain).join('\n') : '暂无已核验内容'
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${displayLabels[key] ?? key}: ${plain(item)}`).join('\n')
  return displayLabels[String(value)] ?? String(value)
}

/** Full approved content, embedded Unicode font and explicit immutable version identifiers. */
export async function renderMastersPdf(report: ExportReport, fontPath: string): Promise<Buffer> {
  invariant(fontPath && isAbsolute(fontPath), 503, 'PDF_FONT_REQUIRED', '报告 PDF 需要配置获授权的中文字体')
  try { await access(fontPath) } catch { invariant(false, 503, 'PDF_FONT_REQUIRED', '报告 PDF 字体暂不可用') }
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: {
      Title: 'Application Compass · ' + (report.assistance?.label ?? '初评／待补报告'), Author: 'Phoenix Nova',
      Subject: `report=${report.id}; version=${report.version}; profile=${report.profileVersion}; sha256=${contentDigest(report)}`
    } })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('error', reject)
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.font(fontPath).fontSize(19).fillColor('#173C36').text('Application Compass')
    doc.fontSize(15).text(report.assistance?.label ?? '初评／待补报告').moveDown()
    doc.fontSize(10).text(report.assistance?.explanation ?? '规则草稿与人工核验辅助；自动选校尚未实现。').moveDown()
    for (const limitation of report.assistance?.limitations ?? []) doc.text(limitation).moveDown(0.2)
    doc.fontSize(9).fillColor('#444444').text(`报告 ${report.id} · 版本 ${report.version} · 资料版本 ${report.profileVersion}`).moveDown()
    const labels: Record<string, string> = {
      backgroundSummary: '背景摘要', strengthsAndGaps: '优势与资料缺口', suggestedDirections: '建议申请方向',
      candidatePrograms: '候选学校专业表', preparationPlan: '准备计划', nextStepsAndLimitations: '下一步与限制说明'
    }
    for (const [key, label] of Object.entries(labels)) {
      const value = report.content[key]
      if (doc.y > 710) doc.addPage()
      doc.fillColor('#173C36').fontSize(13).text(label).moveDown(0.4)
      doc.fillColor('#222222').fontSize(10).text(plain(value), { lineGap: 4 }).moveDown()
    }
    doc.fillColor('#555555').fontSize(8).text(`内容校验 SHA-256: ${contentDigest(report)}`)
    doc.end()
  })
}

function xml(value: unknown): string {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}
function column(n: number): string {
  let result = ''
  for (let k = n + 1; k > 0; k = Math.floor((k - 1) / 26)) result = String.fromCharCode(65 + (k - 1) % 26) + result
  return result
}

/** Inline-string cells: never interpret student/advisor text as Excel formulas or external links. */
export function renderMastersXlsx(report: ExportReport): Buffer {
  const candidates = Array.isArray(report.content.candidatePrograms) ? report.content.candidatePrograms as Record<string, unknown>[] : []
  const fields = ['institution', 'program', 'intakeYear', 'requirements', 'matchReason', 'risks', 'officialUrl', 'verifiedAt', 'sourceStatus', 'studentAccepted']
  const headings = ['院校', '正式项目名称', '入学年份', '申请要求', '匹配理由', '风险', '官网 URL', '核验日期', '来源状态', '学生接受情况']
  const rows: unknown[][] = [
    ['Application Compass · ' + (report.assistance?.label ?? '初评／待补报告')],
    ['report_id', report.id, 'report_version', report.version, 'profile_version', report.profileVersion],
    ['content_sha256', contentDigest(report)],
    ['报告能力', report.assistance?.label ?? '初评／待补报告', '自动选校', '尚未实现'],
    headings,
    ...candidates.map(c => fields.map(field => plain(c[field])))
  ]
  if (!candidates.length) rows.push(['暂无已核验候选项目；详见初评报告资料缺口和下一步说明。'])
  // Also include exact approved candidate JSON to preserve every additional governed field.
  rows.push(['approved_candidates_json', JSON.stringify(candidates)])
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((row, i) => `<row r="${i + 1}">${row.map((value, j) => `<c r="${column(j)}${i + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`
  const files: Record<string, string> = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="申请项目" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': sheet
  }
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([key, value]) => [key, strToU8(value)])), { level: 6 }))
}
