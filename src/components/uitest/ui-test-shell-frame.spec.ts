import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const css = readFileSync(resolve(__dirname, "ui-test.css"), "utf8")
const shell = readFileSync(resolve(__dirname, "ui-test-shell.tsx"), "utf8")

describe("新版 UI 最外侧窗口", () => {
  it("根容器不再保留外层画布留白", () => {
    expect(css).toMatch(/\.ui-test-root\s*\{[^}]*padding:\s*0;[^}]*background:\s*var\(--ui-paper\);/)
  })

  it("应用容器不再显示圆角外框或投影", () => {
    expect(css).toMatch(/\.ui-test-app\s*\{[^}]*border-radius:\s*0;[^}]*box-shadow:\s*none;/)
  })

  it("窄屏规则也不再恢复外层留白", () => {
    expect(css).not.toMatch(/@media \(max-width: 959px\)[^{]*\{[^}]*\.ui-test-root\s*\{[^}]*padding:\s*(?:12px|8px)/)
    expect(css).not.toMatch(/@media \(max-width: 767px\)[^{]*\{[^}]*\.ui-test-app\s*\{[^}]*border-radius:\s*12px/)
  })

  it("测试版窗口同时关闭原生装饰和阴影", () => {
    expect(shell).toContain("win.setDecorations(false)")
    expect(shell).toContain("win.setShadow(false)")
  })
})
