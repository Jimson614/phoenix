import { randomUUID, createHash } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink, realpath, readdir, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { invariant } from '../domain/errors'

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
export const MAX_DOCUMENTS = 20

/** Private, non-web-served files. Only opaque generated keys cross this boundary. */
export class PrivateFiles {
  constructor(readonly root: string) {
    invariant(isAbsolute(root), 500, 'PRIVATE_STORAGE_REQUIRED', '需要配置绝对路径私有存储')
  }

  async initialize(projectRoot?: string): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    if (projectRoot) {
      const actual = await realpath(this.root)
      const rel = relative(await realpath(projectRoot), actual)
      invariant(rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel), 500, 'PRIVATE_STORAGE_UNSAFE', '私有附件目录必须在源码和发布目录之外')
    }
  }

  private path(key: string): string {
    invariant(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(key), 404, 'DOCUMENT_NOT_FOUND', '材料不存在')
    return join(resolve(this.root), key)
  }

  async put(bytes: Buffer): Promise<{ storageKey: string; sha256: string; sizeBytes: number }> {
    invariant(bytes.length > 0 && bytes.length <= MAX_DOCUMENT_BYTES, 413, 'FILE_SIZE_INVALID', '单个文件须为 1 字节至 10 MB')
    const storageKey = randomUUID()
    const destination = this.path(storageKey)
    const temporary = `${destination}.pending`
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } catch (error) {
      await handle.close()
      await unlink(temporary).catch(() => undefined)
      throw error
    }
    await handle.close()
    try { await rename(temporary, destination) } catch (error) {
      await unlink(temporary).catch(() => undefined)
      throw error
    }
    return { storageKey, sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length }
  }

  async get(key: string): Promise<Buffer> {
    try { return await readFile(this.path(key)) } catch (error) {
      invariant((error as NodeJS.ErrnoException).code !== 'ENOENT', 404, 'DOCUMENT_NOT_FOUND', '材料不存在或已撤除')
      throw error
    }
  }

  async remove(key: string): Promise<void> {
    await unlink(this.path(key)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
  }

  async sweepOrphans(referencedKeys: Set<string>, graceMs = 3_600_000): Promise<number> {
    let removed = 0
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isFile() || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\.pending)?$/.test(entry.name)) continue
      const key = entry.name.replace(/\.pending$/, '')
      this.path(key) // Apply the same strict opaque key boundary.
      if (referencedKeys.has(key)) continue
      const path = join(this.root, entry.name)
      const metadata = await stat(path).catch(() => null)
      if (metadata && Date.now() - metadata.mtimeMs >= graceMs) {
        await unlink(path).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
        removed++
      }
    }
    return removed
  }
}
