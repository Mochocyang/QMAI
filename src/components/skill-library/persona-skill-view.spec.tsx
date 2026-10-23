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

const io = vi.hoisted(() => ({ files: new Map<string, string>(), writes: 0 }))

vi.mock("@/commands/fs", () => ({
  readFile: async (path: string) => {
    if (!io.files.has(path)) throw new Error(`文件缺失：${path}`)
    return io.files.get(path)!
  },
  writeFileAtomic: async (path: string, contents: string) => {
    io.writes += 1
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

// 视图只需要「重新整理研究文件」「把候选人物建档」「把误建档的人退回候选」三个动作
// 来自学习模块；整块 mock 掉，免得把 llm-client / Tauri 那串东西拖进 jsdom。
const learning = vi.hoisted(() => ({
  promote: vi.fn(async () => true),
  demote: vi.fn(async () => true),
}))

vi.mock("@/lib/novel/persona-skill-learning", () => ({
  regeneratePersonaSkillResearch: vi.fn(async () => true),
  promotePersonaSighting: learning.promote,
  demotePersonaSkillToSighting: learning.demote,
  /*
   * 保存路径必须**真实跑一遍**：这一组用例要验证的正是「正文与 editedByUser
   * 在同一把锁内写入」。mock 成空函数等于把被测对象换成 `() => {}`，
   * 用例永远绿、功能永远错。这里用纯文本重建 + store 的真实保存，
   * 只省掉 learning 模块拖进来的 llm-client / Tauri 依赖。
   */
  savePersonaSkillProfileByUser: async (input: {
    projectPath: string
    id: string
    fields: Record<string, string>
    roleType?: string
  }) => {
    const { applyPersonaProfileEdits } = await import("@/lib/novel/persona-skill-profile")
    const store = await import("@/lib/novel/persona-skill-store")
    const previous = await store.readPersonaSkillDocument(input.projectPath, input.id)
    const base = previous.trim() ? previous : `# ${input.id} · 人物 Skill\n`
    return store.savePersonaSkillDocumentByUser(
      input.projectPath,
      input.id,
      applyPersonaProfileEdits(base, input.fields),
    )
  },
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
    io.writes = 0
    learning.promote.mockClear()
    learning.demote.mockClear()
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

  it("打开档案后按表单保存：写回 SKILL.md 并把 editedByUser 置真", async () => {
    writeIndex([meta()])
    io.files.set(
      `${project}/.qmai/persona-skills/林清越/SKILL.md`,
      "# 林清越 · 人物 Skill\n\n## 怎么说话\n\n原始内容。\n",
    )
    const { container, root } = await renderView()

    await click(getButton(container, "打开档案") ?? null)

    // 档案面板默认落在「基础设定」：这一格是结构化表单，不再是整篇 Markdown
    const field = container.querySelector<HTMLTextAreaElement>('[data-testid="persona-field-性格"]')!
    expect(field).not.toBeNull()
    expect(container.textContent).toContain("势力组织")

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
      setter?.call(field, "沉得住气，不轻易表态。")
      field.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await flushEffects()
    expect(container.textContent).toContain("未保存")

    await click(container.querySelector('[data-testid="persona-profile-save"]'))

    const saved = io.files.get(`${project}/.qmai/persona-skills/林清越/SKILL.md`)!
    expect(saved).toContain("## 性格")
    expect(saved).toContain("沉得住气，不轻易表态。")
    // 既有分区必须原样保留：表单保存是在旧文档上重建，不是从零拼一份
    expect(saved).toContain("## 怎么说话")
    expect(saved).toContain("原始内容。")
    expect(readIndex().skills[0].editedByUser).toBe(true)
    expect(readIndex().skills[0].skillRevision).toBe(2)

    cleanup(root, container)
  })

  it("档案页签把 SKILL.md 的分区回填成结构化字段", async () => {
    writeIndex([meta()])
    io.files.set(
      `${project}/.qmai/persona-skills/林清越/SKILL.md`,
      [
        "---",
        "character: 林清越",
        "role: 男主",
        "---",
        "",
        "# 林清越 · 人物 Skill",
        "",
        "## 性别",
        "",
        "男",
        "",
        "## 势力组织",
        "",
        "青云会",
        "",
        "## 关系网",
        "",
        "沈砚：旧识（互相提防）",
        "",
        "## 怎么说话",
        "",
        "句子短。",
        "",
        "## 补充（截至第 3 章）",
        "",
        "右肩有旧伤。",
        "",
      ].join("\n"),
    )
    const { container, root } = await renderView()

    await click(getButton(container, "打开档案") ?? null)

    expect(container.querySelector<HTMLInputElement>('[data-testid="persona-field-性别"]')!.value).toBe("男")
    expect(container.querySelector<HTMLInputElement>('[data-testid="persona-field-势力组织"]')!.value).toBe("青云会")

    // 语言与行为：5 条演技字段 + AI 追加的「补充」段
    await click(container.querySelector('[data-testid="persona-profile-tab-act"]'))
    expect(container.querySelector<HTMLTextAreaElement>('[data-testid="persona-field-怎么说话"]')!.value).toBe(
      "句子短。",
    )
    expect(container.textContent).toContain("右肩有旧伤。")

    // 关系：把「对象：关系（性质）」拆成一行一条
    await click(container.querySelector('[data-testid="persona-profile-tab-relation"]'))
    const relations = container.querySelector(".ui-test-persona-relations")!
    expect(relations.textContent).toContain("沈砚")
    expect(relations.textContent).toContain("旧识")
    expect(relations.textContent).toContain("互相提防")

    cleanup(root, container)
  })

  it("「当前状态」页签展示提取记忆投影的四段动态内容", async () => {
    writeIndex([meta()])
    io.files.set(
      `${project}/.qmai/persona-skills/林清越/SKILL.md`,
      [
        "# 林清越 · 人物 Skill",
        "",
        "## 怎么说话",
        "",
        "句子短。",
        "",
        "## 当前状态",
        "",
        "第 7 章：右肩受伤，被困在码头",
        "",
        "## 出场组织",
        "",
        "青云会：成员（第 7 章）",
        "",
        "## 认知变化",
        "",
        "第 7 章：林清越知道账本是假的",
        "",
        "## 关系变化",
        "",
        "第 7 章：与 沈砚 关系 → 怀疑",
        "",
      ].join("\n"),
    )
    const { container, root } = await renderView()

    await click(getButton(container, "打开档案") ?? null)
    await click(container.querySelector('[data-testid="persona-profile-tab-status"]'))

    expect(
      container.querySelector<HTMLTextAreaElement>('[data-testid="persona-live-当前状态"]')!.value,
    ).toContain("右肩受伤")
    expect(
      container.querySelector<HTMLTextAreaElement>('[data-testid="persona-live-出场组织"]')!.value,
    ).toContain("青云会：成员")
    expect(
      container.querySelector<HTMLTextAreaElement>('[data-testid="persona-live-认知变化"]')!.value,
    ).toContain("知道账本是假的")
    expect(
      container.querySelector<HTMLTextAreaElement>('[data-testid="persona-live-关系变化"]')!.value,
    ).toContain("与 沈砚 关系")

    cleanup(root, container)
  })

  it("原始 Markdown 页签仍可整篇编辑", async () => {
    writeIndex([meta()])
    const docPath = `${project}/.qmai/persona-skills/林清越/SKILL.md`
    io.files.set(docPath, "# 林清越 · 人物 Skill\n\n## 怎么说话\n\n原始内容。\n")
    const { container, root } = await renderView()

    await click(getButton(container, "打开档案") ?? null)
    await click(container.querySelector('[data-testid="persona-profile-tab-raw"]'))

    const editor = container.querySelector<HTMLTextAreaElement>('[data-testid="persona-skill-editor"]')!
    expect(editor.value).toContain("原始内容。")

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
      setter?.call(editor, "# 林清越 · 人物 Skill\n\n## 怎么说话\n\n用户改过的内容。\n")
      editor.dispatchEvent(new Event("input", { bubbles: true }))
    })

    await click(container.querySelector('[data-testid="persona-profile-save"]'))

    expect(io.files.get(docPath)).toContain("用户改过的内容。")
    expect(readIndex().skills[0].editedByUser).toBe(true)

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

    const field = container.querySelector<HTMLTextAreaElement>('[data-testid="persona-field-性格"]')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
      setter?.call(field, "用户改过的内容。")
      field.dispatchEvent(new Event("input", { bubbles: true }))
    })

    // 先自己占住锁，模拟「后台学习正在跑」
    let release!: () => void
    const held = withPersonaSkillLock(
      personaSkillLockKey(project),
      () => new Promise<void>((resolve) => { release = () => resolve() }),
    )

    await click(container.querySelector('[data-testid="persona-profile-save"]'))

    // 锁还被占着 —— 正文必须一字未动，证明「写正文」也在锁内。
    // 若实现是「先写正文、再单独取锁改标志」，这里会提前看到用户那句话。
    expect(io.files.get(docPath)).toContain("原始内容。")
    expect(io.files.get(docPath)).not.toContain("用户改过的内容。")

    release()
    await act(async () => { await held })
    await flushEffects()

    expect(io.files.get(docPath)).toContain("用户改过的内容。")
    expect(readIndex().skills[0].editedByUser).toBe(true)
    expect(readIndex().skills[0].skillRevision).toBe(2)

    cleanup(root, container)
  })

  it("出场频次分析：只列低出场/潜伏/归档者，且不写盘", async () => {
    writeIndex([
      meta({ id: "主角", characterName: "主角", appearanceCount: 3, status: "active" }),
      meta({ id: "低出场", characterName: "低出场", appearanceCount: 1, status: "active" }),
      meta({ id: "潜伏者", characterName: "潜伏者", appearanceCount: 5, status: "dormant" }),
      meta({ id: "归档者", characterName: "归档者", appearanceCount: 6, status: "archived" }),
    ])
    const { container, root } = await renderView()

    await click(container.querySelector('[data-testid="persona-skill-analysis-toggle"]'))
    await flushEffects()

    expect(container.querySelector('[data-testid="persona-skill-analysis"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="persona-skill-analysis-低出场"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="persona-skill-analysis-潜伏者"]')).not.toBeNull()
    const archived = container.querySelector<HTMLElement>('[data-testid="persona-skill-analysis-归档者"]')
    expect(archived).not.toBeNull()
    expect(archived!.textContent).toContain("建议归档")
    expect(container.querySelector('[data-testid="persona-skill-analysis-主角"]')).toBeNull()
    // 只读面板：绝不允许写盘
    expect(io.writes).toBe(0)

    cleanup(root, container)
  })

  it("候选人物区渲染未建档人物，点「建档」调用 promotePersonaSighting", async () => {
    io.files.set(
      `${project}/.qmai/persona-skills/sightings.json`,
      JSON.stringify({
        version: 1,
        sightings: [
          {
            characterName: "小紫",
            aliases: ["紫儿"],
            roleType: "",
            appearanceCount: 2,
            firstChapter: 1,
            lastChapter: 4,
            chapters: [1, 4],
          },
        ],
      }),
    )
    const { container, root } = await renderView()

    const candidate = container.querySelector<HTMLElement>('[data-testid="persona-skill-candidate-小紫"]')
    expect(candidate).not.toBeNull()
    expect(candidate!.textContent).toContain("小紫")
    expect(candidate!.textContent).toContain("出场 2 章")
    // 反向守卫：候选区不能再出现那枚写死 is-on 的绿勾。它长得像「重要角色开关」，
    // 实际是只能建档、没有取消分支的动作按钮 —— 用户就是因此以为「取消不掉」。
    expect(candidate!.querySelector(".ui-test-persona-pin")).toBeNull()
    expect(candidate!.textContent).toContain("建档")

    await click(container.querySelector('[data-testid="persona-skill-promote-小紫"]'))
    await flushEffects()

    expect(learning.promote).toHaveBeenCalledTimes(1)
    expect(learning.promote).toHaveBeenCalledWith(
      expect.objectContaining({ projectPath: project, characterName: "小紫" }),
    )

    cleanup(root, container)
  })

  it("档案卡提供「移回候选」，确认后调用 demotePersonaSkillToSighting", async () => {
    writeIndex([meta({ id: "小紫", characterName: "小紫", appearanceCount: 2 })])
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true)
    const { container, root } = await renderView()

    const demote = container.querySelector<HTMLButtonElement>('[data-testid="persona-skill-demote-小紫"]')
    expect(demote).not.toBeNull()
    expect(demote!.textContent).toContain("移回候选")

    await click(demote)

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(learning.demote).toHaveBeenCalledWith({ projectPath: project, characterName: "小紫" })

    confirmSpy.mockRestore()
    cleanup(root, container)
  })

  it("「移回候选」在确认框被取消时一个字节都不写", async () => {
    writeIndex([meta({ id: "小紫", characterName: "小紫" })])
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false)
    const { container, root } = await renderView()

    await click(container.querySelector('[data-testid="persona-skill-demote-小紫"]'))

    expect(learning.demote).not.toHaveBeenCalled()
    expect(io.writes).toBe(0)

    confirmSpy.mockRestore()
    cleanup(root, container)
  })
})
