import { describe, expect, it } from "vitest"

import { canonicalJson } from "./canonical"
import { mergeProviderConfigs, type SyncProviderEntry } from "./merge"

function entry(key: string, value: unknown, updatedAt = 0): SyncProviderEntry {
  return { key, value, updatedAt }
}

describe("canonicalJson", () => {
  it("键序不同但内容相同的对象序列化结果一致", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }))
    expect(canonicalJson({ a: [{ y: 1, x: 2 }] })).toBe(canonicalJson({ a: [{ x: 2, y: 1 }] }))
  })

  it("undefined 字段被跳过，与缺字段等价", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }))
  })
})

describe("mergeProviderConfigs（并集 + 同键取较新）", () => {
  it("本地独有的 provider 会被加进云端", () => {
    const local = { localOnly: entry("localOnly", { k: 1 }) }
    const cloud = { common: entry("common", { k: 2 }) }
    const result = mergeProviderConfigs(local, cloud)

    expect(result.addedToCloud).toEqual(["localOnly"])
    expect(result.addedToLocal).toEqual(["common"])
    expect(Object.keys(result.merged).sort()).toEqual(["common", "localOnly"])
    expect(result.conflicts).toEqual([])
  })

  it("云端独有的 provider 会被拉到本地", () => {
    const result = mergeProviderConfigs({}, { cloudOnly: entry("cloudOnly", { k: 1 }) })
    expect(result.addedToLocal).toEqual(["cloudOnly"])
    expect(result.changedLocally).toBe(true)
  })

  it("两边内容相同：不算冲突，时间戳取较大者", () => {
    const local = { same: entry("same", { a: 1, b: 2 }, 100) }
    const cloud = { same: entry("same", { b: 2, a: 1 }, 900) }
    const result = mergeProviderConfigs(local, cloud)

    expect(result.conflicts).toEqual([])
    expect(result.addedToLocal).toEqual([])
    expect(result.addedToCloud).toEqual([])
    expect(result.merged.same.updatedAt).toBe(900)
    expect(result.changedLocally).toBe(false)
  })

  it("两边内容不同：取较新的那份并记进 conflicts", () => {
    const local = { p: entry("p", { model: "old" }, 100) }
    const cloud = { p: entry("p", { model: "new" }, 200) }
    const result = mergeProviderConfigs(local, cloud)

    expect(result.conflicts).toEqual(["p"])
    expect(result.merged.p.value).toEqual({ model: "new" })
    expect(result.changedLocally).toBe(true)
    // 冲突明细：两份都留着，界面才能让用户改选
    expect(result.conflictDetails).toEqual([
      { key: "p", localValue: { model: "old" }, cloudValue: { model: "new" }, chosen: "cloud" },
    ])
  })

  it("本地较新时冲突明细记为选择本地", () => {
    const result = mergeProviderConfigs(
      { p: entry("p", { model: "local" }, 900) },
      { p: entry("p", { model: "cloud" }, 100) },
    )
    expect(result.conflictDetails[0].chosen).toBe("local")
  })

  it("两边时间戳相同且内容不同：保留本地（稳定、不来回抖）", () => {
    const local = { p: entry("p", { model: "local" }, 500) }
    const cloud = { p: entry("p", { model: "cloud" }, 500) }
    expect(mergeProviderConfigs(local, cloud).merged.p.value).toEqual({ model: "local" })
  })

  it("合并结果不会删除任何一方独有的 provider", () => {
    const local = { a: entry("a", { v: 1 }), b: entry("b", { v: 2 }) }
    const cloud = { b: entry("b", { v: 3 }, 10), c: entry("c", { v: 4 }) }
    const result = mergeProviderConfigs(local, cloud)
    expect(Object.keys(result.merged).sort()).toEqual(["a", "b", "c"])
  })
})
