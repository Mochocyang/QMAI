// @vitest-environment jsdom
//
// 生成 check.mjs 使用的 markup 快照（docs/legacy-character-binding-20261006/dump.html）。
//
// 为什么要有这个文件：check.mjs 只在真实 Chromium 里量尺寸，它自己渲染不出 React。
// 上一轮（docs/book-workbench-relayout）手写了一份 dump.html，组件改了以后那份快照没人更新，
// 脚本还在拿旧 DOM 当「验证过」的证据。所以照抄 docs/book-analysis-legacy-merge-20261006/
// dump-legacy-markup.spec.tsx 的做法：用**真实组件**渲染出 markup 再落盘。
//
// 四份渲染 = 四种输入 fixture。check.mjs 的期望来自 [data-dump-case] 这个**输入**标签，
// 不是从 DOM 反推，所以这里也按同一份期望在 vitest 里先断言一遍：
// fixture 写错必须在 vitest 里红，而不是在几何脚本里表现成一个看不懂的失败。
//
//   publishable   沈微（只有散文字段 → rules 为空＝情况 Z，本任务最关键的一档）
//                 裴探（只有 personalityProfile → rules 也为空）
//                 柳青（带便携人格块 → rules 非空，tag 是短的那个「旧版导入」）
//                 ——三张卡片的按钮都必须可点：可用性绝不能看 rules.length
//   unpublishable 无名氏（既无人格块也无任何散文字段）→ 徽标「无可用资料」、两个按钮都禁用
//   in-library    周砚（已在自定义灵魂库、未绑定）→「加入」禁用、「绑定」仍可用
//   bound         陈渡（已绑定到「沈微」）→ 同上，且绑定对话框就在这一份渲染里打开
//
// 对话框走 base-ui Dialog 的 Portal，渲染到 document.body 而不是容器里，所以快照是
// 「容器 innerHTML + body 里多出来的 portal markup」拼起来的；check.mjs 在整页里找
// [data-slot="dialog-content"]，位置无所谓。
//
// 重新生成：
//   npx vitest run docs/legacy-character-binding-20261006/dump-actions.spec.tsx --exclude '**/.codex-temp/**' --exclude '**/.claude/**'
//
// 视图选择（为什么落盘前点一下「列表视图」）：
//   check.mjs 的几何断言分「宽容器 1200px / 窄容器 420px」两组量，宽容器那一组预设卡片是宽的
//   （徽标与两个按钮能并排）。默认三列网格在 1200px 视口下每张卡只有约 356px，而
//   「旧版资料导入 · 无结构化规则」tag + 徽标 + 两个按钮要约 500px，flex-wrap 必然换行
//   （本文件生成过快照后实测：top 差 28px，带短 tag 的柳青那张 42px）。那是卡片宽度决定的，
//   不是按钮行错位；列表视图是组件自己提供的视图（工具栏可切换），卡片占满一列
//   （1200px 下 1096px），宽容器断言才落在它设计时要量的场景上。窄容器那一组不受影响，
//   照旧是真实换行、不溢出。这里没有改任何 markup/CSS，只是点了组件自己的视图按钮。
//
// 已知边界（写在这里免得后人把快照改成「迁就脚本」的样子）：
//   check.mjs 的「宽屏下徽标与按钮在同一行」用 rect.top 差值 <= 2 判定，而真实 CSS 是
//   .wb-soul-actions{align-items:center} + .wb-soul-status 是 12px/1.5=18px 的行内文本、
//   .book-workbench button{min-height:34px}。同一行里中心对齐的两个不同高度的盒子，
//   top 天然差 (34-18)/2=8px——任何「并排」的真实布局都过不了这条。这是断言的实现问题
//   （应比较垂直中心或 flex 行），不是组件问题；快照照实生成，不为迁就它删 tag、
//   去掉 .book-workbench 外壳，或往快照里塞补丁 CSS。

