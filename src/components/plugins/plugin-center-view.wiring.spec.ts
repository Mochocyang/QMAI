/**
 * 「插件」这个顶层视图的**接线守卫**。
 *
 * 为什么除了组件测试还要这一条：页面本身写得再好，只要四处接线漏了一处，
 * 用户在界面上就完全看不到它 —— 而且四种漏法一个都不会让 `tsc` 报错：
 *   · `activeView` 联合类型里没有 → `setActiveView("plugins")` 才会报错，但没人调它；
 *   · `DEFAULT_SIDEBAR_NAV_ORDER` 里没有 → 图标压根不出现；
 *   · `CONFIGURABLE_NAV_ITEMS` 里没有 → 顺序里排了也没有对应图标/文案；
 *   · `content-area.tsx` 的 switch 里没有 → 掉进 `default:`，渲染的是 **AI 会话**（不是白屏）。
 * 本仓既有同类守卫见 `book-analysis-routing.spec.ts` 与 `content-area.routing.spec.tsx`。
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  DEFAULT_SIDEBAR_NAV_ORDER,
  normalizeSidebarNavConfig,
} from "@/lib/sidebar-nav-preferences"
import zh from "../../i18n/zh.json"

const ROOT = resolve(__dirname, "../../..")
const read = (relative: string) => readFileSync(resolve(ROOT, relative), "utf8")

/** 去掉注释后再断言（注释里「讨论」某个标识符不算接线，本仓已栽过多次）。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
}

describe("「插件」视图的导航接线", () => {
  it("默认侧边栏顺序里有 plugins，且旧配置读回时会被补上", () => {
    expect(DEFAULT_SIDEBAR_NAV_ORDER).toContain("plugins")
    // 老用户 localStorage 里存着没有 plugins 的顺序：归一化必须把它补回来，
    // 否则升级后图标永远不出现，而界面上没有任何「你少了一个入口」的提示。
    const normalized = normalizeSidebarNavConfig({ order: ["wiki", "skillLibrary"] })
    expect(normalized.order).toContain("plugins")
    // wiki 仍然排第一（既有不变式）
    expect(normalized.order[0]).toBe("wiki")
  })

  it("侧边栏可配置条目里有唯一一项 view === 'plugins'，文案与图标都接好了", () => {
    const source = stripComments(read("src/components/layout/icon-sidebar.tsx"))
    const start = source.indexOf("const CONFIGURABLE_NAV_ITEMS")
    expect(start, "icon-sidebar.tsx 里应能找到 CONFIGURABLE_NAV_ITEMS").toBeGreaterThan(-1)
    const block = source.slice(start, source.indexOf("\n]", start) + 2)
    expect(block).toContain('id: "plugins"')
    expect(block).toContain('view: "plugins"')
    expect(block).toContain('labelKey: "novel.nav.plugins"')
    expect(block).toContain("icon: Puzzle")
    // 恰好一项：重复会让同一图标出现两次、且 DnD 的 id 冲突
    expect(block.match(/view: "plugins"/g) ?? []).toHaveLength(1)
    // Puzzle 必须是从 lucide-react 导入的，不是随手引用一个未定义标识符
    expect(source).toMatch(/from "lucide-react"/)
    expect(source.slice(0, source.indexOf("lucide-react")).includes("Puzzle")).toBe(true)
  })

  it("内容区有 plugins 分支，且懒加载的是 PluginCenterView", () => {
    const source = stripComments(read("src/components/layout/content-area.tsx"))
    expect(source).toContain('case "plugins":')
    expect(source).toContain("<PluginCenterView />")
    expect(source).toContain('import("@/components/plugins/plugin-center-view")')
    // 落在 Suspense 里（照其它 case 的写法），不是直接渲染
    const caseAt = source.indexOf('case "plugins":')
    const caseBlock = source.slice(caseAt, caseAt + 240)
    expect(caseBlock).toContain("<Suspense")
    expect(caseBlock).toContain("<LoadingView />")
  })

  it("activeView 联合类型里有 plugins（否则 setActiveView('plugins') 编译不过）", () => {
    const source = read("src/stores/wiki-store.ts")
    expect(source).toContain('"maintenance" | "plugins"')
  })

  it("导航文案在 novel.nav 下（不是顶层 nav；两个 nav 块只差这一处就会显示成原始 key）", () => {
    expect(zh.novel.nav.plugins).toBe("插件")
  })

  it("已安装列表由本页自己渲染，且启停权限走「清单申请的权限」而不是空数组", () => {
    const source = stripComments(read("src/components/plugins/plugin-center-view.tsx"))

    /*
     * 2026-10 的版面重做把「已安装」从 tab + PluginSection 改成页内行式卡片 + 开关
     * （用户要求：界面全是字、想要一步开关）。所以**不再**断言复用 PluginSection ——
     * 那条断言的是旧版面，不是行为。这里改钉重做后真正会坏的三件事：
     */

    // 1) 行式列表必须由 InstalledRow 渲染（漏了它 = 已安装列表整个消失）
    expect(source).toContain('from "@/components/plugins/installed-row"')
    expect(source).toContain("<InstalledRow")

    // 2) 启用时必须传「清单里申请的权限」。传空数组会让插件拿不到读项目的资格，
    //    后端照实拒绝，而用户看到的是「启用了但用不了」—— 这是曾经真发生过的 bug。
    expect(source).toContain("declaredPermissions ?? []")
    expect(source).not.toContain("pluginsApi.enable(plugin.id, [])")

    // 3) 停用/卸载的职责从 PluginSection 转移到本页，但卸载必须先确认（不可逆动作）
    expect(source).toContain("pluginsApi.disable(")
    expect(source).toContain("window.confirm")
  })
})
