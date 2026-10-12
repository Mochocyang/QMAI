// @vitest-environment jsdom

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import "@/i18n"
import type { ScenarioCandidate } from "@/lib/novel/story-simulation/scenario-types"
import { ScenarioSoulBindDialog } from "./scenario-soul-bind-dialog"

const fsMocks = vi.hoisted(() => ({
  createDirectory: vi.fn(async () => {}),
  fileExists: vi.fn(async () => false),
  writeFileAtomic: vi.fn(async () => {}),
}))

vi.mock("@/commands/fs", () => ({
  createDirectory: fsMocks.createDirectory,
  fileExists: fsMocks.fileExists,
  writeFileAtomic: fsMocks.writeFileAtomic,
}))

const auraMocks = vi.hoisted(() => ({
  listCharacterAuras: vi.fn(),
  bindCharacterAura: vi.fn(),
  unbindCharacterAura: vi.fn(),
}))

vi.mock("@/lib/novel/character-aura", async () => {
  const actual = await vi.importActual<typeof import("@/lib/novel/character-aura")>(
    "@/lib/novel/character-aura",
  )
  return {
    ...actual,
    listCharacterAuras: auraMocks.listCharacterAuras,
    bindCharacterAura: auraMocks.bindCharacterAura,
    unbindCharacterAura: auraMocks.unbindCharacterAura,
  }
})

const BLOCK_MESSAGE = "请先在大纲中添加人物小传或人物设定，再绑定角色灵魂"

function makeAura(id: string, name: string) {
  return {
    id,
    builtIn: false,
    name,
    sourceNote: "",
    corpus: "",
    styleDescription: "",
    behaviorRules: "",
    boundaries: "",
    notes: "",
  }
}

const CANDIDATE: ScenarioCandidate = {
  id: "沈砚",
  name: "沈砚",
  profile: "账房出身",
  auraId: null,
  auraName: null,
  speakingStyle: "短句",
  personality: ["谨慎"],
  knowledgeScope: ["账目"],
  doesNotKnow: ["北境战事"],
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

function renderDialog(
  props: Partial<React.ComponentProps<typeof ScenarioSoulBindDialog>> = {},
) {
  const onOpenChange = vi.fn()
  const onBound = vi.fn()
  act(() => {
    root.render(
      <ScenarioSoulBindDialog
        open
        projectPath="/proj"
        candidate={CANDIDATE}
        onOpenChange={onOpenChange}
        onBound={onBound}
        {...props}
      />,
    )
  })
  return { onOpenChange, onBound }
}

function findButton(label: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent?.trim() === label,
  )
}

function click(node: Element | null | undefined) {
  if (!node) throw new Error("要点击的元素不存在")
  act(() => {
    ;(node as HTMLElement).click()
  })
}

/** 打开弹窗 → 选中第一个灵魂 → 点「绑定」。 */
async function pickSoulAndBind(name = "账房先生") {
  renderDialog()
  await flush()
  act(() => document.body.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!.click())
  await flush()
  click(findButton("绑定"))
  await flush()
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  fsMocks.fileExists.mockResolvedValue(false)
  auraMocks.listCharacterAuras.mockResolvedValue([makeAura("a1", "账房先生")])
  auraMocks.bindCharacterAura.mockResolvedValue({ customAuras: [], bindings: [] })
  // 弹窗走 Portal 渲染到 body，所以断言一律查 document.body；每次先清空 body，
  // 否则上一个用例残留的弹窗 DOM 会让「不该出现的东西」断言假通过
  document.body.innerHTML = ""
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ""
})