import { writeFileSync } from "node:fs"
import path from "node:path"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { BookAnalysisWorkbench } from "@/components/novel/book-analysis-workbench"
import { parsePortablePersonality, renderPersonalitySkill } from "@/lib/novel/portable-personality"
import type { BookAnalysisLibraryBook } from "@/lib/novel/book-analysis/library-state"
import type { CharacterSoulStatus } from "@/lib/novel/book-analysis/workbench-soul-actions"

// 工作台一挂载就读盘：作品库、版本目录、章节列表、灵魂状态、绑定候选……全部打桩。
// 这份 spec 除了自己生成的 dump.html，一个字节都不该写到真实文件系统上。
const mocks = vi.hoisted(() => {
  const init = vi.fn(async () => {})
  return {
    init,
    load: vi.fn(),
    revisions: vi.fn(async (): Promise<unknown[]> => []),
    // 徽标与两个按钮的可用性都来自这里：逐 fixture 换返回值（一次渲染只能有一种状态）。
    soulStatus: vi.fn(async (): Promise<unknown> => "none"),
    listBindable: vi.fn(async (): Promise<string[]> => ["沈微", "裴探"]),
    addToSoul: vi.fn(async () => ({ auraId: "aura-1", auraName: "沈微" })),
    bindCharacters: vi.fn(async () => ({ succeeded: 1, alreadyBound: [] as string[], failed: [] as string[] })),
    // 只拦落盘：这份快照不点「确认并加入」，但绝不能有任何一条路径能真写盘。
    materialize: vi.fn(async () => ({})),
    inspect: vi.fn(async () => ({ targets: [], impacts: [], fingerprint: "fp-1" })),
    confirmRevision: vi.fn(async () => ({})),
    refreshProject: vi.fn(async () => {}),
    loadStyles: vi.fn(async () => ({ enabledStyleId: null as string | null, styles: [] })),
    setStyle: vi.fn(async () => {}),
    storyMapHistory: vi.fn(async (): Promise<unknown[]> => []),
    wiki: { project: { id: "p", name: "测试项目", path: "/project" }, providerConfigs: {} },
    old: {
      selectedLibraryBookId: null as string | null,
      sidebarRefreshCounter: 0,
      pendingRecognitionTaskId: null as string | null,
      setSelectedLibraryBookId: vi.fn(),
      consumeReopenRequest: vi.fn(),
    },
    // 任务列表留空：渲染必须停在静止态。有 running/queued 任务时 busy=true，
    // 两个按钮会被一起禁用，快照就证明不了「情况 Z 也能点」。
    imports: {
      tasks: [] as unknown[], batches: [], revision: 0, initializeProject: init,
      createBatch: vi.fn(), deletePublishedBook: vi.fn(), deleteRecord: vi.fn(async () => {}),
    },
    pipeline: {
      tasks: [] as unknown[], chunks: [], progresses: {} as Record<string, unknown>, initializeProject: init,
      recognizeWorkbenchCharacters: vi.fn(async () => {}), confirmCharacterSelection: vi.fn(async () => {}),
      startTask: vi.fn(async () => {}),
    },
  }
})

