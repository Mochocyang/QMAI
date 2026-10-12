// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useWikiStore } from "@/stores/wiki-store"
import { WritingStyleLibraryView } from "./writing-style-library-view"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mem = new Map<string, string>()

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
}))

const PROJECT = "C:/project"
const STYLE_PATH = `${PROJECT}/.qmai/writing-style.json`

function storeJSON(styles: unknown[], enabledStyleId: string | null = null): string {
  return JSON.stringify({ version: 1, enabledStyleId, styles })
}

const preset = {
  id: "preset:cool",
  name: "冷硬叙事文风",
  sourceBook: "凡人修仙传",
  profile: {
    schemaVersion: 2,
    generatedAt: 1,
    sampledChapterIds: [],
    constitution: "短句为主",
    samples: ["片段一"],
    integratedDna: "",
  },
  createdAt: 100,
  updatedAt: 100,
}

let host: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function render() {
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(<WritingStyleLibraryView />)
  })
  await flush()
}

function getButton(label: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent?.trim() === label)
}

async function setField(testid: string, value: string) {
  const el = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-testid="${testid}"]`)!
  await act(async () => {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value)
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

beforeEach(() => {
  mem.clear()
  mem.set(STYLE_PATH, storeJSON([preset], null))
  vi.restoreAllMocks()
  useWikiStore.setState({
    project: { id: "p1", name: "测试项目", path: PROJECT },
    selectedWritingStyleLibraryStyleId: preset.id,
    selectedSkillLibrarySkillId: null,
    selectedWritingSkillLibrarySkillId: null,
  })
})

describe("WritingStyleLibraryView", () => {
  it("读入选中的文风预设并回填表单", async () => {
    await render()

    expect(host.querySelector<HTMLInputElement>('[data-testid="writing-style-name"]')!.value).toBe("冷硬叙事文风")
    expect(host.querySelector<HTMLInputElement>('[data-testid="writing-style-source"]')!.value).toBe("凡人修仙传")
    expect(host.querySelector<HTMLTextAreaElement>('[data-testid="writing-style-constitution"]')!.value).toBe("短句为主")
  })

  it("没有选中项时展示引导文案", async () => {
    useWikiStore.setState({ selectedWritingStyleLibraryStyleId: null })
    await render()

    expect(host.querySelector('[data-testid="writing-style-library-view"]')).toBeNull()
    expect(host.textContent).toContain("新建文风")
  })

  it("改名称与硬约束并保存：写回 .qmai/writing-style.json", async () => {
    await render()

    await setField("writing-style-name", "冷硬叙事 v2")
    await setField("writing-style-constitution", "长句为主")
    await act(async () => {
      getButton("保存")?.click()
    })
    await flush()

    const saved = JSON.parse(mem.get(STYLE_PATH)!) as { styles: Array<{ name: string; profile: { constitution: string } }> }
    expect(saved.styles[0].name).toBe("冷硬叙事 v2")
    expect(saved.styles[0].profile.constitution).toBe("长句为主")
    expect(host.textContent).toContain("已保存")
  })

  it("启用文风：写入 enabledStyleId，按钮切成「停用」", async () => {
    await render()

    await act(async () => {
      getButton("启用")?.click()
    })
    await flush()

    const saved = JSON.parse(mem.get(STYLE_PATH)!) as { enabledStyleId: string | null }
    expect(saved.enabledStyleId).toBe(preset.id)
    expect(getButton("停用")).toBeDefined()
  })

  it("删除文风：确认后移除预设并清空选中", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true)
    await render()

    await act(async () => {
      getButton("删除")?.click()
    })
    await flush()

    const saved = JSON.parse(mem.get(STYLE_PATH)!) as { styles: unknown[] }
    expect(saved.styles).toHaveLength(0)
    expect(useWikiStore.getState().selectedWritingStyleLibraryStyleId).toBeNull()
  })

  it("取消删除：不改动 store", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false)
    await render()

    await act(async () => {
      getButton("删除")?.click()
    })
    await flush()

    const saved = JSON.parse(mem.get(STYLE_PATH)!) as { styles: unknown[] }
    expect(saved.styles).toHaveLength(1)
  })
})
