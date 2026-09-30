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
    expect(css).toMatch(/\.ui-test-root\s*\{[^}]*padding:\s*0;[^}]*background:\s*transparent;/)
    expect(css).toContain(".ui-test-resize-edge")
    expect(shell).toContain('top: "North"')
    expect(shell).toContain('se: "SouthEast"')
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
    expect(css).not.toContain("@media (max-width: 959px) { .ui-test-root { padding: 12px; }")
    expect(css).toContain("@media (max-width: 767px) { .ui-test-app { border-radius: 8px; clip-path: inset(0 round 8px); }")
  })

  it("只有非 macOS 才关闭原生装饰和阴影", () => {
    const branch = shell.slice(shell.indexOf("if (isMacOS())"), shell.indexOf("const syncWindowFilled"))
    expect(branch).toContain('invoke("restore_macos_window_frame")')
    expect(branch).toContain("await win.setDecorations(false)")
    expect(branch).toContain("await win.setShadow(false)")
    expect(shell).not.toContain("win.setMinimizable")
    const rust = readFileSync(resolve(__dirname, "../../../src-tauri/src/macos_window.rs"), "utf8")
    expect(rust).toContain("setStyleMask:")
    expect(rust).toContain("standardWindowButton:")
  })

  it("新版不再显示底部目录提示和构建标签", () => {
    expect(sidebar).not.toContain('className="ui-test-directory-note"')
    expect(sidebar).not.toContain("先有方向，再落笔")
    expect(shell).not.toContain("ui-test-build-label")
  })

  it("macOS 使用左侧交通灯，圆角交给系统窗口", () => {
    const lights = readFileSync(resolve(__dirname, "mac-traffic-lights.tsx"), "utf8")
    expect(shell).toContain("isMacOS()")
    expect(shell).toContain('data-platform={macOS ? "macos" : undefined}')
    expect(shell).toContain("<MacTrafficLights")
    expect(lights.indexOf("关闭窗口")).toBeLessThan(lights.indexOf("最小化"))
    expect(lights.indexOf("最小化")).toBeLessThan(lights.indexOf("最大化或还原"))
    expect(lights).not.toContain("<Plus")
    expect(lights).toContain("macos-traffic-lights/svg/close/hover.svg")
    expect(lights).toContain("macos-traffic-lights/svg/minimize/hover.svg")
    expect(lights).toContain("macos-traffic-lights/svg/maximize/hover.svg")
    expect(readFileSync(resolve(__dirname, "../../../package.json"), "utf8")).toContain('"macos-traffic-lights": "^1.1.0"')
    expect(css).toMatch(/\.ui-test-traffic-btn \{[^}]*width:\s*14px/)
    expect(css).toMatch(/\.ui-test-root\[data-platform="macos"\] \.ui-test-traffic \{[^}]*left:\s*19px[^}]*gap:\s*9px/)
    expect(css).toMatch(/\.ui-test-root\[data-platform="macos"\] \.ui-test-app \{[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*clip-path:\s*none;[^}]*box-shadow:\s*none;/)
    expect(css.indexOf('[data-window-filled="true"] .ui-test-app')).toBeGreaterThan(css.indexOf('[data-platform="macos"] .ui-test-app'))
  })

  it("最大化或全屏后移除窗口缓冲、圆角、边框和阴影", () => {
    expect(css).toMatch(/\.ui-test-root\[data-window-filled="true"\]\s*\{\s*padding:\s*0;\s*\}/)
    expect(css).toMatch(/\.ui-test-root\[data-window-filled="true"\]\s+\.ui-test-app\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*clip-path:\s*none;[^}]*box-shadow:\s*none;/)
    expect(shell).toContain("win.isMaximized()")
    expect(shell).toContain("win.isFullscreen()")
    expect(shell).toContain("win.onResized")
  })

  it("顶栏整条可拖，弹出菜单不拖窗口", () => {
    expect(shell).toContain('<header className="ui-test-header" data-tauri-drag-region="deep">')
    expect(shell).toContain('aria-label={`${item.label}功能菜单`} data-tauri-drag-region="false"')
    expect(shell).toContain('aria-label="创作工具" data-tauri-drag-region="false"')
    expect(shell).toContain('aria-label="外观" data-tauri-drag-region="false"')
    expect(shell.match(/data-tauri-drag-region="false"/g)).toHaveLength(3)
  })
})
