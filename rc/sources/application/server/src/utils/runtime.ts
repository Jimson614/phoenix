import { createHmac, randomBytes, randomUUID } from 'node:crypto'

export type Clock = () => Date
export type IdFactory = (prefix: string) => string

export const systemClock: Clock = () => new Date()
export const randomId: IdFactory = (prefix) => `${prefix}_${randomUUID().replaceAll('-', '')}`

export function randomToken(): string {
  return randomBytes(32).toString('base64url')
}

export function tokenDigest(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token, 'utf8').digest('hex')
}

export function iso(clock: Clock): string {
  return clock().toISOString()
}

export function addMilliseconds(date: Date, milliseconds: number): string {
  return new Date(date.getTime() + milliseconds).toISOString()
}

export function outTradeNo(prefix: 'PX' | 'PR'): string {
  return `${prefix}${randomUUID().replaceAll('-', '').slice(0, 30)}`
}
