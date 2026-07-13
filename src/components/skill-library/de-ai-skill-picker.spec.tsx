// @vitest-environment jsdom

import { act, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useWikiStore } from "@/stores/wiki-store"
import { DeAiSkillOptionsPanel, DeAiSkillPicker } from "./de-ai-skill-picker"
import { useDeAiSkillOptions } from "./use-de-ai-skill-options"

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

async function renderPicker(onChange = vi.fn(), props: Partial<ComponentProps<typeof DeAiSkillPicker>> = {}) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<DeAiSkillPicker value="built-in:comprehensive" onChange={onChange} {...props} />)
  })
  return { container, root, onChange }
}

function SkillOptionsProbe() {
  const options = useDeAiSkillOptions({
    projectPath: "C:/project",
    selectedSkillId: undefined,
    useLastChapterSkill: true,
  })
  return (
    <div>
      <span data-testid="effective-name">{options.effectiveName}</span>
      <span data-testid="current-id">{options.currentSkillId}</span>
      <span data-testid="default-id">{options.defaultSkillId}</span>
    </div>
  )
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
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

  it("shows the effective de-AI skill", async () => {
    const { container, root } = await renderPicker()

    const button = container.querySelector<HTMLButtonElement>("button")
    expect(button?.textContent).toContain("去AI味：综合去AI味-项目版")
    expect(button?.title).toBe("当前去AI味 Skill：综合去AI味-项目版")

    await act(async () => {
      button?.click()
    })

    expect(container.textContent).not.toContain("已修改")

    cleanup(root, container)
  })

  it("reloads skills after the skill library data version changes", async () => {
    const { container, root } = await renderPicker()
    await flushEffects()
    expect(container.querySelector<HTMLButtonElement>("button")?.textContent).toContain("综合去AI味-项目版")

    readFileMock.mockResolvedValue(JSON.stringify({
      version: 1,
      defaultSkillId: "built-in:comprehensive",
      disabledSkillIds: [],
      projectSkills: [],
      builtInSkillOverrides: [{
        id: "built-in:comprehensive",
        name: "综合去AI味-新版",
        description: "当前项目新规则",
        templateId: "comprehensive",
        content: "新的项目覆盖规则",
        source: "built-in",
        createdAt: 1000,
        updatedAt: 3000,
      }],
    }))

    await act(async () => {
      useWikiStore.getState().bumpDataVersion()
    })
    await flushEffects()

    expect(container.querySelector<HTMLButtonElement>("button")?.textContent).toContain("综合去AI味-新版")

    cleanup(root, container)
  })

  it("shows a recovery hint when the skill config is corrupt", async () => {
    readFileMock.mockResolvedValue("{bad json")
    const { container, root } = await renderPicker()
    await flushEffects()

    const button = container.querySelector<HTMLButtonElement>("button")
    expect(button?.textContent).toContain("去AI味：配置损坏")
    expect(button?.title).toBe("当前去AI味 Skill：配置损坏")

    await act(async () => {
      button?.click()
    })

    expect(container.textContent).toContain("技能库配置文件损坏，请到技能库恢复配置")

    cleanup(root, container)
  })

  it("renders shared option list states for chapter and chat entries", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <DeAiSkillOptionsPanel
          loading={false}
          errorMessage=""
          emptyMessage="暂无可用去AI味技能"
          skills={[{
            id: "built-in:comprehensive",
            name: "综合去AI味-项目版",
            description: "当前项目规则",
            templateId: "comprehensive",
            content: "当前项目覆盖后的内置规则",
            source: "built-in",
          }]}
          currentSkillId="built-in:comprehensive"
          defaultSkillId="built-in:comprehensive"
          onPick={vi.fn()}
        />,
      )
    })

    expect(container.textContent).toContain("综合去AI味-项目版")
    expect(container.textContent).toContain("当前")
    expect(container.textContent).toContain("默认")
    expect(container.textContent).not.toContain("已修改")

    await act(async () => {
      root.render(
        <DeAiSkillOptionsPanel
          loading={false}
          errorMessage="技能库配置文件损坏，请到技能库恢复配置"
          emptyMessage="暂无可用去AI味技能"
          skills={[]}
          currentSkillId={null}
          defaultSkillId={null}
          onPick={vi.fn()}
        />,
      )
    })

    expect(container.textContent).toContain("技能库配置文件损坏，请到技能库恢复配置")

    cleanup(root, container)
  })

  it("loads shared de-AI skill option state with last chapter skill fallback", async () => {
    readFileMock.mockResolvedValue(JSON.stringify({
      version: 1,
      defaultSkillId: "built-in:comprehensive",
      disabledSkillIds: [],
      projectSkills: [],
      builtInSkillOverrides: [],
      lastChapterDeAiSkillId: "built-in:dialogue-natural",
    }))
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(<SkillOptionsProbe />)
    })
    await flushEffects()

    expect(container.querySelector('[data-testid="effective-name"]')?.textContent).toContain("对话口语化")
    expect(container.querySelector('[data-testid="current-id"]')?.textContent).toBe("built-in:dialogue-natural")
    expect(container.querySelector('[data-testid="default-id"]')?.textContent).toBe("built-in:comprehensive")

    cleanup(root, container)
  })

  it("closes the picker with Escape and outside click", async () => {
    const { container, root } = await renderPicker()
    await flushEffects()
    const button = container.querySelector<HTMLButtonElement>("button")

    await act(async () => {
      button?.click()
    })
    expect(container.textContent).toContain("当前项目规则")

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    })
    expect(container.textContent).not.toContain("当前项目规则")

    await act(async () => {
      button?.click()
    })
    expect(container.textContent).toContain("当前项目规则")

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
    })
    expect(container.textContent).not.toContain("当前项目规则")

    cleanup(root, container)
  })

  it("highlights the current option and supports keyboard pick", async () => {
    const onChange = vi.fn()
    const { container, root } = await renderPicker(onChange)
    await flushEffects()
    const button = container.querySelector<HTMLButtonElement>("button")

    await act(async () => {
      button?.click()
    })

    expect(container.querySelector('[aria-current="true"]')?.textContent).toContain("综合去AI味-项目版")

    await act(async () => {
      container
        .querySelector('[role="listbox"]')
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
    })
    await act(async () => {
      container
        .querySelector('[role="listbox"]')
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    })

    expect(onChange).toHaveBeenCalledWith("built-in:reduce-explanation")

    cleanup(root, container)
  })

  it("focuses the option list after opening the picker", async () => {
    const { container, root } = await renderPicker()
    await flushEffects()
    const button = container.querySelector<HTMLButtonElement>("button")

    await act(async () => {
      button?.click()
    })
    await flushEffects()

    expect(document.activeElement).toBe(container.querySelector('[role="listbox"]'))

    cleanup(root, container)
  })

  it("anchors the option panel with fixed positioning so overflow toolbars do not clip it", async () => {
    const { container, root } = await renderPicker()
    await flushEffects()
    const button = container.querySelector<HTMLButtonElement>("button")

    await act(async () => {
      button?.click()
    })

    const popover = container.querySelector<HTMLElement>('[data-testid="de-ai-skill-picker-popover"]')
    expect(popover?.className).toContain("fixed")
    expect(popover?.style.left).not.toBe("")

    cleanup(root, container)
  })

  it("can render as an icon-only trigger while keeping hover and accessible descriptions", async () => {
    const { container, root } = await renderPicker(vi.fn(), { iconOnly: true })
    await flushEffects()
    const button = container.querySelector<HTMLButtonElement>("button")

    expect(button?.textContent).not.toContain("去AI味")
    expect(button?.textContent).not.toContain("综合去AI味")
    expect(button?.title).toBe("当前去AI味 Skill：综合去AI味-项目版。点击选择去AI味 Skill")
    expect(button?.getAttribute("aria-label")).toBe("当前去AI味 Skill：综合去AI味-项目版。点击选择去AI味 Skill")

    cleanup(root, container)
  })
})
