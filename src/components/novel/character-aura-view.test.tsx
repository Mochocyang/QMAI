// @vitest-environment jsdom

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import "@/i18n"
import { BUILT_IN_CHARACTER_AURAS } from "@/lib/novel/character-aura"
import { useWikiStore } from "@/stores/wiki-store"
import { CharacterAuraView } from "./character-aura-view"
import { personality } from "@/test-helpers/portable-personality-fixture"
import { parsePortablePersonality } from "@/lib/novel/portable-personality"

const auraMocks = vi.hoisted(() => ({
  bindCharacterAura: vi.fn(),
  buildCharacterAuraContext: vi.fn(),
  createCustomCharacterAuraSkill: vi.fn(),
  deleteCustomCharacterAura: vi.fn(),
  getCharacterAuraBindings: vi.fn(),
  listBindableNovelCharacters: vi.fn(),
  listCharacterAuras: vi.fn(),
  loadCharacterAuraResearchDocument: vi.fn(),
  loadCharacterAuraSkillDocument: vi.fn(),
  unbindCharacterAura: vi.fn(),
  updateCustomCharacterAura: vi.fn(),
}))

vi.mock("@/lib/novel/character-aura", async () => {
  const actual = await vi.importActual<typeof import("@/lib/novel/character-aura")>("@/lib/novel/character-aura")
  return {
    ...actual,
    bindCharacterAura: auraMocks.bindCharacterAura,
    buildCharacterAuraContext: auraMocks.buildCharacterAuraContext,
    createCustomCharacterAuraSkill: auraMocks.createCustomCharacterAuraSkill,
    deleteCustomCharacterAura: auraMocks.deleteCustomCharacterAura,
    getCharacterAuraBindings: auraMocks.getCharacterAuraBindings,
    listBindableNovelCharacters: auraMocks.listBindableNovelCharacters,
    listCharacterAuras: auraMocks.listCharacterAuras,
    loadCharacterAuraResearchDocument: auraMocks.loadCharacterAuraResearchDocument,
    loadCharacterAuraSkillDocument: auraMocks.loadCharacterAuraSkillDocument,
    unbindCharacterAura: auraMocks.unbindCharacterAura,
    updateCustomCharacterAura: auraMocks.updateCustomCharacterAura,
  }
})

const source = readFileSync(resolve(__dirname, "character-aura-view.tsx"), "utf8")
const iconSidebarSource = readFileSync(resolve(__dirname, "..", "layout", "icon-sidebar.tsx"), "utf8")
const contentAreaSource = readFileSync(resolve(__dirname, "..", "layout", "content-area.tsx"), "utf8")
const customAura = {
  ...BUILT_IN_CHARACTER_AURAS[0],
  id: "custom-aura-1",
  name: "自定义角色灵魂",
  builtIn: false,
  category: "测试角色",
}

