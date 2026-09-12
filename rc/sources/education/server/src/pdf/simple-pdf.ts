import { Report } from '../domain/model'

function escapePdfText(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
}

export function renderSimpleReportPdf(report: Report): Buffer {
  const moduleKeys = (report.modules ?? []).map((module, index) => `${index + 1}. ${module.key}`)
  const lines = [
    'Phoenix Education Compass',
    `Report: ${report.id}`,
    `Data as of: ${report.dataAsOf}`,
    `Confidence: ${report.confidence}`,
    ...moduleKeys,
    'This controlled PDF mirrors the authorized in-app report.'
  ]
  const commands = lines.map((line, index) => {
    const y = 780 - index * 28
    return `BT /F1 12 Tf 50 ${y} Td (${escapePdfText(line)}) Tj ET`
  }).join('\n')
  const stream = Buffer.from(commands, 'ascii')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${commands}\nendstream`
  ]
  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%Phoenix\n', 'ascii')]
  const offsets = [0]
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.concat(chunks).length)
    chunks.push(Buffer.from(`${index + 1} 0 obj\n${objects[index]}\nendobj\n`, 'ascii'))
  }
  const xrefOffset = Buffer.concat(chunks).length
  const xref = [
    `xref\n0 ${objects.length + 1}`,
    '0000000000 65535 f ',
    ...offsets.slice(1).map((offset) => `${offset.toString().padStart(10, '0')} 00000 n `),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    `startxref\n${xrefOffset}\n%%EOF\n`
  ].join('\n')
  chunks.push(Buffer.from(xref, 'ascii'))
  return Buffer.concat(chunks)
}
