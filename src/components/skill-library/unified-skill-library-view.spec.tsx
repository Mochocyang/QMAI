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

/**
 * 项目里的角色灵魂（`.qmai/character-aura.json`）。
 * ⚠️ 这个文件里**没有**内置灵魂 —— 内置的那些来自
 * `BUILT_IN_CHARACTER_AURAS` 常量，`listCharacterAuras` 无条件把它们拼在前面。
 * 所以「灵魂 tab 至少列出内置灵魂」这件事在本用例里**必须**能看到。
 */
const characterAuraStore = {
  customAuras: [
    {
      id: "custom-xu",
      builtIn: false,
      name: "许七安",
      category: "古装权谋",
      sourceNote: "来自《大奉打更人》的拆书结果",
      corpus: "抄诗、断案、插科打诨、铜锣腰牌",
      styleDescription: "先调侃后收束，破案时语速加快。",
      behaviorRules: "遇事先问证据，再问动机。",
      boundaries: "不替角色下道德结论。",
      notes: "",
    },
  ],
  // 「许七安」已真实绑定到小说人物「陈拾」，另一条绑定指向别的灵魂。
  bindings: [
    { characterName: "陈拾", auraId: "custom-xu" },
    { characterName: "李四", auraId: "builtin-li-si" },
  ],
}

/**
 * 盘上**当前**的文风库内容（`writeFileAtomic` 会更新它）。见 beforeEach 的说明：
 * 「选中态来自盘上状态」那条用例必须让写盘与重读闭合成一条真链路。
 */
