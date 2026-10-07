// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ReferenceInput as InputComponent } from "@/components/reference/ReferenceInput"

let ReferenceInput: typeof InputComponent
let host: HTMLDivElement
let root: Root
const formalKey = "qmai-reference-input-height"
const testKey = "qm-uitest-reference-input-height"

async function renderInput(enabled: boolean) {
  vi.stubEnv("VITE_QMAI_UI_TEST", enabled ? "1" : "0")
  vi.resetModules()
  ;({ ReferenceInput } = await import("@/components/reference/ReferenceInput"))
  await act(async () => root.render(<ReferenceInput tokens={[]} onSubmit={() => {}} />))
  return host.querySelector("textarea") as HTMLTextAreaElement
}

async function dragInput(startY: number, endY: number) {
  const handle = host.querySelector('[role="separator"]') as HTMLDivElement
  await act(async () => handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientY: startY })))
  await act(async () => window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientY: endY })))
  await act(async () => window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientY: endY })))
}

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllEnvs()
})

describe("测试版 AI 模型选择布局", () => {
  it("思考按钮与模型选择同一行；底栏收窄时压缩模型框而不是换到第二排", () => {
    const css = readFileSync(resolve(__dirname, "ui-test-ai.css"), "utf8")
    expect(css).toMatch(/\[data-ui-ai-composer\] \{[^}]*overflow:\s*visible;/s)
    expect(css).toMatch(/\[data-ui-ai-panel\] \.bg-background:has\(>\s*\[data-ui-ai-composer\]\) \{[^}]*background-color:\s*transparent;/s)
    expect(css).toMatch(/\[data-ui-ai-composer\] div:has\(>\s*\[data-reference-input-footer\]\) \{[^}]*overflow:\s*hidden;[^}]*clip-path:\s*inset\(0 round 14px\);[^}]*border-radius:\s*14px;/s)
    /*
     * 底栏**不换行**：曾经是 flex-wrap:wrap（"放不下就整组落到第二排"），
     * 用户判定那是缺陷 —— 收窄时要的是模型框跟着收窄。这条断言就是那条需求的守卫。
     */
    expect(css).toMatch(/\[data-ui-ai-composer\] \[data-reference-input-footer\] \{[^}]*flex-wrap:\s*nowrap;[^}]*min-width:\s*0;[^}]*padding:\s*8px 14px 14px;/s)
    /*
     * 右组必须可压缩到 0 宽，且收缩权重远高于左组。
     * 旧的 min-width: min(100%, max-content) 保证它不小于内容宽，正是换行的根因；
     * 旧值 flex: 1 0 auto 也让它只长不缩。flex-shrink=1000 是关键：只在模型那一层
     * 给大权重不够，因为收缩量是在每一层各自按 (shrink × basis) 分配的 ——
     * 实测底栏这一层若不偏向右组，左组会被压掉一半、把「计划」按钮裁掉。
     */
    expect(css).toMatch(/\[data-ui-ai-composer\] \[data-reference-input-footer\] > div:last-child \{[^}]*flex:\s*0 1000 auto;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*gap:\s*2px;/s)
    expect(css).not.toMatch(/\[data-ui-ai-composer\] \[data-reference-input-footer\] > div:last-child \{[^}]*min-width:\s*min\(100%, max-content\)/s)
    // 左组同样可压缩，避免极窄时把右组顶到第二排（只有在模型压无可压时才轮到它）。
    expect(css).toMatch(/\[data-ui-ai-composer\] \[data-reference-input-footer\] > div:first-child \{[^}]*flex:\s*0 1 auto;[^}]*min-width:\s*0;/s)
    /*
     * 模型框是收窄时**优先**让步的那一项：flex-shrink 权重极大，且 .relative 变成
     * flex 容器，按钮作为 flex 项才能被压到 min-content 以下、露出省略号。
     * 按钮另有 44px 下限：收到底只剩几像素就点不中也认不出了。
     */
    expect(css).toMatch(/\[data-ui-ai-composer\] \.ui-test-ai-model > \.relative:last-child \{[^}]*display:\s*flex;[^}]*flex:\s*0 1000 auto;[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;/s)
    expect(css).toMatch(/\[data-ui-ai-composer\] \.ui-test-ai-model > \.relative:last-child > button \{[^}]*flex:\s*1 1 auto;[^}]*min-width:\s*44px;/s)
    // 模型名的 span 必须放开 min-width，否则 flex 的自动最小尺寸会让它永远截不断。
    expect(css).toMatch(/\[data-ui-ai-composer\] \.ui-test-ai-model > \.relative > button > span \{[^}]*min-width:\s*0;[^}]*text-overflow:\s*ellipsis;/s)
    expect(css).toMatch(/\[data-ui-ai-composer\] \[data-reference-input-footer\] > div:last-child > \.ui-test-ai-model \{[^}]*display: flex;[^}]*flex-direction: row;[^}]*flex-wrap: nowrap;[^}]*min-width: 0;/s)
    expect(css).toMatch(/\[data-ui-ai-panel\] \[data-reference-input-footer\] \[aria-label="上下文用量"\] \{[^}]*display: inline-flex;/s)
    expect(css).toMatch(/\[data-ui-ai-composer\] \[aria-label="停止生成"\] \{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;[^}]*width:\s*32px;[^}]*height:\s*32px;[^}]*padding:\s*0;/s)
    expect(css).toMatch(/\[data-ui-ai-composer\] \[aria-label="发送消息"\] \{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;[^}]*width:\s*32px;[^}]*height:\s*32px;[^}]*padding:\s*0;/s)
  })

  /*
   * 上面那条是 CSS 文本契约，量不出"到底有没有换行"。
   * 真实换行行为由浏览器几何脚本守：docs/ai-composer-nowrap-20261007/check-composer.mjs
   * （8 个宽度实测同一行 + 模型框随之变窄 + 3 条负向对照）。
   * 这里只做一件事：确认那条脚本还在，且没有被悄悄删掉。
   */
  it("底栏收窄行为由真实浏览器脚本守着（jsdom 量不出布局）", () => {
    const script = readFileSync(resolve(__dirname, "../../../docs/ai-composer-nowrap-20261007/check-composer.mjs"), "utf8")
    expect(script).toContain("flex-wrap:wrap")
    expect(script).toContain("同一行")
    expect(script).toContain("模型框确实收窄")
  })
})

