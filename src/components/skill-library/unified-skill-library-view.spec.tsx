// @vitest-environment jsdom

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useWikiStore } from "@/stores/wiki-store"
import { useFavoriteSkillStore } from "@/stores/favorite-skill-store"
import {
  UnifiedSkillLibraryView,
  entryEnabled,
  entryFavoriteTarget,
  resolveActiveTab,
} from "./unified-skill-library-view"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const readFileMock = vi.hoisted(() => vi.fn())
const writeFileMock = vi.hoisted(() => vi.fn())
const writeFileAtomicMock = vi.hoisted(() => vi.fn())
const joinMock = vi.hoisted(() => vi.fn(async (...parts: string[]) => parts.join("/")))
const openDialogMock = vi.hoisted(() => vi.fn())
const saveDialogMock = vi.hoisted(() => vi.fn())
vi.mock("@/commands/fs", () => ({
  readFile: readFileMock,
  writeFile: writeFileMock,
  writeFileAtomic: writeFileAtomicMock,
  createDirectory: async () => {},
  // 加固后的 store 用 fileExists 区分「索引不存在」与「读不出来」。
  // 这两个用例只验证「tab 切过去了、页面渲染出来了」，不需要真有索引，返回 false 最省事：
  // store 会当成「还没建过档」→ 空列表 → 渲染空态。
  fileExists: async () => false,
  listDirectory: async () => [],
}))

vi.mock("@/lib/novel/persona-skill-learning", () => ({
  regeneratePersonaSkillResearch: vi.fn(async () => true),
}))

/*
 * ⚠️ 这里**故意不 mock** `@/lib/novel/writing-style-store`（前一版 mock 过它）。
 * 那一版 mock 它是为了造出「文风库读取失败」这个输入；但真 loader
 * `loadWritingStyleStore` 把每一次失败都在内部吞掉、返回空 store ——
 * **它的 promise 永远不会 reject**。于是那个 mock 造的是**真 loader 产生不了的状态**，
 * 用例只能证明 mock 自己（这就是复核批 MUST-FIX 1）。
 * 现在这条路上没有 loader mock：任何「读取故障」都必须是**真的**读取故障
 * （真 loader + 让 `readFile` 抛错）。⚠️ 别再把这个 mock 加回来。
 */

vi.mock("@tauri-apps/api/path", () => ({
  join: joinMock,
}))

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: openDialogMock,
  save: saveDialogMock,
}))

vi.mock("@/lib/web-store", () => ({
  getStore: vi.fn(async () => ({
    get: vi.fn(async () => ({ version: 1, favorites: [] })),
    set: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
  })),
  flushAppState: vi.fn(),
}))

const deAiConfig = {
  version: 1,
  defaultSkillId: "project:quiet",
  disabledSkillIds: [],
  lastChapterDeAiSkillId: null,
  projectSkills: [{
    id: "project:quiet",
    name: "沉浸式去AI味",
    description: "减少解释腔和总结腔",
    templateId: "custom",
    content: "删除协作口吻，保留角色语气。",
    source: "project",
    createdAt: 100,
    updatedAt: 100,
  }],
  builtInSkillOverrides: [],
}

const writingConfig = {
  version: 1,
  selectedSkillId: "skill:three",
  disabledSkillIds: [],
  skills: [{
    id: "skill:three",
    name: "三翻四抖",
    description: "三次转折，四次震惊。",
    kind: ["structure", "review"],
    stages: ["planning", "review"],
    modes: ["standard", "strict"],
    content: "每章设置三次局势变化和四次信息冲击。",
    source: "uploaded",
    createdAt: 100,
    updatedAt: 100,
  }],
  categories: [],
}

/** 项目里的文风预设（v1 画像形状：没有 workbenchStyle）。 */
const writingStyleStore = {
  version: 1,
  enabledStyleId: "preset:cool",
  styles: [
    {
      id: "preset:cool",
      name: "冷硬叙事文风",
      sourceBook: "凡人修仙传",
      profile: {
        schemaVersion: 1,
        generatedAt: 1,
        sampledChapterIds: [],
        constitution: "1. 短句为主\n2. 环境描写不超过两句",
        samples: ["他略一沉吟，继而抬起头。"],
      },
      createdAt: 100,
      updatedAt: 100,
    },
    {
      id: "preset:warm",
      name: "温情笔触文风",
      sourceBook: "山楂树之恋",
      profile: {
        schemaVersion: 1,
        generatedAt: 2,
        sampledChapterIds: [],
        constitution: "1. 长句铺陈",
        samples: ["院子里那棵树下，风很轻。"],
      },
      createdAt: 90,
      updatedAt: 90,
    },
  ],
}

async function renderLibrary() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<UnifiedSkillLibraryView />)
  })
  await flushEffects()
  return { container, root }
}

function cleanup(root: Root, container: HTMLElement) {
  act(() => root.unmount())
  document.body.removeChild(container)
}

