import { beforeEach, describe, expect, it, vi } from "vitest"

const mem = new Map<string, string>()
const dirs = new Map<string, Array<{ name: string; path: string; is_dir: boolean }>>()

vi.mock("@/commands/fs", () => ({
  fileExists: vi.fn(async (path: string) => mem.has(path)),
  readFile: vi.fn(async (path: string) => {
    if (!mem.has(path)) throw new Error("ENOENT")
    return mem.get(path)!
  }),
  writeFileAtomic: vi.fn(async (path: string, content: string) => {
    mem.set(path, content)
  }),
  createDirectory: vi.fn(async () => {}),
  listDirectory: vi.fn(async (path: string) => {
    if (!dirs.has(path)) throw new Error("ENOENT")
    return dirs.get(path)!
  }),
}))

vi.mock("@/stores/wiki-store", () => ({
  useWikiStore: { getState: () => ({ bumpDataVersion: vi.fn() }) },
}))

import {
  collectProjectChapterBodies,
  isStyleEvolutionRunning,
  resetStyleEvolutionInFlight,
  runStyleEvolutionTick,
} from "./style-evolution-runner"
import { emptyState, loadStyleEvolutionState, saveStyleEvolutionState } from "./style-evolution-store"
import { advanceOpenDay } from "./style-evolution-schedule"

const PROJECT = "E:/Novel"
const CHAPTERS = `${PROJECT}/wiki/chapters`

function addChapters(entries: Array<{ name: string; content: string }>) {
  dirs.set(
    CHAPTERS,
    entries.map((e) => ({ name: e.name, path: `${CHAPTERS}/${e.name}`, is_dir: false })),
  )
  for (const e of entries) mem.set(`${CHAPTERS}/${e.name}`, e.content)
}

const BODY = "他走进屋里，雨还在下。\n\n“你回来了。”她说。\n\n他没有答话。\n"

function chapterContent(title: string, body = BODY): string {
  return `---\ntitle: ${title}\ncharacters: [甲, 乙]\n---\n\n${body}`
}

async function primeDueState(projectPath = PROJECT) {
  let state = { ...emptyState(), enabled: true, nextThreshold: 3 as const }
  state = advanceOpenDay(state, "2026-10-01").state
  state = advanceOpenDay(state, "2026-10-02").state
  await saveStyleEvolutionState(projectPath, state)
}

beforeEach(() => {
  mem.clear()
  dirs.clear()
  resetStyleEvolutionInFlight()
})

