import { readFileSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import postcss from "postcss"
import { describe, expect, it } from "vitest"

/**
 * 弹窗宽度守卫。
 *
 * 背景：曾有一条写在 ui-test.css 里的皮肤规则声明了 `max-width: calc(100vw - 32px)`。
 * 该规则**没有**放进任何 @layer，而 Tailwind 宽度类都在 @layer utilities 里；
 * CSS 中未分层的样式优先于任何 layer，早于特异性比较。于是这一条压过了所有弹窗
 * 自己的宽度类，把 31 个弹窗里的 26 个撑成几乎占满窗口。
 *
 * 更隐蔽的是第二层：DialogContent 基础类曾带 `sm:max-w-sm`。Tailwind v4 把变体工具类
 * 排在无变体之后，而任意值 `sm:max-w-[Npx]` 又排在具名 `sm:max-w-sm` 之前。
 * 所以基础类那个 `sm:max-w-sm` 恒胜，所有弹窗自己写的 `sm:max-w-[...]` 全是死代码。
 *
 * 这两件事都没有任何测试能发现，因此本文件把两条都钉住，并额外要求每个 DialogContent
 * 都有明确的宽度来源 —— 否则漏掉一个不会有任何提示，它只会静默地变成占满窗口。
 */

const CSS_PATH = resolve(__dirname, "ui-test.css")
const DIALOG_PATH = resolve(__dirname, "../ui/dialog.tsx")
const SRC_ROOT = resolve(__dirname, "../..")

const uiTestCss = readFileSync(CSS_PATH, "utf8")
const dialogSource = readFileSync(DIALOG_PATH, "utf8")

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
      walk(full, out)
    } else if (entry.isFile()) {
      out.push(full)
    }
  }
  return out
}

const allFiles = walk(SRC_ROOT)
const isTestFile = (p: string) => /\.(spec|test)\.[cm]?tsx?$/.test(p)

/** 收集所有「由 CSS 赋予宽度」的类名：任何规则只要声明了 width / max-width，其选择器里的类都算。 */
function cssWidthClasses(): Set<string> {
  const found = new Set<string>()
  for (const file of allFiles) {
    if (!file.endsWith(".css")) continue
    const root = postcss.parse(readFileSync(file, "utf8"))
    root.walkRules((rule) => {
      const direct = (rule.nodes ?? []).filter((node) => node.type === "decl")
      const hasWidth = direct.some(
        (node) => node.type === "decl" && (node.prop === "width" || node.prop === "max-width"),
      )
      if (!hasWidth) return
      let selectors: string[]
      try {
        selectors = rule.selectors
      } catch {
        return
      }
      for (const selector of selectors) {
        for (const match of selector.matchAll(/\.([A-Za-z0-9_-]+)/g)) found.add(match[1])
      }
    })
  }
  return found
}

/** 取出 <DialogContent …> 的开标签文本（花括号深度为 0 时的 '>' 才算结束，避免被 => 截断）。 */
function dialogContentTags(source: string): string[] {
  const tags: string[] = []
  const re = /<DialogContent\b/g
  let match: RegExpExecArray | null
  while ((match = re.exec(source))) {
    let i = match.index + match[0].length
    let depth = 0
    let quote: string | null = null
    for (; i < source.length; i++) {
      const char = source[i]
      if (quote) {
        if (char === "\\") i++
        else if (char === quote) quote = null
        continue
      }
      if (char === '"' || char === "'" || char === "`") quote = char
      else if (char === "{") depth++
      else if (char === "}") depth--
      else if (char === ">" && depth === 0) break
    }
    tags.push(source.slice(match.index, i + 1))
  }
  return tags
}

