import { invoke } from "@tauri-apps/api/core"

export const APP_STATE_ATOMIC_WRITE_COMMAND = "write_app_state_atomic"
export const APP_STATE_PERSIST_DEBOUNCE_MS = 100

export interface AtomicPersistStore {
  get: <T>(key: string) => Promise<T | undefined>
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<boolean>
  entries: <T>() => Promise<Array<[string, T]>>
}

export interface AtomicAppStateStore {
  get: <T>(key: string) => Promise<T | undefined>
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<boolean>
  save: () => Promise<void>
}

export function wrapStoreForAtomicPersist(
  inner: AtomicPersistStore,
  persistEntries: (entries: Record<string, unknown>) => Promise<void>,
  debounceMs = APP_STATE_PERSIST_DEBOUNCE_MS,
): AtomicAppStateStore {
  let persistTimer: ReturnType<typeof setTimeout> | null = null
  let persistChain = Promise.resolve()

  const flushPersist = () => {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    persistChain = persistChain
      .catch(() => undefined)
      .then(async () => {
        const pairs = await inner.entries()
        await persistEntries(Object.fromEntries(pairs))
      })
    return persistChain
  }

  const schedulePersist = () => {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = null
      void flushPersist()
    }, debounceMs)
  }

  return {
    get: (key) => inner.get(key),
    set: async (key, value) => {
      await inner.set(key, value)
      schedulePersist()
    },
    delete: async (key) => {
      const deleted = await inner.delete(key)
      schedulePersist()
      return deleted
    },
    save: () => flushPersist(),
  }
}

let storePromise: Promise<AtomicAppStateStore> | null = null

export async function getStore(): Promise<AtomicAppStateStore> {
  if (!storePromise) {
    storePromise = (async () => {
      const { load } = await import("@tauri-apps/plugin-store")
      const inner = await load("app-state.json", { autoSave: false })
      return wrapStoreForAtomicPersist(inner, async (entries) => {
        await invoke(APP_STATE_ATOMIC_WRITE_COMMAND, { entries })
      })
    })()
  }
  return storePromise
}
