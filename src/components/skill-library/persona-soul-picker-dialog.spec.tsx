// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// 灵魂库是异步 IO：这里只验证「挑选 → 确认」这条交互，
// 数据源用固定夹具替代，避免把测试绑到 `.qmai/character-aura.json` 的读写细节上。
const listCharacterAuras = vi.fn()
vi.mock("@/lib/novel/character-aura", () => ({
  listCharacterAuras: (...args: unknown[]) => listCharacterAuras(...args),
}))

import { PersonaSoulPickerDialog } from "./persona-soul-picker-dialog"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const AURAS = [
  {
    id: "builtin-serious",
    builtIn: true,
    name: "严肃沉稳",
    category: "男主角",
    sourceNote: "内置灵魂",
    corpus: "",
    styleDescription: "短句、命令式、重秩序与尺度。",
    behaviorRules: "",
    boundaries: "",
    notes: "",
  },
  {
    id: "custom-1",
    builtIn: false,
    name: "江湖气",
    sourceNote: "自定义",
    corpus: "",
    styleDescription: "爱用行话与俚语；先讲义气，再谈价钱。",
    behaviorRules: "",
    boundaries: "",
    notes: "",
  },
]

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  listCharacterAuras.mockReset()
  listCharacterAuras.mockResolvedValue(AURAS)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

async function render(props: Partial<Parameters<typeof PersonaSoulPickerDialog>[0]> = {}) {
  const onConfirm = vi.fn()
  const onOpenChange = vi.fn()
  await act(async () =>
    root.render(
      <PersonaSoulPickerDialog
        open={props.open ?? true}
        projectPath={props.projectPath ?? "/tmp/project"}
        characterName={props.characterName ?? "杨寒"}
        currentSoulName={props.currentSoulName ?? ""}
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
      />,
    ),
  )
  return { onConfirm, onOpenChange }
}

describe("PersonaSoulPickerDialog（S1 卡片网格）", () => {
  it("打开时读取角色灵魂库并渲染卡片", async () => {
    await render()
    expect(listCharacterAuras).toHaveBeenCalledWith("/tmp/project")
    expect(host.ownerDocument.body.textContent).toContain("为「杨寒」绑定角色灵魂")
    expect(host.ownerDocument.querySelector('[data-testid="persona-soul-option-严肃沉稳"]')).not.toBeNull()
    expect(host.ownerDocument.querySelector('[data-testid="persona-soul-option-江湖气"]')).not.toBeNull()
  })

  it("当前已绑定的灵魂带「已绑定」标记", async () => {
    await render({ currentSoulName: "严肃沉稳" })
    const card = host.ownerDocument.querySelector('[data-testid="persona-soul-option-严肃沉稳"]')!
    expect(card.textContent).toContain("已绑定")
  })

  it("选中一张卡后确认，交回灵魂名", async () => {
    const { onConfirm } = await render()
    const card = host.ownerDocument.querySelector<HTMLElement>('[data-testid="persona-soul-option-江湖气"]')!
    await act(async () => card.click())
    const confirm = host.ownerDocument.querySelector<HTMLElement>('[data-testid="persona-soul-confirm"]')!
    await act(async () => confirm.click())
    expect(onConfirm).toHaveBeenCalledWith("江湖气")
  })

  it("没选之前确认按钮不可点", async () => {
    await render()
    const confirm = host.ownerDocument.querySelector<HTMLButtonElement>('[data-testid="persona-soul-confirm"]')!
    expect(confirm.disabled).toBe(true)
  })

  it("按「内置 / 自定义」筛选", async () => {
    await render()
    const custom = host.ownerDocument.querySelector<HTMLElement>('[data-testid="persona-soul-filter-custom"]')!
    await act(async () => custom.click())
    expect(host.ownerDocument.querySelector('[data-testid="persona-soul-option-江湖气"]')).not.toBeNull()
    expect(host.ownerDocument.querySelector('[data-testid="persona-soul-option-严肃沉稳"]')).toBeNull()
  })

  it("灵魂库为空时给出可操作指引", async () => {
    listCharacterAuras.mockResolvedValue([])
    await render()
    expect(host.ownerDocument.body.textContent).toContain("角色灵魂库还是空的")
  })
})
