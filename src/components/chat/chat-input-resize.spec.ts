import { describe, expect, it } from "vitest"
import { clampResizableInputHeight, resolveResizableInputMaxHeight } from "./chat-input-resize"

describe("chat input resize bounds", () => {
  it("keeps the input height between the default height and half of the panel", () => {
    expect(clampResizableInputHeight(20, { minHeight: 44, maxHeight: 300 })).toBe(44)
    expect(clampResizableInputHeight(180, { minHeight: 44, maxHeight: 300 })).toBe(180)
    expect(clampResizableInputHeight(500, { minHeight: 44, maxHeight: 300 })).toBe(300)
  })

  it("uses half of the available panel height as the maximum", () => {
    expect(resolveResizableInputMaxHeight({ panelHeight: 900, viewportHeight: 1200 })).toBe(450)
    expect(resolveResizableInputMaxHeight({ panelHeight: 0, viewportHeight: 1000 })).toBe(500)
  })
})
