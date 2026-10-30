// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
vi.mock("@/lib/plugins/api", () => ({ pluginsApi: { list: vi.fn().mockResolvedValue([]), marketIndex: vi.fn().mockResolvedValue({plugins:[],fromCache:false,fetchedAt:null,sourceUrl:""}), enable: vi.fn(), disable: vi.fn(), uninstall: vi.fn(), install: vi.fn(), installLocal: vi.fn(), marketInstall: vi.fn() } }))
describe("probe", () => {
  it("module imports", async () => {
    const mod = await import("@/components/plugins/plugin-center-view")
    expect(typeof mod.PluginCenterView).toBe("function")
  })
})