vi.mock("@/stores/wiki-store", () => ({ useWikiStore: Object.assign((s: any) => s(mocks.wiki), { getState: () => mocks.wiki }) }))
vi.mock("@/stores/book-analysis-store", () => ({ useBookAnalysisStore: Object.assign((s: any) => s(mocks.old), { getState: () => mocks.old }) }))
vi.mock("@/stores/book-analysis-import-store", () => ({ useBookAnalysisImportStore: Object.assign(() => mocks.imports, { getState: () => mocks.imports }) }))
vi.mock("@/stores/book-analysis-pipeline-store", () => ({ useBookAnalysisPipelineStore: Object.assign(() => mocks.pipeline, { getState: () => mocks.pipeline }) }))
vi.mock("@/lib/novel/book-analysis/library-state", () => ({ loadBookAnalysisLibraryState: mocks.load }))
vi.mock("@/lib/novel/book-analysis/workbench-storage", () => ({ loadWorkbenchRevisions: mocks.revisions }))
// 只要 3 章：快照没必要为了 123 章的估算文案膨胀。
vi.mock("@/lib/novel/book-analysis/analysis-engine", () => ({
  loadChapterList: async () => Array.from({ length: 3 }, (_, i) => ({ chapterId: `c${i + 1}`, order: i + 1, title: `第${i + 1}章`, wordCount: 1000 })),
}))
vi.mock("@/components/chat/chat-model-selector", () => ({ ChatModelSelector: () => <button type="button">默认模型</button> }))
vi.mock("@/lib/novel/book-analysis/analysis-model-resolver", () => ({ resolveTaskLlmConfig: () => ({ model: "测试模型" }) }))
vi.mock("@/lib/novel/writing-style-store", () => ({ loadWritingStyleStore: mocks.loadStyles, setEnabledWritingStyle: mocks.setStyle }))
vi.mock("@/components/novel/book-analysis-input-dialog", () => ({
  BookAnalysisInputDialog: ({ open, workbenchMode }: any) => open ? <div role="dialog">{workbenchMode ? "单页导入" : "旧版导入"}</div> : null,
}))
vi.mock("@/components/novel/book-analysis-usage-summary", () => ({ BookAnalysisUsageSummary: () => null }))
// StoryMapContent 会读盘；角色页签下它压根不渲染，但依赖还是照工作台 spec 打上桩。
vi.mock("@/lib/novel/book-analysis/story-map-history", () => ({ listStoryMapHistory: mocks.storyMapHistory }))
vi.mock("@/lib/novel/book-analysis/workbench-soul-actions", () => ({
  loadCharacterSoulStatus: mocks.soulStatus,
  addCharacterToSoulLibrary: mocks.addToSoul,
  bindCharacterToNovelCharacters: mocks.bindCharacters,
}))
vi.mock("@/lib/novel/character-aura", () => ({ listBindableNovelCharacters: mocks.listBindable }))
vi.mock("@/lib/project-refresh", () => ({ refreshProjectState: mocks.refreshProject }))
vi.mock("@/lib/novel/book-analysis/workbench-publish", () => ({
  inspectWorkbenchPublication: mocks.inspect, confirmWorkbenchRevision: mocks.confirmRevision,
}))
// 只替换落盘那一个函数：buildLegacyCharacterRevision 必须是真的，
// 「旧版条目并入新版结果区」正是这份快照要证明的东西。
vi.mock("@/lib/novel/book-analysis/legacy-character-revision", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/novel/book-analysis/legacy-character-revision")>()),
  materializeLegacyCharacterRevision: mocks.materialize,
}))

type Character = BookAnalysisLibraryBook["characters"][number]
type Skill = BookAnalysisLibraryBook["skills"][number]

/** 旧版作品资料；characters/skills 就是 buildLegacyCharacterRevision 的全部输入。 */
function legacyBook(characters: Character[], skills: Skill[] = []): BookAnalysisLibraryBook {
  return {
    id: "book-1",
    path: "/project/book-analysis/book-1",
    metadata: { title: "测试作品", totalChapters: 3, totalWords: 12000, sourceType: "file", createdAt: 1, updatedAt: 2 },
    recognizedCharacters: [],
    characters,
    skills,
    styleStatus: "disabled",
    boundAurasCount: 0,
    addedAuraCharacterIds: [],
    evidence: [],
  }
}

function character(name: string, fields: Partial<Character> = {}): Character {
  return {
    id: `char-${name}`, name, aliases: [], importance: 9, category: "protagonist",
    firstAppearance: 1, lastAppearance: 3, appearanceCount: 3,
    description: "", personality: "", speechStyle: "", relationships: [], keyEvents: [], corpus: "",
    ...fields,
  }
}

interface DumpFixture {
  name: "publishable" | "unpublishable" | "in-library" | "bound"
  /** 这一份渲染里 loadCharacterSoulStatus 的返回值（逐 subject 相同）。 */
  status: CharacterSoulStatus
  book: BookAnalysisLibraryBook
  subjects: string[]
  /** check.mjs 的同名期望；两边必须一致，否则快照和断言就对不上了。 */
  badge: string
  expectDisabled: [add: boolean, bind: boolean]
}