let host: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe("角色灵魂页面", () => {
  it("绑定小说人物下拉框位于内置灵魂位置并需要点击绑定", () => {
    // 新布局里身份带不再包含「人物分类」字段，改为验证绑定控件与能力卡同在详情区内。
    expect(source).toContain("<CharacterBindingControl")
    expect(source).toContain("<CharacterBindingControl")
    expect(source).toContain('aria-label="绑定小说人物"')
    expect(source).toContain('pendingBound ? "取消绑定" : "绑定"')
    expect(source).toContain("已绑定${boundNames.join")
    expect(source).not.toContain("仅使用公开或已授权资料")
  })

  it("自定义灵魂先显示预览，再进入新建或编辑表单", () => {
    expect(source).toContain('const [showCustomEditor, setShowCustomEditor] = useState(false)')
    expect(source).toContain('if (!aura.builtIn) setShowCustomEditor(false)')
    expect(source).toContain('showCustomEditor ? (')
    expect(source).toContain("<CustomAuraForm")
    expect(source).toContain('<AuraDetails')
    expect(source).toContain('badgeLabel="自定义灵魂"')
    expect(source).toContain("编辑")
    expect(source).toContain("返回预览")
  })

  it("新建灵魂入口固定在自定义列表上方", () => {
    expect(source).toContain("handleStartCreatingCustomAura")
    expect(source).toContain("新建灵魂")
    expect(source).not.toContain("新建角色灵魂")
    expect(source.indexOf("新建灵魂")).toBeLessThan(source.indexOf("{visibleAuras.map((aura) => ("))
    expect(source).toContain("点击上方“新建灵魂”后，再填写资料并生成。")
  })

  it("自定义灵魂预览区提供删除入口", () => {
    expect(source).toContain("handleDelete(targetAura?: CharacterAura)")
    expect(source).toContain("onDelete")
    expect(source).toContain("删除灵魂")
    expect(source).toContain("删除")
  })

  it("编辑当前自定义灵魂时会回填当前人物信息", () => {
    expect(source).toContain("formFromAura")
    expect(source).toContain("setForm(formFromAura(selected))")
    expect(source).toContain("当前灵魂信息")
    expect(source).toContain("灵魂摘要")
    expect(source).toContain("怎么说话 / 表达特征")
    expect(source).toContain("怎么想 / 心智模型")
    expect(source).toContain("怎么判断 / 决策启发式")
    expect(source).toContain("什么不做 / 价值观反模式")
    expect(source).toContain("知道局限 / 诚实边界")
  })

  it("页面异步失败时显示中文错误提示而不是吞掉异常", () => {
    expect(source).toContain("async function runAction")
    expect(source).toContain('"角色灵魂加载失败，请稍后重试"')
    expect(source).toContain('"自定义灵魂生成失败，请检查项目文件权限后重试"')
    expect(source).toContain('"自定义灵魂更新失败，请检查项目文件权限后重试"')
    expect(source).toContain('"自定义灵魂删除失败，请检查项目文件权限后重试"')
    expect(source).toContain('"绑定失败，请稍后重试"')
    expect(source).toContain('role="status"')
  })

  it("详情页用身份带 + 能力卡 + 资料库呈现，不再平铺九段字段", () => {
    // 身份带：口头禅收进标题区。
    expect(source).toContain('data-ui="soul-signature-quote"')
    expect(source).toContain(' · 内置灵魂')
    // 四张能力卡。
    expect(source).toContain('title="怎么说话"')
    expect(source).toContain('title="怎么想"')
    expect(source).toContain('title="怎么判断"')
    expect(source).toContain('title="什么不做"')
    // 资料库折叠。
    expect(source).toContain('data-ui="soul-doc-library"')
    expect(source).toContain("资料库")
    // 旧版平铺字段与重复摘要必须消失。
    expect(source).not.toContain("灵魂文件夹")
    expect(source).not.toContain('Detail label="灵魂摘要"')
  })

  it("资料库内可切换灵魂文档与研究文件，且渲染为可读正文", () => {
    expect(source).toContain("loadCharacterAuraSkillDocument")
    expect(source).toContain("正在读取灵魂文档。")
    expect(source).toContain("暂无灵魂文档。")
    expect(source).toContain("loadCharacterAuraResearchDocument")
    expect(source).toContain("正在读取研究文件。")
    expect(source).toContain("暂无研究文件。")
    // 研究文件走侧边导航，不再是顶部编号按钮；默认停在全文概览。
    expect(source).toContain("全文概览")
    // 渲染 Markdown，而不是把 YAML 头和符号原样打印给读者。
    expect(source).toContain("AuraDocumentView")
    expect(source).toContain("parseAuraMarkdown")
    expect(source).not.toContain("灵魂文档预览")
  })

  it("新建自定义灵魂保留资料导入入口", () => {
    expect(source).toContain("生成设置")
    expect(source).toContain("生成提示词")
    expect(source).toContain("开启 AI 搜索")
    expect(source).toContain("资料导入设置")
    expect(source).toContain("资料文本")
    expect(source).toContain("网页资料地址")
    expect(source).toContain("本地文档路径")
    expect(source).toContain("从资料生成角色灵魂")
  })

  it("生成自定义灵魂时提供工作流进度并锁定切换", () => {
    expect(source).toContain('const [isGeneratingCustomAura, setIsGeneratingCustomAura] = useState(false)')
    expect(source).toContain('const [generationProgress, setGenerationProgress] = useState<CharacterAuraGenerationProgress | null>(null)')
    expect(source).toContain("function blockWhileGenerating")
    expect(source).toContain("正在启动角色灵魂工作流，请稍候。")
    expect(source).toContain("生成流程预览")
    expect(source).toContain("当前研究文件：")
    expect(source).toContain("正在生成角色灵魂")
    expect(source).toContain("请等待完成后再切换或操作其他灵魂。")
  })

  it("详情页不再显示生成提示词与 AI 搜索这类生成期参数", () => {
    // 详情页是给人看效果的，生成参数摆进正文只会挤掉真正有用的内容；
    // 这两个字段仍保留在自定义灵魂的编辑表单里。
    expect(source).not.toContain('Detail label="AI 搜索"')
    expect(source).not.toContain('Detail label="生成提示词"')
  })
  it("内置灵魂可编辑并提供恢复默认，破坏性操作走确认弹窗", () => {
    // 数据入口：修改写覆盖层，恢复只删覆盖记录。
    expect(source).toContain("updateBuiltInCharacterAura")
    expect(source).toContain("resetBuiltInCharacterAura")
    expect(source).toContain("listEditedBuiltInAuraIds")
    expect(source).toContain("editedBuiltInIds")
    // 内置灵魂也有编辑入口，不再被 builtIn 判空挡住。
    expect(source).toContain("handleStartEditingBuiltIn")
    expect(source).toContain("BuiltInAuraEditDrawer")
    // 恢复默认必须二次确认，不能一点就清。
    expect(source).toContain("ResetBuiltInAuraDialog")
    expect(source).toContain("确认恢复")
    expect(source).toContain("此操作不可撤销")
  })


  it("编辑自定义灵魂允许维护资料来源索引", () => {
    expect(source).toContain("资料来源索引")
    expect(source).toContain("如果你要补充或修正网页资料、本地文档来源，也可以在这里一起维护。")
  })

  it("不再保留页面下方的绑定说明和灵魂注入预览", () => {
    expect(source).not.toContain("从小说人物下拉框中选择要绑定的人物")
    expect(source).not.toContain("灵魂注入预览")
    expect(source).not.toContain("预览本次注入")
    expect(source).not.toContain("async function handlePreviewAuraContext")
  })

  it("用户可见文案不再出现旧功能名", () => {
    const oldName = ["魂", "魄"].join("")
    expect(source).not.toContain(oldName)
    expect(iconSidebarSource).not.toContain(oldName)
    expect(contentAreaSource).not.toContain(oldName)
  })

  it("导航入口和内容区能渲染角色灵魂页面", () => {
    expect(iconSidebarSource).toContain('view: "soul"')
    expect(iconSidebarSource).toContain('labelKey: "novel.nav.soul"')
    expect(contentAreaSource).toContain('case "soul"')
    expect(contentAreaSource).toContain("<SoulView />")
  })
})

