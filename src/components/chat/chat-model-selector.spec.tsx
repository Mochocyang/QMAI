import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  formatModelRatio,
  getChatModelDropdownStyle,
  modelRowMark,
  resolveModelItemLabel,
  resolveModelRowDecoration,
  sameDropdownStyle,
} from "./chat-model-selector"

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
  it("行高统一 36px、左右边距 16px（v4 实测值），不再随内容忽高忽低", () => {
    // 内置行：h-9 = 36px，px-4 = 16px
    expect(source).toContain("flex h-9 w-full items-center gap-2.5 px-4 text-left")
    // 名称 14px / 20px
    expect(source).toContain("truncate text-sm leading-5")
    // 自定义提供方行与子项都是 34px
    expect(source).toContain("flex h-[34px] w-full items-center gap-2 px-4 text-left")
    expect(source).toContain("pl-[38px] pr-4")
    // 旧的 2.5 上下内边距（会让行高随内容浮动）必须消失
    expect(source).not.toContain("py-2.5")
  })

  it("倍率列 44px 定宽右对齐、等宽数字", () => {
    expect(source).toContain("w-11 shrink-0 text-right text-xs tabular-nums text-muted-foreground")
  })

  it("分组标题吸顶、加粗，且按需求没有搜索框与分隔线", () => {
    expect(source).toContain("sticky top-0 z-10 rounded-t-md bg-popover")
    expect(source).toContain("text-[0.6875rem] font-semibold text-muted-foreground")
    // 吸顶标题要贴到滚动区最上沿：容器顶部不能留 padding，否则上一行会透出来。
    expect(source).toContain("px-0.5 pb-0.5 pt-0")
    expect(source).not.toContain('t("chat.searchModel")')
    expect(source).not.toContain("<input")
    expect(source).not.toContain("filterModelGroups")
    expect(source).not.toContain("h-px bg-border")
  })

  it("选中项用整行底色 + 右侧勾，不再额外画左侧竖条", () => {
    expect(source).toContain('selected ? "bg-accent" : ""')
    expect(source).not.toContain("truncate-y-1/2 rounded-full bg-primary")
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

describe("内置与自定义分开呈现（方案 F + D）", () => {
  it("内置模型区永远完整可见，且只在这里显示倍率", () => {
    // 内置分组独立渲染，不经过自定义的开关
    expect(source).toContain("builtinGroups.map((group) => (")
    expect(source).toContain("resolveModelRowDecoration(model)")
  })

  it("自定义区默认收起，靠开关展开", () => {
    expect(source).toContain('readBool(CUSTOM_OPEN_STORAGE_KEY, false)')
    expect(source).toContain('role="switch"')
    expect(source).toContain("{customOpen && customGroups.map((group) => {")
  })

  it("自定义模型按提供方折叠，点一次展开这个提供方下的模型", () => {
    expect(source).toContain("openProviders.has(group.id)")
    expect(source).toContain("aria-expanded={expanded}")
    expect(source).toContain("toggleProvider(group.id)")
  })

  it("自定义模型行只显示名称：不带 provider/ 前缀，也不显示倍率占位", () => {
    const customRow = source.slice(source.indexOf("自定义模型只显示名称本身"))
    expect(customRow).toContain("{title}")
    // 不能出现 model.model 的拼接，也不能出现横线占位
    expect(source).not.toContain("provider.toLowerCase()")
    expect(source).not.toContain("{ ratio ?? \"—\" }")
    expect(source).not.toContain("text-muted-foreground\">—")
  })

  it("选中项在收起的自定义提供方里时，打开下拉会自动展开那一块", () => {
    expect(source).toContain("selectedCustomProviderId")
    expect(source).toContain("next.add(selectedCustomProviderId)")
  })

  it("打开下拉会刷新一次倍率（控制台改完立刻能看到）", () => {
    expect(source).toContain("refreshBuiltinModels()")
  })
})

describe("formatModelRatio", () => {
  it("按控制台的两位小数展示并去掉末尾的 0", () => {
    expect(formatModelRatio(0.08)).toBe("0.08x")
    expect(formatModelRatio(0.06)).toBe("0.06x")
    expect(formatModelRatio(0.3)).toBe("0.3x")
    expect(formatModelRatio(1)).toBe("1x")
    expect(formatModelRatio(1.25)).toBe("1.25x")
  })

  it("没有倍率时不显示任何占位（自定义模型没有倍率）", () => {
    expect(formatModelRatio(undefined)).toBeNull()
    expect(formatModelRatio(null)).toBeNull()
    expect(formatModelRatio(Number.NaN)).toBeNull()
  })
})

describe("resolveModelRowDecoration", () => {
  it("内置模型带上倍率与时段规则名", () => {
    expect(resolveModelRowDecoration({
      id: "builtin-qmai-standard",
      name: "青幕标准版",
      model: "qmai-standard",
      createdAt: 0,
      rating: { ratio: 0.08, rule: "夜间折扣", syncedAt: 0 },
    })).toEqual({ ratio: "0.08x", rule: "夜间折扣" })
  })

  it("没有 rating 的自定义模型既不显示倍率也不显示规则", () => {
    expect(resolveModelRowDecoration({
      id: "model-1",
      name: "glm-5.3",
      model: "glm-5.3",
      createdAt: 0,
    })).toEqual({ ratio: null, rule: null })
  })
})

describe("modelRowMark", () => {
  it("中文取首字，英文取前两个字母并大写", () => {
    expect(modelRowMark("青幕标准版")).toBe("青")
    expect(modelRowMark("qmai-qwen-38f")).toBe("QM")
    expect(modelRowMark("  ")).toBe("?")
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
    // right = 800 - 400 - (320 - 128) = 208
    expect(style).toMatchObject({ top: 156, right: 208 })
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
    // 最小宽度 320：名称 + 优惠标签 + 倍率列并排不截断
    expect(style.width).toBe(320)
    expect(style.right).toBe(692 - 180 - (320 - 128))
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
