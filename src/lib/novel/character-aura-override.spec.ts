import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  BUILT_IN_CHARACTER_AURAS,
  listCharacterAuras,
  listEditedBuiltInAuraIds,
  loadCharacterAuraStore,
  updateBuiltInCharacterAura,
  resetBuiltInCharacterAura,
} from "./character-aura"

/**
 * 内置灵魂覆盖层（feature/soul-detail-redesign）。
 *
 * 这一组用例锁住三条行为，任何一条被改坏，用户就会看到「改了没生效」或「恢复默认把出厂内容弄丢」：
 *   1. 改内置灵魂 = 只写覆盖层，出厂常量一个字节都不动。
 *   2. 恢复默认 = 删覆盖记录，内容原样回来。
 *   3. 覆盖层随项目落盘，重新读取仍在。
 */

const PROJECT = "E:/Novel"
const STORE_PATH = "E:/Novel/.qmai/character-aura.json"

/** 用内存 Map 撑一个假文件系统，让写入能被后续读取看到。 */
function createMemoryFs(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial))
  return {
    files,
    readFile: vi.fn(async (path: string) => {
      const value = files.get(path)
      if (value === undefined) throw new Error(`ENOENT: ${path}`)
      return value
    }),
    writeFileAtomic: vi.fn(async (path: string, content: string) => {
      files.set(path, content)
    }),
    createDirectory: vi.fn(async () => undefined),
    listDirectory: vi.fn(async () => []),
    exists: vi.fn(async (path: string) => files.has(path)),
    removeFile: vi.fn(async (path: string) => {
      files.delete(path)
    }),
  }
}

let fs: ReturnType<typeof createMemoryFs>

vi.mock("@/commands/fs", () => ({
  readFile: (...args: unknown[]) => fs.readFile(...(args as [string])),
  writeFileAtomic: (...args: unknown[]) => fs.writeFileAtomic(...(args as [string, string])),
  createDirectory: (...args: unknown[]) => fs.createDirectory(...(args as [string])),
  listDirectory: (...args: unknown[]) => fs.listDirectory(...(args as [string])),
  exists: (...args: unknown[]) => fs.exists(...(args as [string])),
  removeFile: (...args: unknown[]) => fs.removeFile(...(args as [string])),
}))

const TARGET_ID = "builtin-role-mother-devoted"

function builtInTarget() {
  const aura = BUILT_IN_CHARACTER_AURAS.find((item) => item.id === TARGET_ID)
  if (!aura) throw new Error("测试前置失败：找不到目标内置灵魂")
  return aura
}

/** 出厂定义的快照，用来断言「常量没被改」。 */
const PRISTINE = JSON.stringify(builtInTarget())

beforeEach(() => {
  fs = createMemoryFs({ [STORE_PATH]: JSON.stringify({ customAuras: [], bindings: [] }) })
})

