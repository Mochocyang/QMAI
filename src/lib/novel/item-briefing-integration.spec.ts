/**
 * 「出场物品」真的进入写作提示词的端到端测试。
 *
 * ## 为什么必须有这个文件
 *
 * 物品此前是**只写不读**的：`ingestChapter` 把 `items` / `itemDetails` 写进快照，
 * 但 `ContextPack` 没有物品字段、`DATA_SOURCE_CATEGORY_MAP` 没有 items、
 * 检索式里也没有物品语义（段标题 `## 相关地点/组织/物品` 承诺了物品，
 * 检索式却是 `"setting 设定 location 地点"`）。结果是分类做得再细，
 * 写作时一件道具都读不到。
 *
 * 所以验收点不是「分类函数算得对」（那由 item-category.spec.ts 覆盖），
 * 而是**磁盘上的快照 → buildContextPack 真实装配 → contextPackToPrompt 提示词**
 * 这条链上确实出现了道具。没有这条断言，本次优化等于没做。
 *
 * 调用方式与生产一致：不传 categories，让注册器装配全部数据源。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const PROJECT = "/proj"
const SNAPSHOT_DIR = `${PROJECT}/.novel/snapshots`

/** 与生产一致的快照文件名规则：三位补零 + .snapshot.json */
function snapshotFile(chapterNumber: number): string {
  return `${SNAPSHOT_DIR}/${String(chapterNumber).padStart(3, "0")}.snapshot.json`
}

function snapshotPayload(options: {
  chapterNumber: number
  items?: string[]
  itemDetails?: Record<string, Record<string, string>>
  itemCategories?: Record<string, string>
}): string {
  return JSON.stringify({
    chapterId: `chapter-${options.chapterNumber}`,
    chapterNumber: options.chapterNumber,
    summary: `第${options.chapterNumber}章摘要`,
    characters: ["萧炎"],
    locations: [],
    organizations: [],
    items: options.items ?? [],
    events: [],
    characterStateChanges: [],
    relationshipChanges: [],
    knowledgeChanges: [],
    foreshadowingChanges: [],
    newCanonFacts: [],
    timelineEvents: [],
    conflicts: [],
    endingHook: "",
    graphNodes: [],
    graphEdges: [],
    itemDetails: options.itemDetails,
    itemCategories: options.itemCategories,
  })
}

