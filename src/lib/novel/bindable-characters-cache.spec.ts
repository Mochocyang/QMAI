import { beforeEach, describe, expect, it, vi } from "vitest"
import { sha256Text } from "@/lib/context-hub/fingerprint"
import { listDirectory } from "@/commands/fs"
import {
  BINDABLE_CHARACTERS_CACHE_FILE,
  bindableCharactersCachePath,
  computeBindableFingerprint,
  loadBindableCharactersWithCache,
  readBindableCharactersCache,
  writeBindableCharactersCache,
} from "./bindable-characters-cache"

const projectPath = "/project"
const entityDir = `${projectPath}/wiki/entities`
const outlineDir = `${projectPath}/wiki/outlines`

// 内存文件系统：内容走 files，清单元数据走 meta。
// strippedMeta 里的路径返回的节点不带 size/mtimeMs，用来验证「缺失按 0」。
// missingDirs 里的目录让 listDirectory 抛错，模拟 wiki 目录缺失。
// listDirectoryCalls 记录每一次 listDirectory 调用（指纹扫描的唯一入口），
// 用于验证「一次加载只扫描一次清单」。
const io = vi.hoisted(() => {
  const files = new Map<string, string>()
  const meta = new Map<string, { size?: number; mtimeMs?: number }>()
  const strippedMeta = new Set<string>()
  const missingDirs = new Set<string>()
  const writes: string[] = []
  const listDirectoryCalls: string[] = []
  let descending = false
  const childrenOf = (dir: string): any[] => {
    if (missingDirs.has(dir)) throw new Error(`目录不存在：${dir}`)
    const prefix = dir.endsWith("/") ? dir : `${dir}/`
    const nodes = new Map<string, any>()
    for (const path of files.keys()) {
      if (!path.startsWith(prefix)) continue
      const rest = path.slice(prefix.length)
      const head = rest.split("/")[0]
      const childPath = `${prefix}${head}`
      if (rest.includes("/")) {
        if (!nodes.has(childPath)) nodes.set(childPath, { name: head, path: childPath, is_dir: true })
        continue
      }
      const info = meta.get(path)
      const node: any = { name: head, path: childPath, is_dir: false }
      if (!strippedMeta.has(path)) {
        node.size = info?.size ?? files.get(path)!.length
        node.mtimeMs = info?.mtimeMs ?? 1000
      }
      nodes.set(childPath, node)
    }
    const list = [...nodes.values()].map((node) => (node.is_dir ? { ...node, children: childrenOf(node.path) } : node))
    return descending ? list.reverse() : list
  }
  return {
    files,
    meta,
    strippedMeta,
    missingDirs,
    writes,
    listDirectoryCalls,
    childrenOf,
    setDescending: (value: boolean) => { descending = value },
  }
})

vi.mock("@/commands/fs", () => ({
  readFile: async (path: string) => {
    if (!io.files.has(path)) throw new Error(`文件缺失：${path}`)
    return io.files.get(path)!
  },
  writeFileAtomic: async (path: string, contents: string) => {
    io.writes.push(path)
    io.files.set(path, contents)
  },
  createDirectory: async () => {},
  fileExists: async (path: string) => io.files.has(path),
  listDirectory: async (path: string) => {
    io.listDirectoryCalls.push(path)
    return io.childrenOf(path)
  },
}))

function put(path: string, content = "内容", info?: { size?: number; mtimeMs?: number }): void {
  io.files.set(path, content)
  if (info) io.meta.set(path, info)
}

function expectedFingerprint(entries: [string, number, number][]): Promise<string> {
  return sha256Text(entries.map(([path, size, mtimeMs]) => `${path}\u0000${size}\u0000${mtimeMs}`).join("\n"))
}

beforeEach(() => {
  io.files.clear()
  io.meta.clear()
  io.strippedMeta.clear()
  io.missingDirs.clear()
  io.writes.length = 0
  io.listDirectoryCalls.length = 0
  io.setDescending(false)
  vi.clearAllMocks()
})

