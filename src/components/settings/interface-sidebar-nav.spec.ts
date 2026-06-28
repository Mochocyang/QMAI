import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import zh from "@/i18n/zh.json"

const interfaceSectionSource = readFileSync(resolve(__dirname, "sections/interface-section.tsx"), "utf8")
const settingsTypesSource = readFileSync(resolve(__dirname, "settings-types.ts"), "utf8")
const settingsViewSource = readFileSync(resolve(__dirname, "settings-view.tsx"), "utf8")

describe("settings sidebar nav preferences", () => {
  it("stores sidebar nav config in the settings draft and saves it through the wiki store", () => {
    expect(settingsTypesSource).toContain("sidebarNavConfig")
    expect(settingsViewSource).toContain("const sidebarNavConfig = useWikiStore((s) => s.sidebarNavConfig)")
    expect(settingsViewSource).toContain("const setSidebarNavConfig = useWikiStore((s) => s.setSidebarNavConfig)")
    expect(settingsViewSource).toContain("setSidebarNavConfig(draft.sidebarNavConfig)")
  })

  it("renders a Chinese sidebar feature visibility section in interface settings", () => {
    expect(interfaceSectionSource).toContain("SIDEBAR_NAV_LABEL_KEYS")
    expect(interfaceSectionSource).toContain('setDraft("sidebarNavConfig"')
    expect(interfaceSectionSource).toContain('type="checkbox"')
    expect(zh.settings.sections.interface.sidebarNavTitle).toBe("左侧功能栏")
    expect(zh.settings.sections.interface.sidebarNavDescription).toBe("勾选要在左侧显示的功能，取消勾选后该功能入口会隐藏。")
  })
})