describe("出场物品进入写作提示词", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.doUnmock("@/commands/fs")
    vi.doUnmock("@/lib/search")
    vi.resetModules()
  })

  /** 装配一个「项目里只有这些文件」的磁盘，其余读取一律失败。 */
  async function loadPrompt(files: Record<string, string>, task: string, chapterNumber = 4) {
    const normalizedFiles = new Map(
      Object.entries(files).map(([path, content]) => [path.replace(/\\/g, "/"), content]),
    )

    vi.doMock("@/commands/fs", () => ({
      readFile: vi.fn(async (path: string) => {
        const normalized = path.replace(/\\/g, "/")
        const content = normalizedFiles.get(normalized)
        if (content === undefined) throw new Error(`ENOENT: ${normalized}`)
        return content
      }),
      fileExists: vi.fn(async (path: string) => normalizedFiles.has(path.replace(/\\/g, "/"))),
      writeFileAtomic: vi.fn(),
      writeFileIfAbsent: vi.fn(),
      createDirectory: vi.fn(),
      deleteFile: vi.fn(),
      // 「目录列表」按前缀从内存磁盘推导，这样 listSnapshots 能真的发现快照文件。
      listDirectory: vi.fn(async (dir: string) => {
        const normalized = dir.replace(/\\/g, "/")
        return [...normalizedFiles.keys()]
          .filter((path) => path.startsWith(`${normalized}/`))
          .map((path) => ({ name: path.slice(normalized.length + 1), path, isDirectory: false }))
      }),
      readFileAsBase64: vi.fn(),
    }))
    // 其它检索类数据源会经过这个模块；给出空结果，避免无关源报缺失导出。
    vi.doMock("@/lib/search", () => ({
      searchWiki: vi.fn(async () => []),
      tokenizeQuery: vi.fn(() => []),
      searchFiles: vi.fn(async () => []),
      flattenMdFiles: vi.fn(() => []),
    }))

    const { useWikiStore } = await import("@/stores/wiki-store")
    useWikiStore.setState({
      novelMode: true,
      novelConfig: { recentSummaryWindow: 3, searchTopK: 3 } as never,
    })

    const { buildContextPack, contextPackToPrompt } = await import("./context-engine")
    const pack = await buildContextPack(PROJECT, task, chapterNumber)
    return { pack, prompt: contextPackToPrompt(pack, 20_000) }
  }

  it("磁盘快照里的道具经真实装配后进入正文提示词", async () => {
    const { pack, prompt } = await loadPrompt(
      {
        [snapshotFile(3)]: snapshotPayload({
          chapterNumber: 3,
          items: ["玄重尺"],
          itemDetails: {
            玄重尺: {
              holder: "萧炎",
              previousHolders: "",
              abilities: "沉重如山",
              limitations: "极耗斗气",
              origin: "药老所赠",
            },
          },
          itemCategories: { 玄重尺: "主角使用" },
        }),
      },
      "写第4章：萧炎取出玄重尺应战",
    )

    // 1) 上下文包字段被真实填充（这是「读得到」的第一层证据）
    expect(pack.sectionBriefing).toContain("相关道具")
    expect(pack.sectionBriefing).toContain("玄重尺")
    expect(pack.sectionBriefing).toContain("当前持有：萧炎")
    expect(pack.sectionBriefing).toContain("能力：沉重如山")

    // 2) 正文提示词里出现道具段落与内容（最终验收点）
    expect(prompt).toContain("## 本节速记")
    expect(prompt).toContain("### 相关道具")
    expect(prompt).toContain("玄重尺")
    expect(prompt).toContain("极耗斗气")
  })

  it("分类为「没有意义」的道具不进提示词（省 token），但仍留在快照里", async () => {
    const { pack, prompt } = await loadPrompt(
      {
        [snapshotFile(3)]: snapshotPayload({
          chapterNumber: 3,
          items: ["玄重尺", "路人的茶"],
          itemDetails: {
            玄重尺: { holder: "萧炎", previousHolders: "", abilities: "沉重", limitations: "", origin: "" },
            路人的茶: { holder: "萧炎", previousHolders: "", abilities: "", limitations: "", origin: "" },
          },
          itemCategories: { 玄重尺: "主角使用", 路人的茶: "没有意义" },
        }),
      },
      "写第4章：萧炎取出玄重尺应战",
    )

    expect(pack.sectionBriefing).toContain("玄重尺")
    // 分类的价值就体现在这里：无意义道具被挡在提示词之外。
    expect(pack.sectionBriefing).not.toContain("路人的茶")
    expect(prompt).not.toContain("路人的茶")
  })

  it("不与本章相关的道具也不进提示词，避免把全部道具倒进上下文", async () => {
    const { pack } = await loadPrompt(
      {
        [snapshotFile(3)]: snapshotPayload({
          chapterNumber: 3,
          items: ["玄重尺", "别人的刀"],
          itemDetails: {
            玄重尺: { holder: "萧炎", previousHolders: "", abilities: "", limitations: "", origin: "" },
            别人的刀: { holder: "路人甲", previousHolders: "", abilities: "", limitations: "", origin: "" },
          },
        }),
      },
      // 本章点名了玄重尺；别人的刀既没被点名、持有者也不在场 → 应被挡掉
      "写第4章：萧炎取出玄重尺应战",
    )

    expect(pack.sectionBriefing).toContain("玄重尺")
    expect(pack.sectionBriefing).not.toContain("别人的刀")
  })

  it("旧快照没有 itemCategories 时照样能读出来（向后兼容，不因缺字段丢道具）", async () => {
    const { pack, prompt } = await loadPrompt(
      {
        [snapshotFile(2)]: snapshotPayload({
          chapterNumber: 2,
          items: ["旧玉佩"],
          itemDetails: { 旧玉佩: { holder: "萧炎", previousHolders: "", abilities: "", limitations: "", origin: "" } },
        }),
      },
      "写第4章：萧炎握着旧玉佩",
    )

    expect(pack.sectionBriefing).toContain("旧玉佩")
    expect(prompt).toContain("旧玉佩")
  })

  it("只读本章之前的章节快照：未来章节的道具不能提前泄漏进正文", async () => {
    // 关键设计：本章任务**同时点名**两件道具。若第 9 章的快照被误读，
    // 「未来的神兵」就会被选中并出现在提示词里 —— 这样这条断言才有鉴别力。
    // 反过来，如果只点名「已经得到的剑」，那么即使代码读错了快照，
    // 未来的神兵也不会出现，测试会假绿。
    const { pack } = await loadPrompt(
      {
        [snapshotFile(3)]: snapshotPayload({
          chapterNumber: 3,
          items: ["已经得到的剑"],
          itemDetails: { 已经得到的剑: { holder: "萧炎", previousHolders: "", abilities: "", limitations: "", origin: "" } },
        }),
        // 第 9 章还没写，其快照若泄漏进来就是剧透
        [snapshotFile(9)]: snapshotPayload({
          chapterNumber: 9,
          items: ["未来的神兵"],
          itemDetails: { 未来的神兵: { holder: "萧炎", previousHolders: "", abilities: "", limitations: "", origin: "" } },
        }),
      },
      "写第4章：萧炎带着已经得到的剑，也在想未来的神兵",
    )

    expect(pack.sectionBriefing).toContain("已经得到的剑")
    expect(pack.sectionBriefing).not.toContain("未来的神兵")
  })

  it("单份快照损坏时不影响其它快照的道具，也不炸整次装配", async () => {
    const { pack, prompt } = await loadPrompt(
      {
        // 第 2 章故意给一段非法 JSON：走 loadSnapshot 的 catch 分支返回 null
        [snapshotFile(2)]: "{ 这不是合法 JSON",
        [snapshotFile(3)]: snapshotPayload({
          chapterNumber: 3,
          items: ["玄重尺"],
          itemDetails: { 玄重尺: { holder: "萧炎", previousHolders: "", abilities: "", limitations: "", origin: "" } },
        }),
      },
      "写第4章：萧炎取出玄重尺应战",
    )

    // 坏的那份被跳过，好的那份照常读出 —— 损坏不该连累整条链
    expect(pack.sectionBriefing).toContain("相关道具")
    expect(pack.sectionBriefing).toContain("玄重尺")
    expect(prompt).toContain("玄重尺")
  })

  it("完全没有快照时不产生道具小节，也不抛错", async () => {
    const { pack, prompt } = await loadPrompt({}, "写第4章：萧炎修炼")

    expect(pack.sectionBriefing ?? "").not.toContain("相关道具")
    expect(prompt).toContain("写第4章：萧炎修炼")
  })
})
