// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { FileNode } from "@/types/wiki"
import { OutlineFileTree } from "./outline-file-tree"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true

const tree: FileNode[] = [
  {
    name: "章纲",
    path: "C:/Book/wiki/outlines/章纲",
    is_dir: true,
    children: [
      {
        name: "章纲-第001章.md",
        path: "C:/Book/wiki/outlines/章纲/章纲-第001章.md",
        is_dir: false,
      },
    ],
  },
  {
    name: "大纲",
    path: "C:/Book/wiki/outlines/大纲",
    is_dir: true,
    children: [
      {
        name: "总纲.md",
        path: "C:/Book/wiki/outlines/大纲/总纲.md",
        is_dir: false,
      },
    ],
  },
]

describe("OutlineFileTree", () => {
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
  })

  it("渲染大纲目录并在点击 Markdown 文件时选中文件", async () => {
    const onSelectFile = vi.fn()
    const onMoveFile = vi.fn(async () => {})

    await act(async () => {
      root.render(
        <OutlineFileTree
          nodes={tree}
          selectedPath={null}
          onSelectFile={onSelectFile}
          onMoveFile={onMoveFile}
        />,
      )
    })

    expect(host.textContent).toContain("章纲")
    expect(host.textContent).toContain("大纲")

    const fileButton = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("章纲-第001章.md"),
    ) as HTMLButtonElement

    await act(async () => {
      fileButton.click()
    })

    expect(onSelectFile).toHaveBeenCalledWith("C:/Book/wiki/outlines/章纲/章纲-第001章.md")
    expect(host.querySelector("[data-testid='outline-file-context-menu']")).toBeNull()
    expect(host.querySelector("[data-testid='outline-move-submenu']")).toBeNull()
    expect(onMoveFile).not.toHaveBeenCalled()
  })

  it("右键 Markdown 文件只显示一级操作菜单，点击移动后才显示目标文件夹", async () => {
    const onMoveFile = vi.fn(async () => {})

    await act(async () => {
      root.render(
        <OutlineFileTree
          nodes={tree}
          selectedPath={null}
          onSelectFile={() => {}}
          onMoveFile={onMoveFile}
        />,
      )
    })

    const fileButton = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("章纲-第001章.md"),
    ) as HTMLButtonElement

    await act(async () => {
      fileButton.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }))
    })

    const menu = document.body.querySelector("[data-testid='outline-file-context-menu']")
    expect(menu).not.toBeNull()
    expect(menu?.textContent ?? "").toContain("重命名")
    expect(menu?.textContent ?? "").toContain("移动")
    expect(menu?.textContent ?? "").toContain("发送到AI大纲会话")
    expect(document.body.querySelector("[data-testid='outline-move-submenu']")).toBeNull()

    const moveButton = Array.from(menu?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent?.includes("移动"),
    ) as HTMLButtonElement

    await act(async () => {
      moveButton.click()
    })

    const moveMenu = document.body.querySelector("[data-testid='outline-move-submenu']")
    expect(moveMenu).not.toBeNull()
    expect(moveMenu?.textContent ?? "").toContain("大纲")

    const targetButton = Array.from(moveMenu?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent?.includes("大纲"),
    ) as HTMLButtonElement

    await act(async () => {
      targetButton.click()
    })

    expect(onMoveFile).toHaveBeenCalledWith(
      "C:/Book/wiki/outlines/章纲/章纲-第001章.md",
      "C:/Book/wiki/outlines/大纲",
    )
  })

  it("右键重命名后在文件行内编辑文件名并用回车提交", async () => {
    const onRenameFile = vi.fn(async () => {})

    await act(async () => {
      root.render(
        <OutlineFileTree
          nodes={tree}
          selectedPath={null}
          onSelectFile={() => {}}
          onMoveFile={async () => {}}
          onRenameFile={onRenameFile}
        />,
      )
    })

    const fileButton = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("章纲-第001章.md"),
    ) as HTMLButtonElement

    await act(async () => {
      fileButton.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }))
    })

    const menu = document.body.querySelector("[data-testid='outline-file-context-menu']")
    const renameButton = Array.from(menu?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent?.includes("重命名"),
    ) as HTMLButtonElement

    await act(async () => {
      renameButton.click()
    })

    const input = host.querySelector("[data-testid='outline-rename-input']") as HTMLInputElement
    expect(input).not.toBeNull()

    await act(async () => {
      input.value = "新章纲.md"
      input.dispatchEvent(new Event("input", { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    })

    expect(onRenameFile).toHaveBeenCalledWith(
      "C:/Book/wiki/outlines/章纲/章纲-第001章.md",
      "新章纲.md",
    )
  })

  it("右键发送到 AI 大纲会话时只传递文件引用", async () => {
    const onSendToOutlineChat = vi.fn()

    await act(async () => {
      root.render(
        <OutlineFileTree
          nodes={tree}
          selectedPath={null}
          onSelectFile={() => {}}
          onMoveFile={async () => {}}
          onSendToOutlineChat={onSendToOutlineChat}
        />,
      )
    })

    const fileButton = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("章纲-第001章.md"),
    ) as HTMLButtonElement

    await act(async () => {
      fileButton.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }))
    })

    const menu = document.body.querySelector("[data-testid='outline-file-context-menu']")
    const sendButton = Array.from(menu?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent?.includes("发送到AI大纲会话"),
    ) as HTMLButtonElement

    await act(async () => {
      sendButton.click()
    })

    expect(onSendToOutlineChat).toHaveBeenCalledWith(
      "C:/Book/wiki/outlines/章纲/章纲-第001章.md",
      "章纲-第001章.md",
    )
  })

  it("拖拽 Markdown 文件到任意文件夹时移动到该文件夹", async () => {
    const onMoveFile = vi.fn(async () => {})

    await act(async () => {
      root.render(
        <OutlineFileTree
          nodes={tree}
          selectedPath={null}
          onSelectFile={() => {}}
          onMoveFile={onMoveFile}
        />,
      )
    })

    const fileButton = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("章纲-第001章.md"),
    ) as HTMLButtonElement
    const folderButton = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("大纲"),
    ) as HTMLButtonElement

    await act(async () => {
      fileButton.dispatchEvent(new Event("dragstart", { bubbles: true }))
    })

    await act(async () => {
      folderButton.dispatchEvent(new Event("dragover", { bubbles: true }))
      folderButton.dispatchEvent(new Event("drop", { bubbles: true }))
    })

    expect(onMoveFile).toHaveBeenCalledWith(
      "C:/Book/wiki/outlines/章纲/章纲-第001章.md",
      "C:/Book/wiki/outlines/大纲",
    )
  })

  it("右键文件夹显示新建、重命名和删除操作", async () => {
    const onCreateFile = vi.fn()
    const onCreateFolder = vi.fn()
    const onRenameFolder = vi.fn()
    const onDeleteFolder = vi.fn()

    await act(async () => {
      root.render(
        <OutlineFileTree
          nodes={tree}
          selectedPath={null}
          onSelectFile={() => {}}
          onMoveFile={async () => {}}
          onCreateFile={onCreateFile}
          onCreateFolder={onCreateFolder}
          onRenameFolder={onRenameFolder}
          onDeleteFolder={onDeleteFolder}
        />,
      )
    })

    const folderButton = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("章纲"),
    ) as HTMLButtonElement

    await act(async () => {
      folderButton.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: 24,
        clientY: 36,
      }))
    })

    const menu = document.body.querySelector("[data-testid='outline-file-context-menu']")
    expect(menu).not.toBeNull()
    expect(menu?.textContent ?? "").toContain("新建文档")
    expect(menu?.textContent ?? "").toContain("新建文件夹")
    expect(menu?.textContent ?? "").toContain("重命名")
    expect(menu?.textContent ?? "").toContain("删除")
    expect(menu?.textContent ?? "").not.toContain("发送到AI大纲会话")

    const createFileButton = Array.from(menu?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent?.includes("新建文档"),
    ) as HTMLButtonElement
    await act(async () => {
      createFileButton.click()
    })
    expect(onCreateFile).toHaveBeenCalledWith("C:/Book/wiki/outlines/章纲")
  })
})
