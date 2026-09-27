// @vitest-environment jsdom

import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WikiProject } from "@/types/wiki"

const mocks = vi.hoisted(() => ({
  uiTest: true,
  getExecutableDir: vi.fn(),
  listDirectory: vi.fn(),
  openProject: vi.fn(),
  readFile: vi.fn(),
  getRecentProjects: vi.fn(),
  loadRegisteredProjects: vi.fn(),
  fileExists: vi.fn(),
  createProject: vi.fn(),
  createDirectory: vi.fn(),
  writeFile: vi.fn(),
  pickDirectory: vi.fn(),
  setOutputLanguage: vi.fn(),
  saveOutputLanguage: vi.fn(),
}))

vi.mock("@/lib/ui-test", () => ({
  get IS_UI_TEST_BUILD() { return mocks.uiTest },
  UI_TEST_STORAGE_PREFIX: "qm-uitest-",
}))
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => `asset://${path}` }))
vi.mock("@/commands/fs", () => ({
  getExecutableDir: mocks.getExecutableDir,
  listDirectory: mocks.listDirectory,
  openProject: mocks.openProject,
  readFile: mocks.readFile,
  createProject: mocks.createProject,
  createDirectory: mocks.createDirectory,
  writeFile: mocks.writeFile,
  fileExists: mocks.fileExists,
  openProjectFolder: vi.fn(),
  renameProject: vi.fn(),
  moveProjectToSystemTrash: vi.fn(),
  saveProjectCover: vi.fn(),
}))
vi.mock("@/lib/project-store", () => ({
  getRecentProjects: mocks.getRecentProjects,
  loadRegisteredProjects: mocks.loadRegisteredProjects,
  removeProjectRecords: vi.fn(),
  saveOutputLanguage: mocks.saveOutputLanguage,
}))
vi.mock("@/lib/platform", () => ({ pickDirectory: mocks.pickDirectory }))
vi.mock("@/lib/templates", () => ({
  getTemplate: () => ({ schema: "原有结构", purpose: "原有用途", extraDirs: ["wiki/outlines"] }),
}))
vi.mock("@/stores/wiki-store", () => ({
  useWikiStore: (select: (state: { setOutputLanguage: typeof mocks.setOutputLanguage }) => unknown) =>
    select({ setOutputLanguage: mocks.setOutputLanguage }),
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => ({
    "project.createTitle": "创建项目",
    "project.name": "项目名称",
    "project.namePlaceholder": "输入项目名称",
    "project.parentDir": "父目录",
    "project.parentDirPlaceholder": "选择父目录",
    "project.cancel": "取消",
    "project.create": "创建",
    "project.creating": "创建中",
    "project.errorNameRequired": "请输入名称",
  } as Record<string, string>)[key] ?? key }),
}))

import { moveProjectToSystemTrash } from "@/commands/fs"
import { removeProjectRecords } from "@/lib/project-store"
import { UiTestShelf } from "./ui-test-shelf"
import { CreateProjectDialog } from "@/components/project/create-project-dialog"

const project: WikiProject = { id: "novel-1", name: "真实小说", path: "C:/已打开的小说/真实小说" }
let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.resetAllMocks()
  mocks.uiTest = true
  localStorage.clear()
  mocks.getExecutableDir.mockResolvedValue("C:/QMAI")
  mocks.fileExists.mockResolvedValue(false)
  mocks.getRecentProjects.mockResolvedValue([project])
  mocks.loadRegisteredProjects.mockResolvedValue([])
  mocks.listDirectory.mockImplementation(async (path: string) => path.endsWith("/wiki/chapters")
    ? [{ name: "第一章.md", path: `${path}/第一章.md`, is_dir: false }]
    : [])
  mocks.readFile.mockImplementation(async (path: string) => path.endsWith("/.qmai/project.json")
    ? JSON.stringify({ id: "novel-1", createdAt: Date.parse("2026-09-24T10:30:00") })
    : "---\ntitle: 第一章\n---\n# 第一章\n甲乙\n\n丙丁")
  mocks.createProject.mockResolvedValue(project)
  mocks.createDirectory.mockResolvedValue(undefined)
  mocks.writeFile.mockResolvedValue(undefined)
  mocks.saveOutputLanguage.mockResolvedValue(undefined)
  mocks.pickDirectory.mockResolvedValue(null)
  host = document.createElement("div")
  host.className = "ui-test-root"
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