/**
 * 最小外壳：模拟 `content-area.tsx` 按 `activeView` 分派内容区。
 *
 * ⚠️ 存在的理由：`UnifiedSkillLibraryView` 在收到非技能库 activeView 时
 * **会主动抛错**（`resolveActiveTab` 的守卫）。真实外壳的 `switch` 会先把本组件
 * 卸载、再渲染目标视图，所以生产永远不会走到那一步；测试里若裸渲染本组件
 * 再切 activeView，就会撞上守卫 —— 那是**脚手架不真实**，不是产品缺陷。
 *
 * 判据用 `resolveActiveTab` 本身（try/catch），不另抄一份视图名清单：
 * 抄一份就会在「新增技能库 tab」时与本尊漂移，而这条 harness 恰恰是
 * 用来验证分派的，漂移了就会给出假绿。
 */
function SkillLibraryHarness() {
  const activeView = useWikiStore((state) => state.activeView)
  let insideSkillLibrary = true
  try {
    resolveActiveTab(activeView)
  } catch {
    insideSkillLibrary = false
  }
  return insideSkillLibrary
    ? <UnifiedSkillLibraryView />
    : <div data-testid="content-area-book-analysis">拆书库</div>
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function setInputValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    valueSetter?.call(input, value)
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

function getButton(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent?.trim() === label)
}

function tabStates(container: HTMLElement): [string, string | null][] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>(".ui-test-skills-tab"))
    .map((tab) => [tab.textContent?.trim() ?? "", tab.getAttribute("aria-pressed")])
}

/** 当前网格里的条目 id（去掉 testid 前缀）。 */
function entryIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-testid^="unified-skill-entry-"]'))
    .map((card) => card.getAttribute("data-testid")?.replace("unified-skill-entry-", "") ?? "")
}

/** 分类 chips 的可见文案。 */
function chipLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>(".ui-test-skills-chip"))
    .map((chip) => chip.textContent?.trim() ?? "")
}

async function switchToTab(container: HTMLElement, label: string) {
  await act(async () => {
    getButton(container, label)?.click()
  })
  await flushEffects()
}

const WRITING_STYLE_TAB = "文风 skill"

