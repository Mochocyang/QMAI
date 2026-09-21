import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const css = readFileSync(resolve(__dirname, "ui-test.css"), "utf8")
const shell = readFileSync(resolve(__dirname, "ui-test-shell.tsx"), "utf8")
const sidebar = readFileSync(resolve(__dirname, "../layout/sidebar-panel.tsx"), "utf8")
const tauriConfig = readFileSync(resolve(__dirname, "../../../src-tauri/tauri.conf.json"), "utf8")

describe("新版 UI 最外侧窗口", () => {
  it("圆角外使用透明背景并提供阴影缓冲", () => {
    expect(css).toMatch(/html\[data-ui-test-skin\][^{]*\{[^}]*background:\s*transparent\s*!important;/)
    expect(css).toMatch(/\.ui-test-root\s*\{[^}]*padding:\s*14px;[^}]*background:\s*transparent;/)
    expect(tauriConfig).toContain('"transparent": true')
  })

  it("应用容器使用 Windows 11 风格 1px 细边框与多层羽化阴影", () => {
    const appRule = css.match(/\.ui-test-app\s*\{([^}]*)\}/)?.[1] ?? ""
    expect(appRule).toContain("border: 1px solid color-mix(in srgb, var(--ui-ink) 12%, transparent);")
    expect(appRule).toContain("0 1px 2px rgba(23, 35, 29, .03)")
    expect(appRule).toContain("0 4px 8px rgba(23, 35, 29, .04)")
    expect(appRule).toContain("0 0 14px rgba(23, 35, 29, .055)")
  })

  it("窄屏保留透明阴影缓冲和圆角", () => {
    expect(css).toContain("@media (max-width: 959px) { .ui-test-root { padding: 12px; }")
    expect(css).toContain("@media (max-width: 767px) { .ui-test-root { padding: 10px; } .ui-test-app { border-radius: 8px; }")
  })

  it("测试版窗口同时关闭原生装饰和阴影", () => {
    expect(shell).toContain("win.setDecorations(false)")
    expect(shell).toContain("win.setShadow(false)")
  })

  it("新版不再显示底部目录提示和构建标签", () => {
    expect(sidebar).not.toContain('className="ui-test-directory-note"')
    expect(sidebar).not.toContain("先有方向，再落笔")
    expect(shell).not.toContain("ui-test-build-label")
  })

  it("最大化或全屏后移除窗口缓冲、圆角、边框和阴影", () => {
    expect(css).toMatch(/\.ui-test-root\[data-window-filled="true"\]\s*\{\s*padding:\s*0;\s*\}/)
    expect(css).toMatch(/\.ui-test-root\[data-window-filled="true"\]\s+\.ui-test-app\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*box-shadow:\s*none;/)
    expect(shell).toContain("win.isMaximized()")
    expect(shell).toContain("win.isFullscreen()")
    expect(shell).toContain("win.onResized")
  })
})