describe("ScenarioSoulBindDialog", () => {
  it("打开时读出灵魂名单，选中后可绑定并回执", async () => {
    const { onBound, onOpenChange } = renderDialog()
    await flush()
    expect(auraMocks.listCharacterAuras).toHaveBeenCalledWith("/proj")

    act(() => document.body.querySelector<HTMLInputElement>('input[aria-label="账房先生"]')!.click())
    await flush()
    click(findButton("绑定"))
    await flush()

    expect(auraMocks.bindCharacterAura).toHaveBeenCalledWith("/proj", {
      characterName: "沈砚",
      auraId: "a1",
    })
    expect(onBound).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("绑定被拒（缺小传）时切到补小传步骤，并预填草稿、不写盘", async () => {
    auraMocks.bindCharacterAura.mockRejectedValueOnce(new Error(BLOCK_MESSAGE))
    await pickSoulAndBind()

    expect(document.body.textContent).toContain("先补一份人物小传")
    const textarea = document.body.querySelector<HTMLTextAreaElement>("textarea")
    expect(textarea?.value).toContain("# 沈砚")
    expect(textarea?.value).toContain("谨慎")
    expect(fsMocks.writeFileAtomic).not.toHaveBeenCalled()
  })

  it("补小传步骤：写盘 → 再次绑定 → 成功回执", async () => {
    auraMocks.bindCharacterAura
      .mockRejectedValueOnce(new Error(BLOCK_MESSAGE))
      .mockResolvedValueOnce({ customAuras: [], bindings: [] })
    await pickSoulAndBind()
    click(findButton("创建小传并绑定"))
    await flush()

    expect(fsMocks.writeFileAtomic).toHaveBeenCalledWith(
      "/proj/wiki/entities/沈砚.md",
      expect.stringContaining("tags: [character]"),
    )
    expect(auraMocks.bindCharacterAura).toHaveBeenCalledTimes(2)
  })

  it("补小传步骤可以退回重选，退回时还没写盘", async () => {
    auraMocks.bindCharacterAura.mockRejectedValueOnce(new Error(BLOCK_MESSAGE))
    await pickSoulAndBind()
    click(findButton("返回重选"))
    await flush()

    expect(document.body.textContent).toContain("绑定会写入本项目")
    expect(fsMocks.writeFileAtomic).not.toHaveBeenCalled()
  })

  it("其它错误原样显示，且不切步骤", async () => {
    auraMocks.bindCharacterAura.mockRejectedValueOnce(new Error("磁盘满了"))
    await pickSoulAndBind()

    expect(document.body.textContent).toContain("磁盘满了")
    expect(document.body.textContent).not.toContain("先补一份人物小传")
  })

  it("灵魂库为空时给出可操作的空态", async () => {
    auraMocks.listCharacterAuras.mockResolvedValue([])
    renderDialog()
    await flush()
    expect(document.body.textContent).toContain("还没有可用的角色灵魂")
  })

  it("角色已绑定时提供「解绑」，解绑成功同样回执", async () => {
    auraMocks.unbindCharacterAura.mockResolvedValue({ customAuras: [], bindings: [] })
    const { onBound } = renderDialog({
      candidate: { ...CANDIDATE, auraId: "a1", auraName: "账房先生" },
    })
    await flush()
    click(findButton("解绑"))
    await flush()
    expect(auraMocks.unbindCharacterAura).toHaveBeenCalledWith("/proj", "沈砚")
    expect(onBound).toHaveBeenCalledTimes(1)
  })

  it("未绑定时不显示「解绑」", async () => {
    renderDialog()
    await flush()
    expect(findButton("解绑")).toBeUndefined()
  })

  it("取消不产生任何写入", async () => {
    const { onOpenChange } = renderDialog()
    await flush()
    click(findButton("返回"))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(fsMocks.writeFileAtomic).not.toHaveBeenCalled()
    expect(auraMocks.bindCharacterAura).not.toHaveBeenCalled()
  })
})

describe("ScenarioSoulBindDialog 源码契约", () => {
  const src = readFileSync(resolve(__dirname, "scenario-soul-bind-dialog.tsx"), "utf8")

  it("不复用拆书工作台的绑定弹窗（那是发布语义，文案与多选都不对）", () => {
    expect(src).not.toContain("BindingTargetDialog")
    expect(src).toContain("scenario-soul-bind-dialog")
  })

  it("名单来自 listCharacterAuras，绑定走 scenario-soul-binding", () => {
    expect(src).toContain("listCharacterAuras")
    expect(src).toContain("bindScenarioSoul")
    expect(src).toContain("createProfilePageThenBind")
  })
})