describe("collectProjectChapterBodies", () => {
  it("只读 wiki/chapters 下的 .md，非 md 文件即使可读也不许进样本", async () => {
    addChapters([
      { name: "chapter-001.md", content: chapterContent("第一章", "他点了根烟。") },
      { name: "chapter-002.md", content: chapterContent("第二章", "雨停了。") },
    ])
    /*
     * ⚠️ 非 md 项**必须也放可读内容**。
     * 若只把它列进目录、不给内容，过滤失效时它会因 readFile 失败而被
     * catch 静默跳过 —— 测试照样通过，等于没测到过滤。
     */
    dirs.get(CHAPTERS)!.push({ name: "cover.png", path: `${CHAPTERS}/cover.png`, is_dir: false })
    mem.set(`${CHAPTERS}/cover.png`, "这是一张封面的二进制占位内容，绝不该被当成正文")

    const bodies = await collectProjectChapterBodies(PROJECT)

    expect(bodies).toHaveLength(2)
    expect(bodies[0]).toBe("他点了根烟。")
    expect(bodies[1]).toBe("雨停了。")
    for (const body of bodies) {
      expect(body).not.toContain("封面")
    }
  })

  it("剥掉 frontmatter：YAML 元数据不许混进正文", async () => {
    addChapters([
      { name: "chapter-001.md", content: chapterContent("第一章", "他点了根烟。") },
    ])

    const bodies = await collectProjectChapterBodies(PROJECT)
    expect(bodies).toEqual(["他点了根烟。"])
    // frontmatter 里的标题与人物绝不能混进正文（会污染句长与标点统计）
    for (const body of bodies) {
      expect(body).not.toContain("title:")
      expect(body).not.toContain("characters:")
    }
  })

  it("按章节序号自然排序（chapter-9 要排在 chapter-10 前面）", async () => {
    addChapters([
      { name: "chapter-10.md", content: chapterContent("十", "第十。") },
      { name: "chapter-9.md", content: chapterContent("九", "第九。") },
      { name: "chapter-2.md", content: chapterContent("二", "第二。") },
    ])

    const bodies = await collectProjectChapterBodies(PROJECT)
    expect(bodies).toEqual(["第二。", "第九。", "第十。"])
  })

  it("目录不存在（新项目）⇒ 空数组，不抛错", async () => {
    await expect(collectProjectChapterBodies("E:/Empty")).resolves.toEqual([])
  })

  it("单个章节读不出来 ⇒ 跳过它，其余照常返回", async () => {
    addChapters([
      { name: "chapter-001.md", content: chapterContent("一", "第一段。") },
      { name: "chapter-002.md", content: chapterContent("二", "第二段。") },
    ])
    // 模拟这个文件读失败
    mem.delete(`${CHAPTERS}/chapter-001.md`)

    const bodies = await collectProjectChapterBodies(PROJECT)
    expect(bodies).toEqual(["第二段。"])
  })

  it("子目录被忽略，即使它的名字以 .md 结尾", async () => {
    /*
     * ⚠️ 目录名必须**以 `.md` 结尾**才测得到 `is_dir` 那道判断。
     * 用一个叫 `drafts` 的目录是测不出来的：它会被 `\.md$` 那道过滤拦住，
     * 于是「去掉 is_dir 判断」这个变异照样通过（实测漏杀过一次）。
     */
    dirs.set(CHAPTERS, [
      { name: "归档.md", path: `${CHAPTERS}/归档.md`, is_dir: true },
      { name: "chapter-001.md", path: `${CHAPTERS}/chapter-001.md`, is_dir: false },
    ])
    mem.set(`${CHAPTERS}/chapter-001.md`, chapterContent("一", "正文。"))
    // 同样要给它可读内容，否则 is_dir 过滤失效时会被 catch 掩盖
    mem.set(`${CHAPTERS}/归档.md`, "归档目录的占位内容，不该被当成章节")

    expect(await collectProjectChapterBodies(PROJECT)).toEqual(["正文。"])
  })

  it("frontmatter 只有空白正文的章节被丢掉", async () => {
    addChapters([
      { name: "chapter-001.md", content: chapterContent("一", "正文。") },
      { name: "chapter-002.md", content: "---\ntitle: 空\n---\n\n   \n" },
    ])
    expect(await collectProjectChapterBodies(PROJECT)).toEqual(["正文。"])
  })
})

