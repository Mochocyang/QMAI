// @vitest-environment jsdom
import { act } from "react"
import { createElement } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"
import { ReasoningDepthControl } from "./reasoning-depth-control"

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}))

const reasoningModel: LlmConfig = {
  provider: "openai",
  apiKey: "key",
  model: "gpt-5",
  ollamaUrl: "",
  customEndpoint: "",
  maxContextSize: 204800,
}

const plainModel: LlmConfig = { ...reasoningModel, model: "gpt-4o" }

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

function render(node: Parameters<typeof root.render>[0]) {
  act(() => {
    root.render(node)
  })
}

/**
 * React tracks the last value it wrote to an input, so assigning `.value`
 * directly makes the change invisible to its synthetic event system. Going
 * through the prototype setter keeps the tracker in sync.
 */
function setRangeValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
  descriptor?.set?.call(input, value)
}

async function flushAnimationFrames() {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    })
  }
}

describe("ReasoningDepthControl", () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it("renders nothing when the model's thinking cannot be steered", () => {
    render(createElement(ReasoningDepthControl, {
      value: "high",
      onChange: vi.fn(),
      modelConfig: plainModel,
    }))

    expect(container.querySelector("button")).toBeNull()
  })

  it("renders nothing when there is no target config, as in writing fast mode", () => {
    render(createElement(ReasoningDepthControl, {
      value: "high",
      onChange: vi.fn(),
      modelConfig: null,
    }))

    expect(container.querySelector("button")).toBeNull()
  })

  it("shows the current depth on the trigger for a reasoning model", () => {
    render(createElement(ReasoningDepthControl, {
      value: "medium",
      onChange: vi.fn(),
      modelConfig: reasoningModel,
    }))

    const trigger = container.querySelector("button")
    expect(trigger).not.toBeNull()
    expect(trigger?.textContent).toContain("chat.reasoningDepth.medium")
  })

  it("reports the stop the slider was dragged to", async () => {
    const onChange = vi.fn()
    render(createElement(ReasoningDepthControl, {
      value: "auto",
      onChange,
      modelConfig: reasoningModel,
    }))

    act(() => {
      container.querySelector("button")?.click()
    })
    // The popover measures the trigger across two animation frames before it
    // has a position to render at.
    await flushAnimationFrames()

    const slider = document.querySelector<HTMLInputElement>('input[type="range"]')
    expect(slider).not.toBeNull()
    expect(slider?.value).toBe("0")

    act(() => {
      setRangeValue(slider!, "4")
      slider!.dispatchEvent(new Event("input", { bubbles: true }))
    })

    expect(onChange).toHaveBeenCalledWith("high")
  })

  it("jumps to a stop when its tick label is clicked", async () => {
    const onChange = vi.fn()
    render(createElement(ReasoningDepthControl, {
      value: "auto",
      onChange,
      modelConfig: reasoningModel,
    }))

    act(() => {
      container.querySelector("button")?.click()
    })
    await flushAnimationFrames()

    const slider = document.querySelector<HTMLInputElement>('input[type="range"]')
    const ticks = Array.from(
      slider!.nextElementSibling!.querySelectorAll<HTMLButtonElement>("button"),
    )
    expect(ticks.map((tick) => tick.textContent)).toEqual([
      "chat.reasoningDepth.auto",
      "chat.reasoningDepth.off",
      "chat.reasoningDepth.low",
      "chat.reasoningDepth.medium",
      "chat.reasoningDepth.high",
      "chat.reasoningDepth.max",
    ])

    act(() => {
      ticks[1].click()
    })

    expect(onChange).toHaveBeenCalledWith("off")
  })

  it("keeps the trigger inert while disabled", async () => {
    const onChange = vi.fn()
    render(createElement(ReasoningDepthControl, {
      value: "auto",
      onChange,
      modelConfig: reasoningModel,
      disabled: true,
    }))

    act(() => {
      container.querySelector("button")?.click()
    })
    await flushAnimationFrames()

    expect(document.querySelector('input[type="range"]')).toBeNull()
  })
})
