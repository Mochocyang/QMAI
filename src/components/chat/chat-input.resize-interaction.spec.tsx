// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ChatInput } from "./chat-input"

let host: HTMLDivElement
let root: Root

function createPointerEvent(
  type: string,
  init: {
    button?: number
    buttons?: number
    clientY?: number
    pointerId?: number
  } = {},
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: init.button ?? 0,
    buttons: init.buttons ?? 0,
    cancelable: true,
    clientY: init.clientY ?? 0,
  })

  Object.defineProperty(event, "pointerId", { value: init.pointerId ?? 1 })
  return event
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
  })
}

describe("ChatInput resize interaction", () => {
  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    window.innerHeight = 800
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    host.remove()
    vi.restoreAllMocks()
  })

  it("captures the pointer and resizes while dragging the height handle", async () => {
    await act(async () => {
      root.render(
        <div
          ref={(node) => {
            if (!node) return
            node.getBoundingClientRect = () => ({
              x: 0,
              y: 0,
              top: 0,
              right: 360,
              bottom: 480,
              left: 0,
              width: 360,
              height: 480,
              toJSON: () => ({}),
            })
          }}
        >
          <ChatInput onSend={() => {}} onStop={() => {}} isStreaming={false} />
        </div>,
      )
    })

    const resizeHandle = host.querySelector<HTMLElement>('[role="separator"]')
    const textarea = host.querySelector<HTMLTextAreaElement>("textarea")
    if (!resizeHandle || !textarea) throw new Error("chat input resize elements not found")

    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    resizeHandle.setPointerCapture = setPointerCapture
    resizeHandle.releasePointerCapture = releasePointerCapture

    await act(async () => {
      resizeHandle.dispatchEvent(createPointerEvent("pointerdown", {
        button: 0,
        buttons: 1,
        clientY: 220,
        pointerId: 17,
      }))
    })

    expect(setPointerCapture).toHaveBeenCalledWith(17)

    await act(async () => {
      window.dispatchEvent(createPointerEvent("pointermove", {
        buttons: 1,
        clientY: 120,
        pointerId: 17,
      }))
    })
    await flush()

    expect(textarea.style.height).toBe("144px")

    await act(async () => {
      window.dispatchEvent(createPointerEvent("pointerup", { pointerId: 17 }))
    })

    expect(releasePointerCapture).toHaveBeenCalledWith(17)
  })

  it("uses the nearest usable panel height when the chat input is wrapped in a short footer", async () => {
    await act(async () => {
      root.render(
        <div
          ref={(node) => {
            if (!node) return
            node.getBoundingClientRect = () => ({
              x: 0,
              y: 0,
              top: 0,
              right: 360,
              bottom: 480,
              left: 0,
              width: 360,
              height: 480,
              toJSON: () => ({}),
            })
          }}
        >
          <div
            ref={(node) => {
              if (!node) return
              node.getBoundingClientRect = () => ({
                x: 0,
                y: 420,
                top: 420,
                right: 360,
                bottom: 480,
                left: 0,
                width: 360,
                height: 60,
                toJSON: () => ({}),
              })
            }}
          >
            <ChatInput onSend={() => {}} onStop={() => {}} isStreaming={false} />
          </div>
        </div>,
      )
    })

    const resizeHandle = host.querySelector<HTMLElement>('[role="separator"]')
    const textarea = host.querySelector<HTMLTextAreaElement>("textarea")
    if (!resizeHandle || !textarea) throw new Error("chat input resize elements not found")

    resizeHandle.setPointerCapture = vi.fn()
    resizeHandle.releasePointerCapture = vi.fn()

    await act(async () => {
      resizeHandle.dispatchEvent(createPointerEvent("pointerdown", {
        button: 0,
        buttons: 1,
        clientY: 220,
        pointerId: 18,
      }))
    })

    await act(async () => {
      window.dispatchEvent(createPointerEvent("pointermove", {
        buttons: 1,
        clientY: 120,
        pointerId: 18,
      }))
    })
    await flush()

    expect(textarea.style.height).toBe("144px")
  })

  it("does not let a grown chat footer become its own resize limit", async () => {
    await act(async () => {
      root.render(
        <div
          ref={(node) => {
            if (!node) return
            node.getBoundingClientRect = () => ({
              x: 0,
              y: 0,
              top: 0,
              right: 360,
              bottom: 480,
              left: 0,
              width: 360,
              height: 480,
              toJSON: () => ({}),
            })
          }}
        >
          <div
            ref={(node) => {
              if (!node) return
              node.getBoundingClientRect = () => ({
                x: 0,
                y: 360,
                top: 360,
                right: 360,
                bottom: 480,
                left: 0,
                width: 360,
                height: 120,
                toJSON: () => ({}),
              })
            }}
          >
            <ChatInput onSend={() => {}} onStop={() => {}} isStreaming={false} />
          </div>
        </div>,
      )
    })

    const resizeHandle = host.querySelector<HTMLElement>('[role="separator"]')
    const textarea = host.querySelector<HTMLTextAreaElement>("textarea")
    if (!resizeHandle || !textarea) throw new Error("chat input resize elements not found")

    resizeHandle.setPointerCapture = vi.fn()
    resizeHandle.releasePointerCapture = vi.fn()

    await act(async () => {
      resizeHandle.dispatchEvent(createPointerEvent("pointerdown", {
        button: 0,
        buttons: 1,
        clientY: 320,
        pointerId: 19,
      }))
    })

    await act(async () => {
      window.dispatchEvent(createPointerEvent("pointermove", {
        buttons: 1,
        clientY: 20,
        pointerId: 19,
      }))
    })
    await flush()

    expect(textarea.style.height).toBe("240px")
  })
})
