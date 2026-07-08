// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { FileNode } from "@/types/wiki"
import { useWikiStore } from "@/stores/wiki-store"
import { useOutlineChatStore } from "@/stores/outline-chat-store"
import { OutlineFileTreePanel } from "./outline-file-tree-panel"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true

const { copyFileMock, createDirectoryMock, deleteFileMock, fileExistsMock, listDirectoryMock, writeFileMock } = vi.hoisted(() => ({
  copyFileMock: vi.fn(async () => undefined),
  createDirectoryMock: vi.fn(async () => undefined),
  deleteFileMock: vi.fn(async () => undefined),
  fileExistsMock: vi.fn(async () => false),
  listDirectoryMock: vi.fn(),
  writeFileMock: vi.fn(async () => undefined),
}))

vi.mock("@/commands/fs", () => ({
  createDirectory: createDirectoryMock,
  listDirectory: listDirectoryMock,
  copyFile: copyFileMock,
  deleteFile: deleteFileMock,
  fileExists: fileExistsMock,
  writeFile: writeFileMock,
}))

const outlineNodes: FileNode[] = [
  {
    name: "章纲",
    path: "C:/Book/wiki/outlines/章纲",
    is_dir: true,
    children: [
      {
        name: "1.md",
        path: "C:/Book/wiki/outlines/章纲/1.md",
        is_dir: false,
      },
    ],
  },
  {
    name: "大纲",
    path: "C:/Book/wiki/outlines/大纲",
    is_dir: true,
    children: [],
  },
]

