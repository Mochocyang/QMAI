import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { pxToRem, convertCss, convertTsx, convertFile } from "./convert-font-units-to-rem.mjs"

describe("pxToRem", () => {
  it("0.5 的整数倍全部换得精确有限小数", () => {
    expect(pxToRem(12)).toBe("0.75rem")
    expect(pxToRem(12.5)).toBe("0.78125rem")
    expect(pxToRem(13)).toBe("0.8125rem")
    expect(pxToRem(13.5)).toBe("0.84375rem")
    expect(pxToRem(9)).toBe("0.5625rem")
    expect(pxToRem(100)).toBe("6.25rem")
    expect(pxToRem(16)).toBe("1rem")
  })
  it("非数值抛错，不静默产出坏值", () => {
    expect(() => pxToRem("abc")).toThrow()
  })
})

describe("convertCss", () => {
  it("独立 font-size 换成 rem", () => {
    expect(convertCss("a{font-size:13px}")).toBe("a{font-size:0.8125rem}")
    expect(convertCss("a{ font-size: 12.5px; }")).toBe("a{ font-size: 0.78125rem; }")
  })
  it("独立 line-height 换成 rem（不是无单位比值）", () => {
    expect(convertCss("a{line-height:20px}")).toBe("a{line-height:1.25rem}")
  })
  it("font 简写：字号与 px 行高都换，字重与字族保持", () => {
    expect(convertCss("a{font:500 20px/28px var(--serif)}"))
      .toBe("a{font:500 1.25rem/1.75rem var(--serif)}")
  })
  it("font 简写的无单位行高保持不动", () => {
    expect(convertCss("a{font: 400 13px/1.6 var(--ui)}"))
      .toBe("a{font: 400 0.8125rem/1.6 var(--ui)}")
  })
  it("不碰布局尺寸与颜色", () => {
    const src = "a{width:13px;padding:10px;border:1px solid #fff;margin:0 2px}"
    expect(convertCss(src)).toBe(src)
  })
  it("不改动注释里的示例", () => {
    const src = "/* font-size:13px 是旧的 */\na{font-size:13px}"
    expect(convertCss(src)).toBe("/* font-size:13px 是旧的 */\na{font-size:0.8125rem}")
  })
  it("幂等：二次调用结果不变", () => {
    const once = convertCss("a{font-size:13px;line-height:20px}")
    expect(convertCss(once)).toBe(once)
  })
})

describe("convertTsx", () => {
  it("Tailwind 任意值换为 rem", () => {
    expect(convertTsx('className="text-[11px]"')).toBe('className="text-[0.6875rem]"')
    expect(convertTsx('"text-[10px] leading-tight"')).toBe('"text-[0.625rem] leading-tight"')
  })
  it("不碰 min-w- / max-w- / gap- 等非字号任意值", () => {
    const src = 'className="min-w-[16px] max-w-[600px] gap-[10px] text-[13px]"'
    expect(convertTsx(src)).toBe('className="min-w-[16px] max-w-[600px] gap-[10px] text-[0.8125rem]"')
  })
  it("不碰颜色任意值", () => {
    const src = 'className="text-[#fff] text-[rgb(0,0,0)]"'
    expect(convertTsx(src)).toBe(src)
  })
  it("不碰 SVG 的 fontSize 属性（图标几何）", () => {
    const src = '<text fontSize="13.5">自</text>'
    expect(convertTsx(src)).toBe(src)
  })
  it("已是 rem 的不重复转换", () => {
    const src = 'className="text-[0.75rem]"'
    expect(convertTsx(src)).toBe(src)
  })
})