describe("bindable 角色缓存文件", () => {
  it("缓存路径：位于项目 .qmai 目录下，文件名固定", () => {
    expect(BINDABLE_CHARACTERS_CACHE_FILE).toBe("bindable-characters.json")
    expect(bindableCharactersCachePath("/a/b")).toBe("/a/b/.qmai/bindable-characters.json")
    expect(bindableCharactersCachePath("C:\\proj")).toBe("C:/proj/.qmai/bindable-characters.json")
  })
})

describe("bindable 指纹", () => {
  it("指纹格式：路径、大小、修改时间以 NUL 拼接后按路径升序取哈希", async () => {
    put(`${entityDir}/b.md`, "乙", { size: 30, mtimeMs: 111 })
    put(`${entityDir}/a.md`, "甲", { size: 3, mtimeMs: 222 })
    put(`${outlineDir}/sub/c.md`, "丙", { size: 9, mtimeMs: 333 })

    const fingerprint = await computeBindableFingerprint(projectPath)

    expect(fingerprint).toBe(await expectedFingerprint([
      [`${entityDir}/a.md`, 3, 222],
      [`${entityDir}/b.md`, 30, 111],
      [`${outlineDir}/sub/c.md`, 9, 333],
    ]))
  })

  it("只统计 .md 文件：其他扩展名不进入清单", async () => {
    put(`${entityDir}/a.md`, "甲", { size: 5, mtimeMs: 1000 })
    put(`${entityDir}/notes.txt`, "笔记", { size: 6, mtimeMs: 1000 })

    expect(await computeBindableFingerprint(projectPath)).toBe(
      await expectedFingerprint([[`${entityDir}/a.md`, 5, 1000]]),
    )
  })

  it("元数据缺失时大小与修改时间按 0 计算", async () => {
    put(`${entityDir}/a.md`, "甲")
    io.strippedMeta.add(`${entityDir}/a.md`)

    const fingerprint = await computeBindableFingerprint(projectPath)

    expect(fingerprint).toBe(await expectedFingerprint([[`${entityDir}/a.md`, 0, 0]]))
    io.strippedMeta.delete(`${entityDir}/a.md`)
    expect(await computeBindableFingerprint(projectPath)).not.toBe(fingerprint)
  })

  it("wiki 目录缺失不抛：指纹仍为稳定字符串（空清单的哈希）", async () => {
    io.missingDirs.add(entityDir)
    io.missingDirs.add(outlineDir)

    expect(await computeBindableFingerprint(projectPath)).toBe(await sha256Text(""))
  })

  it("排序无关：listDirectory 子节点顺序不同时指纹相同", async () => {
    put(`${entityDir}/a.md`, "甲")
    put(`${entityDir}/b.md`, "乙")

    const ascending = await computeBindableFingerprint(projectPath)
    expect((await listDirectory(entityDir)).map((node) => node.name)).toEqual(["a.md", "b.md"])
    expect(ascending).toBe(await expectedFingerprint([
      [`${entityDir}/a.md`, 1, 1000],
      [`${entityDir}/b.md`, 1, 1000],
    ]))

    io.setDescending(true)
    expect((await listDirectory(entityDir)).map((node) => node.name)).toEqual(["b.md", "a.md"])

    expect(await computeBindableFingerprint(projectPath)).toBe(ascending)
  })
})