let persistedWritingStyleStore = writingStyleStore

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
    /*
     * 盘上的文风库内容。**每个用例重置**，且 `writeFileAtomic` 会把它更新 ——
     * 这样「点启用 → 写盘 → 重新挂载重读」这条链在用例里是**真的闭**的。
     * 只让 `readFile` 永远返回同一份常量的话，「选中态是否来自盘上状态」
     * 这条用例就证明不了任何事（重挂载后读回来的还是那份旧常量）。
     */
    persistedWritingStyleStore = structuredClone(writingStyleStore)
    readFileMock.mockImplementation(async (path: string) => {
      if (path.endsWith("de-ai-skills.json")) return JSON.stringify(deAiConfig)
      if (path.endsWith("writing-skills.json")) return JSON.stringify(writingConfig)
      if (path.endsWith(".qmai/writing-style.json")) return JSON.stringify(persistedWritingStyleStore)
      if (path.endsWith(".qmai/character-aura.json")) return JSON.stringify(characterAuraStore)
      throw new Error("missing")
    })
    writeFileMock.mockResolvedValue(undefined)
    writeFileAtomicMock.mockImplementation(async (path: string, content: string) => {
      if (path.endsWith(".qmai/writing-style.json")) {
        persistedWritingStyleStore = JSON.parse(content) as typeof writingStyleStore
      }
    })
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
      ["文风", "false"],
      ["角色灵魂", "false"],
      ["人物 Skill", "false"],
      ["收藏", "false"],
    ])
    // 初始在去AI味 tab
    expect(container.querySelector('[data-testid="unified-skill-entry-de-ai:project:quiet"]')).not.toBeNull()

    await switchToTab(container, "文风")

    expect(useWikiStore.getState().activeView).toBe("writingStyleLibrary")
    // (a) 选中语义：只有「文风」是 pressed
    expect(tabStates(container)).toEqual([
      ["去AI味技能", "false"],
      ["写作 Skill", "false"],
      ["文风", "true"],
      ["角色灵魂", "false"],
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
    await switchToTab(container, "文风")

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
    await switchToTab(container, "文风")

    expect(container.querySelector('[data-testid="unified-skill-entry-style:preset:cool"]')).toBeNull()
    const empty = container.querySelector(".ui-test-skills-empty")
    expect(empty?.textContent).toContain("文风库还是空的")
    expect(empty?.textContent).not.toContain("去AI味")

    cleanup(root, container)
  })

  /*
   * ── 文风卡片：点击 = 启用该文风（用户要求的语义变更）──
   *
   * ⚠️ 这条用例的旧版本断的是「选中它**一个文件都没写**」。那条断言已被
   * **用户明确推翻**：在文风库里点选时用户期望它生效并保持，而不是只亮一个
   * 离开就消失的高亮（现场：选中后回到写作区，那个「文风」按钮仍显示「未启用」；
   * 再打开「完整文风库」卡片又变回「点击选中」）。
   *
   * 所以这里改断**新的**不变式 —— 原用例真正要防的那件事（写错库的文件、
   * 误开别的库的编辑器）**一条都没放松**：
   *   · 只允许写 `.qmai/writing-style.json` 这一个文件；
   *   · 不许写 `writing-skills.json` / `de-ai-skills.json`；
   *   · 不许打开任何编辑器、不许写 wiki-store 的「选中技能」状态。
   *
   * 判别力：把 `setEnabledWritingStyle` 换成往别的库写（或换回本地 setState），
   * 下面第一条断言就会红。
   */
  it("文风条目：点击启用该文风，只写 writing-style.json，不写别的库、不开编辑器", async () => {
    const { container, root } = await renderLibrary()
    await switchToTab(container, "文风")

    const enabledCard = container.querySelector<HTMLElement>('[data-testid="unified-skill-entry-style:preset:cool"]')
    const otherCard = container.querySelector<HTMLElement>('[data-testid="unified-skill-entry-style:preset:warm"]')
    expect(enabledCard).not.toBeNull()
    expect(otherCard).not.toBeNull()
    // 盘上 enabledStyleId 是 preset:cool，所以它在选中态、另一张不在
    expect(enabledCard!.getAttribute("aria-pressed")).toBe("true")
    expect(otherCard!.getAttribute("aria-pressed")).toBe("false")
    // 条目是**读项目文件**来的（引用），不是把预设复制成技能
    expect(readFileMock.mock.calls.map((call) => String(call[0]))).toContain("C:/project/.qmai/writing-style.json")
    expect(writeFileAtomicMock.mock.calls.map((call) => String(call[0]))).toEqual([])

    await act(async () => {
      otherCard!.click()
    })
    await flushEffects()

    // 只写了文风库这一个文件 —— 这是原用例「不写错库」那条防线的**新形式**
    expect(writeFileAtomicMock.mock.calls.map((call) => String(call[0]))).toEqual([
      "C:/project/.qmai/writing-style.json",
    ])
    expect(writeFileMock).not.toHaveBeenCalled()
    // 写进去的是「启用 preset:warm」
    const written = JSON.parse(String(writeFileAtomicMock.mock.calls[0][1])) as { enabledStyleId: string | null }
    expect(written.enabledStyleId).toBe("preset:warm")
    // 也没有写 wiki-store 的「选中技能」状态（那会打开另一个库的编辑器）
    expect(useWikiStore.getState().selectedSkillLibrarySkillId).toBeNull()
    expect(useWikiStore.getState().selectedWritingSkillLibrarySkillId).toBeNull()
    expect(container.querySelector('[data-testid="skill-library-view"]')).toBeNull()
    expect(container.querySelector('[data-testid="writing-skill-library-view"]')).toBeNull()
    // 选中态在界面上跟着换人：新启用项亮起，旧启用项熄灭
    expect(otherCard!.getAttribute("aria-pressed")).toBe("true")
    expect(enabledCard!.getAttribute("aria-pressed")).toBe("false")
    expect(otherCard!.querySelector(".ui-test-skill-card-open")).toBeNull()

    cleanup(root, container)
  })

  /*
   * 再点一次 = 取消启用。可逆是用户选定的语义（推荐项）：
   * 否则库里出现了「启用了却关不掉」的死角，只能绕去拆书库取消。
   */
  it("文风条目：再点一次取消启用", async () => {
    const { container, root } = await renderLibrary()
    await switchToTab(container, "文风")

    const card = container.querySelector<HTMLElement>('[data-testid="unified-skill-entry-style:preset:cool"]')!
    expect(card.getAttribute("aria-pressed")).toBe("true")

    await act(async () => {
      card.click()
    })
    await flushEffects()

    const written = JSON.parse(String(writeFileAtomicMock.mock.calls[0][1])) as { enabledStyleId: string | null }
    expect(written.enabledStyleId).toBeNull()
    expect(card.getAttribute("aria-pressed")).toBe("false")

    cleanup(root, container)
  })

  /*
   * ⚠️ 这条用例直击用户报的「回到章节当中，再次打开完整文风库时还是显示
   * 『点击选中』」：选中态来自**盘上的 enabledStyleId**，不是组件内存变量。
   *
   * 判别力（关键）：把实现改回 `useState` 本地选中，这条会红 —— 卸载再挂载
   * 之后本地状态归零，aria-pressed 变回 false。为了让「写盘 → 重读」这条链
   * 真的闭合，这里让 `writeFileAtomic` 把内容存进 `persistedWritingStyleStore`，
   * `readFile` 从它读（见本文件 beforeEach）。
   */
  it("文风选中态来自盘上状态：卸载再挂载后仍保持（不是内存变量）", async () => {
    const first = await renderLibrary()
    await switchToTab(first.container, "文风")
    await act(async () => {
      first.container.querySelector<HTMLElement>('[data-testid="unified-skill-entry-style:preset:warm"]')!.click()
    })
    await flushEffects()
    expect(
      first.container.querySelector('[data-testid="unified-skill-entry-style:preset:warm"]')!.getAttribute("aria-pressed"),
    ).toBe("true")
    cleanup(first.root, first.container)

    // 重新挂载（等价于「切走再切回来」/ 重开面板）
    const second = await renderLibrary()
    await switchToTab(second.container, "文风")
    expect(
      second.container.querySelector('[data-testid="unified-skill-entry-style:preset:warm"]')!.getAttribute("aria-pressed"),
    ).toBe("true")
    expect(
      second.container.querySelector('[data-testid="unified-skill-entry-style:preset:cool"]')!.getAttribute("aria-pressed"),
    ).toBe("false")
    cleanup(second.root, second.container)
  })

  /*
   * 端到端接线：点卡片启用 → `dataVersion` 自增。
   *
   * 这条是**用户报的第四项**（「拆出库启用新文风后，写作区那个文风按钮也要显示」）
   * 在文风库这一侧的证据。写作区那个「文风」按钮的读盘 effect 只依赖
   * `[dataVersion, projectPath, selectedSkillId]`，所以「启用」这个事实
   * 只有通过 dataVersion 变化才能传过去；少了它，用户会看到按钮仍显示「未启用」。
   *
   * 判别力：把 `handleToggleStyleEnabled` 里对 `setEnabledWritingStyle` 的调用
   * 换回本地 setState（旧实现），`dataVersion` 不动，这条红。
   */
  it("点卡片启用会通知刷新：dataVersion 自增", async () => {
    const { container, root } = await renderLibrary()
    await switchToTab(container, "文风")
    const before = useWikiStore.getState().dataVersion

    await act(async () => {
      container.querySelector<HTMLElement>('[data-testid="unified-skill-entry-style:preset:warm"]')!.click()
    })
    await flushEffects()

    expect(useWikiStore.getState().dataVersion).toBe(before + 1)

    cleanup(root, container)
  })

  /*
   * 页脚文案必须与真实语义一致。旧文案「点击选中 / 已选中」有两个毛病：
   * 它既是空头承诺（改造前点了不生效、离开就丢），又与卡片徽章「当前启用」
   * 互相矛盾（一条真启用的文风，页脚仍写「点击选中」）。
   *
   * ⚠️ 同时钉住**灵魂条目仍写「点击选中」**：两类条目都 `toggleable: false`，
   * 但灵魂的点击确实是 no-op（没有全局启用态），文案不能一起被改掉。
   */
  it("文风卡片页脚说「点击启用 / 已启用」，与徽章一致；灵魂条目不受影响", async () => {
    const { container, root } = await renderLibrary()
    await switchToTab(container, "文风")

    const enabledCard = container.querySelector('[data-testid="unified-skill-entry-style:preset:cool"]')!
    const otherCard = container.querySelector('[data-testid="unified-skill-entry-style:preset:warm"]')!
    expect(enabledCard.querySelector(".ui-test-skill-toggle")?.textContent).toBe("已启用")
    expect(otherCard.querySelector(".ui-test-skill-toggle")?.textContent).toBe("点击启用")
    expect(enabledCard.textContent).not.toContain("点击选中")
    // 徽章与页脚同真：徽章说「当前启用」，页脚就说「已启用」
    expect(
      Array.from(enabledCard.querySelectorAll(".ui-test-skill-badge")).map((badge) => badge.textContent),
    ).toContain("当前启用")

    await switchToTab(container, "角色灵魂")
    const soulCard = container.querySelector('[data-testid="unified-skill-entry-soul:custom-xu"]')!
    expect(soulCard.querySelector(".ui-test-skill-toggle")?.textContent).toBe("点击选中")

    cleanup(root, container)
  })

  it("文风 tab 不提供新建/导入/编辑入口（本批不新增编辑能力）", async () => {
    const { container, root } = await renderLibrary()
    await switchToTab(container, "文风")

    expect(
      Array.from(container.querySelectorAll('[data-testid="skill-library-header-actions"] button'))
        .map((button) => button.textContent?.trim()),
    ).toEqual([])
    expect(container.querySelector(".ui-test-skill-card-open")).toBeNull()
    expect(container.querySelector(".ui-test-skill-toggle input")).toBeNull()

    /*
     * 逐张卡片地钉住 ENTRY_CAPABILITIES.style 的**三个**布尔：
     * 卡片内一个 `input` / `button` 都不许有。
     *  - `favoritable` → 收藏星按钮（button）
     *  - `toggleable`  → 启用勾选框（input）
     *  - `openable`    → 下面另断「编辑」入口（它是 span，不在 input/button 里）
     * 之前只有 `toggleable` 与 `openable` 各一条断言（还都是全页查询），
     * `favoritable` 单独改成 true 时 14/14 全绿 —— 收藏星会静默出现在一个
     * 明确「不提供任何编辑能力」的只读 tab 上。这一条同时覆盖前两个。
     */
    for (const card of Array.from(container.querySelectorAll<HTMLElement>('[data-testid^="unified-skill-entry-"]'))) {
      expect(card.querySelectorAll("input, button")).toHaveLength(0)
      expect(card.querySelector('[aria-label="收藏"]')).toBeNull()
      expect(card.querySelector('[aria-label="取消收藏"]')).toBeNull()
    }
    // 文风卡片确实渲染了（否则上面的循环在空集合上「全绿」）
    expect(container.querySelectorAll('[data-testid^="unified-skill-entry-"]').length).toBe(2)

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

    await switchToTab(container, "文风")
    expect(container.querySelector('[data-testid^="unified-skill-entry-style:"]')).toBeNull()
    const styleEmpty = container.querySelector(".ui-test-skills-empty")?.textContent ?? ""
    // 生产的真实行为：**空库**文案（读取故障与空库在本组件里不可区分）
    expect(styleEmpty).toContain("文风库还是空的")
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

    await switchToTab(container, "文风")
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
    expect(resolveActiveTab("characterSoulLibrary")).toBe("characterSoulLibrary")
    // 合并说明：`main` 的人物 Skill 视图也必须由这张显式 Record 承载，
    // 漏掉它就会落进 `isSkillLibraryTab` 的抛错分支（点开人物 Skill 直接崩）。
    expect(resolveActiveTab("personaSkillLibrary")).toBe("personaSkillLibrary")
    expect(resolveActiveTab("skillFavorites")).toBe("skillFavorites")

    expect(() => resolveActiveTab("soul")).toThrow(/非技能库的 activeView/)
    expect(() => resolveActiveTab("settings")).toThrow(/非技能库的 activeView/)
    expect(() => resolveActiveTab("lint")).toThrow(/非技能库的 activeView/)
  })

  /*
   * === 角色灵魂 tab（丁-4 步骤 1：可选面投影）===
   *
   * 这一组的值不在「能列出条目」本身（那是投影函数的机械结果），而在两件
   * 容易静默做错的事：
   *   1. 灵魂 tab 必须显示**灵魂**条目，而不是去AI味/写作条目；
   *   2. 卡片必须把**真实绑定**摆出来 —— 「列在库里」不等于「已经在用」。
   */
  it("切换角色灵魂 tab：该 tab 被标记为选中，且展示的是灵魂条目而不是别的库的条目", async () => {
    const { container, root } = await renderLibrary()

    await switchToTab(container, "角色灵魂")

    expect(useWikiStore.getState().activeView).toBe("characterSoulLibrary")
    expect(tabStates(container)).toEqual([
      ["去AI味技能", "false"],
      ["写作 Skill", "false"],
      ["文风", "false"],
      ["角色灵魂", "true"],
      ["人物 Skill", "false"],
      ["收藏", "false"],
    ])
    expect(entryIds(container)).toContain("soul:custom-xu")
    expect(entryIds(container)).not.toContain("de-ai:project:quiet")
    expect(entryIds(container)).not.toContain("writing:skill:three")
    expect(entryIds(container)).not.toContain("style:preset:cool")

    cleanup(root, container)
  })

  it("灵魂卡片的徽章是「角色灵魂」+ 来源，并标出真实绑定数而不是「已启用」", async () => {
    const { container, root } = await renderLibrary()
    await switchToTab(container, "角色灵魂")

    const custom = container.querySelector('[data-testid="unified-skill-entry-soul:custom-xu"]')!
    expect(custom.querySelector(".ui-test-skill-card-name")?.textContent).toBe("许七安")
    expect(
      Array.from(custom.querySelectorAll(".ui-test-skill-badge")).map((badge) => badge.textContent),
    ).toEqual(["角色灵魂", "项目", "已绑定 1 个人物"])
    expect(custom.querySelector(".ui-test-skill-badge.is-type")?.textContent).toBe("角色灵魂")
    expect(custom.textContent).toContain("自定义角色灵魂 · 古装权谋")

    // 未被任何人物绑定的灵魂也不能显示成「已启用」之类的东西。
    const liSi = container.querySelector('[data-testid="unified-skill-entry-soul:builtin-li-si"]')!
    expect(
      Array.from(liSi.querySelectorAll(".ui-test-skill-badge")).map((badge) => badge.textContent),
    ).toEqual(["角色灵魂", "内置", "已绑定 1 个人物"])
    const unbound = container.querySelector('[data-testid="unified-skill-entry-soul:builtin-qin-shihuang"]')!
    expect(
      Array.from(unbound.querySelectorAll(".ui-test-skill-badge")).map((badge) => badge.textContent),
    ).toEqual(["角色灵魂", "内置", "未绑定"])

    cleanup(root, container)
  })

  it("灵魂条目没有任何可写动作：没有勾选框、没有收藏星标、卡片上也没有「编辑」", async () => {
    const { container, root } = await renderLibrary()
    await switchToTab(container, "角色灵魂")

    const card = container.querySelector('[data-testid="unified-skill-entry-soul:custom-xu"]')!
    // 「启用一条灵魂」在这个架构里不存在（进不进上下文只由绑定表决定），
    // 所以这里**不能**出现任何像开关的东西。
    expect(card.querySelector('input[type="checkbox"]')).toBeNull()
    expect(card.querySelector(".ui-test-skill-card-star")).toBeNull()
    expect(card.querySelector(".ui-test-skill-card-open")).toBeNull()
    expect(card.textContent).toContain("点击选中")

    cleanup(root, container)
  })

  it("灵魂 tab 没有分类 chips、也没有新建/导入动作（本批不给灵魂库写入口）", async () => {
    const { container, root } = await renderLibrary()
    await switchToTab(container, "角色灵魂")

    expect(chipLabels(container)).toEqual([])
    // 动作区容器仍会渲染，但**一个按钮都不能有** —— 断按钮而不是断容器。
    expect(
      Array.from(
        container.querySelectorAll('[data-testid="skill-library-header-actions"] button'),
      ).map((button) => button.textContent?.trim()),
    ).toEqual([])

    cleanup(root, container)
  })

  it("搜索能命中灵魂条目（且不会因为灵魂没有 rawSkill 而崩）", async () => {
    const { container, root } = await renderLibrary()
    await switchToTab(container, "角色灵魂")

    const search = container.querySelector<HTMLInputElement>('[data-testid="unified-skill-search-input"]')!
    await setInputValue(search, "抄诗")

    // 命中点只在 `content`（灵魂画像文本）里，证明搜索确实读到了 aura 自己的字段。
    expect(entryIds(container)).toEqual(["soul:custom-xu"])

    cleanup(root, container)
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
 */
describe("文风 tab 的自进化入口", () => {
  it("切到「文风」tab 能看到开关，默认关闭", async () => {
    const { container, root } = await renderLibrary()
    await switchToTab(container, "文风")

    expect(container.querySelector('[data-testid="style-evolution-panel"]')).not.toBeNull()
    // 默认关闭：数据文件不存在时退化成 emptyState()，而不是让整页崩掉
    expect(
      container.querySelector('[data-testid="style-evolution-toggle"]')?.getAttribute("aria-pressed"),
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

  it("开关面板只属于「文风」tab，别处不出现", async () => {
    const { container, root } = await renderLibrary()
    await switchToTab(container, "去AI味技能")
    expect(container.querySelector('[data-testid="style-evolution-panel"]')).toBeNull()

    await switchToTab(container, "文风")
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