describe("对真实源码的约束", () => {
  it("css 与 tsx 的换算结果里不再有 px 字号", () => {
    const css = convertCss(readFileSync("src/components/uitest/ui-test-editor.css", "utf8"))
    expect(css).not.toMatch(/font-size:\s*[\d.]+px/)
    expect(css).not.toMatch(/line-height:\s*[\d.]+px/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 以下为本任务针对"骨架实现的真实缺陷"补的测试（骨架提供者要求自行补覆盖）。
// ─────────────────────────────────────────────────────────────────────────────

/** 全仓 px 取值集合（docs/font-scaling-fix-20261007/absolute-font-units.md 实测分布）。 */
const REAL_PX_VALUES = [9, 10, 11, 12, 12.5, 13, 14, 15, 16, 18, 19, 20, 22, 24, 26, 28, 32, 100]

describe("font 简写行高的精确性（28px 是设计文档曾漏掉的取值）", () => {
  it("22px/28px 简写：字号 1.375rem、行高 1.75rem（不得四舍五入）", () => {
    expect(convertCss("a{font:500 22px/28px var(--serif)}"))
      .toBe("a{font:500 1.375rem/1.75rem var(--serif)}")
  })
  it("往返无损：rem × 16 逐位等于原 px", () => {
    for (const px of REAL_PX_VALUES) {
      const rem = pxToRem(px)
      expect(rem.endsWith("rem")).toBe(true)
      expect(Number(rem.slice(0, -3)) * 16).toBe(px)
    }
  })
  it("简写里的行高不是无单位比值：20px/13px 不得写成 1.538461… 这类近似比值", () => {
    const out = convertCss("a{font:400 13px/20px var(--ui)}")
    expect(out).toBe("a{font:400 0.8125rem/1.25rem var(--ui)}")
    // 0.8125 × 16 = 13、1.25 × 16 = 20，均逐位精确
    expect(Number("0.8125") * 16).toBe(13)
    expect(Number("1.25") * 16).toBe(20)
  })
})

describe("幂等性覆盖 font 简写", () => {
  it("含 px/px 简写的输入二次调用结果不变", () => {
    const once = convertCss("a{font:500 20px/28px var(--serif)}b{font:400 14px/22px var(--ui)}")
    expect(convertCss(once)).toBe(once)
  })
  it("字号已是相对单位、行高为 px 的简写只改行高，且二次调用不变", () => {
    const once = convertCss("a{font: 1rem/20px var(--ui)}")
    expect(once).toBe("a{font: 1rem/1.25rem var(--ui)}")
    expect(convertCss(once)).toBe(once)
  })
  it("字族 var() 回退值里的 px 不参与换算（否则第二次运行会改坏）", () => {
    const src = "a{font: 500 13px/1.5 var(--x, 20px)}"
    const once = convertCss(src)
    expect(once).toBe("a{font: 500 0.8125rem/1.5 var(--x, 20px)}")
    expect(convertCss(once)).toBe(once)
  })
  it("font: inherit / 无 px 的简写原样保留", () => {
    const src = "a{font: inherit;cursor:pointer}b{font:13px Consolas,monospace}"
    expect(convertCss(src)).toBe("a{font: inherit;cursor:pointer}b{font:0.8125rem Consolas,monospace}")
    expect(convertCss(convertCss(src))).toBe(convertCss(src))
  })
  it("自定义属性 --font: 不被当成 font 简写（\bfont: 会误命中）", () => {
    const src = ":root{--font-body:13px;--qmai-ui-font-family:x}"
    expect(convertCss(src)).toBe(src)
  })
})

describe("注释位置不影响换算（按注释切段处理会静默漏改）", () => {
  it("font 简写的关键字与数值之间夹注释", () => {
    expect(convertCss("a{font: /* c */ 13px var(--ui)}")).toBe("a{font: /* c */ 0.8125rem var(--ui)}")
  })
  it("font-size / line-height 的冒号与数值之间夹注释", () => {
    expect(convertCss("a{font-size: /* c */ 13px}")).toBe("a{font-size: /* c */ 0.8125rem}")
    expect(convertCss("a{line-height: /* c */ 20px}")).toBe("a{line-height: /* c */ 1.25rem}")
  })
  it("数值之后的注释不被改写，也不阻断换算", () => {
    const src = "a{font-size:13px/* 示例 13px 保留 */;line-height:20px}"
    expect(convertCss(src)).toBe("a{font-size:0.8125rem/* 示例 13px 保留 */;line-height:1.25rem}")
    expect(convertCss(convertCss(src))).toBe(convertCss(src))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 全仓不变式：只允许"px → 精确 rem"这一种子串替换，其余字节一字未动。
// 该判据不依赖实现细节（不是复用实现的正则），而是从需求直接推出。
// ─────────────────────────────────────────────────────────────────────────────

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(css|tsx|ts)$/.test(entry)) out.push(p)
  }
  return out
}

const rel = (abs) => relative(process.cwd(), abs).replace(/\\/g, "/")

/** 按出现顺序抽取全部 `<数字><px|rem>` 数值对。 */
function unitTokens(text) {
  return [...text.matchAll(/(\d+(?:\.\d+)?|\.\d+)(px|rem)/g)].map((m) => ({ n: Number(m[1]), u: m[2] }))
}

describe("全仓真实源码：换算的完整性与纯粹性", () => {
  const files = walk("src")

  it("每处变化都必须是 px→rem 且 rem × 16 逐位等于原 px；未应用换算时总数 = 569", () => {
    const problems = []
    let conversions = 0
    const perFile = { css: 0, tsx: 0 }
    for (const abs of files) {
      const { original, converted } = convertFile(abs)
      const before = unitTokens(original)
      const after = unitTokens(converted)
      if (before.length !== after.length) {
        problems.push(`${rel(abs)}: 单位数值个数 ${before.length} → ${after.length}（有增删）`)
        continue
      }
      let fileConversions = 0
      for (let i = 0; i < before.length; i++) {
        const a = before[i]
        const b = after[i]
        if (a.u === b.u && a.n === b.n) continue
        if (a.u === "px" && b.u === "rem" && b.n * 16 === a.n) {
          conversions++
          fileConversions++
          continue
        }
        problems.push(`${rel(abs)}: 第 ${i + 1} 个数值 ${a.n}${a.u} → ${b.n}${b.u}（不允许的变化）`)
      }
      if (fileConversions > 0) perFile[abs.endsWith(".css") ? "css" : "tsx"] += fileConversions
    }
    expect(problems).toEqual([])
    // 上一条断言对"漏改"是盲的（漏改的 px 只会表现为"未变化"），完整性的把关在此：
    //   · 换算尚未应用到源码时（conversions > 0）：总数必须等于权威清点口径
    //     （docs/font-scaling-fix-20261007/design.md §4.1：CSS 160+80+12+11=263，
    //      TSX 306，合计 569 个数值）。
    //   · 换算已应用到源码后（conversions === 0）：源码已无 px 字号可换算，
    //     完整性由下一条"不再有 px 字号"测试把关（它直接断言源码本身）。
    if (conversions > 0) {
      expect(perFile.css).toBe(263)
      expect(perFile.tsx).toBe(306)
      expect(conversions).toBe(569)
    } else {
      expect(perFile).toEqual({ css: 0, tsx: 0 })
    }
  })

  it("换算后全仓不再有 px 字号/行高，也不再有 text-[Npx]", () => {
    const leftover = []
    for (const abs of files) {
      const { converted } = convertFile(abs)
      if (abs.endsWith(".css")) {
        if (/font-size:\s*[\d.]+px/.test(converted)) leftover.push(`${rel(abs)}: font-size:Npx`)
        if (/line-height:\s*[\d.]+px/.test(converted)) leftover.push(`${rel(abs)}: line-height:Npx`)
        if (/\bfont:[^;{}]*[\d.]+px/.test(converted)) leftover.push(`${rel(abs)}: font 简写仍有 px`)
      } else if (/text-\[[\d.]+px\]/.test(converted)) {
        leftover.push(`${rel(abs)}: text-[Npx]`)
      }
    }
    expect(leftover).toEqual([])
  })

  it("幂等：对每个真实文件二次换算不再产生变化", () => {
    const notIdempotent = []
    for (const abs of files) {
      const { converted } = convertFile(abs)
      const again = abs.endsWith(".css") ? convertCss(converted) : convertTsx(converted)
      if (again !== converted) notIdempotent.push(rel(abs))
    }
    expect(notIdempotent).toEqual([])
  })

  it("本工具不遮罩 // 行注释，故真实源码里不得存在行注释内的 text-[Npx]（否则会改写注释文本）", () => {
    const bad = []
    for (const abs of files) {
      readFileSync(abs, "utf8")
        .split(/\r?\n/)
        .forEach((line, i) => {
          const idx = line.indexOf("//")
          if (idx === -1) return
          if (/text-\[[\d.]+px\]/.test(line.slice(idx))) bad.push(`${rel(abs)}:${i + 1}`)
        })
    }
    expect(bad).toEqual([])
  })
})