/**
 * 去掉 TS 源码里的注释（块注释与行注释），用于「对源码形状做断言」的用例。
 *
 * ⚠️ 存在的理由是本分支反复栽过的一个缺陷类：**对整份源码文本做正则，
 * 会被注释满足**（丙-4 的 F4 就是这个：一条注释里的 CSS 片段满足了
 * 「真实规则存在」的断言）。所以任何源码形状断言都必须匹配**去注释后的副本**。
 *
 * ⚠️ 已知局限（此处够用即可，不追求通用）：不做词法分析，因此**字符串字面量里**
 * 的 `//` 或 `/*` 也会被当成注释起点。对本文件够用 —— 断言只看
 * `const unhandled: never = entry` 与紧跟的 `throw new Error(`，
 * 两者都不含这类字面量。若将来这条断言挪去别的文件，先复核这一点。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
}

describe("UnifiedSkillLibraryView", () => {
  beforeEach(() => {
    useWikiStore.getState().setPersonaSkillLibraryDraftDirty(false)
    vi.clearAllMocks()
    readFileMock.mockImplementation(async (path: string) => {
      if (path.endsWith("de-ai-skills.json")) return JSON.stringify(deAiConfig)
      if (path.endsWith("writing-skills.json")) return JSON.stringify(writingConfig)
      if (path.endsWith(".qmai/writing-style.json")) return JSON.stringify(writingStyleStore)
      throw new Error("missing")
    })
    writeFileMock.mockResolvedValue(undefined)
    writeFileAtomicMock.mockResolvedValue(undefined)
    openDialogMock.mockResolvedValue(null)
    saveDialogMock.mockResolvedValue(null)
    useWikiStore.getState().setProject({
      id: "p1",
      name: "测试项目",
      path: "C:/project",
    })
    useWikiStore.getState().setActiveView("skillLibrary")
    useWikiStore.getState().setSelectedSkillLibrarySkillId(null)
    useWikiStore.getState().setSelectedWritingSkillLibrarySkillId(null)
    useWikiStore.getState().setSkillLibraryDraftDirty(false)
    useWikiStore.getState().setWritingSkillLibraryDraftDirty(false)
    useFavoriteSkillStore.setState({ favorites: [], loaded: true, currentProjectPath: "C:/project" })
  })

  it("renders a card gallery with the page title and de-AI cards on the de-AI tab", async () => {
    const { container, root } = await renderLibrary()

    expect(container.querySelector('[data-testid="unified-skill-library-view"]')).not.toBeNull()
    expect(container.querySelector("h1")?.textContent).toBe("技能库")
    expect(container.querySelector('[data-testid="unified-skill-entry-de-ai:project:quiet"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="unified-skill-entry-writing:skill:three"]')).toBeNull()
    expect(container.querySelector('[data-testid="unified-skill-search-input"]')).not.toBeNull()

    cleanup(root, container)
  })

  it("shows de-AI actions on the de-AI tab and writing actions on the writing tab", async () => {
    const { container, root } = await renderLibrary()

    let actionLabels = Array.from(
      container.querySelectorAll('[data-testid="skill-library-header-actions"] button'),
    ).map((button) => button.textContent?.trim())
    expect(actionLabels).toEqual(["新建技能", "导入"])

    await act(async () => {
      getButton(container, "写作 Skill")?.click()
    })
    await flushEffects()

    actionLabels = Array.from(
      container.querySelectorAll('[data-testid="skill-library-header-actions"] button'),
    ).map((button) => button.textContent?.trim())
    expect(actionLabels).toEqual(["新建 Skill", "导入"])

    cleanup(root, container)
  })

  it("filters the current tab's cards with the search input", async () => {
    const { container, root } = await renderLibrary()
    const searchInput = container.querySelector<HTMLInputElement>('[data-testid="unified-skill-search-input"]')

    await setInputValue(searchInput!, "解释腔")
    expect(container.querySelector('[data-testid="unified-skill-entry-de-ai:project:quiet"]')).not.toBeNull()

    await setInputValue(searchInput!, "没有这个技能")
    expect(container.querySelector('[data-testid="unified-skill-entry-de-ai:project:quiet"]')).toBeNull()

    cleanup(root, container)
  })

  it("lights up the favorite star immediately after clicking it", async () => {
    const { container, root } = await renderLibrary()
    const cardSelector = '[data-testid="unified-skill-entry-de-ai:project:quiet"]'

    expect(container.querySelector(`${cardSelector} button[aria-label="收藏"]`)).not.toBeNull()

    await act(async () => {
      container.querySelector<HTMLButtonElement>(`${cardSelector} button[aria-label="收藏"]`)?.click()
    })

    expect(container.querySelector(`${cardSelector} button[aria-label="取消收藏"]`)).not.toBeNull()

    cleanup(root, container)
  })

  it("switches the gallery content when another tab is selected", async () => {
    const { container, root } = await renderLibrary()

    await act(async () => {
      getButton(container, "写作 Skill")?.click()
    })
    await flushEffects()

    expect(useWikiStore.getState().activeView).toBe("writingSkillLibrary")
    expect(container.querySelector('[data-testid="unified-skill-entry-writing:skill:three"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="unified-skill-entry-de-ai:project:quiet"]')).toBeNull()

    cleanup(root, container)
  })

  it("opens a card into the detail editor and returns with the back button", async () => {
    const { container, root } = await renderLibrary()

    await act(async () => {
      container.querySelector<HTMLElement>('[data-testid="unified-skill-entry-de-ai:project:quiet"]')?.click()
    })
    await flushEffects()

    expect(useWikiStore.getState().selectedSkillLibrarySkillId).toBe("project:quiet")
    expect(container.querySelector('[data-testid="skill-library-view"]')).not.toBeNull()

    await act(async () => {
      getButton(container, "返回技能库")?.click()
    })
    await flushEffects()

    expect(container.querySelector('[data-testid="skill-library-view"]')).toBeNull()
    expect(container.querySelector('[data-testid="unified-skill-search-input"]')).not.toBeNull()

    cleanup(root, container)
  })

  it("creates a writing Skill from the header and drills into the editor", async () => {
    const { container, root } = await renderLibrary()

    await act(async () => {
      getButton(container, "写作 Skill")?.click()
    })
    await flushEffects()

    await act(async () => {
      getButton(container, "新建 Skill")?.click()
    })
    await flushEffects()

    expect(useWikiStore.getState().activeView).toBe("writingSkillLibrary")
    expect(useWikiStore.getState().selectedWritingSkillLibrarySkillId).toMatch(/^skill:/)
    expect(writeFileAtomicMock).toHaveBeenCalledWith(
      "C:/project/writing-skills.json",
      expect.stringContaining("新建写作 Skill"),
    )
    expect(container.querySelector('[data-testid="writing-skill-library-view"]')).not.toBeNull()

    cleanup(root, container)
  })

  it("imports a de-AI skill file from the header", async () => {
    openDialogMock.mockResolvedValue("C:/skills/冷硬叙事.md")
    readFileMock.mockImplementation(async (path: string) => {
      if (path.endsWith("de-ai-skills.json")) return JSON.stringify(deAiConfig)
      if (path.endsWith("writing-skills.json")) return JSON.stringify(writingConfig)
      if (path === "C:/skills/冷硬叙事.md") return "# 冷硬叙事\n\n删掉解释，保留动作。"
      throw new Error("missing")
    })
    const { container, root } = await renderLibrary()

    await act(async () => {
      getButton(container, "导入")?.click()
    })
    await flushEffects()

    expect(writeFileAtomicMock).toHaveBeenCalledWith(
      "C:/project/de-ai-skills.json",
      expect.stringContaining("冷硬叙事"),
    )
    expect(writeFileAtomicMock).toHaveBeenCalledWith(
      "C:/project/de-ai-skills.json",
      expect.stringContaining("删掉解释，保留动作。"),
    )
    expect(useWikiStore.getState().activeView).toBe("skillLibrary")
    expect(container.querySelector('[data-testid="skill-library-view"]')).not.toBeNull()

    cleanup(root, container)
  })

  it("切到「人物 Skill」tab：写 activeView 并渲染人物页", async () => {
    const { container, root } = await renderLibrary()

    await act(async () => {
      getButton(container, "人物 Skill")?.click()
    })
    await flushEffects()

    expect(useWikiStore.getState().activeView).toBe("personaSkillLibrary")
    expect(container.querySelector('[data-testid="persona-skill-view"]')).not.toBeNull()
    // 人物页没有统一技能库的搜索框，说明确实换了内容区
    expect(container.querySelector('[data-testid="unified-skill-search-input"]')).toBeNull()

    cleanup(root, container)
  })

  /*
   * === 文风 tab（丁-1）===
   *
   * ⚠️ 这一组用例存在的理由：本文件的 tab 分派原先是一串
   * `activeTab === "writingSkillLibrary" ? A : B` 的**二元三元**。
   * 给联合类型加第三个成员后每一处三元仍然合法编译（`"…style…" === "…writing…"` 只是恒 false），
   * 全部静默落到 else 分支，而 `tsc` 抓不到任何一处。
   * 所以「文风 tab 高亮正确 + 显示的是文风条目」必须由**行为测试**证明，
   * 不能用 typecheck 或源码文本断言代替。
   */

  it("切换文风 tab：该 tab 被标记为选中，且展示的是文风条目而不是去AI味条目", async () => {
    const { container, root } = await renderLibrary()

    expect(tabStates(container)).toEqual([
      ["去AI味技能", "true"],
      ["写作 Skill", "false"],
      ["文风 skill", "false"],
      ["人物 Skill", "false"],
      ["收藏", "false"],
    ])
    // 初始在去AI味 tab
    expect(container.querySelector('[data-testid="unified-skill-entry-de-ai:project:quiet"]')).not.toBeNull()

    await switchToTab(container, WRITING_STYLE_TAB)

    expect(useWikiStore.getState().activeView).toBe("writingStyleLibrary")
    // (a) 选中语义：只有「文风」是 pressed
    expect(tabStates(container)).toEqual([
      ["去AI味技能", "false"],
      ["写作 Skill", "false"],
      ["文风 skill", "true"],
      ["人物 Skill", "false"],
      ["收藏", "false"],
    ])
    // (b) 列表内容：是文风条目，不是去AI味/写作 Skill 条目
    expect(container.querySelector('[data-testid="unified-skill-entry-style:preset:cool"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="unified-skill-entry-style:preset:warm"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="unified-skill-entry-de-ai:project:quiet"]')).toBeNull()
    expect(container.querySelector('[data-testid="unified-skill-entry-writing:skill:three"]')).toBeNull()

    cleanup(root, container)
  })

  it("人物 Skill tab 不显示去AI味的「新建技能 / 导入」按钮", async () => {
    const { container, root } = await renderLibrary()

    await act(async () => {
      getButton(container, "人物 Skill")?.click()
    })
    await flushEffects()

    expect(container.querySelector('[data-testid="skill-library-header-actions"]')).toBeNull()

    cleanup(root, container)
  })

  it("把项目里的文风预设列成条目：类型徽章为「文风」、来源是「引用」、启用项标出「当前启用」", async () => {
    const { container, root } = await renderLibrary()
    await switchToTab(container, WRITING_STYLE_TAB)

    const card = container.querySelector('[data-testid="unified-skill-entry-style:preset:cool"]')
    expect(card).not.toBeNull()
    expect(card!.querySelector(".ui-test-skill-card-name")?.textContent).toBe("冷硬叙事文风")
    expect(
      Array.from(card!.querySelectorAll(".ui-test-skill-badge")).map((badge) => badge.textContent),
    ).toEqual(["文风", "引用", "当前启用", "《凡人修仙传》"])

    // 未启用的那条不带「当前启用」
    const warm = container.querySelector('[data-testid="unified-skill-entry-style:preset:warm"]')
    expect(
      Array.from(warm!.querySelectorAll(".ui-test-skill-badge")).map((badge) => badge.textContent),
    ).toEqual(["文风", "引用", "《山楂树之恋》"])
    expect(warm!.querySelector(".ui-test-skill-badge.is-type")?.textContent).toBe("文风")

    cleanup(root, container)
  })

  it("文风库为空时展示文风空态，而不是去AI味空态", async () => {
    readFileMock.mockImplementation(async (path: string) => {
      if (path.endsWith("de-ai-skills.json")) return JSON.stringify(deAiConfig)
      if (path.endsWith("writing-skills.json")) return JSON.stringify(writingConfig)
      if (path.endsWith(".qmai/writing-style.json")) {
        return JSON.stringify({ version: 1, enabledStyleId: null, styles: [] })
      }
      throw new Error("missing")
    })
    const { container, root } = await renderLibrary()
    await switchToTab(container, WRITING_STYLE_TAB)

    expect(container.querySelector('[data-testid="unified-skill-entry-style:preset:cool"]')).toBeNull()
    const empty = container.querySelector(".ui-test-skills-empty")
    expect(empty?.textContent).toContain("还没有文风 skill")
    expect(empty?.textContent).not.toContain("去AI味")

    cleanup(root, container)
  })

  it("文风条目是引用：点开进入文风编辑器，且选中写进自己的槽位、不写盘", async () => {
    const { container, root } = await renderLibrary()
    await switchToTab(container, WRITING_STYLE_TAB)

    const card = container.querySelector<HTMLElement>('[data-testid="unified-skill-entry-style:preset:cool"]')
    expect(card).not.toBeNull()
    // 条目是**读项目文件**来的（引用），不是把预设复制成技能
    expect(readFileMock.mock.calls.map((call) => String(call[0]))).toContain("C:/project/.qmai/writing-style.json")
    expect(writeFileAtomicMock.mock.calls.map((call) => String(call[0]))).toEqual([])

    await act(async () => {
      card!.click()
    })
    await flushEffects()

    // 打开编辑器本身**一个文件都没写**
    expect(writeFileAtomicMock.mock.calls.map((call) => String(call[0]))).toEqual([])
    // 选中 id 写进「文风 skill」自己的槽位，不写别的库（否则会打开另一个库的编辑器）
    expect(useWikiStore.getState().selectedWritingStyleLibraryStyleId).toBe("preset:cool")
    expect(useWikiStore.getState().selectedSkillLibrarySkillId).toBeNull()
    expect(useWikiStore.getState().selectedWritingSkillLibrarySkillId).toBeNull()
    expect(container.querySelector('[data-testid="writing-style-library-view"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="skill-library-view"]')).toBeNull()

    cleanup(root, container)
  })

  it("文风 tab 提供「+ 新建文风」与「去拆书库添加文风」两个入口，卡片可打开编辑器、不可收藏", async () => {
    const { container, root } = await renderLibrary()
    await switchToTab(container, WRITING_STYLE_TAB)

    expect(
      Array.from(container.querySelectorAll('[data-testid="skill-library-header-actions"] button'))
        .map((button) => button.textContent?.trim()),
    ).toEqual(["新建文风", "去拆书库添加文风"])
    // openable: true → 卡片显示「编辑」入口
    expect(container.querySelector(".ui-test-skill-card-open")).not.toBeNull()

    // favoritable: false → 卡片内没有收藏星（收藏库只认 writing / de-ai 快照形状）。
    for (const card of Array.from(container.querySelectorAll<HTMLElement>('[data-testid^="unified-skill-entry-"]'))) {
      expect(card.querySelector('[aria-label="收藏"]')).toBeNull()
      expect(card.querySelector('[aria-label="取消收藏"]')).toBeNull()
    }
    // 文风卡片确实渲染了（否则上面的循环在空集合上「全绿」）
    expect(container.querySelectorAll('[data-testid^="unified-skill-entry-"]').length).toBe(2)

    cleanup(root, container)
  })

  /*
   * 「去拆书库添加文风」跳转。
   *
   * 为什么值得单钉一条：文风的正经来源是**拆书库的文风提取**（跑真实作品得到
   * 9 维指标 + 风格宪法），旁边的「新建文风」只能建空壳。这个入口一旦指错视图
   * （比如写成 "skills" 或漏掉），用户点下去会静默停在本页 —— 没有任何报错。
   *
   * 判别力：把 `bookAnalysis` 改成任何别的视图名 ⇒ 红。
   * 只断言 `activeView` 与外壳的分派结果，不断言拆书库内部渲染了什么 ——
   * 那是拆书库自己的 spec 的事。
   */
  it("「去拆书库添加文风」跳到拆书库视图", async () => {
    /*
     * ⚠️ 这条必须用 `SkillLibraryHarness` 而不是裸 `renderLibrary()`。
     *
     * `UnifiedSkillLibraryView` 收到非技能库 activeView 时**会主动抛错**
     * （`resolveActiveTab` 的守卫，见组件里那段注释）。真实外壳
     * （`content-area.tsx` 的 switch）会先把它卸载再渲染拆书库，所以生产不抛；
     * 裸渲染 + 切视图会撞上守卫 —— 那是**脚手架不真实**，不是产品缺陷。
     */
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<SkillLibraryHarness />)
    })
    await flushEffects()

    await switchToTab(container, WRITING_STYLE_TAB)

    const button = container.querySelector<HTMLButtonElement>('[data-testid="skill-library-goto-book-analysis"]')
    expect(button, "文风 tab 应有「去拆书库添加文风」按钮").not.toBeNull()
    expect(button!.textContent?.trim()).toBe("去拆书库添加文风")
    // 纯导航：正常状态下必须可点（没有项目时禁用是另一回事，见组件里的注释）
    expect(button!.disabled).toBe(false)

    await act(async () => {
      button!.click()
    })

    expect(useWikiStore.getState().activeView).toBe("bookAnalysis")
    // 外壳确实把技能库换成了拆书库（而不是把技能库留在原地）
    expect(container.querySelector('[data-testid="content-area-book-analysis"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="skill-library-header-actions"]')).toBeNull()

    cleanup(root, container)
  })

  it("文风读取故障只让文风 tab 退化成空态，另外两个库不受牵连（**真** loader + 抛错的 readFile）", async () => {
    /*
     * ⚠️ 这条用例**必须**走真 loader（本文件已不再 mock `writing-style-store`）：
     * `loadWritingStyleStore` 内部吞掉所有失败并返回空 store，它的 promise
     * **永远不会 reject**，所以一次真实的读取故障在生产里的可观察后果**就是**
     * 文风 tab 显示**空库**文案。前一版这里 mock loader 抛错、并断言
     * 「文风库读取失败」文案 —— 那是在断言一个**真 loader 产生不了的状态**
     * （复核批 MUST-FIX 1 已实测复现：真故障下用户看到的仍是空库文案）。
     * 现在改回断言**生产真实行为**。
     *
     * 判别力（说清楚它能杀什么、不能杀什么）：
     *   - 能杀：文风 tab 被接错库（显示去AI味条目 / 去AI味空态文案）、
     *     文风 store 根本没被尝试读取（下面断言读取路径真的被请求过）、
     *     以及故障路径上写文件。
     *   - **不能**杀：把这条单独的链并进上面那个 `Promise.all`、或删掉那个
     *     `.catch` 结构性防御 —— 因为 loader 从不 reject，这几种形状今天的
     *     可观察行为**完全一致**。⚠️ 「读取故障把另外两个库一起带崩」**也算在
     *     这一档**：把链并进共享 `Promise.all` 正是它的成因，既然那个变异杀不掉，
     *     下面「另外两库照常」那条断言就只是**粗粒度回归守卫**、不是这条链的判别器
     *     （曾把它记成「能杀」，已订正）。这是**如实记下的**边界，不是漏测。
     *   - 也**不能**断言「读取失败 ≠ 空库」：本组件区分不了，见 tsx 里
     *     `styleLoad` 处注释（那是 loader 的既有缺陷，本批不修）。
     */
    readFileMock.mockImplementation(async (path: string) => {
      if (path.endsWith("de-ai-skills.json")) return JSON.stringify(deAiConfig)
      if (path.endsWith("writing-skills.json")) return JSON.stringify(writingConfig)
      if (path.endsWith(".qmai/writing-style.json")) throw new Error("EACCES: 读取 .qmai/writing-style.json 失败")
      throw new Error("missing")
    })
    const { container, root } = await renderLibrary()

    // 另外两库照常：没有整页错误
    expect(container.querySelector(".ui-test-skills-error")).toBeNull()
    expect(container.querySelector('[data-testid="unified-skill-entry-de-ai:project:quiet"]')).not.toBeNull()
    // 文风那条链**确实尝试读了这个项目的那份文件**（否则「退化成空态」只是没加载）
    expect(readFileMock.mock.calls.map((call) => String(call[0]))).toContain("C:/project/.qmai/writing-style.json")

    await switchToTab(container, WRITING_STYLE_TAB)
    expect(container.querySelector('[data-testid^="unified-skill-entry-style:"]')).toBeNull()
    const styleEmpty = container.querySelector(".ui-test-skills-empty")?.textContent ?? ""
    // 生产的真实行为：**空库**文案（读取故障与空库在本组件里不可区分）
    expect(styleEmpty).toContain("还没有文风 skill")
    expect(styleEmpty).not.toContain("去AI味")
    // 读取故障没有写任何文件
    expect(writeFileAtomicMock).not.toHaveBeenCalled()

    await switchToTab(container, "写作 Skill")
    expect(container.querySelector('[data-testid="unified-skill-entry-writing:skill:three"]')).not.toBeNull()
    expect(container.querySelector(".ui-test-skills-error")).toBeNull()

    cleanup(root, container)
  })

  /*
   * === 分类维度（TAB_CATEGORY_AXIS）===
   *
   * 「显示分类 chips」与「按分类过滤」现在由**同一张表**决定。下面两条
   * 分别钉住这张表的两半：
   *   - 少了 chips 的 tab 之前**没有任何测试会红**（清空原先那个
   *     `ReadonlySet` 时 typecheck exit 0、14/14 全绿，而写作 Skill 的
   *     分类 chips 全部静默消失）；
   *   - 过滤那一半原本硬编码 `activeTab === "writingSkillLibrary"`，
   *     与 chips 是两份可以各自漂移的事实。
   */
  it("分类 chips 只出现在写作 Skill tab（chips 消失必须有人报警）", async () => {
    const { container, root } = await renderLibrary()

    expect(chipLabels(container)).toEqual([])

    await switchToTab(container, "写作 Skill")
    // 前三条是固定项，后面跟着项目 / 内置 skillhub 的分类与「+ 新建分类」。
    const writingChips = chipLabels(container)
    expect(writingChips.slice(0, 3)).toEqual(["全部", "最近使用", "未分类"])
    expect(writingChips).toContain("+ 新建分类")
    expect(writingChips.length).toBeGreaterThan(3)

    await switchToTab(container, WRITING_STYLE_TAB)
    expect(chipLabels(container)).toEqual([])

    cleanup(root, container)
  })

  it("分类 chips 会真的过滤列表（chips 与过滤共用同一张表）", async () => {
    const categorizedWritingConfig = {
      ...writingConfig,
      categories: [{ id: "cat-pace", name: "节奏" }],
      skills: [
        { ...writingConfig.skills[0], id: "skill:three", name: "三翻四抖", categoryId: "cat-pace" },
        { ...writingConfig.skills[0], id: "skill:other", name: "另一条", categoryId: undefined },
      ],
    }
    readFileMock.mockImplementation(async (path: string) => {
      if (path.endsWith("de-ai-skills.json")) return JSON.stringify(deAiConfig)
      if (path.endsWith("writing-skills.json")) return JSON.stringify(categorizedWritingConfig)
      if (path.endsWith(".qmai/writing-style.json")) return JSON.stringify(writingStyleStore)
      throw new Error("missing")
    })
    const { container, root } = await renderLibrary()
    await switchToTab(container, "写作 Skill")

    expect(entryIds(container)).toContain("writing:skill:three")
    expect(entryIds(container)).toContain("writing:skill:other")

    await act(async () => {
      getButton(container, "节奏")?.click()
    })
    await flushEffects()
    expect(entryIds(container)).toContain("writing:skill:three")
    expect(entryIds(container)).not.toContain("writing:skill:other")

    await act(async () => {
      getButton(container, "未分类")?.click()
    })
    await flushEffects()
    expect(entryIds(container)).toContain("writing:skill:other")
    expect(entryIds(container)).not.toContain("writing:skill:three")

    cleanup(root, container)
  })

  /*
   * === 启用开关写哪个库的文件 ===
   *
   * `handleToggleEnabled` 是本文件唯一会**写库文件**的条目分派点，
   * 原先靠 `if (writing) … else …` 的形状把任何新类型静默当成去AI味。
   * 编译侧的穷尽 `switch` 已经补上；这里补**行为**侧的证据：
   * 两组用例分别断言「只写了这个库的 json」——写错库时立刻红。
   */
  it("勾选写作 Skill 的启用框只写 writing-skills.json，不碰 de-ai-skills.json", async () => {
    const { container, root } = await renderLibrary()
    await switchToTab(container, "写作 Skill")

    const toggle = container.querySelector<HTMLInputElement>(".ui-test-skill-toggle input")
    expect(toggle).not.toBeNull()
    expect(toggle!.checked).toBe(true)

    await act(async () => {
      toggle!.click()
    })
    await flushEffects()

    expect(writeFileAtomicMock.mock.calls.map((call) => String(call[0])))
      .toEqual(["C:/project/writing-skills.json"])

    cleanup(root, container)
  })

  it("勾选去AI味技能的启用框只写 de-ai-skills.json，不碰 writing-skills.json", async () => {
    const { container, root } = await renderLibrary()

    const toggle = container.querySelector<HTMLInputElement>(".ui-test-skill-toggle input")
    expect(toggle).not.toBeNull()

    await act(async () => {
      toggle!.click()
    })
    await flushEffects()

    expect(writeFileAtomicMock.mock.calls.map((call) => String(call[0])))
      .toEqual(["C:/project/de-ai-skills.json"])

    cleanup(root, container)
  })

  /*
   * 打开条目：选中的 id 必须写进**自己那个库**的状态槽。
   * 写作 Skill 这一侧原先没有用例（只有去AI味那条），而 `handleOpenEntry`
   * 的 `else` 正是把新类型静默路由到 `selectedSkillLibrarySkillId` 的那条路。
   */
  it("点开写作 Skill 卡片写的是写作库的选中 id，不是去AI味库的", async () => {
    const { container, root } = await renderLibrary()
    await switchToTab(container, "写作 Skill")

    await act(async () => {
      container.querySelector<HTMLElement>('[data-testid="unified-skill-entry-writing:skill:three"]')?.click()
    })
    await flushEffects()

    expect(useWikiStore.getState().selectedWritingSkillLibrarySkillId).toBe("skill:three")
    expect(useWikiStore.getState().selectedSkillLibrarySkillId).toBeNull()
    expect(container.querySelector('[data-testid="writing-skill-library-view"]')).not.toBeNull()

    cleanup(root, container)
  })

  /*
   * 兜底守卫：`resolveActiveTab` 以前对任何陌生视图静默兜底成「去AI味技能」，
   * 那会让用户在别的视图下看到一个**带可写按钮**的去AI味技能库。
   * 今天唯一渲染本组件的是 content-area 的 switch（只路由 4 个技能库视图），
   * 所以这条断言守的是「前提被打破时当场失败」而不是「现在会崩」。
   * 直接测纯函数，而不是渲染后等 React 把异常抛出来 —— 后者抛出的东西
   * 经过 React 的包装，消息不可依赖（实测拿到的是空字符串）。
   */
  it("resolveActiveTab 对非技能库视图直接抛错，不静默退化成去AI味技能库", () => {
    expect(resolveActiveTab("skillLibrary")).toBe("skillLibrary")
    expect(resolveActiveTab("writingSkillLibrary")).toBe("writingSkillLibrary")
    expect(resolveActiveTab("writingStyleLibrary")).toBe("writingStyleLibrary")
    // 合并说明：`main` 的人物 Skill 视图也必须由这张显式 Record 承载，
    // 漏掉它就会落进 `isSkillLibraryTab` 的抛错分支（点开人物 Skill 直接崩）。
    expect(resolveActiveTab("personaSkillLibrary")).toBe("personaSkillLibrary")
    expect(resolveActiveTab("skillFavorites")).toBe("skillFavorites")

    expect(() => resolveActiveTab("soul")).toThrow(/非技能库的 activeView/)
    expect(() => resolveActiveTab("settings")).toThrow(/非技能库的 activeView/)
    expect(() => resolveActiveTab("lint")).toThrow(/非技能库的 activeView/)
  })

  /*
   * === 拆掉 `never` 守卫必须有人报警 ===
   *
   * 把穷尽 `switch` 退回二元 `if/else` **就等于拆掉守卫**，而对**今天这 3 种类型**
   * 它是**外延相等**的：全部既有行为用例照样绿（复核批实测 S1 / S6 两处存活）。
   * 守卫守的从来不是今天，而是**第 4 种条目类型** —— 所以这里用 `as never`
   * 造一个类型系统里**不存在**的输入。这三条用例就是让那个守卫**不再静默**的东西。
   */
  it("entryFavoriteTarget 对未列入清单的条目类型抛错（第 4 种类型必须先在这里显式决定）", () => {
    /*
     * ⚠️ `as never` 是**故意**的：模拟「将来给 `UnifiedSkillEntry` 加了第 4 种类型」。
     * 这是唯一能构造那种输入的办法（联合类型里今天只有 3 个成员）。
     * 别因为「类型不合法」把它改成某个真实类型 —— 那样这条用例就失去全部意义。
     */
    expect(() => entryFavoriteTarget({ type: "note", sourceId: "n1" } as never)).toThrow()
  })

  it("entryEnabled 对未列入清单的条目类型抛错（同上；它抽成模块级纯函数后才可测）", () => {
    const configs = { styleStore: null, deAiConfig: null, writingConfig: null }
    expect(() => entryEnabled({ type: "note", sourceId: "n1" } as never, configs)).toThrow()
  })

  it("本文件每个穷尽 switch 都留着 `never` 守卫（源码级兜底，覆盖两个闭包 switch）", () => {
    /*
     * 为什么还需要一条**源码级**断言：`handleToggleEnabled` / `handleOpenEntry`
     * 是**闭包**（依赖 project / busy / 选中态），jsdom 里造不出第 4 种条目类型，
     * 那两处守卫**没有行为入口**；而拆掉守卫（switch → if/else）今天又是外延相等的。
     * 只剩源码级能看见它们。
     *
     * ⚠️ 只匹配**构造**，不钉行号、不钉空白、不钉整行文本：
     * 「守卫 + 紧跟其后的 `throw`」这个形状，而不是单看 `const unhandled`。
     *
     * ⚠️⚠️ 必须在**去掉注释之后**的副本上匹配。这是本分支栽过多次的同一类缺陷：
     * 对**整份源码文本**做正则，是会被**注释**满足的。实测两种假象：
     *   - 本文件里**讨论**这条守卫的注释（`* const unhandled: never = entry` 之类）
     *     若被算进来，计数会多出 1；
     *   - 反之，在守卫与 `throw` 之间插一行普通注释，计数会少 1，
     *     而且报错信息与「真把守卫删了」**逐字节相同**（`length of 4 but got 3`），
     *     红得无法诊断。
     * 所以先 `stripComments` 再数 —— 注释既不产生命中、也不打断命中。
     * 4 = 文件顶部注释承诺的穷尽 switch 数。它是**承诺**不是实现细节 ——
     * 将来真新增第 5 个穷尽 switch，请**同时**改这里和顶部注释（会有意红给你看）。
     */
    const source = readFileSync(resolve(__dirname, "unified-skill-library-view.tsx"), "utf8")
    const code = stripComments(source)
    const guards = code.match(/const\s+unhandled\s*:\s*never\s*=\s*entry\s*throw\s+new\s+Error\(/g) ?? []
    expect(guards).toHaveLength(4)
  })
})