function button(text: string, container: ParentNode = host): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll("button")).find((node) => node.textContent?.trim() === text || node.getAttribute("aria-label") === text)
  expect(found, `应有“${text}”按钮`).toBeDefined()
  return found!
}

async function renderShelf(onSelectProject = vi.fn()) {
  const onCreateProject = vi.fn()
  const onOpenProject = vi.fn()
  await act(async () => root.render(<UiTestShelf
    onCreateProject={onCreateProject}
    onOpenProject={onOpenProject}
    onSelectProject={onSelectProject}
  />))
  return { onCreateProject, onOpenProject, onSelectProject }
}

async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

describe("独立 UI 书架", () => {
  it("封面下显示书名和累计字数，不显示日期时间", async () => {
    await renderShelf()
    const card = host.querySelector(".ui-test-book-card")!
    expect(card.textContent).toContain("真实小说")
    expect(card.textContent).toContain("4 字")
    expect(card.textContent).not.toContain("2026")
    expect(card.querySelector("time")).toBeNull()
  })

  it("身份文件读取失败时显示0字，不回退到日期", async () => {
    mocks.readFile.mockRejectedValue(new Error("拒绝读取"))
    await renderShelf()
    const card = host.querySelector(".ui-test-book-card")!
    expect(card.textContent).toContain("0 字")
    expect(card.textContent).not.toContain("2026")
    expect(card.querySelector("time")).toBeNull()
  })

  it("读取完整独立书库而不是最近十条", async () => {
    const projects = Array.from({ length: 15 }, (_, n) => ({ id: `book-${n}`, name: `小说${n}`, path: `C:/登记目录/${n}` }))
    localStorage.setItem("qm-uitest-library", JSON.stringify({ schemaVersion: 1, projects }))
    mocks.getRecentProjects.mockResolvedValue(projects.slice(5))
    await renderShelf()
    expect(host.querySelectorAll(".ui-test-book-card")).toHaveLength(15)
    expect(host.textContent).toContain("小说0")
  })

  it("只读发现默认小说目录，不调用会迁移或登记正式配置的打开函数", async () => {
    mocks.getRecentProjects.mockResolvedValue([])
    mocks.fileExists.mockResolvedValue(true)
    mocks.listDirectory.mockImplementation(async (path: string) => path.replace(/\\/g, "/") === "C:/QM-BOOK"
      ? [
        { name: "默认小说", path: "C:/QM-BOOK/默认小说", is_dir: true },
        { name: "外部目录", path: "D:/其他目录", is_dir: true },
      ]
      : [])
    mocks.readFile.mockResolvedValue(JSON.stringify({ id: "existing-id" }))
    mocks.openProject.mockResolvedValue({ id: "existing-id", name: "默认小说", path: "C:/QM-BOOK/默认小说" })
    await renderShelf()
    expect(mocks.openProject).not.toHaveBeenCalled()
    expect(mocks.writeFile).not.toHaveBeenCalled()
    expect(mocks.listDirectory).toHaveBeenCalledWith(expect.stringMatching(/C:[\\/]QM-BOOK$/), { maxDepth: 1 })
    expect(mocks.readFile).toHaveBeenCalledWith("C:/QM-BOOK/默认小说/.qmai/project.json")
    expect(mocks.readFile.mock.calls.some(([path]) => String(path).startsWith("D:"))).toBe(false)
    expect(host.querySelectorAll(".ui-test-book-card")).toHaveLength(1)
  })

  it("默认目录不存在时仍显示已登记的历史小说", async () => {
    const historical = { id: "old-1", name: "历史小说", path: "D:/QM-BOOK/历史小说" }
    const recentOnly = { id: "recent-1", name: "最近小说", path: "E:/作品/最近小说" }
    mocks.getRecentProjects.mockResolvedValue([recentOnly])
    mocks.loadRegisteredProjects.mockResolvedValue([historical])
    mocks.fileExists.mockResolvedValue(false)
    await renderShelf()
    expect(host.textContent).toContain("历史小说")
    expect(host.textContent).toContain("最近小说")
    expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(mocks.listDirectory.mock.calls.some(([path]) => String(path).replace(/\\/g, "/").toLowerCase() === "c:/qm-book")).toBe(false)
  })

  it("标题去书名号仅用于展示，键盘聚焦可看全名，开书仍传原项目", async () => {
    const fullName = "一个合法的很长小说标题".repeat(8)
    const longProject = { ...project, name: `《${fullName}》` }
    mocks.getRecentProjects.mockResolvedValue([longProject])
    const actions = await renderShelf()
    const title = host.querySelector('[role="heading"][aria-level="2"]')
    expect(title?.textContent).toBe(fullName)
    const card = host.querySelector<HTMLButtonElement>(".ui-test-book-card")!
    expect(card.getAttribute("aria-label")).toBe(`打开小说：${fullName}`)
    expect(host.querySelector("button button")).toBeNull()
    await act(async () => {
      card.focus()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(document.body.querySelector('[data-slot="tooltip-content"]')?.textContent).toContain(fullName)
    await act(async () => card.click())
    expect(actions.onSelectProject).toHaveBeenCalledWith(longProject)
  })

  it("章节目录不可读时仍保留书卡并显示字数不可用", async () => {
    mocks.listDirectory.mockImplementation(async (path: string) => {
      if (path.endsWith("/wiki/chapters")) throw new Error("目录无读取权限")
      return []
    })
    await renderShelf()
    expect(host.querySelectorAll(".ui-test-book-card")).toHaveLength(1)
    expect(host.querySelector(".ui-test-book-card")?.textContent).toContain("字数不可用")
    expect(host.querySelector(".ui-test-book-card")?.textContent).not.toContain("2026")
  })

  it("单章读取失败时仍累计其余章节字数", async () => {
    mocks.listDirectory.mockImplementation(async (path: string) => path.endsWith("/wiki/chapters")
      ? [1, 2].map((n) => ({ name: `第${n}章.md`, path: `${path}/第${n}章.md`, is_dir: false }))
      : [])
    mocks.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith("/.qmai/project.json")) return JSON.stringify({ id: "novel-1", createdAt: Date.parse("2026-09-24T10:30:00") })
      if (path.endsWith("第2章.md")) throw new Error("第二章读取失败")
      return "# 第一章\n甲乙丙丁"
    })
    await renderShelf()
    expect(host.querySelector(".ui-test-book-card")?.textContent).toContain("4 字")
    expect(host.querySelector(".ui-test-book-card")?.textContent).not.toContain("2026")
  })

  it("索引损坏给出中文提醒，不覆盖原文，也不藏起仍可读取的项目", async () => {
    const raw = "{损坏的原始索引"
    localStorage.setItem("qm-uitest-library", raw)
    await renderShelf()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("书架索引读取失败")
    expect(host.querySelectorAll(".ui-test-book-card")).toHaveLength(1)
    expect(localStorage.getItem("qm-uitest-library")).toBe(raw)
  })

  it("最近记录损坏不会使独立完整书库消失", async () => {
    localStorage.setItem("qm-uitest-library", JSON.stringify({ schemaVersion: 1, projects: [project] }))
    mocks.getRecentProjects.mockResolvedValue([{ name: "旧记录缺少身份" }])
    await renderShelf()
    expect(host.querySelectorAll(".ui-test-book-card")).toHaveLength(1)
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("最近记录暂不可读")
    expect(JSON.parse(localStorage.getItem("qm-uitest-library")!).projects).toEqual([project])
  })

  it("关闭测试标记后仍显示已登记小说", async () => {
    mocks.uiTest = false
    mocks.getRecentProjects.mockResolvedValue([])
    mocks.loadRegisteredProjects.mockResolvedValue([project])
    await renderShelf()
    expect(host.querySelectorAll(".ui-test-book-card")).toHaveLength(1)
    expect(host.textContent).toContain("真实小说")
    expect(mocks.loadRegisteredProjects).toHaveBeenCalled()
  })

  it("目录已不存在时删除只清书架记录，不调用系统回收站", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true)
    await renderShelf()
    const card = host.querySelector<HTMLButtonElement>(".ui-test-book-card")!
    await act(async () => card.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 30 })))
    await act(async () => button("删除").click())
    expect(window.confirm).toHaveBeenCalledWith("“真实小说”的目录已经不存在，确定从书架移除？")
    expect(moveProjectToSystemTrash).not.toHaveBeenCalled()
    expect(removeProjectRecords).toHaveBeenCalledWith(project.path)
    expect(host.querySelectorAll(".ui-test-book-card")).toHaveLength(0)
    expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(JSON.parse(localStorage.getItem("qm-uitest-library")!).projects).toEqual([])
  })

  it("目录仍在时删除仍移入系统回收站", async () => {
    mocks.fileExists.mockImplementation(async (path: string) => path === project.path)
    vi.spyOn(window, "confirm").mockReturnValue(true)
    await renderShelf()
    const card = host.querySelector<HTMLButtonElement>(".ui-test-book-card")!
    await act(async () => card.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 30 })))
    await act(async () => button("删除").click())
    expect(window.confirm).toHaveBeenCalledWith("确定将“真实小说”移入系统回收站？")
    expect(moveProjectToSystemTrash).toHaveBeenCalledWith(project.path)
    expect(removeProjectRecords).toHaveBeenCalledWith(project.path)
    expect(host.querySelectorAll(".ui-test-book-card")).toHaveLength(0)
  })

  it("右键菜单提供重命名、打开文件夹和删除", async () => {
    await renderShelf()
    const card = host.querySelector<HTMLButtonElement>(".ui-test-book-card")!
    await act(async () => card.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 30 })))
    const labels = Array.from(host.querySelectorAll(".ui-test-shelf-menu button")).map((button) => button.textContent)
    expect(labels).toEqual(["重命名", "打开文件夹", "删除"])
    expect(labels).not.toContain("上传封面")
    expect(host.textContent).not.toContain("刷新")
    expect(host.textContent).not.toContain("另存")
    expect(host.textContent).not.toContain("打印")
    expect(host.textContent).not.toContain("更多工具")
  })

  it("书架头部两个动作仍调用原回调", async () => {
    const actions = await renderShelf()
    await act(async () => button("打开已有").click())
    await act(async () => button("新建小说").click())
    expect(actions.onOpenProject).toHaveBeenCalledOnce()
    expect(actions.onCreateProject).toHaveBeenCalledOnce()
  })

  it("不显示书架顶部介绍，封面可在大中小之间切换并记住", async () => {
    await renderShelf()
    expect(host.textContent).not.toContain("每个故事，都有自己的位置。")
    expect(host.textContent).not.toContain("你的私人书架")
    expect(host.textContent).not.toContain("不必从头寻找")
    expect(host.textContent).not.toContain("全部小说")
    expect(host.textContent).not.toContain("找一本书")
    expect(host.textContent).not.toContain("点击书封，直接继续上次的创作")
    const actions = Array.from(host.querySelectorAll(".ui-test-shelf-actions button")).map((item) => item.textContent)
    expect(actions[0]).toContain("新建小说")
    expect(actions[1]).toContain("打开已有")
    const grid = host.querySelector(".ui-test-books-grid")!
    expect(grid.className).toContain("is-medium")
    await act(async () => button("大封面").click())
    expect(grid.className).toContain("is-large")
    expect(button("大封面").getAttribute("aria-pressed")).toBe("true")
    expect(button("大封面").querySelector("svg")).not.toBeNull()
    expect(localStorage.getItem("qm-uitest-shelf-cover-size-v1")).toBe("large")
    await act(async () => button("小封面").click())
    expect(grid.className).toContain("is-small")
  })

  it("封面八色取自参考图，筛选后同一本书不换色", async () => {
    const projects = Array.from({ length: 8 }, (_, n) => ({ id: `color-${n}`, name: `配色小说${n}`, path: `C:/书/${n}` }))
    mocks.getRecentProjects.mockResolvedValue(projects)
    await renderShelf()
    const backgrounds = Array.from(host.querySelectorAll<HTMLElement>(".ui-test-cover")).map((cover) => cover.style.backgroundColor)
    expect(new Set(backgrounds).size).toBe(8)
    expect(backgrounds[7]).not.toBe(backgrounds[0])
  })
})

