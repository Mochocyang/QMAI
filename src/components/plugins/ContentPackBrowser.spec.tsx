// @vitest-environment jsdom
/**
 * ContentPackBrowser 测试。
 *
 * 灵感库是"用户真会天天用"的面板：5000 条里搜不到东西就等于没有这个功能。
 * 因此观察点三个：搜索生效、标签筛选生效、空状态说人话。
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ContentPackItem } from "@/lib/plugins/declarative/types"
import type { SlotPackEntry } from "@/lib/plugins/slots"
import { ContentPackBrowser, resolvePackActions, toggleTagFilter } from "./ContentPackBrowser"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const items: ContentPackItem[] = [
  { id: "i1", title: "最后一班地铁", body: "末班车只有七个人，其中六个没有影子。", tags: ["都市", "悬疑"] },
  { id: "i2", title: "锈蚀的卫星", body: "它在轨道上睡着了六十年。", tags: ["科幻"] },
  { id: "i3", title: "雨夜来信", body: "信封里只有一张空白纸。", tags: ["悬疑"] },
]

const packs: SlotPackEntry[] = [
  {
    pluginId: "idea-generator",
    pluginName: "灵感生成器",
    pack: { id: "scifi", title: "科幻灵感包", items: [], actions: [{ kind: "clipboard", label: "复制" }] },
    loadKey: "idea-generator/scifi",
  },
  {
    pluginId: "idea-generator",
    pluginName: "灵感生成器",
    pack: { id: "empty", title: "空包", items: [] },
    loadKey: "idea-generator/empty",
  },
]

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ""
})

async function render(props: Partial<Parameters<typeof ContentPackBrowser>[0]> = {}) {
  // loadItems 收到的是 loadKey（合成键），不是包内 id
  const loadItems = vi.fn(async (loadKey: string) => (loadKey === "idea-generator/empty" ? [] : items))
  const onUse = vi.fn(async () => {})
  await act(async () => {
    root.render(<ContentPackBrowser packs={packs} loadItems={loadItems} onUse={onUse} {...props} />)
  })
  await flush()
  return { loadItems, onUse }
}

function setSearch(value: string) {
  const input = host.querySelector<HTMLInputElement>('[data-content-search="true"]')!
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function visibleItemIds(): string[] {
  return [...host.querySelectorAll("[data-content-item]")].map((node) => node.getAttribute("data-content-item") ?? "")
}

/** 把挂起的 promise 链（loadItems → setState → 再渲染）跑干净。 */
async function flush(times = 4) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

describe("ContentPackBrowser", () => {
  it("默认展示第一个包的全部条目，并列出所有包的入口", async () => {
    const { loadItems } = await render()
    expect(loadItems).toHaveBeenCalledWith("idea-generator/scifi")
    expect(visibleItemIds()).toEqual(["i1", "i2", "i3"])
    expect(host.textContent).toContain("科幻灵感包")
    expect(host.textContent).toContain("空包")
  })

  it("搜索标题生效", async () => {
    await render()
    setSearch("卫星")
    expect(visibleItemIds()).toEqual(["i2"])
    expect(host.textContent).toContain("1 / 3 条")
  })

  it("搜索正文也生效（不只是标题）", async () => {
    await render()
    setSearch("空白纸")
    expect(visibleItemIds()).toEqual(["i3"])
  })

  it("标签筛选生效，再次点击可取消", async () => {
    await render()
    const tagButton = [...host.querySelectorAll('[data-content-tags="true"] button')].find((node) =>
      node.textContent?.includes("悬疑"),
    ) as HTMLButtonElement

    act(() => tagButton.click())
    expect(visibleItemIds()).toEqual(["i1", "i3"])

    act(() => tagButton.click())
    expect(visibleItemIds()).toEqual(["i1", "i2", "i3"])
  })

  it("搜索 + 标签同时生效", async () => {
    await render()
    setSearch("地铁")
    const tagButton = [...host.querySelectorAll('[data-content-tags="true"] button')].find((node) =>
      node.textContent?.includes("科幻"),
    ) as HTMLButtonElement
    act(() => tagButton.click())
    // 关键词命中 i1，但标签要求"科幻" → 交集为空
    expect(visibleItemIds()).toEqual([])
    expect(host.textContent).toContain("没有匹配的条目")
  })

  it("空包显示「这个灵感包还没有内容」", async () => {
    await render()
    const emptyPackButton = [...host.querySelectorAll('[role="tab"]')].find((node) =>
      node.textContent?.includes("空包"),
    ) as HTMLButtonElement

    await act(async () => emptyPackButton.click())
    await flush()

    expect(host.querySelector('[data-content-browser="empty-items"]')).not.toBeNull()
    expect(host.textContent).toContain("这个灵感包还没有内容")
  })

  it("没有任何内容包时给出可读的空状态", async () => {
    await act(async () => {
      root.render(<ContentPackBrowser packs={[]} loadItems={async () => []} onUse={async () => {}} />)
    })
    expect(host.querySelector('[data-content-browser="empty-packs"]')).not.toBeNull()
  })

  it("点击条目操作会把条目与目标交给宿主", async () => {
    const { onUse } = await render()
    const copyButton = [...host.querySelectorAll("button")].find((node) => node.textContent === "复制")!
    await act(async () => copyButton.click())
    expect(onUse).toHaveBeenCalledWith(items[0], expect.objectContaining({ kind: "clipboard" }))
  })
})

