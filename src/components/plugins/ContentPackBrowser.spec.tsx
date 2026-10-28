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
  },
  {
    pluginId: "idea-generator",
    pluginName: "灵感生成器",
    pack: { id: "empty", title: "空包", items: [] },
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
  const loadItems = vi.fn(async (packId: string) => (packId === "empty" ? [] : items))
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
    expect(loadItems).toHaveBeenCalledWith("scifi")
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
