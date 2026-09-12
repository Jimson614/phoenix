import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { emptyState } from '../domain/model'
import { InMemoryStore } from './memory-store'

type DatabaseState = ReturnType<typeof emptyState>

export class FileStore extends InMemoryStore {
  private constructor(private readonly filePath: string, initial: DatabaseState) {
    super(initial)
  }

  static async open(filePath: string): Promise<FileStore> {
    let state = emptyState()
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf8')) as Partial<DatabaseState>
      state = { ...state, ...parsed }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    return new FileStore(filePath, state)
  }

  protected override async afterCommit(snapshot: DatabaseState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporary = `${this.filePath}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify(snapshot), { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, this.filePath)
  }
}