describe("测试版引用输入框真实高度逻辑", () => {
  it("默认 128px，测试版不读取或覆盖正式版保存的输入高度", async () => {
    localStorage.setItem(formalKey, "260")
    const input = await renderInput(true)
    expect(input.style.height).toBe("128px")
    await dragInput(400, 368)
    expect(input.style.height).toBe("160px")
    expect(localStorage.getItem(formalKey)).toBe("260")
  })

  it("实际拖动可以缩到 48px、拉到 300px，并在抬起时保存", async () => {
    const input = await renderInput(true)
    await dragInput(400, 800)
    expect(input.style.height).toBe("112px")
    await dragInput(400, 0)
    expect(input.style.height).toBe("300px")
    expect(input.style.maxHeight).toBe("300px")
    expect(localStorage.getItem(testKey)).toBe("300")
  })

  it.each([["12", "112px"], ["180", "180px"], ["600", "300px"], ["invalid", "128px"]])("保存值 %s 按测试版边界恢复为 %s", async (saved, expected) => {
    localStorage.setItem(testKey, saved)
    const input = await renderInput(true)
    expect(input.style.height).toBe(expected)
  })

  it("双击拖柄恢复测试版默认 128px，而不是 CSS 固定高度", async () => {
    localStorage.setItem(testKey, "230")
    const input = await renderInput(true)
    await act(async () => host.querySelector('[role="separator"]')?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })))
    expect(input.style.height).toBe("128px")
  })

  it("面板 CSS 不再覆盖拖动逻辑设置的 textarea 最大高度", () => {
    const css = readFileSync(resolve(__dirname, "ui-test-ai.css"), "utf8")
    const rule = css.match(/\[data-ui-ai-composer\]\s+textarea\s*\{([^}]+)\}/)?.[1]
    expect(rule).toBeTruthy()
    expect(rule).not.toMatch(/(?:height|max-height|min-height)\s*:/)
  })

  it("大纲输入框点击后只保留闪烁光标，不显示颜色和边框", () => {
    const css = readFileSync(resolve(__dirname, "ui-test-ai.css"), "utf8")
    const rule = css.match(/\[data-ui-ai-panel="outline"\]\s+\[data-ui-ai-composer\]\s+div:has\(>\s*\[data-reference-input-footer\]\):focus-within\s*\{([^}]+)\}/)?.[1]
    expect(rule).toMatch(/border-color:\s*color-mix/)
    expect(rule).toMatch(/box-shadow:\s*none/)
    expect(rule).toMatch(/outline:\s*none/)
    expect(rule).toMatch(/--tw-ring-shadow:\s*0 0 #0000/)
    expect(css).toMatch(/\[data-ui-ai-composer\]\s+div:has\(>\s*\[data-reference-input-footer\]\):focus-within\s*\{[^}]*--tw-ring-shadow:\s*0 0 #0000/)
    expect(css).toMatch(/\[data-ui-ai-panel="outline"\]\s+\[data-ui-ai-composer\]\s+textarea:is\(:focus,\s*:focus-visible\)\s*\{[^}]*caret-color:\s*var\(--ui-accent\)/)
  })
})

describe("正式版引用输入框不回退", () => {
  it("仍默认 192px，忽略测试版的 96px 偏好", async () => {
    localStorage.setItem(testKey, "96")
    const input = await renderInput(false)
    expect(input.style.height).toBe("192px")
  })

  it("仍读取正式偏好，最低 192px、最高 300px；双击仍恢复 192px", async () => {
    localStorage.setItem(formalKey, "240")
    const input = await renderInput(false)
    expect(input.style.height).toBe("240px")
    await dragInput(400, 800)
    expect(input.style.height).toBe("192px")
    await dragInput(400, 0)
    expect(input.style.height).toBe("300px")
    await act(async () => host.querySelector('[role="separator"]')?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })))
    expect(input.style.height).toBe("192px")
    expect(localStorage.getItem(formalKey)).toBe("192")
    expect(localStorage.getItem(testKey)).toBeNull()
  })
})
// 两种助手共用面板留白，大纲不能再叠加第二层横向内边距。
describe("写作布局间距契约", () => {
  it("大纲输入区去除额外横向内边距，需求行允许换行", () => {
    const css = readFileSync(resolve(__dirname, "ui-test-ai.css"), "utf8")
    const panel = readFileSync(resolve(__dirname, "../sources/outline-chat-panel.tsx"), "utf8")
    expect(panel).toContain("data-ui-ai-input-area")
    expect(panel).toContain('className="mb-2 flex flex-wrap items-center justify-between gap-2"')
    expect(css).toMatch(/\[data-ui-ai-panel="outline"\] > \[data-ui-ai-input-area\]\s*\{[^}]*padding-inline:\s*0/)
  })
})
