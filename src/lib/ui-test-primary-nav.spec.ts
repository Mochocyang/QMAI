// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest"
import {
  PRIMARY_NAV_OPTIONS,
  normalizePrimaryNav,
  readPrimaryNav,
  type PrimaryNavItem,
} from "./ui-test-primary-nav"

const STORAGE_KEY = "qm-uitest-primary-nav-v1"
const views = (items: PrimaryNavItem[]) => items.map((item) => item.view)
const labels = (items: PrimaryNavItem[]) => items.map((item) => item.label)

beforeEach(() => localStorage.clear())

describe("「插件」成为一级导航项", () => {
  it("PRIMARY_NAV_OPTIONS 里有「插件」，且紧跟「技能库」之后", () => {
    expect(PRIMARY_NAV_OPTIONS).toContainEqual({ view: "plugins", label: "插件" })
    /*
     * 位置也要钉住：与顶栏「创作工具」下拉里的分组一致（技能库 → 插件 → 拆书库）。
     * 只断言「选项里有这一条」的话，插到列表末尾也能绿，但菜单顺序会和下拉里对不上。
     */
    expect(PRIMARY_NAV_OPTIONS.findIndex((item) => item.view === "plugins")).toBe(
      PRIMARY_NAV_OPTIONS.findIndex((item) => item.view === "skillLibrary") + 1,
    )
  })

  it("全新用户（本地没有存过配置）默认一级导航里就有「插件」", () => {
    /*
     * 不直接断言 DEFAULT_PRIMARY_NAV 常量：它没有导出，故意保持模块私有，
     * 只能通过「没有存储值」这条真实路径观察。normalize(null) 走的正是
     * readPrimaryNav 在 localStorage 为空时的分支。
     */
    expect(views(normalizePrimaryNav(null))).toEqual(["sources", "wiki", "soul", "plugins"])
    expect(labels(normalizePrimaryNav(null))).toEqual(["大纲", "章节", "灵魂", "插件"])
  })
})

describe("老数据向前补全「插件」", () => {
  it("老用户存的是三项时，末尾补上「插件」，前三项顺序不变", () => {
    const result = normalizePrimaryNav(["sources", "wiki", "soul"])
    expect(views(result)).toEqual(["sources", "wiki", "soul", "plugins"])
    // 用户的排列必须原样保留：只准往后加，不准插队
    expect(labels(result).slice(0, 3)).toEqual(["大纲", "章节", "灵魂"])
  })

  it("本地已存的旧配置（老用户真实路径）读出来也带「插件」", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["sources", "wiki", "soul"]))
    expect(views(readPrimaryNav())).toEqual(["sources", "wiki", "soul", "plugins"])
  })

  it("已经满 5 项时不补全：尊重用户用满的名额", () => {
    const stashed = ["sources", "wiki", "soul", "graph", "bookAnalysis"]
    const result = normalizePrimaryNav(stashed)
    expect(views(result)).toEqual(stashed)
    expect(views(result)).toHaveLength(5)
    expect(views(result)).not.toContain("plugins")
  })

  it("补全是幂等的：连续 normalize 两次结果相同，不会重复追加", () => {
    const once = normalizePrimaryNav(["sources", "wiki", "soul"])
    const twice = normalizePrimaryNav(views(once))
    expect(twice).toEqual(once)
    expect(views(twice).filter((view) => view === "plugins")).toHaveLength(1)
  })

  it("用户自己排过顺序时不插队，只追加到末尾", () => {
    expect(views(normalizePrimaryNav(["wiki", "sources", "soul"]))).toEqual([
      "wiki",
      "sources",
      "soul",
      "plugins",
    ])
  })

  it("已经含「插件」的配置不会被搬到别的位置", () => {
    const stored = ["sources", "plugins", "soul"]
    expect(views(normalizePrimaryNav(stored))).toEqual(stored)
  })
})
