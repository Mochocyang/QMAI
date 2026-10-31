import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { getChatModelDropdownStyle, resolveModelItemLabel, sameDropdownStyle } from "./chat-model-selector"

const source = readFileSync(resolve(__dirname, "chat-model-selector.tsx"), "utf8")

describe("chat model selector sizing", () => {
  it("uses a narrow fixed trigger width with truncated model text", () => {
    expect(source).toContain('className="h-8 w-fit max-w-40 justify-start gap-1 px-2 text-xs"')
    expect(source).toContain('className="max-w-32 truncate text-left"')
    expect(source).not.toContain("min-w-[160px]")
    expect(source).not.toContain("max-w-[200px]")
  })
})

describe("resolveModelItemLabel", () => {
  it("名字与模型 ID 相同时只保留一行", () => {
    expect(resolveModelItemLabel({ name: "hy3", model: "hy3" })).toEqual({
      title: "hy3",
      showModelId: false,
    })
  })

  it("名字与模型 ID 不同时才显示第二行", () => {
    expect(resolveModelItemLabel({ name: "写作主力", model: "deepseek-v4.1-flash" })).toEqual({
      title: "写作主力",
      showModelId: true,
    })
  })

  it("名字为空或只有空格时回落到模型 ID，且不重复显示", () => {
    expect(resolveModelItemLabel({ name: "   ", model: "glm-5.3" })).toEqual({
      title: "glm-5.3",
      showModelId: false,
    })
    expect(resolveModelItemLabel({ name: "", model: "hy3" })).toEqual({
      title: "hy3",
      showModelId: false,
    })
  })
})

describe("chat model dropdown density", () => {
  it("下拉项用 14px 字号与舒展行距（C2）", () => {
    expect(source).toContain('className="truncate text-sm leading-5"')
    expect(source).toContain("text-xs leading-4 text-muted-foreground")
    expect(source).toContain("items-center gap-2 rounded-md px-3 py-2.5 text-left")
    expect(source).not.toContain("items-start gap-2 rounded-sm px-3 py-1.5")
  })

  it("分组标题吸顶、加粗，且按需求没有搜索框与分隔线", () => {
    expect(source).toContain("sticky top-0 z-10 rounded-t-md bg-popover")
    // 吸顶标题用 font-bold（按用户在 A/B/C 字重对比里选的 C）。
    expect(source).toContain("text-[0.625rem] font-bold uppercase tracking-wider")
    // 吸顶标题要贴到滚动区最上沿：容器顶部不能留 padding，否则上一行会透出来。
    expect(source).toContain("px-0.5 pb-0.5 pt-0")
    expect(source).not.toContain('t("chat.searchModel")')
    expect(source).not.toContain("<input")
    expect(source).not.toContain("filterModelGroups")
    expect(source).not.toContain("h-px bg-border")
  })

  it("选中项用左侧竖条而不是只靠底色", () => {
    expect(source).toContain("absolute left-1 top-1/2 w-1 -translate-y-1/2 rounded-full bg-primary")
  })

  it("打开下拉时自动滚到当前选中的模型", () => {
    // 打标记：只有选中项带 data-selected="true"，滚动逻辑靠它定位
    expect(source).toContain('data-selected={selected ? "true" : undefined}')
    expect(source).toContain('[data-selected="true"]')
    expect(source).toContain("container.scrollTop")
  })

  it("自动定位每次打开只做一次，之后不再抢用户的滚动", () => {
    // 依赖里不能带 value：否则任何一次重渲染都会把滚动位置拉回选中项
    expect(source).toContain("scrolledToSelectionRef.current = true")
    expect(source).not.toContain("[open, dropdownStyle, value]")
  })

  it("下拉列表自身滚动不会触发位置重算（否则每滚一格就跳回顶部）", () => {
    expect(source).toContain("container.contains(target)")
    expect(source).toContain("sameDropdownStyle(prev, next) ? prev : next")
  })
})

describe("模型悬停弹窗接线", () => {
  /*
   * 悬停弹窗是「点开列表」之外的第二条入口：鼠标停在模型按钮上弹设置面板，
   * 点按钮仍然是打开模型列表。两者必须互斥，否则会互相盖住。
   */
  it("悬停时挂出生成设置弹窗，且与下拉列表互斥", () => {
    expect(source).toContain("<ModelSettingsPopover")
    expect(source).toContain("schedulePanelOpen")
    expect(source).toContain("schedulePanelClose")
    expect(source).toContain("!open && panelOpen && panelStyle && selectedEntry")
  })

  it("工具条上不再有独立的思考深度按钮（推理程度只在弹窗里调）", () => {
    expect(source).not.toContain("ReasoningDepthControl")
  })
})

describe("getChatModelDropdownStyle", () => {  it("opens below the trigger when there is enough space underneath", () => {
    const style = getChatModelDropdownStyle(
      { top: 120, bottom: 152, right: 400, width: 128 },
      { width: 800, height: 900 },
    )
    expect(style).toMatchObject({ top: 156, right: 248 })
    expect(style.bottom).toBeUndefined()
    expect(style.maxHeight).toBeLessThanOrEqual(360)
    expect(style.maxHeight).toBeGreaterThan(200)
  })

  it("opens above the trigger when space below is tight", () => {
    const style = getChatModelDropdownStyle(
      { top: 700, bottom: 732, right: 400, width: 128 },
      { width: 800, height: 800 },
    )
    expect(style.top).toBeUndefined()
    expect(style.bottom).toBe(800 - 700 + 4)
    expect(style.maxHeight).toBeLessThanOrEqual(700 - 4 - 4)
  })

  it("shifts a left-edge menu right so its full width stays visible", () => {
    const style = getChatModelDropdownStyle(
      { top: 300, bottom: 332, right: 180, width: 128 },
      { width: 692, height: 938 },
    )
    expect(style.width).toBe(280)
    expect(style.right).toBe(692 - 180 - (280 - 128))
    expect(style.right).toBeGreaterThanOrEqual(4)
  })

  it("caps downward maxHeight so the menu stays inside the viewport", () => {
    const style = getChatModelDropdownStyle(
      { top: 80, bottom: 112, right: 400, width: 128 },
      { width: 800, height: 400 },
    )
    expect(style.top).toBe(116)
    // viewport below trigger: 400 - 112 = 288 → maxHeight ≤ 288 - gap - 4
    expect(style.maxHeight).toBeLessThanOrEqual(280)
  })
})

describe("sameDropdownStyle", () => {
  it("位置完全一致时判定相同（复用旧对象，避免无谓重渲染）", () => {
    const a = { right: 10, width: 280, maxHeight: 360, top: 100 }
    expect(sameDropdownStyle(a, { ...a })).toBe(true)
  })

  it("任一项不同就判定不同", () => {
    const a = { right: 10, width: 280, maxHeight: 360, top: 100 }
    expect(sameDropdownStyle(a, { ...a, top: 101 })).toBe(false)
    expect(sameDropdownStyle(a, { ...a, maxHeight: 300 })).toBe(false)
    expect(sameDropdownStyle(a, { right: 10, width: 280, maxHeight: 360, bottom: 100 })).toBe(false)
  })

  it("空值处理：两边都空算相同，单边为空算不同", () => {
    expect(sameDropdownStyle(null, null)).toBe(true)
    expect(sameDropdownStyle(null, { right: 1, width: 2, maxHeight: 3, top: 4 })).toBe(false)
    expect(sameDropdownStyle({ right: 1, width: 2, maxHeight: 3, top: 4 }, null)).toBe(false)
  })
})