describe("书架新建小说弹窗", () => {
  it("测试版提供两主字段、目录选择和创建并写大纲，保留原创建链", async () => {
    const onCreated = vi.fn()
    const onOpenChange = vi.fn()
    await act(async () => root.render(<CreateProjectDialog open onOpenChange={onOpenChange} onCreated={onCreated} />))
    const dialog = document.body.querySelector<HTMLElement>('[data-ui-test-dialog="create-project"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.textContent).toContain("让一个新故事开始")
    expect(dialog?.querySelectorAll("label")).toHaveLength(2)
    expect(dialog?.querySelector('[aria-label="关闭新建小说"]')).not.toBeNull()
    expect(button("创建并写大纲", dialog!).disabled).toBe(true)
    const name = dialog!.querySelector<HTMLInputElement>("input")!
    expect(name.id).toBe(dialog!.querySelector("label")!.htmlFor)
    await typeInto(name, "  用户小说  ")
    mocks.pickDirectory.mockResolvedValue("D:/用户指定目录")
    await act(async () => button("选择目录", dialog!).click())
    expect(dialog!.textContent).toContain("D:/用户指定目录")
    await act(async () => dialog!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
    expect(mocks.createDirectory).toHaveBeenCalledWith("D:/用户指定目录")
    expect(mocks.createProject).toHaveBeenCalledWith("用户小说", "D:/用户指定目录")
    expect(mocks.writeFile).toHaveBeenCalledWith(`${project.path}/schema.md`, "原有结构")
    expect(mocks.writeFile).toHaveBeenCalledWith(`${project.path}/purpose.md`, "原有用途")
    expect(mocks.createDirectory).toHaveBeenCalledWith(`${project.path}/wiki/outlines`)
    expect(mocks.setOutputLanguage).toHaveBeenCalledWith("Chinese")
    expect(mocks.saveOutputLanguage).toHaveBeenCalledWith("Chinese", project.id)
    expect(onCreated).toHaveBeenCalledWith(project)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("异步解析默认目录后展示真实位置，不一直停留在读取中", async () => {
    let resolveDirectory!: (path: string) => void
    mocks.getExecutableDir.mockReturnValue(new Promise<string>((resolve) => { resolveDirectory = resolve }))
    await act(async () => root.render(<CreateProjectDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} />))
    await act(async () => { resolveDirectory("E:/程序安装位置") })
    const output = document.body.querySelector(".ui-test-create-path")
    expect(output?.textContent).toBe("E:\\QM-BOOK")
  })

  it("创建失败保留合法长名称与所选目录，实际错误中文可见", async () => {
    const onCreated = vi.fn()
    const onOpenChange = vi.fn()
    mocks.createProject.mockRejectedValue(new Error("目录已存在：用户小说"))
    mocks.pickDirectory.mockResolvedValue("D:/用户保留目录")
    await act(async () => root.render(<CreateProjectDialog open onOpenChange={onOpenChange} onCreated={onCreated} />))
    const dialog = document.body.querySelector<HTMLElement>('[data-ui-test-dialog="create-project"]')!
    const input = dialog.querySelector<HTMLInputElement>("input")!
    const name = "合法的长小说名称".repeat(12)
    await typeInto(input, name)
    await act(async () => button("选择目录", dialog).click())
    await act(async () => dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
    expect(input.value).toBe(name)
    expect(dialog.textContent).toContain("D:/用户保留目录")
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain("目录已存在")
    expect(mocks.createProject).toHaveBeenCalledWith(name, "D:/用户保留目录")
    expect(mocks.writeFile).not.toHaveBeenCalled()
    expect(onCreated).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(button("创建并写大纲", dialog).disabled).toBe(false)
  })

  it("输入法组合回车不提交小说", async () => {
    await act(async () => root.render(<CreateProjectDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} />))
    const input = document.body.querySelector<HTMLInputElement>(".ui-test-create-name")!
    await typeInto(input, "正在组词的小说")
    const key = new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true })
    await act(async () => { input.dispatchEvent(key) })
    expect(key.defaultPrevented).toBe(true)
    expect(mocks.createProject).not.toHaveBeenCalled()
  })

  it("目录选择失败不误报名称错误，取消选择不创建项目", async () => {
    mocks.pickDirectory.mockRejectedValue(new Error("picker unavailable"))
    await act(async () => root.render(<CreateProjectDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} />))
    const dialog = document.body.querySelector<HTMLElement>('[data-ui-test-dialog="create-project"]')!
    await act(async () => button("选择目录", dialog).click())
    expect(dialog.querySelector('[role="alert"]')?.textContent).toBe("无法打开目录选择器，请稍后重试。")
    mocks.pickDirectory.mockResolvedValue(null)
    await act(async () => button("选择目录", dialog).click())
    expect(mocks.createProject).not.toHaveBeenCalled()
  })

  it("创建中禁用重复提交和关闭，完成后只回调一次", async () => {
    let finish!: (project: WikiProject) => void
    mocks.createProject.mockReturnValue(new Promise<WikiProject>((resolve) => { finish = resolve }))
    const onCreated = vi.fn()
    const onOpenChange = vi.fn()
    await act(async () => root.render(<CreateProjectDialog open onOpenChange={onOpenChange} onCreated={onCreated} />))
    const dialog = document.body.querySelector<HTMLElement>('[data-ui-test-dialog="create-project"]')!
    await typeInto(dialog.querySelector<HTMLInputElement>("input")!, "一本小说")
    await act(async () => dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
    expect(button("创建中…", dialog).disabled).toBe(true)
    expect(button("取消", dialog).disabled).toBe(true)
    await act(async () => dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
    await act(async () => dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
    expect(mocks.createProject).toHaveBeenCalledOnce()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    await act(async () => { finish(project) })
    expect(onCreated).toHaveBeenCalledOnce()
  })

  it("Esc 关闭新建弹窗并回到原按钮，不创建磁盘内容", async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return <><button type="button" onClick={() => setOpen(true)}>新建入口</button><CreateProjectDialog open={open} onOpenChange={setOpen} onCreated={vi.fn()} /></>
    }
    await act(async () => root.render(<Harness />))
    const trigger = button("新建入口")
    await act(async () => { trigger.focus(); trigger.click() })
    // Base UI 的初始焦点在下一动画帧设置，先等待它完成。
    await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())) })
    const input = document.body.querySelector<HTMLInputElement>(".ui-test-create-name")!
    expect(document.activeElement).toBe(input)
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })))
    expect(document.body.querySelector('[data-ui-test-dialog="create-project"][data-open]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(mocks.createDirectory).not.toHaveBeenCalled()
    expect(mocks.createProject).not.toHaveBeenCalled()
  })

  it("新建弹窗始终使用当前文案，并显示正式小说目录", async () => {
    mocks.uiTest = false
    await act(async () => root.render(<CreateProjectDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} />))
    const dialog = document.body.querySelector<HTMLElement>('[data-ui-test-dialog="create-project"]')!
    expect(dialog.textContent).toContain("让一个新故事开始")
    expect(dialog.textContent).toContain("创建并写大纲")
    expect(dialog.textContent).toContain("C:\\QM-BOOK")
  })
})

