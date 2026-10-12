import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { AppError, invariant } from '../domain/errors'
import { Clock, systemClock } from '../utils/runtime'

// Mini Program message push (开发管理 → 消息推送), which carries the virtual payment delivery,
// refund and complaint events. Only safe mode with JSON bodies is accepted: every push is signed
// over its ciphertext and the plaintext ends with our AppID.
// https://developers.weixin.qq.com/miniprogram/dev/framework/server-ability/message-push.html
const BLOCK_SIZE = 32

export interface WechatMessageConfig {
  token: string
  encodingAesKey: string
  appId: string
}

export interface SealedReply {
  Encrypt: string
  MsgSignature: string
  TimeStamp: number
  Nonce: string
}

/** sha1 over the parts sorted in dictionary order, as WeChat signs URL checks and pushes. */
export function messageSignature(...parts: string[]): string {
  return createHash('sha1').update([...parts].sort().join(''), 'utf8').digest('hex')
}

function aesKey(encodingAesKey: string): Buffer {
  const key = Buffer.from(`${encodingAesKey}=`, 'base64')
  invariant(encodingAesKey.length === 43 && key.length === 32, 500, 'WECHAT_MESSAGE_AES_KEY_INVALID', 'EncodingAESKey 必须是43位')
  return key
}

export function decryptMessage(encodingAesKey: string, encrypt: string, appId: string): string {
  const key = aesKey(encodingAesKey)
  let full: Buffer
  try {
    const decipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16))
    decipher.setAutoPadding(false)
    const padded = Buffer.concat([decipher.update(Buffer.from(encrypt, 'base64')), decipher.final()])
    const pad = padded[padded.length - 1] ?? 0
    invariant(pad >= 1 && pad <= BLOCK_SIZE && padded.length > pad, 401, 'WECHAT_MESSAGE_DECRYPT_FAILED', '消息推送解密失败')
    full = padded.subarray(0, padded.length - pad)
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError(401, 'WECHAT_MESSAGE_DECRYPT_FAILED', '消息推送解密失败')
  }
  invariant(full.length >= 20, 401, 'WECHAT_MESSAGE_DECRYPT_FAILED', '消息推送解密失败')
  const length = full.readUInt32BE(16)
  invariant(20 + length <= full.length, 401, 'WECHAT_MESSAGE_DECRYPT_FAILED', '消息推送解密失败')
  const receivedAppId = full.subarray(20 + length).toString('utf8')
  invariant(receivedAppId === appId, 401, 'WECHAT_MESSAGE_APPID_MISMATCH', '消息推送不属于本小程序')
  return full.subarray(20, 20 + length).toString('utf8')
}

export function encryptMessage(encodingAesKey: string, plaintext: string, appId: string, random: Buffer = randomBytes(16)): string {
  const key = aesKey(encodingAesKey)
  invariant(random.length === 16, 500, 'WECHAT_MESSAGE_RANDOM_INVALID', '随机串必须是16字节')
  const message = Buffer.from(plaintext, 'utf8')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(message.length)
  const full = Buffer.concat([random, length, message, Buffer.from(appId, 'utf8')])
  const pad = BLOCK_SIZE - (full.length % BLOCK_SIZE)
  const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16))
  cipher.setAutoPadding(false)
  return Buffer.concat([cipher.update(Buffer.concat([full, Buffer.alloc(pad, pad)])), cipher.final()]).toString('base64')
}

function sameSignature(expected: string, provided: string | null): boolean {
  if (!provided || provided.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(provided, 'utf8'))
}

export class WechatMessageCodec {
  constructor(
    private readonly config: WechatMessageConfig,
    private readonly clock: Clock = systemClock,
    private readonly random: () => Buffer = () => randomBytes(16)
  ) {
    invariant(/^[A-Za-z0-9]{3,32}$/.test(config.token), 500, 'WECHAT_MESSAGE_TOKEN_INVALID', '消息推送 Token 必须是3至32位字母或数字')
    aesKey(config.encodingAesKey)
    invariant(/^wx[0-9a-fA-F]{16}$/.test(config.appId), 500, 'WECHAT_MESSAGE_APPID_INVALID', '消息推送 AppID 无效')
  }

  /** The GET check WeChat sends when the URL is saved: echo echostr back only if the signature holds. */
  verifyServerUrl(query: URLSearchParams): string {
    const timestamp = query.get('timestamp') ?? ''
    const nonce = query.get('nonce') ?? ''
    const echostr = query.get('echostr') ?? ''
    invariant(timestamp && nonce && echostr, 400, 'WECHAT_MESSAGE_QUERY_INVALID', '消息推送校验参数缺失')
    invariant(sameSignature(messageSignature(this.config.token, timestamp, nonce), query.get('signature')),
      401, 'WECHAT_MESSAGE_SIGNATURE_INVALID', '消息推送签名无效')
    return echostr
  }

  /** Verifies msg_signature over the ciphertext, then decrypts the JSON event. */
  openPush(query: URLSearchParams, rawBody: Buffer): Record<string, unknown> {
    invariant(query.get('encrypt_type') === 'aes', 401, 'WECHAT_MESSAGE_PLAINTEXT_REFUSED', '消息推送必须使用安全模式')
    const timestamp = query.get('timestamp') ?? ''
    const nonce = query.get('nonce') ?? ''
    invariant(timestamp && nonce, 401, 'WECHAT_MESSAGE_SIGNATURE_INVALID', '消息推送签名无效')
    let envelope: unknown
    try { envelope = JSON.parse(rawBody.toString('utf8')) } catch { throw new AppError(400, 'WECHAT_MESSAGE_BODY_INVALID', '消息推送不是有效 JSON') }
    const encrypt = (envelope as { Encrypt?: unknown } | null)?.Encrypt
    invariant(typeof encrypt === 'string' && encrypt.length > 0, 400, 'WECHAT_MESSAGE_BODY_INVALID', '消息推送缺少密文')
    invariant(sameSignature(messageSignature(this.config.token, timestamp, nonce, encrypt), query.get('msg_signature')),
      401, 'WECHAT_MESSAGE_SIGNATURE_INVALID', '消息推送签名无效')
    let event: unknown
    try { event = JSON.parse(decryptMessage(this.config.encodingAesKey, encrypt, this.config.appId)) } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(400, 'WECHAT_MESSAGE_BODY_INVALID', '消息推送明文不是有效 JSON')
    }
    invariant(event !== null && typeof event === 'object' && !Array.isArray(event), 400, 'WECHAT_MESSAGE_BODY_INVALID', '消息推送结构无效')
    return event as Record<string, unknown>
  }

  /** A reply other than an empty body or "success" has to be encrypted and signed. */
  sealReply(plaintext: string, nonce: string): SealedReply {
    const timestamp = Math.floor(this.clock().getTime() / 1000)
    const encrypted = encryptMessage(this.config.encodingAesKey, plaintext, this.config.appId, this.random())
    return { Encrypt: encrypted, MsgSignature: messageSignature(this.config.token, String(timestamp), nonce, encrypted), TimeStamp: timestamp, Nonce: nonce }
  }
}
