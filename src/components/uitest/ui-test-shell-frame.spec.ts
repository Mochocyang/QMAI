import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const css = readFileSync(resolve(__dirname, "ui-test.css"), "utf8")

describe("?? UI ?????", () => {
  it("?????????????", () => {
    expect(css).toMatch(/\.ui-test-root\s*\{[^}]*padding:\s*0;[^}]*background:\s*var\(--ui-paper\);/)
  })

  it("???????????????", () => {
    expect(css).toMatch(/\.ui-test-app\s*\{[^}]*border-radius:\s*0;[^}]*box-shadow:\s*none;/)
  })

  it("?????????????", () => {
    expect(css).not.toMatch(/@media \(max-width: 959px\)[^{]*\{[^}]*\.ui-test-root\s*\{[^}]*padding:\s*(?:12px|8px)/)
    expect(css).not.toMatch(/@media \(max-width: 767px\)[^{]*\{[^}]*\.ui-test-app\s*\{[^}]*border-radius:\s*12px/)
  })
})