// 便携人格块：让「带 Skill 的旧版角色」在快照里也有一条真实规则（rules 非空）。
const portable = parsePortablePersonality({
  version: 1,
  summary: "遇事先核对账册再开口。",
  scope: "只迁移处事与表达倾向，不继承身份。",
  rules: [{
    id: "P1", field: "decisionHeuristics", condition: "信息不足时", tendency: "先核对材料再判断",
    boundary: "不附带职业知识", evidenceIds: ["E1"],
  }],
  evidence: [{ id: "E1", chapterId: "chapter-1", quote: "他先核对了账册。" }],
})

const FIXTURES: DumpFixture[] = [
  {
    name: "publishable",
    status: "none",
    subjects: ["沈微", "裴探", "柳青"],
    badge: "未加入灵魂库",
    expectDisabled: [false, false],
    book: legacyBook([
      // 情况 Z：只有散文字段、没有便携人格块 → rules 为空，但资料齐全。
      character("沈微", { personality: "克制。", description: "旧城巡夜人。" }),
      // 情况 Y：只有 personalityProfile → rules 同样为空。
      character("裴探", {
        personalityProfile: { personality: "遇事退半步再答。", motivation: "", speechStyle: "", behaviorPatterns: "", quotes: [] },
      }),
      // 有便携人格块 → rules 非空，卡片上的 tag 换成短的「旧版导入」。
      character("柳青", { personality: "账目上一分不让。" }),
    ], [{
      id: "skill-char-柳青", characterId: "char-柳青", characterName: "柳青",
      skillContent: renderPersonalitySkill("柳青", "测试作品", portable),
      sourceBook: "测试作品", chapterRange: ["1", "3"], createdAt: 3,
    }]),
  },
  {
    name: "unpublishable",
    status: "none",
    subjects: ["无名氏"],
    badge: "无可用资料",
    expectDisabled: [true, true],
    // 无人格块、无 Skill、personality/description 都是空串 → hasPublishableData 为 false。
    book: legacyBook([character("无名氏")]),
  },
  {
    name: "in-library",
    status: "added",
    subjects: ["周砚"],
    badge: "已在灵魂库",
    expectDisabled: [true, false],
    book: legacyBook([character("周砚", { personality: "多疑，先看人再说话。" })]),
  },
  {
    name: "bound",
    status: { bound: ["沈微"] },
    subjects: ["陈渡"],
    badge: "已绑定「沈微」",
    expectDisabled: [true, false],
    book: legacyBook([character("陈渡", { description: "旧识，开口先笑。" })]),
  },
]

const actionRow = (host: HTMLElement, subject: string) =>
  host.querySelector<HTMLElement>(`[data-testid="wb-soul-actions-${subject}"]`)

const buttonsOf = (row: HTMLElement) => [...row.querySelectorAll<HTMLButtonElement>("button")]

/** 等异步 effect 落地（读盘/状态查询都是 promise，render 一次是不够的）。 */
async function settle(ready: () => boolean, hint: string) {
  for (let attempt = 0; attempt < 25; attempt++) {
    if (ready()) return
    await act(async () => {})
  }
  throw new Error(`等待渲染稳定超时：${hint}`)
}

/** body 里除了容器以外的东西，就是 Portal 出来的对话框。 */
const portalMarkup = (host: HTMLElement) =>
  [...document.body.children].filter((el) => el !== host).map((el) => el.outerHTML).join("\n")