describe("内置灵魂覆盖层", () => {
  it("修改内置灵魂只写覆盖层，出厂常量不变", async () => {
    await updateBuiltInCharacterAura(PROJECT, TARGET_ID, { name: "妈妈（我改过的）" })

    const stored = JSON.parse(fs.files.get(STORE_PATH)!)
    expect(stored.builtInOverrides[TARGET_ID].name).toBe("妈妈（我改过的）")
    // 出厂常量一个字节都不能动，否则「恢复默认」就没有参照了。
    expect(JSON.stringify(BUILT_IN_CHARACTER_AURAS.find((item) => item.id === TARGET_ID))).toBe(PRISTINE)
  })

  it("列表里能看到改后的内容，未改的内置灵魂保持原样", async () => {
    await updateBuiltInCharacterAura(PROJECT, TARGET_ID, { name: "妈妈（我改过的）" })
    const auras = await listCharacterAuras(PROJECT)

    expect(auras.find((item) => item.id === TARGET_ID)?.name).toBe("妈妈（我改过的）")
    const untouched = auras.find((item) => item.id === "builtin-role-glutton")
    expect(untouched?.name).toBe(BUILT_IN_CHARACTER_AURAS.find((item) => item.id === "builtin-role-glutton")?.name)
  })

  it("恢复默认后内容回到出厂状态，并且覆盖记录被删干净", async () => {
    await updateBuiltInCharacterAura(PROJECT, TARGET_ID, { name: "妈妈（我改过的）", mentalModel: "改过的心智模型" })
    await resetBuiltInCharacterAura(PROJECT, TARGET_ID)

    const auras = await listCharacterAuras(PROJECT)
    expect(auras.find((item) => item.id === TARGET_ID)?.name).toBe(builtInTarget().name)
    const stored = JSON.parse(fs.files.get(STORE_PATH)!)
    expect(stored.builtInOverrides[TARGET_ID]).toBeUndefined()
  })

  it("恢复默认只影响目标灵魂，其他已修改的灵魂不受牵连", async () => {
    const otherId = "builtin-role-glutton"
    await updateBuiltInCharacterAura(PROJECT, TARGET_ID, { name: "妈妈（改）" })
    await updateBuiltInCharacterAura(PROJECT, otherId, { name: "吃货（改）" })
    await resetBuiltInCharacterAura(PROJECT, TARGET_ID)

    const auras = await listCharacterAuras(PROJECT)
    expect(auras.find((item) => item.id === TARGET_ID)?.name).toBe(builtInTarget().name)
    expect(auras.find((item) => item.id === otherId)?.name).toBe("吃货（改）")
  })

  it("已修改标识只列出真正改过的灵魂", async () => {
    await updateBuiltInCharacterAura(PROJECT, TARGET_ID, { name: "妈妈（改）" })
    const store = await loadCharacterAuraStore(PROJECT)
    expect(listEditedBuiltInAuraIds(store)).toEqual([TARGET_ID])

    await resetBuiltInCharacterAura(PROJECT, TARGET_ID)
    expect(listEditedBuiltInAuraIds(await loadCharacterAuraStore(PROJECT))).toEqual([])
  })

  it("不允许通过覆盖层改 id 或 builtIn，避免断掉绑定、混进自定义列表", async () => {
    await updateBuiltInCharacterAura(PROJECT, TARGET_ID, {
      id: "hacked-id",
      builtIn: false,
      name: "妈妈（改）",
    } as never)

    const auras = await listCharacterAuras(PROJECT)
    const merged = auras.find((item) => item.name === "妈妈（改）")
    expect(merged?.id).toBe(TARGET_ID)
    expect(merged?.builtIn).toBe(true)
  })

  it("修改不存在的内置灵魂会报错，不会悄悄写一条脏覆盖", async () => {
    await expect(updateBuiltInCharacterAura(PROJECT, "builtin-not-exists", { name: "x" })).rejects.toThrow(
      "未找到内置灵魂",
    )
    const stored = JSON.parse(fs.files.get(STORE_PATH)!)
    expect(stored.builtInOverrides).toBeUndefined()
  })

  it("旧存档没有 builtInOverrides 字段也能正常读取", async () => {
    fs = createMemoryFs({
      [STORE_PATH]: JSON.stringify({ customAuras: [], bindings: [] }),
    })
    const store = await loadCharacterAuraStore(PROJECT)
    expect(store.builtInOverrides).toEqual({})
  })

  it("覆盖层被外部写坏时退化成无修改，不让整个灵魂库读不出来", async () => {
    fs = createMemoryFs({
      [STORE_PATH]: JSON.stringify({ customAuras: [], bindings: [], builtInOverrides: "坏的" }),
    })
    const store = await loadCharacterAuraStore(PROJECT)
    expect(store.builtInOverrides).toEqual({})
    const auras = await listCharacterAuras(PROJECT)
    expect(auras.length).toBeGreaterThanOrEqual(BUILT_IN_CHARACTER_AURAS.length)
  })
})
