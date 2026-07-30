import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import zh from "@/i18n/zh.json"
import en from "@/i18n/en.json"

const settingsViewSource = readFileSync(resolve(__dirname, "settings-view.tsx"), "utf8")
const webSearchSectionSource = readFileSync(
  resolve(__dirname, "sections/web-search-section.tsx"),
  "utf8",
)
const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8")

describe("Web Search settings restore", () => {
  it("mounts web-search as an independent settings category between network and mcp", () => {
    expect(settingsViewSource).toContain('| "web-search"')
    expect(settingsViewSource).toContain(
      '{ id: "web-search", labelKey: "settings.categories.webSearch", icon: Search }',
    )
    expect(settingsViewSource).toContain('case "web-search":')
    expect(settingsViewSource).toContain("return <WebSearchSection />")
    expect(settingsViewSource).toContain('import { WebSearchSection } from "./sections/web-search-section"')

    const networkIdx = settingsViewSource.indexOf('{ id: "network"')
    const webSearchIdx = settingsViewSource.indexOf('{ id: "web-search"')
    const mcpIdx = settingsViewSource.indexOf('{ id: "mcp"')
    expect(networkIdx).toBeGreaterThan(-1)
    expect(webSearchIdx).toBeGreaterThan(networkIdx)
    expect(mcpIdx).toBeGreaterThan(webSearchIdx)
  })

  it("lists domestic providers before self-hosted and international ones", () => {
    const order = ["bocha", "qiniu", "metaso", "searxng", "tavily", "serpapi"].map((id) =>
      webSearchSectionSource.indexOf(`id: "${id}"`),
    )
    for (let i = 1; i < order.length; i++) {
      expect(order[i]).toBeGreaterThan(order[i - 1])
    }
    expect(webSearchSectionSource).toContain("国内推荐")
    expect(webSearchSectionSource).toContain("国内二级")
    expect(webSearchSectionSource).toContain("自建")
    expect(webSearchSectionSource).toContain("国际")
  })

  it("hydrates searchApiConfig on app startup", () => {
    expect(appSource).toContain("loadSearchApiConfig")
    expect(appSource).toContain("setSearchApiConfig(savedSearchApiConfig)")
  })

  it("provides Chinese and English category/section copy", () => {
    expect(zh.settings.categories.webSearch).toBe("网页搜索")
    expect(zh.settings.sections.webSearch.title).toBe("网页搜索")
    expect(zh.settings.sections.webSearch.description).toContain("博查")
    expect(en.settings.categories.webSearch).toBe("Web Search")
    expect(en.settings.sections.webSearch.title).toBe("Web Search")
    expect(en.settings.sections.webSearch.description).toContain("Bocha")
  })
})
