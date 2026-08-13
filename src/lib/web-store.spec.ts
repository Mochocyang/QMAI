import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  APP_STATE_ATOMIC_WRITE_COMMAND,
  wrapStoreForAtomicPersist,
} from "./web-store"

describe("wrapStoreForAtomicPersist", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createInner(initial: Record<string, unknown> = {}) {
    const values = new Map(Object.entries(initial))
    return {
      values,
      save: vi.fn(async () => {
        throw new Error("plugin save must not be called")
      }),
      store: {
        get: vi.fn(async <T>(key: string) => values.get(key) as T | undefined),
        set: vi.fn(async (key: string, value: unknown) => {
          values.set(key, value)
        }),
        delete: vi.fn(async (key: string) => values.delete(key)),
        entries: vi.fn(async () => [...values.entries()] as Array<[string, unknown]>),
      },
    }
  }

  it("persists full entries through the atomic command and never calls plugin save", async () => {
    const persist = vi.fn(async () => {})
    const inner = createInner({ llmConfig: { model: "keep" } })
    const store = wrapStoreForAtomicPersist(inner.store, persist, 100)

    await store.set("theme", "dark")
    expect(persist).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)

    expect(inner.save).not.toHaveBeenCalled()
    expect(persist).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenCalledWith({
      llmConfig: { model: "keep" },
      theme: "dark",
    })
  })

  it("save flushes immediately with the latest entries", async () => {
    const persist = vi.fn(async () => {})
    const inner = createInner()
    const store = wrapStoreForAtomicPersist(inner.store, persist, 100)

    await store.set("language", "zh")
    await store.save()

    expect(persist).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenCalledWith({ language: "zh" })
    await vi.advanceTimersByTimeAsync(100)
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it("keeps the latest value when overlapping writes resolve out of order", async () => {
    const persist = vi.fn(async () => {})
    const inner = createInner()
    const store = wrapStoreForAtomicPersist(inner.store, persist, 100)

    await store.set("aiOutlineModel", "first")
    await store.set("aiOutlineModel", "second")
    await store.save()

    expect(persist).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenCalledWith({ aiOutlineModel: "second" })
  })
})

describe("atomic write command name", () => {
  it("matches the Rust command", () => {
    expect(APP_STATE_ATOMIC_WRITE_COMMAND).toBe("write_app_state_atomic")
  })
})
