import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "ui-test-shell.tsx"), "utf8")

/**
 * 取出 `TOOL_GROUPS` 的第一个分组（也就是「创作工具」下拉的第一栏）。
 * 各组之间用 `],` 分隔、组内没有嵌套数组，所以按 `],` 切成 3 段即可。
 */
function toolGroupBodies(): string[] {
  const start = source.indexOf("const TOOL_GROUPS = [")
  expect(start, "ui-test-shell.tsx 里找不到 TOOL_GROUPS").toBeGreaterThanOrEqual(0)
  const end = source.indexOf("] as const", start)
  expect(end, "TOOL_GROUPS 没有以 `] as const` 结尾（结构变了，请按实际改写本 spec）").toBeGreaterThan(start)
  // `],` 是组与组的分隔符；切完最后一段只剩数组收口前的缩进，filter 掉。
  return source.slice(start, end).split("],").filter((group) => group.trim().length > 0)
}

describe("「插件」进入创作工具菜单", () => {
  const groups = toolGroupBodies()

  it("TOOL_GROUPS 仍是三组（分组结构没被改动）", () => {
    expect(groups).toHaveLength(3)
    // 判别力：第一段确实是第一组，不是切偏了的片段
    expect(groups[0]).toContain('label: "记忆中心"')
    expect(groups[0]).toContain('label: "拆书库"')
    expect(groups[1]).toContain('label: "剧情推演室 · 测试版"')
  })

  it("第一组里有「插件」，位置在「技能库」之后、「拆书库」之前", () => {
    const first = groups[0]
    const entry = /\{ view: "plugins", label: "([^"]+)", icon: (\w+) \}/.exec(first)
    expect(entry, '第一组里没有 { view: "plugins", label: "插件", icon: Puzzle }').not.toBeNull()
    expect(entry![1]).toBe("插件")
    expect(entry![2]).toBe("Puzzle")

    expect(first.indexOf('view: "skillLibrary"')).toBeGreaterThanOrEqual(0)
    expect(first.indexOf('view: "bookAnalysis"')).toBeGreaterThanOrEqual(0)
    expect(first.indexOf('view: "skillLibrary"')).toBeLessThan(first.indexOf('view: "plugins"'))
    expect(first.indexOf('view: "plugins"')).toBeLessThan(first.indexOf('view: "bookAnalysis"'))
  })

  it("「插件」只出现在第一组，没被埋进「维护工具」那组", () => {
    const occurrences = source.slice(source.indexOf("const TOOL_GROUPS = ["), source.indexOf("] as const", source.indexOf("const TOOL_GROUPS = [")))
      .match(/view: "plugins"/g) ?? []
    expect(occurrences).toHaveLength(1)
    expect(groups[2]).not.toContain('view: "plugins"')
  })

  it("Puzzle 从 lucide-react 导入（不新增依赖）", () => {
    const lucideImport = /import \{([^}]*)\} from "lucide-react"/.exec(source)
    expect(lucideImport, "ui-test-shell.tsx 没有从 lucide-react 导入图标").not.toBeNull()
    expect(lucideImport![1].split(",").map((name) => name.trim())).toContain("Puzzle")
  })
})
