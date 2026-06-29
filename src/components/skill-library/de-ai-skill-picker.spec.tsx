// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useWikiStore } from "@/stores/wiki-store"
import { DeAiSkillPicker } from "./de-ai-skill-picker"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const readFileMock = vi.hoisted(() => vi.fn())
const joinMock = vi.hoisted(() => vi.fn(async (...parts: string[]) => parts.join("/")))

vi.mock("@/commands/fs", () => ({
  readFile: readFileMock,
  writeFile: vi.fn(),
}))

vi.mock("@tauri-apps/api/path", () => ({
  join: joinMock,
}))

async function renderPicker() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<DeAiSkillPicker value="built-in:comprehensive" onChange={vi.fn()} />)
  })
  return { container, root }
}

function cleanup(root: Root, container: HTMLElement) {
  act(() => root.unmount())
  document.body.removeChild(container)
}

describe("DeAiSkillPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readFileMock.mockResolvedValue(JSON.stringify({
      version: 1,
      defaultSkillId: "built-in:comprehensive",
      disabledSkillIds: [],
      projectSkills: [],
      builtInSkillOverrides: [{
        id: "built-in:comprehensive",
        name: "综合去AI味-项目版",
        description: "当前项目规则",
        templateId: "comprehensive",
        content: "当前项目覆盖后的内置规则",
        source: "built-in",
        createdAt: 1000,
        updatedAt: 2000,
      }],
    }))
    useWikiStore.getState().setProject({
      id: "p1",
      name: "测试项目",
      path: "C:/project",
    })
  })

  it("shows the effective de-AI skill and marks modified skills", async () => {
    const { container, root } = await renderPicker()

    const button = container.querySelector<HTMLButtonElement>("button")
    expect(button?.textContent).toContain("去AI味：综合去AI味-项目版")
    expect(button?.title).toBe("当前去AI味 Skill：综合去AI味-项目版")

    await act(async () => {
      button?.click()
    })

    expect(container.textContent).toContain("已修改")

    cleanup(root, container)
  })
})
