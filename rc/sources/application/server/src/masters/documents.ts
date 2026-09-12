import { IncomingMessage } from 'node:http'
import { spawn } from 'node:child_process'
import { join, extname } from 'node:path'
import busboy from 'busboy'
import { AppError, invariant } from '../domain/errors'
import { MAX_DOCUMENT_BYTES } from './private-files'

export interface ExtractionEvidence {
  field: string
  value: string
  location: string
  snippet: string
  confidence: 'NEEDS_CONFIRMATION'
}
export interface FileInspection {
  mimeType: string
  status: 'NEEDS_CONFIRMATION' | 'MANUAL_REVIEW' | 'FAILED'
  fields: ExtractionEvidence[]
  errorCode: string | null
}
export interface UploadedFile { originalName: string; mimeType: string; bytes: Buffer; fields: Record<string, string> }

/** Bounded multipart transport used by native wx.uploadFile. No filename is trusted as a path. */
export function readMultipart(request: IncomingMessage): Promise<UploadedFile> {
  return new Promise((resolve, reject) => {
    let settled = false
    let timer: NodeJS.Timeout
    let file: Omit<UploadedFile, 'fields'> | undefined
    const fields: Record<string, string> = {}
    let bytesSeen = 0
    let parser: ReturnType<typeof busboy>
    const finish = (error?: AppError) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      request.unpipe(parser)
      request.removeListener('data', count)
      if (error) { request.resume(); reject(error) }
      else if (file) resolve({ ...file, fields })
      else reject(new AppError(400, 'FILE_REQUIRED', '请选择一个文件'))
    }
    const count = (chunk: Buffer) => {
      bytesSeen += chunk.length
      if (bytesSeen > MAX_DOCUMENT_BYTES + 32_768) finish(new AppError(413, 'FILE_TOO_LARGE', '单文件最大 10 MB'))
    }
    try { parser = busboy({ headers: request.headers, limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1, fields: 5, fieldSize: 1000, parts: 6, headerPairs: 30 } }) }
    catch { reject(new AppError(400, 'MULTIPART_REQUIRED', '上传需要 multipart/form-data')); return }
    timer = setTimeout(() => finish(new AppError(408, 'UPLOAD_TIMEOUT', '上传超时，可重试或稍后补件')), 10_000)
    request.on('data', count)
    request.once('aborted', () => finish(new AppError(400, 'UPLOAD_ABORTED', '上传中断')))
    request.once('error', () => finish(new AppError(400, 'UPLOAD_ABORTED', '上传中断')))
    parser.on('file', (name, stream, info) => {
      if (name !== 'file' || file) { stream.resume(); finish(new AppError(400, 'FILE_FIELD_INVALID', '每次仅上传一个 file')); return }
      const chunks: Buffer[] = []
      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      stream.on('limit', () => finish(new AppError(413, 'FILE_TOO_LARGE', '单文件最大 10 MB')))
      stream.on('error', () => finish(new AppError(400, 'UPLOAD_ABORTED', '上传中断')))
      stream.on('end', () => {
        file = { originalName: info.filename, mimeType: info.mimeType, bytes: Buffer.concat(chunks) }
      })
    })
    parser.on('field', (key, value, info) => {
      if (!['version', 'type', 'description', 'replaceDocumentId', 'originalName'].includes(key) || key in fields || info.valueTruncated) {
        finish(new AppError(400, 'UPLOAD_FIELD_INVALID', '上传字段无效')); return
      }
      fields[key] = value
    })
    for (const event of ['filesLimit', 'fieldsLimit', 'partsLimit']) parser.on(event, () => finish(new AppError(413, 'UPLOAD_LIMIT', '上传内容超出限制')))
    parser.on('error', () => finish(new AppError(400, 'INVALID_MULTIPART', '上传内容格式无效')))
    parser.on('close', () => finish())
    request.pipe(parser)
  })
}

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png'
}

export function validateFileHeader(file: UploadedFile): string {
  invariant(file.originalName.length > 0 && file.originalName.length <= 180 && !/[\u0000-\u001f\\/]/.test(file.originalName), 400, 'FILENAME_INVALID', '文件名无效')
  const mimeType = MIME[extname(file.originalName).toLowerCase()]
  invariant(mimeType, 415, 'FILE_TYPE_UNSUPPORTED', '仅支持 PDF、DOCX、JPG/JPEG、PNG，不支持旧 DOC')
  invariant(file.bytes.length > 0 && file.bytes.length <= MAX_DOCUMENT_BYTES, 413, 'FILE_SIZE_INVALID', '文件为空或超过 10 MB')
  invariant(file.mimeType === mimeType || file.mimeType === 'application/octet-stream', 415, 'FILE_MIME_MISMATCH', '文件声明类型与扩展名不一致')
  const b = file.bytes
  const matches = mimeType === 'application/pdf' ? b.subarray(0, 5).toString() === '%PDF-'
    : mimeType === 'image/png' ? b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : mimeType === 'image/jpeg' ? b[0] === 255 && b[1] === 216 && b[b.length - 2] === 255 && b[b.length - 1] === 217
        : b.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))
  invariant(matches, 415, 'FILE_CONTENT_MISMATCH', '文件真实类型与扩展名不一致')
  return mimeType
}

/** Separate process: hard deadline + heap cap, no OCR or external model/network call. */
export async function inspectDocument(file: UploadedFile, timeoutMs = 8_000): Promise<FileInspection> {
  const mimeType = validateFileHeader(file)
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--max-old-space-size=128', join(__dirname, 'document-parser.js'), mimeType], {
      stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_NO_WARNINGS: '1' }
    })
    let done = false
    let output = Buffer.alloc(0)
    const finish = (result: FileInspection) => {
      if (done) return
      done = true
      clearTimeout(timer)
      child.kill()
      resolve(result)
    }
    const failed = (code: string): FileInspection => ({ mimeType, status: 'FAILED', fields: [], errorCode: code })
    const timer = setTimeout(() => finish(failed('PARSER_TIMEOUT')), timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      output = Buffer.concat([output, chunk])
      if (output.length > 256_000) finish(failed('PARSER_OUTPUT_LIMIT'))
    })
    child.stdin.on('error', () => undefined)
    child.on('error', () => finish(failed('PARSER_UNAVAILABLE')))
    child.on('close', () => {
      if (done) return
      try {
        const result = JSON.parse(output.toString()) as FileInspection & { invalid?: boolean }
        if (result.invalid) {
          done = true; clearTimeout(timer)
          reject(new AppError(415, 'FILE_CONTENT_INVALID', '文件损坏、类型无效或含不支持的活动内容')); return
        }
        finish({ ...result, mimeType })
      } catch { finish(failed('PARSER_FAILED')) }
    })
    child.stdin.end(file.bytes)
  })
}
