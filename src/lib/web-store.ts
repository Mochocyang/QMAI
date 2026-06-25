import { isTauri } from "./platform"

const STORE_PREFIX = "llm-wiki-store:"

class WebStore {
  private data: Map<string, unknown>

  constructor() {
    this.data = new Map()
    this.loadFromLocalStorage()
  }

  private loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem(STORE_PREFIX + "app-state.json")
      if (raw) {
        const parsed = JSON.parse(raw)
        for (const [key, value] of Object.entries(parsed)) {
          this.data.set(key, value)
        }
      }
    } catch {}
  }

  private saveToLocalStorage() {
    try {
      const obj: Record<string, unknown> = {}
      for (const [key, value] of this.data.entries()) {
        obj[key] = value
      }
      localStorage.setItem(STORE_PREFIX + "app-state.json", JSON.stringify(obj))
    } catch {}
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined
  }

  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, value)
    this.saveToLocalStorage()
  }

  async delete(key: string): Promise<boolean> {
    const existed = this.data.has(key)
    this.data.delete(key)
    this.saveToLocalStorage()
    return existed
  }

  async save(): Promise<void> {
    this.saveToLocalStorage()
  }
}

let webStoreInstance: WebStore | null = null

function getWebStore(): WebStore {
  if (!webStoreInstance) {
    webStoreInstance = new WebStore()
  }
  return webStoreInstance
}

export async function getStore() {
  if (isTauri()) {
    const { load } = await import("@tauri-apps/plugin-store")
    return load("app-state.json", { autoSave: true, defaults: {} })
  }
  return getWebStore()
}