async function renderFixture(fixture: DumpFixture): Promise<string> {
  localStorage.clear()
  // 上一份用例的 portal 残留（对话框）还挂在 body 上，不清掉会混进这一份快照。
  document.body.replaceChildren()
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  mocks.load.mockResolvedValue({ books: [fixture.book] })
  mocks.revisions.mockResolvedValue([])
  mocks.soulStatus.mockImplementation(async () => fixture.status)
  mocks.listBindable.mockResolvedValue(["沈微", "裴探"])
  try {
    await act(async () => { root.render(<BookAnalysisWorkbench />) })
    await settle(
      () => fixture.subjects.every((subject) => actionRow(host, subject)?.querySelector(".wb-soul-status")?.textContent === fixture.badge),
      `${fixture.name} 的状态徽标`,
    )
    // 再冲几次微任务：徽标已经对了也未必代表灵魂状态那次查询已经落地。
    for (let i = 0; i < 3; i++) await act(async () => {})

    // 先把「输入 fixture → 界面状态」逐条钉死，再落盘。
    for (const subject of fixture.subjects) {
      const row = actionRow(host, subject)
      expect(row, `${fixture.name}/${subject} 要有按钮行`).not.toBeNull()
      expect(row!.querySelector(".wb-soul-status")!.textContent).toBe(fixture.badge)
      const buttons = buttonsOf(row!)
      expect(buttons.map((b) => b.textContent?.trim())).toEqual(["加入自定义灵魂库", "绑定…"])
      expect(buttons.map((b) => b.disabled)).toEqual(fixture.expectDisabled)
    }

    // 先切到组件自己的「列表视图」：宽容器断言要量的「徽标与两个按钮并排」只有卡片够宽时才成立
    // （默认三列网格在 1200px 下每张卡约 356px，tag+徽标+两个按钮约 500px，必然换行）。
    const listView = host.querySelector<HTMLButtonElement>('[aria-label="列表视图"]')
    expect(listView, "结果区要有列表视图切换按钮").not.toBeNull()
    await act(async () => { listView!.click() })
    expect(host.querySelector(".wb-skill-grid")!.getAttribute("data-view")).toBe("list")

    // 「绑定…」必须能打开对话框（只有在可点的 fixture 上才有意义）。
    if (fixture.name === "bound") {
      const bind = buttonsOf(actionRow(host, fixture.subjects[0])!).find((b) => b.textContent?.includes("绑定"))!
      expect(bind.disabled).toBe(false)
      await act(async () => { bind.click() })
      await settle(() => document.body.textContent?.includes("裴探") ?? false, "绑定对话框的候选人物")
      const probe = document.createElement("div")
      probe.innerHTML = portalMarkup(host)
      const dialog = probe.querySelector<HTMLElement>('[data-slot="dialog-content"]')
      expect(dialog, "绑定对话框要真的渲染出来").not.toBeNull()
      // check.mjs 量的是这一层：role、可滚动列表、取消/绑定所选两个按钮。
      expect(dialog!.getAttribute("role")).toBe("dialog")
      expect(dialog!.querySelector(".overflow-y-auto")).not.toBeNull()
      const labels = [...dialog!.querySelectorAll("button")].map((b) => b.textContent ?? "")
      expect(labels.some((label) => label.includes("取消"))).toBe(true)
      expect(labels.some((label) => label.includes("绑定所选"))).toBe(true)
    }

    return `<div data-dump-case="${fixture.name}">\n${host.innerHTML}\n${portalMarkup(host)}\n</div>`
  } finally {
    await act(async () => { root.unmount() })
    host.remove()
  }
}

describe("生成几何检查用的 markup 快照", () => {
  it("四种 fixture 各渲染一次（含打开着的绑定对话框），拼成 dump.html", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    // 组件里有几处 window.confirm；这份快照不该走到，但真走到了也不能弹原生框卡住进程。
    vi.spyOn(window, "confirm").mockReturnValue(true)

    const parts: string[] = []
    for (const fixture of FIXTURES) parts.push(await renderFixture(fixture))

    const html = `<!-- 由 dump-actions.spec.tsx 用真实组件渲染生成，请勿手改。 -->\n${parts.join("\n")}\n`
    writeFileSync(path.resolve("docs/legacy-character-binding-20261006/dump.html"), html, "utf8")

    // 快照必须真的含有四种用例与对话框，否则 check.mjs 会在半份文档上「全部通过」。
    for (const fixture of FIXTURES) expect(html).toContain(`data-dump-case="${fixture.name}"`)
    expect(html).toContain("加入自定义灵魂库")
    expect(html).toContain("旧版资料导入 · 无结构化规则")
    expect(html).toContain('data-slot="dialog-content"')
    expect(html).toContain("绑定所选")
  })
})