describe("书架图稿尺寸约束", () => {
  it("专用样式锁定4:5、10px、28px、16/24书名和14/22字数", () => {
    const path = resolve(__dirname, "ui-test-shelf.css")
    const css = existsSync(path) ? readFileSync(path, "utf8") : ""
    expect(css).toContain("is-large")
    expect(css).toContain("is-small")
    expect(css).toMatch(/aspect-ratio:\s*2\s*\/\s*3/)
    expect(css).toMatch(/border-radius:\s*10px/)
    expect(css).toMatch(/gap:\s*30px\s+28px/)
    expect(css).toMatch(/font:\s*600\s+16px\s*\/\s*24px/)
    expect(css).toMatch(/font-size:\s*14px;\s*line-height:\s*22px/)
    expect(css).toContain("1088px")
    expect(css).toContain("620px")
    expect(css).toContain("88dvh")
    expect(css).toMatch(/@media\s*\(width\s*<\s*1180px\)/)
    expect(css).toMatch(/@media\s*\(width\s*<\s*900px\)/)
    expect(css).toMatch(/@media\s*\(width\s*<\s*480px\)/)
    for (const color of ["#89967d", "#b28f88", "#beb08e", "#71878b", "#c5a173", "#8f9984", "#958ba8", "#7c9b96"]) {
      expect(css).toContain(color)
    }
  })
})