describe("并发守卫", () => {
  /*
   * ★ 这条守着 `App.tsx` 的真实缺陷面：`hydrateDeferredProjectState` 是 void 调用、
   * 没有锁，而 `handleProjectOpened` 一天有 4 个入口。引擎里的 `lastAttemptedOn`
   * 要**落盘之后**才生效，两次并发调用可能都读到「今天还没试过」的旧状态。
   */
  it("同一项目并发两次：第二次直接放弃，不会起第二轮", async () => {
    await primeDueState()
    addChapters([
      { name: "chapter-001.md", content: chapterContent("一", BODY.repeat(60)) },
      { name: "chapter-002.md", content: chapterContent("二", BODY.repeat(60)) },
      { name: "chapter-003.md", content: chapterContent("三", BODY.repeat(60)) },
    ])

    let release: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const callModel = vi.fn(async () => {
      await gate
      return JSON.stringify({
        schemaVersion: 2,
        generatedAt: 1,
        integratedDna: "## 语言特征\n短句。\n\n## 风格硬约束\n1. 少形容词。",
        constitution: "1. 少形容词",
        samples: ["他点了根烟。"],
      })
    })

    const first = runStyleEvolutionTick(PROJECT, { callModel })
    // 第二轮在同一个 tick 里发起：此刻第一轮还没跑完
    const second = runStyleEvolutionTick(PROJECT, { callModel })
    const secondResult = await second
    expect(secondResult).toBeNull()
    expect(isStyleEvolutionRunning(PROJECT)).toBe(true)

    release!()
    const firstResult = await first
    expect(firstResult).not.toBeNull()

    // 跑完后守卫释放
    expect(isStyleEvolutionRunning(PROJECT)).toBe(false)
  })

  it("跑完之后守卫释放：下一次调用还能正常跑", async () => {
    await primeDueState()
    addChapters([
      { name: "chapter-001.md", content: chapterContent("一", BODY.repeat(60)) },
      { name: "chapter-002.md", content: chapterContent("二", BODY.repeat(60)) },
      { name: "chapter-003.md", content: chapterContent("三", BODY.repeat(60)) },
    ])
    const callModel = vi.fn(async () =>
      JSON.stringify({
        schemaVersion: 2,
        generatedAt: 1,
        integratedDna: "## 语言特征\n短句。",
        constitution: "1. 少形容词",
        samples: [],
      }),
    )

    const first = await runStyleEvolutionTick(PROJECT, { callModel })
    expect(first?.status).toBe("completed")
    expect(isStyleEvolutionRunning(PROJECT)).toBe(false)

    // 同一项目再 tick 一次：不会因为"还在跑"被拒，而是因为节律不该跑
    const second = await runStyleEvolutionTick(PROJECT, { callModel })
    expect(second?.status).toBe("skipped-not-due")
  })

  it("不同项目互不阻塞", async () => {
    await primeDueState(PROJECT)
    await primeDueState("E:/Other")
    addChapters([
      { name: "chapter-001.md", content: chapterContent("一", BODY.repeat(60)) },
      { name: "chapter-002.md", content: chapterContent("二", BODY.repeat(60)) },
      { name: "chapter-003.md", content: chapterContent("三", BODY.repeat(60)) },
    ])
    dirs.set(
      "E:/Other/wiki/chapters",
      [1, 2, 3].map((i) => ({
        name: `chapter-00${i}.md`,
        path: `E:/Other/wiki/chapters/chapter-00${i}.md`,
        is_dir: false,
      })),
    )
    for (const i of [1, 2, 3]) {
      mem.set(`E:/Other/wiki/chapters/chapter-00${i}.md`, chapterContent(String(i), BODY.repeat(60)))
    }

    const callModel = vi.fn(async () =>
      JSON.stringify({
        schemaVersion: 2,
        generatedAt: 1,
        integratedDna: "## 语言特征\n短句。",
        constitution: "1. 少约束",
        samples: [],
      }),
    )

    const [a, b] = await Promise.all([
      runStyleEvolutionTick(PROJECT, { callModel }),
      runStyleEvolutionTick("E:/Other", { callModel }),
    ])
    expect(a?.status).toBe("completed")
    expect(b?.status).toBe("completed")
  })

  it("接线层内部抛错时绝不外抛给调用方，且仍释放守卫", async () => {
    await primeDueState()
    /*
     * 调用方是 `App.tsx` 里的 `void runStyleEvolutionTick(proj.path)`：
     * 抛出去就是一个未处理的 Promise 拒绝（用户侧表现为控制台报错、无提示）。
     * 所以这里必须**不抛**，而是收敛成 `incomplete` + 原因。
     */
    const result = await runStyleEvolutionTick(PROJECT, {
      collectChapterBodies: async () => {
        throw new Error("磁盘炸了")
      },
    })

    expect(result).not.toBeNull()
    expect(result?.status).toBe("incomplete")
    expect(result?.reason).toContain("磁盘炸了")
    // 守卫必须释放，否则这个项目此后永不进化
    expect(isStyleEvolutionRunning(PROJECT)).toBe(false)
  })

  it("被拒绝的那一次不影响已经落盘的打开日计数", async () => {
    await primeDueState()
    let release: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const first = runStyleEvolutionTick(PROJECT, {
      collectChapterBodies: async () => [],
      callModel: async () => {
        await gate
        return "{}"
      },
    })
    await runStyleEvolutionTick(PROJECT, { collectChapterBodies: async () => [] })
    release!()
    await first

    const state = await loadStyleEvolutionState(PROJECT)
    // 计数停在阈值之上（样本为空 ⇒ incomplete ⇒ 不归零）
    expect(state.openDayCount).toBeGreaterThanOrEqual(state.nextThreshold)
  })
})