describe("bindable 缓存读写", () => {
  it("有效缓存读取：返回指纹、名单与更新时间", async () => {
    io.files.set(
      bindableCharactersCachePath(projectPath),
      JSON.stringify({ fingerprint: "fp", names: ["甲"], updatedAt: 5, llmRefinedFingerprint: "llm-fp" }),
    )
    expect(await readBindableCharactersCache(projectPath)).toEqual({
      fingerprint: "fp",
      names: ["甲"],
      updatedAt: 5,
      llmRefinedFingerprint: "llm-fp",
    })
  })

  it("缓存文件缺失时读取返回 null", async () => {
    io.files.set(bindableCharactersCachePath(projectPath), JSON.stringify({ fingerprint: "fp", names: ["甲"], updatedAt: 1 }))
    expect(await readBindableCharactersCache(projectPath)).not.toBeNull()

    io.files.delete(bindableCharactersCachePath(projectPath))
    expect(await readBindableCharactersCache(projectPath)).toBeNull()
  })

  it("损坏 JSON 读取返回 null", async () => {
    io.files.set(bindableCharactersCachePath(projectPath), JSON.stringify({ fingerprint: "fp", names: ["甲"], updatedAt: 1 }))
    expect(await readBindableCharactersCache(projectPath)).not.toBeNull()

    io.files.set(bindableCharactersCachePath(projectPath), "{ 这不是 JSON")
    expect(await readBindableCharactersCache(projectPath)).toBeNull()
  })

  it.each([
    ["names 不是数组", { fingerprint: "abc", names: "甲", updatedAt: 1 }],
    ["names 含非字符串", { fingerprint: "abc", names: ["甲", 1], updatedAt: 1 }],
    ["fingerprint 缺失", { names: ["甲"], updatedAt: 1 }],
    ["fingerprint 为空串", { fingerprint: "   ", names: ["甲"], updatedAt: 1 }],
    ["顶层不是对象", ["甲"]],
  ])("字段类型不符（%s）时读取返回 null", async (_label, payload) => {
    io.files.set(bindableCharactersCachePath(projectPath), JSON.stringify({ fingerprint: "fp", names: ["甲"], updatedAt: 1 }))
    expect(await readBindableCharactersCache(projectPath)).not.toBeNull()

    io.files.set(bindableCharactersCachePath(projectPath), JSON.stringify(payload))
    expect(await readBindableCharactersCache(projectPath)).toBeNull()
  })

  it("读取时清洗名单：去空白、去空项、去重并保留原顺序", async () => {
    io.files.set(
      bindableCharactersCachePath(projectPath),
      JSON.stringify({ fingerprint: "fp", names: [" 乙 ", "甲", "乙", "", "   "], updatedAt: 5 }),
    )

    expect(await readBindableCharactersCache(projectPath)).toEqual({ fingerprint: "fp", names: ["乙", "甲"], updatedAt: 5 })
  })

  it("写入缓存：通过 writeFileAtomic 落盘为易读 JSON", async () => {
    await writeBindableCharactersCache(projectPath, { fingerprint: "fp", names: ["甲", "甲"], updatedAt: 7 })

    expect(io.writes).toEqual([bindableCharactersCachePath(projectPath)])
    const raw = io.files.get(bindableCharactersCachePath(projectPath))!
    expect(raw).toContain("\n")
    expect(JSON.parse(raw)).toEqual({ fingerprint: "fp", names: ["甲"], updatedAt: 7 })
  })

  it("写入保留 llmRefinedFingerprint：非空值原样落盘并可被读回", async () => {
    await writeBindableCharactersCache(projectPath, {
      fingerprint: "fp",
      names: ["甲"],
      llmRefinedFingerprint: "llm-fp-1",
      updatedAt: 7,
    })

    const raw = io.files.get(bindableCharactersCachePath(projectPath))!
    expect(JSON.parse(raw).llmRefinedFingerprint).toBe("llm-fp-1")
    expect(await readBindableCharactersCache(projectPath)).toEqual({
      fingerprint: "fp",
      names: ["甲"],
      updatedAt: 7,
      llmRefinedFingerprint: "llm-fp-1",
    })
  })

  it("写入省略空的 llmRefinedFingerprint：缺失或空串时 JSON 中不含该键", async () => {
    await writeBindableCharactersCache(projectPath, { fingerprint: "fp", names: ["甲"], updatedAt: 7 })
    const omitted = io.files.get(bindableCharactersCachePath(projectPath))!
    // 断言原始 JSON 文本：写成 null/"" 也会命中这条。
    expect(omitted).not.toContain("llmRefinedFingerprint")
    expect(Object.keys(JSON.parse(omitted))).toEqual(["fingerprint", "names", "updatedAt"])

    await writeBindableCharactersCache(projectPath, {
      fingerprint: "fp",
      names: ["甲"],
      llmRefinedFingerprint: "",
      updatedAt: 8,
    })
    const empty = io.files.get(bindableCharactersCachePath(projectPath))!
    expect(empty).not.toContain("llmRefinedFingerprint")
    expect(Object.keys(JSON.parse(empty))).toEqual(["fingerprint", "names", "updatedAt"])
  })
})

