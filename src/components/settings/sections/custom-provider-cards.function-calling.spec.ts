import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "custom-provider-cards.tsx"), "utf8")

describe("custom provider Function Calling toggle", () => {
  it("wires FunctionCallingControls into custom provider cards", () => {
    expect(source).toContain("FunctionCallingControls")
    expect(source).toContain("functionCallingEnabled")
    expect(source).toContain("onUpdate({ functionCallingEnabled })")
  })
})
