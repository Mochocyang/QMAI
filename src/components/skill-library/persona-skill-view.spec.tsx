// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useWikiStore } from "@/stores/wiki-store"
import {
  personaSkillLockKey,
  withPersonaSkillLock,
  __resetPersonaSkillLocksForTesting,
} from "@/lib/novel/persona-skill-store"
import { PersonaSkillView } from "./persona-skill-view"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const io = vi.hoisted(() => ({ files: new Map<string, string>() }))

vi.mock("@/commands/fs", () => ({
  readFile: async (path: string) => {
    if (!io.files.has(path)) throw new Error(`文件缺失：${path}`)
    return io.files.get(path)!
  },
  writeFileAtomic: async (path: string, contents: string) => {
    io.files.set(path, contents)
  },
  // 加固后的 store 靠 fileExists 区分「索引不存在」（可安全当空索引）与
  // 「存在但读不出来」（拒绝写，绝不覆盖）。不 mock 它会掉进真实 Tauri invoke。
  fileExists: async (path: string) => io.files.has(path),
  createDirectory: async () => {},
  listDirectory: async (dir: string) => {
    const prefix = dir.endsWith("/") ? dir : `${dir}/`
    const nodes = new Map<string, { name: string; path: string; is_dir: boolean }>()
    for (const path of io.files.keys()) {
      if (!path.startsWith(prefix)) continue
      const rest = path.slice(prefix.length)
      const head = rest.split("/")[0]
      const childPath = `${prefix}${head}`
      nodes.set(childPath, { name: head, path: childPath, is_dir: rest.includes("/") })
    }
    return [...nodes.values()]
  },
}))

// 视图只需要「重新整理研究文件」这一个动作来自学习模块；整块 mock 掉，
// 免得把 llm-client / Tauri 那串东西拖进 jsdom。
vi.mock("@/lib/novel/persona-skill-learning", () => ({
  regeneratePersonaSkillResearch: vi.fn(async () => true),
}))

const project = "C:/project"
const indexFile = `${project}/.qmai/persona-skills/index.json`

function writeIndex(skills: unknown[]) {
  io.files.set(indexFile, JSON.stringify({ version: 1, skills }))
}

function meta(overrides: Record<string, unknown> = {}) {
  return {
    id: "林清越",
    characterName: "林清越",
    aliases: [],
    roleType: "男主",
    tier: "major",
    pinned: false,
    status: "active",
    firstChapter: 1,
    lastChapter: 3,
    appearanceCount: 3,
    createdChapter: 1,
    lastLearnedChapter: 3,
    skillRevision: 1,
    editedByUser: false,
    hasResearch: false,
    updatedAt: "2026-10-10T00:00:00.000Z",
    ...overrides,
  }
}

function readIndex(): { skills: Array<Record<string, unknown>> } {
  return JSON.parse(io.files.get(indexFile)!)
}

async function renderView() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<PersonaSkillView />)
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

function getButton(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.trim() === label,
  )
}

async function click(element: HTMLElement | null) {
  await act(async () => {
    element?.click()
  })
  await flushEffects()
}