describe("OutlineFileTreePanel", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    copyFileMock.mockClear()
    createDirectoryMock.mockClear()
    deleteFileMock.mockClear()
    fileExistsMock.mockClear()
    listDirectoryMock.mockClear()
    writeFileMock.mockClear()
    fileExistsMock.mockResolvedValue(false)
    listDirectoryMock.mockResolvedValue(outlineNodes)
    useWikiStore.setState({
      project: { id: "p1", name: "测试书", path: "C:/Book" },
      fileTree: [],
      selectedFile: null,
      fileContent: "",
      dataVersion: 0,
    })
    useOutlineChatStore.setState({
      conversations: [],
      activeConversationId: null,
      streamingContent: "",
      isStreaming: false,
      loaded: false,
      pendingReferenceTokens: [],
    })
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it("项目数据版本变化后刷新左侧大纲文件树", async () => {
    await act(async () => {
      root.render(<OutlineFileTreePanel showHeader={false} />)
    })
    await act(async () => {
      await Promise.resolve()
    })

    listDirectoryMock.mockClear()

    await act(async () => {
      useWikiStore.getState().bumpDataVersion()
      await Promise.resolve()
    })

    expect(listDirectoryMock).toHaveBeenCalledWith("C:/Book/wiki/outlines")
  })

  it("重命名大纲文件后刷新左侧树并更新选中文件", async () => {
    useWikiStore.setState({
      selectedFile: "C:/Book/wiki/outlines/章纲/1.md",
    })

    await act(async () => {
      root.render(<OutlineFileTreePanel showHeader={false} />)
    })
    await act(async () => {
      await Promise.resolve()
    })

    const fileButton = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("1.md"),
    ) as HTMLButtonElement

    await act(async () => {
      fileButton.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }))
    })

    const renameButton = Array.from(document.body.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("重命名"),
    ) as HTMLButtonElement

    await act(async () => {
      renameButton.click()
    })

    const input = host.querySelector("[data-testid='outline-rename-input']") as HTMLInputElement
    await act(async () => {
      input.value = "新文件.md"
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
      await Promise.resolve()
    })

    expect(copyFileMock).toHaveBeenCalledWith(
      "C:/Book/wiki/outlines/章纲/1.md",
      "C:/Book/wiki/outlines/章纲/新文件.md",
    )
    expect(deleteFileMock).toHaveBeenCalledWith("C:/Book/wiki/outlines/章纲/1.md")
    expect(useWikiStore.getState().selectedFile).toBe("C:/Book/wiki/outlines/章纲/新文件.md")
  })

  it("发送到 AI 大纲会话时只加入大纲文件引用", async () => {
    await act(async () => {
      root.render(<OutlineFileTreePanel showHeader={false} />)
    })
    await act(async () => {
      await Promise.resolve()
    })

    const fileButton = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("1.md"),
    ) as HTMLButtonElement

    await act(async () => {
      fileButton.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }))
    })

    const sendButton = Array.from(document.body.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("发送到AI大纲会话"),
    ) as HTMLButtonElement

    await act(async () => {
      sendButton.click()
    })

    expect(useOutlineChatStore.getState().pendingReferenceTokens).toEqual([
      {
        id: "outline:C:/Book/wiki/outlines/章纲/1.md",
        category: "outline",
        title: "1.md",
        path: "C:/Book/wiki/outlines/章纲/1.md",
        displayTitle: "1.md",
      },
    ])
  })

  it("加载时迁移旧的带文件夹后缀目录到新目录", async () => {
    const migratedNodes: FileNode[] = [
      {
        name: "人物小传文件夹",
        path: "C:/Book/wiki/outlines/人物小传文件夹",
        is_dir: true,
        children: [{
          name: "角色-男主-林辰.md",
          path: "C:/Book/wiki/outlines/人物小传文件夹/角色-男主-林辰.md",
          is_dir: false,
        }],
      },
      {
        name: "人物小传",
        path: "C:/Book/wiki/outlines/人物小传",
        is_dir: true,
        children: [],
      },
    ]
    listDirectoryMock.mockResolvedValue(migratedNodes)
    fileExistsMock.mockResolvedValue(false)

    await act(async () => {
      root.render(<OutlineFileTreePanel showHeader={false} />)
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(copyFileMock).toHaveBeenCalledWith(
      "C:/Book/wiki/outlines/人物小传文件夹/角色-男主-林辰.md",
      "C:/Book/wiki/outlines/人物小传/角色-男主-林辰.md",
    )
    expect(deleteFileMock).toHaveBeenCalledWith("C:/Book/wiki/outlines/人物小传文件夹/角色-男主-林辰.md")
    expect(deleteFileMock).toHaveBeenCalledWith("C:/Book/wiki/outlines/人物小传文件夹")
  })

  it("迁移旧设定目录时合并同名默认子目录，不生成带序号的重复文件夹", async () => {
    const migratedNodes: FileNode[] = [
      {
        name: "设定文件夹",
        path: "C:/Book/wiki/outlines/设定文件夹",
        is_dir: true,
        children: [
          {
            name: "世界观",
            path: "C:/Book/wiki/outlines/设定文件夹/世界观",
            is_dir: true,
            children: [
              {
                name: "规则.md",
                path: "C:/Book/wiki/outlines/设定文件夹/世界观/规则.md",
                is_dir: false,
              },
            ],
          },
        ],
      },
      {
        name: "设定",
        path: "C:/Book/wiki/outlines/设定",
        is_dir: true,
        children: [
          {
            name: "世界观",
            path: "C:/Book/wiki/outlines/设定/世界观",
            is_dir: true,
            children: [],
          },
        ],
      },
    ]
    listDirectoryMock.mockResolvedValue(migratedNodes)
    fileExistsMock.mockImplementation(async (path?: unknown) => path === "C:/Book/wiki/outlines/设定/世界观")

    await act(async () => {
      root.render(<OutlineFileTreePanel showHeader={false} />)
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(copyFileMock).toHaveBeenCalledWith(
      "C:/Book/wiki/outlines/设定文件夹/世界观/规则.md",
      "C:/Book/wiki/outlines/设定/世界观/规则.md",
    )
    expect(copyFileMock).not.toHaveBeenCalledWith(
      "C:/Book/wiki/outlines/设定文件夹/世界观/规则.md",
      "C:/Book/wiki/outlines/设定/世界观-2/规则.md",
    )
    expect(deleteFileMock).toHaveBeenCalledWith("C:/Book/wiki/outlines/设定文件夹/世界观")
    expect(deleteFileMock).toHaveBeenCalledWith("C:/Book/wiki/outlines/设定文件夹")
  })

  it("加载时清理设定下带序号的重复默认子目录", async () => {
    const duplicatedNodes: FileNode[] = [
      {
        name: "设定",
        path: "C:/Book/wiki/outlines/设定",
        is_dir: true,
        children: [
          {
            name: "世界观",
            path: "C:/Book/wiki/outlines/设定/世界观",
            is_dir: true,
            children: [],
          },
          {
            name: "世界观-2",
            path: "C:/Book/wiki/outlines/设定/世界观-2",
            is_dir: true,
            children: [
              {
                name: "规则.md",
                path: "C:/Book/wiki/outlines/设定/世界观-2/规则.md",
                is_dir: false,
              },
            ],
          },
        ],
      },
    ]
    listDirectoryMock.mockResolvedValue(duplicatedNodes)
    fileExistsMock.mockResolvedValue(false)

    await act(async () => {
      root.render(<OutlineFileTreePanel showHeader={false} />)
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(copyFileMock).toHaveBeenCalledWith(
      "C:/Book/wiki/outlines/设定/世界观-2/规则.md",
      "C:/Book/wiki/outlines/设定/世界观/规则.md",
    )
    expect(deleteFileMock).toHaveBeenCalledWith("C:/Book/wiki/outlines/设定/世界观-2/规则.md")
    expect(deleteFileMock).toHaveBeenCalledWith("C:/Book/wiki/outlines/设定/世界观-2")
  })

  it("加载时将设定下的伏笔目录合并到顶层伏笔并删除嵌套目录", async () => {
    const duplicatedForeshadowingNodes: FileNode[] = [
      {
        name: "伏笔",
        path: "C:/Book/wiki/outlines/伏笔",
        is_dir: true,
        children: [],
      },
      {
        name: "设定",
        path: "C:/Book/wiki/outlines/设定",
        is_dir: true,
        children: [
          {
            name: "伏笔",
            path: "C:/Book/wiki/outlines/设定/伏笔",
            is_dir: true,
            children: [
              {
                name: "主线伏笔.md",
                path: "C:/Book/wiki/outlines/设定/伏笔/主线伏笔.md",
                is_dir: false,
              },
            ],
          },
        ],
      },
    ]
    listDirectoryMock.mockResolvedValue(duplicatedForeshadowingNodes)
    fileExistsMock.mockResolvedValue(false)

    await act(async () => {
      root.render(<OutlineFileTreePanel showHeader={false} />)
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(createDirectoryMock).not.toHaveBeenCalledWith("C:/Book/wiki/outlines/设定/伏笔")
    expect(copyFileMock).toHaveBeenCalledWith(
      "C:/Book/wiki/outlines/设定/伏笔/主线伏笔.md",
      "C:/Book/wiki/outlines/伏笔/主线伏笔.md",
    )
    expect(deleteFileMock).toHaveBeenCalledWith("C:/Book/wiki/outlines/设定/伏笔/主线伏笔.md")
    expect(deleteFileMock).toHaveBeenCalledWith("C:/Book/wiki/outlines/设定/伏笔")
  })

  it("右键文件夹后可新建文档、新建文件夹和删除文件夹", async () => {
    const promptSpy = vi.spyOn(window, "prompt")
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true)

    await act(async () => {
      root.render(<OutlineFileTreePanel showHeader={false} />)
    })
    await act(async () => {
      await Promise.resolve()
    })

    const folderButton = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("大纲"),
    ) as HTMLButtonElement

    promptSpy.mockReturnValueOnce("新文档")
    await act(async () => {
      folderButton.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }))
    })
    let createFileButton = Array.from(document.body.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("新建文档"),
    ) as HTMLButtonElement
    await act(async () => {
      createFileButton.click()
      await Promise.resolve()
    })
    expect(writeFileMock).toHaveBeenCalledWith(
      "C:/Book/wiki/outlines/大纲/新文档.md",
      "# 新文档\n\n",
    )

    promptSpy.mockReturnValueOnce("子目录")
    await act(async () => {
      folderButton.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }))
    })
    const createFolderButton = Array.from(document.body.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("新建文件夹"),
    ) as HTMLButtonElement
    await act(async () => {
      createFolderButton.click()
      await Promise.resolve()
    })
    expect(createDirectoryMock).toHaveBeenCalledWith("C:/Book/wiki/outlines/大纲/子目录")

    await act(async () => {
      folderButton.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }))
    })
    const deleteButton = Array.from(document.body.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("删除"),
    ) as HTMLButtonElement
    await act(async () => {
      deleteButton.click()
      await Promise.resolve()
    })
    expect(confirmSpy).toHaveBeenCalled()
    expect(deleteFileMock).toHaveBeenCalledWith("C:/Book/wiki/outlines/大纲")

    promptSpy.mockRestore()
    confirmSpy.mockRestore()
  })
})