describe("弹窗宽度：皮肤规则不得压过各弹窗自己的宽度", () => {
  it("ui-test.css 里针对 dialog-content 的通用规则不声明 max-width/width", () => {
    const offenders: string[] = []
    let genericRules = 0
    postcss.parse(uiTestCss).walkRules((rule) => {
      let selectors: string[]
      try {
        selectors = rule.selectors
      } catch {
        return
      }
      for (const selector of selectors) {
        const targetsDialogContent =
          selector.includes('[data-slot="dialog-content"]') ||
          selector.includes('[data-slot="alert-dialog-content"]')
        // 只针对「通用皮肤规则」：选择器里除了 .ui-test-root 之外没有别的类
        const hasDialogClass = /\.[A-Za-z0-9_-]+/.test(selector.replace(/\.ui-test-root/g, ""))
        if (!targetsDialogContent || hasDialogClass) continue
        genericRules++
        for (const node of rule.nodes ?? []) {
          if (node.type !== "decl") continue
          if (node.prop === "max-width" || node.prop === "width") {
            offenders.push(`${selector} { ${node.prop}: ${node.value} }`)
          }
        }
      }
    })
    expect(genericRules).toBeGreaterThan(0)
    expect(offenders).toEqual([])
  })

  it("该通用规则仍保留皮肤职责（不允许靠删掉整条规则来通过）", () => {
    let padding: string | null = null
    postcss.parse(uiTestCss).walkRules((rule) => {
      const targetsDialogContent = rule.selectors?.some(
        (selector) => selector === 'html[data-ui-test-skin] [data-slot="dialog-content"]',
      )
      if (!targetsDialogContent) return
      for (const node of rule.nodes ?? []) {
        if (node.type === "decl" && node.prop === "padding") padding = node.value
      }
    })
    expect(padding).toBe("28px")
    expect(uiTestCss).toContain('html[data-ui-test-skin] [data-slot="dialog-content"]')
  })
})

describe("弹窗宽度：基础类不得携带会恒胜的宽度类", () => {
  const base = dialogSource.match(/"fixed top-1\/2 left-1\/2 z-50 grid[^"]*"/)?.[0] ?? ""

  it("能定位到 DialogContent 的基础类字符串", () => {
    expect(base).toContain("w-full")
    expect(base).toContain("-translate-x-1/2")
  })

  it("不得出现变体宽度类（sm:max-w-* 会恒胜，把每个弹窗的宽度类变成死代码）", () => {
    expect(base).not.toMatch(/\bsm:max-w-/)
  })

  it("无变体宽度类只允许那个视口兜底 max-w-[calc(100%-2rem)]", () => {
    expect(base.match(/max-w-/g) ?? []).toEqual(["max-w-"])
    expect(base).toContain("max-w-[calc(100%-2rem)]")
  })
})

describe("弹窗宽度：每个 DialogContent 都要有宽度来源", () => {
  const widthClasses = cssWidthClasses()
  const uses = allFiles
    .filter((file) => file.endsWith(".tsx") && !isTestFile(file))
    .flatMap((file) =>
      dialogContentTags(readFileSync(file, "utf8")).map((tag) => ({
        file: file.slice(SRC_ROOT.length + 1).replace(/\\/g, "/"),
        tag,
      })),
    )

  it("扫描到的使用点数量合理（防止守卫空转）", () => {
    expect(uses.length).toBeGreaterThanOrEqual(25)
    expect(widthClasses.size).toBeGreaterThan(0)
    expect([...widthClasses]).toContain("ui-test-activity-dialog")
    expect([...widthClasses]).toContain("ui-test-outline-wizard")
  })

  it("每个使用点都有 max-w-* / w-[…] 工具类，或带 width 的弹窗专用类", () => {
    const missing = uses
      .filter(({ tag }) => {
        if (/max-w-/.test(tag)) return false
        if (/[\s"'`]w-\[/.test(tag)) return false
        return ![...widthClasses].some((name) => new RegExp(`[\\s"'\\\`{]${name}[\\s"'\\\`}]`).test(tag))
      })
      .map(({ file, tag }) => `${file}: ${tag.replace(/\s+/g, " ").slice(0, 120)}`)
    expect(missing).toEqual([])
  })
})