describe("书架局部样式不依赖外壳", () => {
  let style: HTMLStyleElement
  beforeEach(() => {
    style = document.createElement("style")
    style.textContent = readFileSync(resolve(__dirname, "ui-test-shelf.css"), "utf8")
    document.head.appendChild(style)
  })
  afterEach(() => style.remove())

  it("书架在 flex 工作区内撑满宽度而非按内容收缩", async () => {
    await renderShelf()
    const shelf = getComputedStyle(host.querySelector(".ui-test-shelf")!)
    expect(shelf.width).toBe("100%")
    expect(shelf.minWidth).toMatch(/^0(?:px)?$/)
    expect(shelf.flexGrow).toBe("1")
  })

  it("封面大小图标与动作按钮位于同一行两端", async () => {
    await renderShelf()
    const hero = getComputedStyle(host.querySelector(".ui-test-shelf-hero")!)
    const icon = getComputedStyle(host.querySelector(".ui-test-cover-size svg")!)
    expect(hero.display).toBe("flex")
    expect(hero.justifyContent).toBe("space-between")
    expect(icon.flexShrink).toBe("0")
    expect(host.querySelector(".ui-test-searchbox")).toBeNull()
  })

  it("书架动作按钮有自己的图标、布局和命中高度定义", async () => {
    await renderShelf()
    const action = button("新建小说")
    const actionStyle = getComputedStyle(action)
    const icon = getComputedStyle(action.querySelector("svg")!)
    expect(actionStyle.display).toBe("inline-flex")
    expect(actionStyle.alignItems).toBe("center")
    expect(actionStyle.minHeight).toBe("36px")
    expect(actionStyle.fontSize).toBe("13px")
    expect(icon.width).toBe("16px")
    expect(icon.height).toBe("16px")
  })

  it("空书架不依赖主样式也能竖向居中并保留可读提示", async () => {
    mocks.getRecentProjects.mockResolvedValue([])
    await renderShelf()
    const empty = getComputedStyle(host.querySelector(".ui-test-empty")!)
    const hint = getComputedStyle(host.querySelector(".ui-test-empty p")!)
    expect(empty.display).toBe("flex")
    expect(empty.flexDirection).toBe("column")
    expect(empty.alignItems).toBe("center")
    expect(empty.justifyContent).toBe("center")
    expect(empty.gap).toBe("12px")
    expect(hint.fontSize).toBe("14px")
  })
})
