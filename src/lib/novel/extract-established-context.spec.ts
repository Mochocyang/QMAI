import { afterEach, describe, expect, it, vi } from "vitest"
import { parseCharacterRoleFileName } from "./extract-established-context"

describe("parseCharacterRoleFileName", () => {
  it("从文件名解析定位与姓名", () => {
    expect(parseCharacterRoleFileName("角色-主角-萧炎.md")).toEqual({ name: "萧炎", role: "主角" })
    expect(parseCharacterRoleFileName("角色-反派-纳兰嫣然.md")).toEqual({ name: "纳兰嫣然", role: "反派" })
    expect(parseCharacterRoleFileName("角色-导师-药老.md")).toEqual({ name: "药老", role: "导师" })
  })

  it("角色名里含短横线时不会被截断（按分隔符硬切会切错）", () => {
    expect(parseCharacterRoleFileName("角色-配角-张三-丰.md")).toEqual({ name: "张三-丰", role: "配角" })
  })

  it("定位必须来自已知枚举，且必须整段前缀匹配", () => {
    // 「主角光环」不是定位，不能被当成 role=主角 匹配掉
    expect(parseCharacterRoleFileName("角色-主角光环-某人.md")).toBeNull()
    expect(parseCharacterRoleFileName("角色-神秘人-某人.md")).toBeNull()
  })

  it("非角色文件一律返回 null", () => {
    expect(parseCharacterRoleFileName("设定-力量体系.md")).toBeNull()
    expect(parseCharacterRoleFileName("角色-主角-.md")).toBeNull()
    expect(parseCharacterRoleFileName("角色-主角-萧炎.txt")).toBeNull()
    expect(parseCharacterRoleFileName("随便什么.md")).toBeNull()
  })
})

describe("buildEstablishedContextForExtraction", () => {
  afterEach(() => {
    vi.doUnmock("@/commands/fs")
    vi.doUnmock("./foreshadowing-tracker")
    vi.resetModules()
  })

  async function build(files: string[], foreshadowing: unknown) {
    vi.resetModules()
    vi.doMock("@/commands/fs", () => ({
      listDirectory: vi.fn(async () => files.map((name) => ({ name, path: `/proj/wiki/characters/${name}`, isDirectory: false }))),
      readFile: vi.fn(async () => { throw new Error("ENOENT") }),
      fileExists: vi.fn(async () => false),
      writeFileAtomic: vi.fn(),
      createDirectory: vi.fn(),
    }))
    vi.doMock("./foreshadowing-tracker", () => ({
      loadForeshadowingTracker: vi.fn(async () => foreshadowing),
      createEmptyForeshadowingStore: vi.fn(() => ({ items: [] })),
    }))
    const { buildEstablishedContextForExtraction: buildContext } = await import("./extract-established-context")
    return buildContext("/proj")
  }

  it("给出角色定位名册与尚未回收的伏笔", async () => {
    const context = await build(
      ["角色-主角-萧炎.md", "角色-反派-纳兰嫣然.md", "不是角色.md"],
      { items: [{ description: "玄重尺的来历", status: "planted" }] },
    )
    expect(context).toContain("已建立的角色定位")
    expect(context).toContain("萧炎（主角）")
    expect(context).toContain("纳兰嫣然（反派）")
    expect(context).not.toContain("不是角色")
    expect(context).toContain("尚未回收的伏笔")
    expect(context).toContain("玄重尺的来历")
  })

  it("已放弃的伏笔不算参照（它不再需要照应）", async () => {
    const context = await build([], {
      items: [
        { description: "还在的伏笔", status: "planted" },
        { description: "已放弃的伏笔", status: "abandoned" },
      ],
    })
    expect(context).toContain("还在的伏笔")
    expect(context).not.toContain("已放弃的伏笔")
  })

  it("什么都没有时返回空串，提取提示词因此与改造前完全一致", async () => {
    expect(await build([], { items: [] })).toBe("")
    expect(await build([], null)).toBe("")
  })

  it("角色目录读取失败时只是没有名册，不抛错", async () => {
    vi.resetModules()
    vi.doMock("@/commands/fs", () => ({
      listDirectory: vi.fn(async () => { throw new Error("目录不存在") }),
      readFile: vi.fn(async () => { throw new Error("ENOENT") }),
      fileExists: vi.fn(async () => false),
    }))
    vi.doMock("./foreshadowing-tracker", () => ({
      loadForeshadowingTracker: vi.fn(async () => ({ items: [{ description: "伏笔甲", status: "planted" }] })),
      createEmptyForeshadowingStore: vi.fn(() => ({ items: [] })),
    }))
    const { buildEstablishedContextForExtraction: buildContext } = await import("./extract-established-context")
    const context = await buildContext("/proj")
    expect(context).toContain("伏笔甲")
    expect(context).not.toContain("角色定位")
  })

  it("超出字符上限时截断，不会把提取提示词撑大", async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ description: "很长很长的伏笔描述".repeat(20) + i, status: "planted" }))
    const context = await build([], { items: many })
    expect(context.length).toBeLessThanOrEqual(1_500)
    expect(context.endsWith("…")).toBe(true)
  })
})
