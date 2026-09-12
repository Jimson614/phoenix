export class AppError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: Record<string, unknown>

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.code = code
    if (details !== undefined) this.details = details
  }
}

export function invariant(
  condition: unknown,
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>
): asserts condition {
  if (!condition) throw new AppError(status, code, message, details)
}

export function errorEnvelope(error: unknown): { status: number; body: Record<string, unknown> } {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {})
        }
      }
    }
  }
  return {
    status: 500,
    body: { error: { code: 'INTERNAL_ERROR', message: '服务器暂时无法处理请求' } }
  }
}