describe("run-action（链式调用保护）", () => {
  const runActionPacks: SlotPackEntry[] = [
    {
      pluginId: "idea-generator",
      pluginName: "灵感生成器",
      loadKey: "idea-generator/scifi",
      pack: {
        id: "scifi",
        title: "科幻灵感包",
        items: [],
        actions: [{ kind: "run-action", actionId: "expand", label: "让 AI 扩写" }],
      },
    },
  ]

  async function renderWithActions(actions: Parameters<typeof ContentPackBrowser>[0]["actions"]) {
    await act(async () => {
      root.render(
        <ContentPackBrowser
          packs={runActionPacks}
          loadItems={async () => items}
          onUse={async () => {}}
          actions={actions}
          deps={{ llm: { call: async () => ({ text: "扩写结果" }) }, getConfig: async () => ({}) }}
          onApplyTarget={async () => {}}
        />,
      )
    })
    await flush()
  }

  it("同插件的 run-action 打开该 action 的对话框", async () => {
    await renderWithActions([
      {
        pluginId: "idea-generator",
        pluginName: "灵感生成器",
        action: { id: "expand", title: "扩写灵感", prompt: { system: "", user: "" }, output: { mode: "text", targets: [] } },
      },
    ])

    const runButton = [...host.querySelectorAll("button")].find((node) => node.textContent === "让 AI 扩写")!
    await act(async () => runButton.click())
    await flush()

    expect(document.body.textContent).toContain("扩写灵感")
  })

  it("跨插件的 run-action 被拒绝并给出可读原因", async () => {
    await renderWithActions([
      {
        pluginId: "other-plugin",
        pluginName: "别的插件",
        action: { id: "expand", title: "扩写灵感", prompt: { system: "", user: "" }, output: { mode: "text", targets: [] } },
      },
    ])

    const runButton = [...host.querySelectorAll("button")].find((node) => node.textContent === "让 AI 扩写")!
    await act(async () => runButton.click())
    await flush()

    expect(host.textContent).toContain("找不到动作")
    // 跨插件时不该打开那个别的插件的对话框
    expect(document.body.querySelector("[data-plugin-action-dialog]")).toBeNull()
  })

  it("缺 actionId 的 run-action 给出可读原因（不是静默死按钮）", async () => {
    await act(async () => {
      root.render(
        <ContentPackBrowser
          packs={[
            {
              pluginId: "idea-generator",
              pluginName: "灵感生成器",
              loadKey: "idea-generator/scifi",
              pack: {
                id: "scifi",
                title: "科幻灵感包",
                items: [],
                actions: [{ kind: "run-action", label: "让 AI 扩写" }],
              },
            },
          ]}
          loadItems={async () => items}
          onUse={async () => {}}
        />,
      )
    })
    await flush()

    const runButton = [...host.querySelectorAll("button")].find((node) => node.textContent === "让 AI 扩写")!
    expect(runButton.title).toContain("没有指定要执行的 action")
    await act(async () => runButton.click())
    await flush()
    expect(host.textContent).toContain("没有指定要执行的 action")
  })
})

describe("内容包操作（纯函数）", () => {
  it("没声明操作时给「插入正文 + 复制」兜底", () => {
    const actions = resolvePackActions({ id: "p", title: "包", items: [] })
    expect(actions.map((action) => action.kind)).toEqual(["insert-at-cursor", "clipboard"])
  })

  it("toggleTagFilter 开关标签", () => {
    expect(toggleTagFilter([], "悬疑")).toEqual(["悬疑"])
    expect(toggleTagFilter(["悬疑", "科幻"], "悬疑")).toEqual(["科幻"])
  })
})