describe("CharacterAuraView hideSidebar selection", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    auraMocks.listBindableNovelCharacters.mockResolvedValue([])
    auraMocks.getCharacterAuraBindings.mockResolvedValue([])
    auraMocks.loadCharacterAuraSkillDocument.mockResolvedValue("")
    auraMocks.loadCharacterAuraResearchDocument.mockResolvedValue("")
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    host.remove()
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  })

  it("uses the selected built-in soul from the store in embedded mode", async () => {
    const targetAura = BUILT_IN_CHARACTER_AURAS[1]
    auraMocks.listCharacterAuras.mockResolvedValue(BUILT_IN_CHARACTER_AURAS)
    useWikiStore.setState({
      project: { id: "proj-1", name: "proj", path: "/proj" },
      selectedSoulId: targetAura.id,
      selectedSoulSection: "builtIn",
      selectedSoulTab: "character",
    })

    await act(async () => {
      root.render(<CharacterAuraView hideSidebar />)
    })
    await flush()

    expect(host.querySelector("h2")?.textContent).toBe(targetAura.name)
    expect(host.querySelector("h2")?.textContent).not.toBe(BUILT_IN_CHARACTER_AURAS[0]?.name)
  })

  it("uses the selected custom soul section from the store in embedded mode", async () => {
    auraMocks.listCharacterAuras.mockResolvedValue([...BUILT_IN_CHARACTER_AURAS, customAura])
    useWikiStore.setState({
      project: { id: "proj-1", name: "proj", path: "/proj" },
      selectedSoulId: customAura.id,
      selectedSoulSection: "custom",
      selectedSoulTab: "character",
    })

    await act(async () => {
      root.render(<CharacterAuraView hideSidebar />)
    })
    await flush()

    expect(host.querySelector("h2")?.textContent).toBe(customAura.name)
  })

  it("新人格灵魂按规则编辑，不与旧五层文本形成两份不同的性格", async () => {
    auraMocks.listCharacterAuras.mockResolvedValue([{
      ...customAura, portablePersonality: parsePortablePersonality(personality),
    }])
    useWikiStore.setState({
      project: { id: "proj-1", name: "proj", path: "/proj" },
      selectedSoulId: customAura.id, selectedSoulSection: "custom", selectedSoulTab: "character",
    })
    await act(async () => { root.render(<CharacterAuraView hideSidebar />) })
    await flush()
    await act(async () => {
      Array.from(host.querySelectorAll("button")).find((node) => node.textContent?.trim() === "编辑")?.click()
    })
    await flush()
    expect(host.textContent).toContain("可迁移人格规则")
    expect(host.textContent).not.toContain("当前灵魂信息")
    const label = Array.from(host.querySelectorAll("label")).find((node) => node.textContent === "R1 · 行为倾向")
    const input = label?.control as HTMLTextAreaElement
    expect(input.value).toContain("不能直接定罪")
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "核验后再决定")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => {
      Array.from(host.querySelectorAll("button")).find((node) => node.textContent?.trim() === "保存修改")?.click()
    })
    expect(auraMocks.updateCustomCharacterAura.mock.calls[0][2].portablePersonality.rules[0].tendency).toBe("核验后再决定")
  })

  it("keeps the new-custom-soul selection so the create form survives refresh", async () => {
    // 回归：新建时列表里还没有自定义灵魂，刷新不能被回退值覆盖，否则新建表单会被立即关闭。
    auraMocks.listCharacterAuras.mockResolvedValue(BUILT_IN_CHARACTER_AURAS)
    useWikiStore.setState({
      project: { id: "proj-1", name: "proj", path: "/proj" },
      selectedSoulId: "new-custom-soul",
      selectedSoulSection: "custom",
      selectedSoulTab: "character",
    })

    await act(async () => {
      root.render(<CharacterAuraView hideSidebar />)
    })
    await flush()

    expect(useWikiStore.getState().selectedSoulId).toBe("new-custom-soul")
    expect(host.textContent).toContain("新建灵魂")
    expect(host.textContent).toContain("从资料生成角色灵魂")
  })

  it("新建表单字段有可关联标签，资料排在进度之前且操作区独立", async () => {
    auraMocks.listCharacterAuras.mockResolvedValue(BUILT_IN_CHARACTER_AURAS)
    useWikiStore.setState({
      project: { id: "proj-1", name: "proj", path: "/proj" },
      selectedSoulId: "new-custom-soul",
      selectedSoulSection: "custom",
      selectedSoulTab: "character",
    })
    await act(async () => {
      root.render(<CharacterAuraView hideSidebar />)
    })
    await flush()

    const labels = Array.from(host.querySelectorAll("label"))
    for (const text of ["名称", "人物分类", "生成提示词", "资料文本", "网页资料地址", "本地文档路径"]) {
      const label = labels.find((node) => node.textContent === text)
      expect(label?.control, `${text}需要关联输入控件`).toBeTruthy()
    }
    const sections = Array.from(host.querySelectorAll("h3")).map((node) => node.textContent)
    expect(sections.indexOf("资料导入设置")).toBeLessThan(sections.indexOf("生成流程预览"))
    expect(host.querySelector('[data-ui="soul-form-actions"]')?.textContent).toContain("从资料生成角色灵魂")
    expect(host.querySelector('[data-ui="soul-form-basics"]')?.querySelectorAll("input").length).toBe(2)
  })

  it("binds a character and bumps the shared data version for the project sidebar", async () => {
    const targetAura = BUILT_IN_CHARACTER_AURAS[0]
    auraMocks.listCharacterAuras.mockResolvedValue(BUILT_IN_CHARACTER_AURAS)
    auraMocks.listBindableNovelCharacters.mockResolvedValue(["杨墨"])
    auraMocks.getCharacterAuraBindings.mockResolvedValue([])
    auraMocks.bindCharacterAura.mockResolvedValue({
      customAuras: [],
      bindings: [{ characterName: "杨墨", auraId: targetAura.id }],
    })
    useWikiStore.setState({
      project: { id: "proj-1", name: "proj", path: "/proj" },
      selectedSoulId: targetAura.id,
      selectedSoulSection: "builtIn",
      selectedSoulTab: "character",
      dataVersion: 0,
    })

    await act(async () => {
      root.render(<CharacterAuraView hideSidebar />)
    })
    await flush()

    const bindSelect = host.querySelector('select[aria-label="绑定小说人物"]')
    const bindButton = Array.from(host.querySelectorAll("button")).find((node) => node.textContent?.trim() === "绑定")
    if (!(bindSelect instanceof HTMLSelectElement) || !(bindButton instanceof HTMLButtonElement)) {
      throw new Error("bind controls not found")
    }

    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set
      if (!setValue) throw new Error("select value setter not found")
      setValue.call(bindSelect, "杨墨")
      bindSelect.dispatchEvent(new Event("change", { bubbles: true }))
    })
    await flush()
    expect(auraMocks.bindCharacterAura).not.toHaveBeenCalled()

    await act(async () => {
      bindButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    await flush()

    expect(auraMocks.bindCharacterAura).toHaveBeenCalledWith("/proj", { characterName: "杨墨", auraId: targetAura.id })
    expect(useWikiStore.getState().dataVersion).toBe(1)
  })
})