describe("bindable 缓存加载", () => {
  it("指纹只算一次：缓存未命中时整次加载只扫描一次清单", async () => {
    put(`${entityDir}/a.md`, "甲")
    put(`${outlineDir}/b.md`, "乙")
    // compute 不触碰 listDirectory，因此下面的调用记录全部来自指纹扫描：
    // 一轮扫描固定是 wiki/entities、wiki/outlines 各一次。
    const compute = vi.fn(async () => ["甲", "乙"])

    // 场景一：缓存文件缺失。
    const missing = await loadBindableCharactersWithCache(projectPath, compute)
    expect(missing.cacheHit).toBe(false)
    expect(compute).toHaveBeenCalledTimes(1)
    expect(io.listDirectoryCalls).toEqual([entityDir, outlineDir])

    // 场景二：缓存指纹过期，必须重算并落盘——比对与写入共用同一次扫描。
    io.listDirectoryCalls.length = 0
    io.files.set(
      bindableCharactersCachePath(projectPath),
      JSON.stringify({ fingerprint: "过期的指纹", names: ["旧名单"], updatedAt: 1 }),
    )
    const stale = await loadBindableCharactersWithCache(projectPath, compute)
    expect(stale.cacheHit).toBe(false)
    expect(compute).toHaveBeenCalledTimes(2)
    expect(io.listDirectoryCalls).toEqual([entityDir, outlineDir])
    expect(JSON.parse(io.files.get(bindableCharactersCachePath(projectPath))!).fingerprint).toBe(stale.fingerprint)

    // 落盘用的指纹与比对用的指纹同源，因此紧接着就能命中。
    io.listDirectoryCalls.length = 0
    const hit = await loadBindableCharactersWithCache(projectPath, compute)
    expect(hit.cacheHit).toBe(true)
    expect(hit.fingerprint).toBe(stale.fingerprint)
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it("未变命中：清单未变化时第二次加载不再调用 compute", async () => {
    put(`${entityDir}/a.md`, "甲")
    const compute = vi.fn(async () => ["甲", "乙"])

    const first = await loadBindableCharactersWithCache(projectPath, compute)
    expect(first.cacheHit).toBe(false)
    expect(first.names).toEqual(["甲", "乙"])
    expect(io.files.has(bindableCharactersCachePath(projectPath))).toBe(true)

    const second = await loadBindableCharactersWithCache(projectPath, compute)
    expect(second.cacheHit).toBe(true)
    expect(second.names).toEqual(["甲", "乙"])
    expect(second.fingerprint).toBe(first.fingerprint)
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it("新增文件失效：wiki/entities 新增文件后 compute 再次被调用", async () => {
    put(`${entityDir}/a.md`, "甲")
    const compute = vi.fn(async () => ["甲"])

    const first = await loadBindableCharactersWithCache(projectPath, compute)
    put(`${entityDir}/b.md`, "乙")
    const second = await loadBindableCharactersWithCache(projectPath, compute)

    expect(second.fingerprint).not.toBe(first.fingerprint)
    expect(second.cacheHit).toBe(false)
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it("改内容失效：mtimeMs 变化后指纹变化并重新计算", async () => {
    put(`${entityDir}/a.md`, "甲", { size: 3, mtimeMs: 1000 })
    const compute = vi.fn(async () => ["甲"])

    const first = await loadBindableCharactersWithCache(projectPath, compute)
    put(`${entityDir}/a.md`, "甲", { size: 3, mtimeMs: 2000 })
    const second = await loadBindableCharactersWithCache(projectPath, compute)

    expect(second.fingerprint).not.toBe(first.fingerprint)
    expect(second.cacheHit).toBe(false)
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it("改内容失效：size 变化后指纹变化并重新计算", async () => {
    put(`${entityDir}/a.md`, "甲", { size: 3, mtimeMs: 1000 })
    const compute = vi.fn(async () => ["甲"])

    const first = await loadBindableCharactersWithCache(projectPath, compute)
    put(`${entityDir}/a.md`, "甲", { size: 4, mtimeMs: 1000 })
    const second = await loadBindableCharactersWithCache(projectPath, compute)

    expect(second.fingerprint).not.toBe(first.fingerprint)
    expect(second.cacheHit).toBe(false)
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it("删文件失效：删除文稿后 compute 再次被调用", async () => {
    put(`${entityDir}/a.md`, "甲")
    put(`${entityDir}/b.md`, "乙")
    const compute = vi.fn(async () => ["甲", "乙"])

    const first = await loadBindableCharactersWithCache(projectPath, compute)
    io.files.delete(`${entityDir}/b.md`)
    const second = await loadBindableCharactersWithCache(projectPath, compute)

    expect(second.fingerprint).not.toBe(first.fingerprint)
    expect(second.cacheHit).toBe(false)
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it("损坏 JSON 重建：坏 JSON 读取为 null，加载会重算并覆盖缓存", async () => {
    put(`${entityDir}/a.md`, "甲")
    io.files.set(bindableCharactersCachePath(projectPath), "{ 这不是 JSON")
    const compute = vi.fn(async () => ["甲"])

    const result = await loadBindableCharactersWithCache(projectPath, compute)

    expect(result.cacheHit).toBe(false)
    expect(compute).toHaveBeenCalledTimes(1)
    const rewritten = JSON.parse(io.files.get(bindableCharactersCachePath(projectPath))!)
    expect(rewritten.names).toEqual(["甲"])
    expect(rewritten.fingerprint).toBe(result.fingerprint)
  })

  it("wiki 目录缺失不抛：加载仍可用，且在目录持续缺失时二次命中", async () => {
    io.missingDirs.add(entityDir)
    io.missingDirs.add(outlineDir)
    const compute = vi.fn(async () => ["甲"])

    const first = await loadBindableCharactersWithCache(projectPath, compute)
    expect(first.names).toEqual(["甲"])
    expect(first.cacheHit).toBe(false)

    const second = await loadBindableCharactersWithCache(projectPath, compute)
    expect(second.cacheHit).toBe(true)
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it("force 选项：force 时绕过有效缓存并重新计算", async () => {
    put(`${entityDir}/a.md`, "甲")
    const compute = vi.fn(async () => ["甲"])

    await loadBindableCharactersWithCache(projectPath, compute)
    const forced = await loadBindableCharactersWithCache(projectPath, compute, { force: true })

    expect(forced.cacheHit).toBe(false)
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it("compute 抛错时不写缓存并向上抛出", async () => {
    put(`${entityDir}/a.md`, "甲")
    const compute = vi.fn(async () => {
      throw new Error("生成失败")
    })

    await expect(loadBindableCharactersWithCache(projectPath, compute)).rejects.toThrow("生成失败")
    expect(io.writes).not.toContain(bindableCharactersCachePath(projectPath))
    expect(io.files.has(bindableCharactersCachePath(projectPath))).toBe(false)
  })

  it("names 去重且保序：命中与未命中返回同一份顺序名单", async () => {
    put(`${entityDir}/a.md`, "甲")
    const compute = vi.fn(async () => ["乙", "甲", "乙", " 丙 ", ""])

    const first = await loadBindableCharactersWithCache(projectPath, compute)
    expect(first.names).toEqual(["乙", "甲", "丙"])
    expect(JSON.parse(io.files.get(bindableCharactersCachePath(projectPath))!).names).toEqual(["乙", "甲", "丙"])

    const second = await loadBindableCharactersWithCache(projectPath, compute)
    expect(second.cacheHit).toBe(true)
    expect(second.names).toEqual(["乙", "甲", "丙"])
  })
})
