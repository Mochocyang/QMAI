// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { EditorContextMenu } from "./editor-context-menu"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function renderMenu(props: Parameters<typeof EditorContextMenu>[0]) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(<EditorContextMenu {...props} />) })
  const labels = [...container.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent)
  return {
    container,
    labels,
    cleanup: () => { act(() => root.unmount()); document.body.removeChild(container) },
  }
}

describe("EditorContextMenu", () => {
  it("不传 actions 时是默认菜单，且默认菜单里没有「续写」", () => {
    const { labels, cleanup } = renderMenu({ position: { x: 0, y: 0 }, onAction: vi.fn(), onClose: vi.fn() })
    expect(labels).toEqual(["撤销", "重做", "复制", "剪切", "粘贴", "全选", "查找", "替换"])
    expect(labels).not.toContain("续写")
    cleanup()
  })

  it("显式传 actions 时按给定顺序渲染，「续写」可以排第一", () => {
    const { labels, cleanup } = renderMenu({
      position: { x: 0, y: 0 },
      actions: ["continue", "undo"],
      onAction: vi.fn(),
      onClose: vi.fn(),
    })
    expect(labels).toEqual(["续写", "撤销"])
    cleanup()
  })

  it("点击「续写」回调收到 continue 并关闭菜单", () => {
    const onAction = vi.fn()
    const onClose = vi.fn()
    const { container, cleanup } = renderMenu({
      position: { x: 0, y: 0 },
      actions: ["continue", "undo"],
      onAction,
      onClose,
    })
    const button = container.querySelector<HTMLButtonElement>('[role="menuitem"]')!
    act(() => { button.click() })
    expect(onAction).toHaveBeenCalledWith("continue")
    expect(onClose).toHaveBeenCalled()
    cleanup()
  })
})
