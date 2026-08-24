import { normalizePath } from "@/lib/path-utils"
 interface ChapterExternalUpdateCoordinator {
  runExternalUpdate(path: string, write: () => Promise<void>): Promise<number>
  flushBeforeLeave(path: string, write: () => Promise<void>): Promise<boolean>
  markEditorSession(path: string, version?: number): void
}

export function createChapterExternalUpdateCoordinator(): ChapterExternalUpdateCoordinator {
  const pathVersions = new Map<string, number>()
  const editorSessionVersions = new Map<string, number>()
  const activeExternalVersions = new Map<string, number>()
  const writeChains = new Map<string, Promise<void>>()

  function keyOf(path: string): string {
    return normalizePath(path)
  }

  function currentVersion(key: string): number {
    return pathVersions.get(key) ?? 0
  }

  function enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = writeChains.get(key) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(operation)
    const tail = run.then(() => undefined, () => undefined)
    writeChains.set(key, tail)
    void tail.finally(() => {
      if (writeChains.get(key) === tail) writeChains.delete(key)
    })
    return run
  }

  async function runExternalUpdate(path: string, write: () => Promise<void>): Promise<number> {
    const key = keyOf(path)
    const previousVersion = currentVersion(key)
    const version = previousVersion + 1
    pathVersions.set(key, version)
    activeExternalVersions.set(key, version)
    try {
      await enqueue(key, write)
      return version
    } catch (error) {
      if (pathVersions.get(key) === version) pathVersions.set(key, previousVersion)
      throw error
    } finally {
      if (activeExternalVersions.get(key) === version) activeExternalVersions.delete(key)
    }
  }

  function flushBeforeLeave(path: string, write: () => Promise<void>): Promise<boolean> {
    const key = keyOf(path)
    const expectedVersion = editorSessionVersions.get(key) ?? currentVersion(key)
    return enqueue(key, async () => {
      if (activeExternalVersions.has(key)) return false
      if (currentVersion(key) !== expectedVersion) return false
      await write()
      return true
    })
  }

  function markEditorSession(path: string, version = currentVersion(keyOf(path))): void {
    editorSessionVersions.set(keyOf(path), version)
  }

  return { runExternalUpdate, flushBeforeLeave, markEditorSession }
}
