// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import "@/i18n"
import { useWikiStore } from "@/stores/wiki-store"
import { SoulSidebarPanel } from "@/components/layout/soul-sidebar-panel"
import { UiTestDirectoryHeader } from "./ui-test-directory"
vi.mock("@/lib/ui-test", () => ({ IS_UI_TEST_BUILD: true }))
vi.mock("@/lib/novel/character-aura", async () => {
  const actual = await vi.importActual<typeof import("@/lib/novel/character-aura")>("@/lib/novel/character-aura")
  return { ...actual, listCharacterAuras: vi.fn().mockResolvedValue(actual.BUILT_IN_CHARACTER_AURAS), getCharacterAuraBindings: vi.fn().mockResolvedValue([]) }
})
let host: HTMLDivElement, root: Root
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host=document.createElement("div");document.body.append(host);root=createRoot(host);useWikiStore.setState({project:{id:"visual",name:"测试小说",path:"/test"},selectedSoulTab:"project",selectedSoulSection:"builtIn",selectedSoulId:"project-soul"}) })
afterEach(async()=>{await act(async()=>root.unmount());host.remove()})
async function click(text:string) { const button=[...host.querySelectorAll("button")].find(b=>b.textContent?.trim()===text); expect(button,text).toBeTruthy();await act(async()=>button!.click()) }
describe("测试版统一灵魂目录",()=>{
  it("项目、人物、内置、自定义入口同时可见且直接切换原store",async()=>{
    await act(async()=>root.render(<SoulSidebarPanel/>))
    expect(host.textContent).toContain("项目灵魂")
    expect(host.textContent).toContain("已绑定人物")
    await click("角色灵魂")
    expect(useWikiStore.getState().selectedSoulTab).toBe("character")
    expect(useWikiStore.getState().selectedSoulSection).toBe("builtIn")
    await click("自定义灵魂")
    expect(useWikiStore.getState().selectedSoulSection).toBe("custom")
    await click("新建自定义灵魂")
    expect(useWikiStore.getState().selectedSoulId).toBe("new-custom-soul")
  })
})
describe("测试版目录操作",()=>{
  it("导入与更多菜单执行真实回调，收起不销毁业务",async()=>{
    const onImportFiles=vi.fn(),onCreateContainer=vi.fn(),onClose=vi.fn()
    await act(async()=>root.render(<UiTestDirectoryHeader kind="outline" busy={false} onCreate={()=>{}} onCreateContainer={onCreateContainer} onImportFiles={onImportFiles} onImportFolder={()=>{}} onOpenAssistant={()=>{}} onClose={onClose} onHelp={()=>{}} />))
    await click("导入");await click("导入文件");expect(onImportFiles).toHaveBeenCalledTimes(1)
    await click("新建");await click("新建文件夹");expect(onCreateContainer).toHaveBeenCalledTimes(1)
    expect(host.textContent).not.toContain("更多")
    expect(host.querySelector('[aria-label="批量大纲提取"]')).not.toBeNull()
    await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="收起目录"]')!.click());expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("章节新建包含章节和卷，并提供与大纲相同的一键提取入口", async () => {
    const onCreate = vi.fn(), onCreateContainer = vi.fn(), onOpenAssistant = vi.fn()
    await act(async () => root.render(<UiTestDirectoryHeader kind="chapter" busy={false} onCreate={onCreate} onCreateContainer={onCreateContainer} onImportFiles={() => {}} onImportFolder={() => {}} onOpenAssistant={onOpenAssistant} onClose={() => {}} onHelp={() => {}} />))
    await click("新建")
    expect(host.textContent).toContain("新建章节")
    expect(host.textContent).toContain("新建卷")
    expect(host.textContent).not.toContain("新建分卷")
    expect(host.textContent).not.toContain("功能使用说明")
    await click("新建卷")
    expect(onCreateContainer).toHaveBeenCalledTimes(1)
    await click("新建")
    await click("新建章节")
    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[aria-label="一键提取"]')).not.toBeNull()
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="一键提取"]')!.click())
    expect(onOpenAssistant).toHaveBeenCalledTimes(1)
  })
})
