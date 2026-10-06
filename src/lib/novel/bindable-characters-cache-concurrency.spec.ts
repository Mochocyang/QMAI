import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * 缓存写回竞态（回归测试）。
 *
 * 真实时序：对话框打开 → load 读缓存判未命中 → 本地解析（大项目上百毫秒）
 * → load 写回；与此同时，上一轮/另一处（灵魂库视图）的精修刚跑完 LLM 并已落盘。
 * 若 load 的写回是无条件整份覆盖，则精修名单与 llmRefinedFingerprint 标记同时丢失，
 * 于是下次打开又去问模型 —— 正是用户报告的「第二次打开还是要等」。
 *
 * 不变量：同一指纹下，「已精修」的那份数据永远优于「仅本地」的写入。
 */
const files = new Map<string, string>()
let tree: { name: string; path: string; is_dir: boolean; size?: number; mtimeMs?: number }[] = []

const PROJECT = "C:/proj"
const ENTITY_DIR = "C:/proj/wiki/entities"
const OUTLINE_DIR = "C:/proj/wiki/outlines"

vi.mock("@/commands/fs", () => ({
  readFile: async (path: string) => {
    if (!files.has(path)) throw new Error("ENOENT " + path)
    return files.get(path)!
  },
  writeFileAtomic: async (path: string, contents: string) => {
    files.set(path, contents)
  },
  listDirectory: async (path: string) => {
    if (path === ENTITY_DIR) return tree
    if (path === OUTLINE_DIR) return []
    throw new Error("ENOENT " + path)
  },
}))

const {
  bindableCharactersCachePath,
  computeBindableFingerprint,
  writeBindableCharactersCache,
  readBindableCharactersCache,
  loadBindableCharactersWithCache,
} = await import("@/lib/novel/bindable-characters-cache")

const CACHE_PATH = bindableCharactersCachePath(PROJECT)
const onDisk = () => (files.has(CACHE_PATH) ? JSON.parse(files.get(CACHE_PATH)!) : null)

/** 换一个 mtime 就换一个指纹，用来模拟「wiki 变了」。 */
function setWiki(mtimeMs: number) {
  tree = [{ name: "a.md", path: `${ENTITY_DIR}/a.md`, is_dir: false, size: 10, mtimeMs }]
}

beforeEach(() => {
  files.clear()
  setWiki(1000)
})

describe("缓存写回不能抹掉已落盘的精修结果", () => {
  it("load 未命中并写回时，同指纹的已精修结果必须保留（名字与标记都不丢）", async () => {
    const fingerprint = await computeBindableFingerprint(PROJECT)

    // ① 精修抢先落盘：名单更全，且带「已精修」标记
    await writeBindableCharactersCache(PROJECT, {
      fingerprint,
      names: ["许七安", "林小满", "精修才发现的人"],
      llmRefinedFingerprint: fingerprint,
      updatedAt: 111,
    })

    // ② load 走未命中路径（force 绕开命中判定），模拟它的写回
    const result = await loadBindableCharactersWithCache(PROJECT, async () => ["许七安"], { force: true })

    const after = onDisk()
    expect(after.llmRefinedFingerprint, "load 的写回抹掉了精修标记，下次打开会重新问模型").toBe(fingerprint)
    expect(after.names, "load 的写回把精修名单覆盖成仅本地名单").toEqual(["许七安", "林小满", "精修才发现的人"])
    expect(result.names, "同指纹已有精修结果时应直接返回它，而不是本地残缺名单")
      .toEqual(["许七安", "林小满", "精修才发现的人"])
    expect(result.cacheHit).toBe(true)
  })

  it("直接调用 write 且不带标记时，也不能覆盖同指纹的已精修结果", async () => {
    const fingerprint = await computeBindableFingerprint(PROJECT)
    await writeBindableCharactersCache(PROJECT, {
      fingerprint, names: ["甲", "乙"], llmRefinedFingerprint: fingerprint, updatedAt: 1,
    })

    await writeBindableCharactersCache(PROJECT, { fingerprint, names: ["甲"], updatedAt: 2 })

    const after = onDisk()
    expect(after.names).toEqual(["甲", "乙"])
    expect(after.llmRefinedFingerprint).toBe(fingerprint)
  })

  it("精修自己仍然可以覆盖：带标记的写入永远生效", async () => {
    const fingerprint = await computeBindableFingerprint(PROJECT)
    await writeBindableCharactersCache(PROJECT, { fingerprint, names: ["旧"], updatedAt: 1 })

    await writeBindableCharactersCache(PROJECT, {
      fingerprint, names: ["新"], llmRefinedFingerprint: fingerprint, updatedAt: 2,
    })

    const after = onDisk()
    expect(after.names).toEqual(["新"])
    expect(after.llmRefinedFingerprint).toBe(fingerprint)
    expect(after.updatedAt).toBe(2)
  })

  it("指纹变化的陈旧标记不算「已精修」，新指纹的未精修写入正常落盘", async () => {
    const oldFingerprint = await computeBindableFingerprint(PROJECT)
    await writeBindableCharactersCache(PROJECT, {
      fingerprint: oldFingerprint, names: ["旧"], llmRefinedFingerprint: oldFingerprint, updatedAt: 1,
    })

    setWiki(2000) // wiki 改了 → 指纹变
    const newFingerprint = await computeBindableFingerprint(PROJECT)
    expect(newFingerprint).not.toBe(oldFingerprint)

    const result = await loadBindableCharactersWithCache(PROJECT, async () => ["新的本地名单"])
    expect(result.cacheHit).toBe(false)
    expect(result.fingerprint).toBe(newFingerprint)

    const after = onDisk()
    expect(after.fingerprint).toBe(newFingerprint)
    expect(after.names).toEqual(["新的本地名单"])
    // 旧指纹的标记不能被当成新指纹已精修
    expect(after.llmRefinedFingerprint).not.toBe(newFingerprint)
  })

  it("指纹未变时的命中仍然直接返回缓存，不重算", async () => {
    const fingerprint = await computeBindableFingerprint(PROJECT)
    await writeBindableCharactersCache(PROJECT, {
      fingerprint, names: ["甲"], llmRefinedFingerprint: fingerprint, updatedAt: 1,
    })

    let computed = 0
    const result = await loadBindableCharactersWithCache(PROJECT, async () => { computed += 1; return ["乙"] })
    expect(result.cacheHit).toBe(true)
    expect(result.names).toEqual(["甲"])
    expect(computed).toBe(0)
    expect((await readBindableCharactersCache(PROJECT))?.llmRefinedFingerprint).toBe(fingerprint)
  })
})