/*
 * 「文风自进化」开关面板的入口。
 *
 * 面板对 `.qmai/style-evolution.json` 的读取会落到 `readFileMock` 的兜底
 * `throw new Error("missing")` 上 —— `loadStyleEvolutionState` 吞掉异常并返回
 * `emptyState()`，这正是「文件还没生成」的真实路径（用户从没开过这个开关）。
 *
 * 合并说明：这块面板来自 main 的文风自进化工作。本分支把这个 tab 从「文风」
 * 改名成「文风 skill」并换成完整编辑器，面板在合并时按用户要求保留，
 * 所以断言用的是 `WRITING_STYLE_TAB`。
 */
describe("文风 tab 的自进化入口", () => {
  it("切到「文风 skill」tab 能看到开关，默认关闭", async () => {
    const { container, root } = await renderLibrary()
    await switchToTab(container, WRITING_STYLE_TAB)

    expect(container.querySelector('[data-testid="style-evolution-panel"]')).not.toBeNull()
    // 默认关闭：数据文件不存在时退化成 emptyState()，而不是让整页崩掉
    expect(
      container.querySelector('[data-testid="style-evolution-toggle"]')?.getAttribute("aria-checked"),
    ).toBe("false")
    /*
     * 进度统计 / 上一轮结论 / 候选按钮 / 轮次历史都按用户要求去掉了。
     * 这条断言是**需求**：只留一块说明 + 一个开关。
     */
    for (const id of [
      "style-evolution-remaining",
      "style-evolution-days",
      "style-evolution-threshold",
      "style-evolution-baseline",
      "style-evolution-conclusion",
      "style-evolution-candidate",
      "style-evolution-round-1",
    ]) {
      expect(container.querySelector(`[data-testid="${id}"]`), `${id} 不该出现`).toBeNull()
    }

    cleanup(root, container)
  })

  it("开关面板只属于「文风 skill」tab，别处不出现", async () => {
    const { container, root } = await renderLibrary()
    await switchToTab(container, "去AI味技能")
    expect(container.querySelector('[data-testid="style-evolution-panel"]')).toBeNull()

    await switchToTab(container, WRITING_STYLE_TAB)
    expect(container.querySelector('[data-testid="style-evolution-panel"]')).not.toBeNull()
    /*
     * 面板与画廊并存：文风预设本身照旧列在下面。
     *
     * ⚠️ 条目 id 的前缀是 `style:`（如 `style:preset:cool`），**不是**
     * `writingStyle`（那是视图名/库名）。按库名去断言会恒为 false。
     */
    expect(entryIds(container).some((id) => id.startsWith("style:"))).toBe(true)

    cleanup(root, container)
  })
})
