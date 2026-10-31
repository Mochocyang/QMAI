// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * 这一组盯着的是「点了没反应」那个回归。
 *
 * 当时的错法：中栏面板从 store 读到意图后**立刻把状态清成 null**，
 * 于是 WritingWorkspace 的 `personaPane ? <面板/> : <文档预览/>` 马上翻回文档，
 * 面板刚挂载就被卸载 —— 用户点角色什么都不会发生。
 *
 * 所以这里断言：读意图之后，`personaOutlinePane` **必须仍然非空**；
 * 清空只允许发生在用户主动关闭时。
 */
const storeState = {
  project: { path: "/tmp/project" } as { path: string } | null,
  personaOutlinePane: null as null | { mode: string; id?: string },
  setPersonaOutlinePane: vi.fn(),
  setPersonaSkillLibraryDraftDirty: vi.fn(),
  personaSkillCreateRequested: false,
  setPersonaSkillCreateRequested: vi.fn(),
  llmConfig: {},
  novelConfig: {},
}

vi.mock("@/stores/wiki-store", () => {
  const hook = (selector: (state: Record<string, unknown>) => unknown) => selector(storeState as unknown as Record<string, unknown>)
  ;(hook as unknown as { getState: () => unknown }).getState = () => storeState
  return { useWikiStore: hook }
})

vi.mock("@/lib/novel/persona-skill-store", () => ({
  loadPersonaSkillIndex: vi.fn(async () => ({ version: 1, skills: [] })),
  loadPersonaSightings: vi.fn(async () => ({ version: 1, sightings: [] })),
  listPersonaSkillRevisions: vi.fn(async () => []),
  readPersonaSkillDocument: vi.fn(async () => ""),
  readPersonaSkillResearch: vi.fn(async () => ({})),
  restorePersonaSkillRevision: vi.fn(async () => ({})),
  savePersonaSkillDocumentByUser: vi.fn(async () => undefined),
  updatePersonaSkillIndex: vi.fn(async () => ({ version: 1, skills: [] })),
}))

vi.mock("@/lib/novel/persona-skill-learning", () => ({
  regeneratePersonaSkillResearch: vi.fn(async () => true),
  deletePersonaSighting: vi.fn(async () => true),
  promotePersonaSightingLocal: vi.fn(async () => null),
  demotePersonaSkillToSighting: vi.fn(async () => true),
  savePersonaSkillProfileByUser: vi.fn(async () => true),
  createPersonaSkillByUser: vi.fn(async () => ({ id: "x" })),
}))

vi.mock("@/lib/novel/persona-outline-detach", () => ({
  removePersonaFromProject: vi.fn(async () => []),
}))

vi.mock("@/components/uitest/ui-test-tools.css", () => ({}))

import { PersonaSkillView } from "./persona-skill-view"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  storeState.setPersonaOutlinePane = vi.fn()
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

describe("PersonaSkillView 的中栏面板态", () => {
  it("读到一个角色意图后，不清空 personaOutlinePane（否则面板会被立刻卸载）", async () => {
    storeState.personaOutlinePane = { mode: "persona", id: "杨寒" }
    await act(async () => root.render(<PersonaSkillView />))
    // 关键断言：没有调用清空
    expect(storeState.setPersonaOutlinePane).not.toHaveBeenCalledWith(null)
  })

  it("读到新建意图后，同样保留面板状态", async () => {
    storeState.personaOutlinePane = { mode: "create" }
    await act(async () => root.render(<PersonaSkillView />))
    expect(storeState.setPersonaOutlinePane).not.toHaveBeenCalledWith(null)
    // 新建表单应该已经展开
    expect(host.ownerDocument.body.textContent).toContain("新建人物角色")
  })
})