describe("PersonaSkillView", () => {
  beforeEach(() => {
    io.files.clear()
    // 占锁那条用例若在断言前失败，锁链会留在模块级 locks Map 里，
    // 把后面所有用例一起挂死（报出来的是假失败）。每条都从干净锁表开始。
    __resetPersonaSkillLocksForTesting()
    useWikiStore.getState().setProject({ id: "p1", name: "测试项目", path: project })
    useWikiStore.getState().setActiveView("personaSkillLibrary")
    useWikiStore.getState().setPersonaSkillLibraryDraftDirty(false)
  })

  it("按 index.json 渲染卡片", async () => {
    writeIndex([meta(), meta({ id: "沈砚", characterName: "沈砚", tier: "minor", roleType: "配角" })])
    const { container, root } = await renderView()

    expect(container.querySelector('[data-testid="persona-skill-view"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="persona-skill-card-林清越"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="persona-skill-card-沈砚"]')).not.toBeNull()

    cleanup(root, container)
  })

  it("没有档案时给出「点提取记忆会自动建档」的空态", async () => {
    const { container, root } = await renderView()
    expect(container.textContent).toContain("提取记忆")
    cleanup(root, container)
  })

  it("点绿勾把 pinned 写进 index.json，并把档位升成 major", async () => {
    writeIndex([meta({ characterName: "沈砚", id: "沈砚", tier: "minor", roleType: "配角" })])
    const { container, root } = await renderView()

    const pin = container.querySelector<HTMLButtonElement>('[data-testid="persona-skill-pin-沈砚"]')!
    expect(pin.getAttribute("aria-pressed")).toBe("false")

    await click(pin)

    const stored = readIndex().skills[0]
    expect(stored.pinned).toBe(true)
    expect(stored.tier).toBe("major")
    expect(
      container.querySelector('[data-testid="persona-skill-pin-沈砚"]')!.getAttribute("aria-pressed"),
    ).toBe("true")

    cleanup(root, container)
  })

  it("再点一次取消绿勾", async () => {
    writeIndex([meta({ pinned: true })])
    const { container, root } = await renderView()

    await click(container.querySelector('[data-testid="persona-skill-pin-林清越"]'))

    expect(readIndex().skills[0].pinned).toBe(false)
    expect(readIndex().skills[0].tier).toBe("major") // 男主本来就是 major

    cleanup(root, container)
  })

  it("打开档案后保存：写回 SKILL.md 并把 editedByUser 置真", async () => {
    writeIndex([meta()])
    io.files.set(`${project}/.qmai/persona-skills/林清越/SKILL.md`, "# 林清越 · 人物 Skill\n\n## 怎么说话\n\n原始内容。\n")
    const { container, root } = await renderView()

    await click(getButton(container, "打开档案") ?? null)

    const editor = container.querySelector<HTMLTextAreaElement>('[data-testid="persona-skill-editor"]')!
    expect(editor.value).toContain("原始内容。")

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
      setter?.call(editor, "# 林清越 · 人物 Skill\n\n## 怎么说话\n\n用户改过的内容。\n")
      editor.dispatchEvent(new Event("input", { bubbles: true }))
    })

    await click(getButton(container, "保存") ?? null)

    expect(io.files.get(`${project}/.qmai/persona-skills/林清越/SKILL.md`)).toContain("用户改过的内容。")
    expect(readIndex().skills[0].editedByUser).toBe(true)
    expect(readIndex().skills[0].skillRevision).toBe(2)

    cleanup(root, container)
  })

  it("状态筛选：点「归档」只剩归档的人", async () => {
    writeIndex([
      meta(),
      meta({ id: "路人", characterName: "路人", status: "archived" }),
    ])
    const { container, root } = await renderView()

    await click(getButton(container, "归档 1") ?? null)

    expect(container.querySelector('[data-testid="persona-skill-card-路人"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="persona-skill-card-林清越"]')).toBeNull()

    cleanup(root, container)
  })

  it("搜索框按人物名过滤", async () => {
    writeIndex([meta(), meta({ id: "沈砚", characterName: "沈砚" })])
    const { container, root } = await renderView()

    const input = container.querySelector<HTMLInputElement>('[data-testid="persona-skill-search-input"]')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
      setter?.call(input, "沈")
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "沈" }))
    })
    await flushEffects()

    expect(container.querySelector('[data-testid="persona-skill-card-沈砚"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="persona-skill-card-林清越"]')).toBeNull()

    cleanup(root, container)
  })

  it("保存档案：正文与 editedByUser 在同一把锁内写入", async () => {
    writeIndex([meta()])
    const docPath = `${project}/.qmai/persona-skills/林清越/SKILL.md`
    io.files.set(docPath, "# 林清越 · 人物 Skill\n\n## 怎么说话\n\n原始内容。\n")
    const { container, root } = await renderView()

    await click(getButton(container, "打开档案") ?? null)

    const editor = container.querySelector<HTMLTextAreaElement>('[data-testid="persona-skill-editor"]')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
      setter?.call(editor, "# 林清越 · 人物 Skill\n\n## 怎么说话\n\n用户改过的内容。\n")
      editor.dispatchEvent(new Event("input", { bubbles: true }))
    })

    // 先自己占住锁，模拟「后台学习正在跑」
    let release!: () => void
    const held = withPersonaSkillLock(
      personaSkillLockKey(project),
      () => new Promise<void>((resolve) => { release = () => resolve() }),
    )

    await click(getButton(container, "保存") ?? null)

    // 锁还被占着 —— 正文必须一字未动，证明「写正文」也在锁内。
    // 若实现是「先写正文、再单独取锁改标志」，这里会提前看到用户那句话。
    expect(io.files.get(docPath)).toContain("原始内容。")

    release()
    await act(async () => { await held })
    await flushEffects()

    expect(io.files.get(docPath)).toContain("用户改过的内容。")
    expect(readIndex().skills[0].editedByUser).toBe(true)
    expect(readIndex().skills[0].skillRevision).toBe(2)

    cleanup(root, container)
  })
})
