import { invoke } from "@tauri-apps/api/core"

import { isTauri } from "@/lib/platform"

export const APP_STATE_ATOMIC_WRITE_COMMAND = "write_app_state_atomic"
export const APP_STATE_PERSIST_DEBOUNCE_MS = 100

/**
 * 这些 app-state 键里含凭据（API Key / WebDAV 密码），写盘前用系统凭据加密。
 *
 * 原则：整块加密，不去挑字段——挑字段就得和每个配置结构保持同步，
 * 以后新增一个密钥字段忘了加，就又漏一条明文。
 */
export const ENCRYPTED_STATE_KEYS = new Set([
  "llmConfig",
  "rerankConfig",
  "projectRerankConfigs",
  "searchApiConfig",
  "embeddingConfig",
  "multimodalConfig",
  "sync.webdav",
])

/** 密文包装标记：`{ "__qmaiEnc": "<base64 DPAPI 密文>" }`。 */
const ENCRYPTION_MARKER = "__qmaiEnc"

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

function isEncryptedValue(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  return typeof (value as Record<string, unknown>)[ENCRYPTION_MARKER] === "string"
}

/**
 * 写盘前把敏感键换成密文。
 *
 * 加密失败时**保留明文**而不是让整次写入失败：丢配置比暂时的磁盘明文更糟，
 * 而且失败原因会记进日志（下次保存会再试）。
 */
export async function encryptStateEntries(
  entries: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!isTauri()) return entries

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(entries)) {
    if (!ENCRYPTED_STATE_KEYS.has(key) || value === undefined || value === null) {
      result[key] = value
      continue
    }
    // 已经是密文包装（例如刚从磁盘读上来、本次没被改写）：原样写回，避免套娃加密。
    if (isEncryptedValue(value)) {
      result[key] = value
      continue
    }
    try {
      const payload = await invoke<string>("state_secret_encrypt", {
        plaintext: JSON.stringify(value),
      })
      result[key] = { [ENCRYPTION_MARKER]: payload }
    } catch (error) {
      console.warn(`[app-state] 加密 ${key} 失败，本次按明文写入`, error)
      result[key] = value
    }
  }
  return result
}

/** 读取时解密；解不开按「没有这个配置」处理（换机器后就是这个结果）。 */
export async function decryptStateValue<T>(value: unknown): Promise<T | undefined> {
  if (!isEncryptedValue(value)) return value as T | undefined
  try {
    const text = await invoke<string | null>("state_secret_decrypt", {
      payload: value[ENCRYPTION_MARKER],
    })
    if (!text) return undefined
    return JSON.parse(text) as T
  } catch (error) {
    console.warn("[app-state] 解密失败，按未配置处理", error)
    return undefined
  }
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
      const store = wrapStoreForAtomicPersist(
        {
          get: async <T>(key: string) => decryptStateValue<T>(await inner.get(key)),
          set: (key, value) => inner.set(key, value),
          delete: (key) => inner.delete(key),
          entries: <T>() => inner.entries<T>(),
        },
        async (entries) => {
          await invoke(APP_STATE_ATOMIC_WRITE_COMMAND, { entries: await encryptStateEntries(entries) })
        },
      )
      // 首次启动就把历史明文迁移成密文（读的是明文，写回时自动加密）。
      if (isTauri()) void store.save()
      return store
    })()
  }
  return storePromise
}

/** Flush pending app-state writes. Call on window close so LLM configs survive restart. */
export async function flushAppState(): Promise<void> {
  const store = await getStore()
  await store.save()
}
