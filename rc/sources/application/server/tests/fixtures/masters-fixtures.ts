import { randomBytes } from 'node:crypto'
import PDFDocument from 'pdfkit'
import jpeg from 'jpeg-js'
import { zipSync, strToU8 } from 'fflate'
import { PNG } from 'pngjs'

/**
 * Every artifact in this module is generated from synthetic values.  The file
 * parser tests must never depend on a real applicant document or a checked-in
 * template whose contents could change outside the test.
 */

export const syntheticProfileText = [
  '姓名：合成申请人',
  '本科院校：Synthetic University',
  '本科专业：Computer Science',
  '学位名称：Bachelor of Science',
  '百分制均分：88.5',
  'GPA：3.72 / 4.0',
  'GPA满分：4.0',
  '预计毕业年月：2027-06'
].join('\n')

// PDFKit's built-in font has no CJK glyph map.  Keep PDF labels ASCII so the
// extracted text remains deterministic; the DOCX fixture above covers CJK
// labels separately.
export const syntheticPdfText = [
  'Name: Synthetic Applicant',
  'Institution: Synthetic University',
  'Major: Computer Science',
  'Degree: Bachelor of Science',
  'Average: 88.5',
  'GPA: 3.72 / 4.0',
  'GPA Scale: 4.0',
  'Graduation Date: 2027-06'
].join('\n')

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Generate a PDF with explicit labelled values that the parser can extract. */
export function makeSyntheticPdf(options: { pages?: number; text?: string; image?: Buffer } = {}): Promise<Buffer> {
  const pages = Math.max(1, Math.floor(options.pages ?? 1))
  const text = options.text ?? syntheticPdfText
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: 'A4', margin: 48 })
    const chunks: Buffer[] = []
    document.on('data', (chunk: Buffer) => chunks.push(chunk))
    document.once('error', reject)
    document.once('end', () => resolve(Buffer.concat(chunks)))
    for (let page = 1; page <= pages; page += 1) {
      if (page > 1) document.addPage()
      if (options.image) document.image(options.image, { fit: [400, 500] })
      else document.fontSize(12).text(text)
      document.fontSize(9).text(`Synthetic page ${page} of ${pages}`)
    }
    document.end()
  })
}

function docxXml(text: string): string {
  const paragraphs = text.split(/\r?\n/).map((line) =>
    `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`
  ).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${paragraphs}<w:sectPr/></w:body></w:document>`
}

const docxContentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `</Types>`

/** Generate the smallest valid OOXML package containing only document.xml. */
export function makeSyntheticDocx(text: string = syntheticProfileText): Buffer {
  return Buffer.from(zipSync({
    '[Content_Types].xml': strToU8(docxContentTypes),
    'word/document.xml': strToU8(docxXml(text))
  }, { level: 6 }))
}

/** Generate a real 1x1 or small RGB PNG which pngjs can decode with CRC checks. */
export function makeSyntheticPng(width = 4, height = 3): Buffer {
  const png = new PNG({ width, height })
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (width * y + x) << 2
      png.data[index] = (x * 61 + 17) % 256
      png.data[index + 1] = (y * 71 + 29) % 256
      png.data[index + 2] = 151
      png.data[index + 3] = 255
    }
  }
  return PNG.sync.write(png)
}

/** Generate a real baseline JPEG which jpeg-js can decode without tolerance. */
export function makeSyntheticJpeg(width = 4, height = 3): Buffer {
  const data = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (width * y + x) << 2
      data[index] = (x * 47 + 13) % 256
      data[index + 1] = (y * 53 + 31) % 256
      data[index + 2] = 197
      data[index + 3] = 255
    }
  }
  return jpeg.encode({ data, width, height }, 85).data
}

export function makeSyntheticMacroDocx(): Buffer {
  const macroTypes = docxContentTypes.replace(
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    'application/vnd.ms-word.document.macroEnabled.main+xml'
  ).replace(
    '</Types>',
    '<Override PartName="/word/vbaProject.bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>'
  )
  return Buffer.from(zipSync({
    '[Content_Types].xml': strToU8(macroTypes),
    'word/document.xml': strToU8(docxXml('姓名：宏文档')),
    'word/vbaProject.bin': randomBytes(32)
  }, { level: 6 }))
}

/**
 * The compressed package stays small while its declared uncompressed document
 * part exceeds the parser's expansion budget.  This exercises zip-bomb
 * defenses without allocating a large fixture on disk.
 */
export function makeSyntheticZipBomb(): Buffer {
  const repeated = 'x'.repeat(21 * 1024 * 1024)
  const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${repeated}</w:t></w:r></w:p></w:body></w:document>`
  return Buffer.from(zipSync({
    '[Content_Types].xml': strToU8(docxContentTypes),
    'word/document.xml': strToU8(xml)
  }, { level: 9 }))
}

export interface MultipartPart {
  name: string
  value: string | Buffer
  filename?: string
  contentType?: string
}

/** Build a deterministic multipart body matching wx.uploadFile's file field. */
export function makeMultipartBody(boundary: string, parts: MultipartPart[]): Buffer {
  const chunks: Buffer[] = []
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`, 'utf8'))
    if (part.filename !== undefined) {
      chunks.push(Buffer.from(
        `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n` +
        `Content-Type: ${part.contentType ?? 'application/octet-stream'}\r\n\r\n`,
        'utf8'
      ))
      chunks.push(Buffer.isBuffer(part.value) ? part.value : Buffer.from(part.value, 'utf8'))
      chunks.push(Buffer.from('\r\n', 'utf8'))
    } else {
      chunks.push(Buffer.from(
        `Content-Disposition: form-data; name="${part.name}"\r\n\r\n${String(part.value)}\r\n`,
        'utf8'
      ))
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'))
  return Buffer.concat(chunks)
}
