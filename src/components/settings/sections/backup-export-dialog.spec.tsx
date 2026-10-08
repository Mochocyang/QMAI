// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ProjectBackupInfo } from "@/lib/backup/types"
import { BackupExportDialog } from "./backup-export-dialog"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const projects: ProjectBackupInfo[] = [
  { id: "p1", name: "长安夜雨", path: "C:/Novel" },
  { id: "p2", name: "旧梦", path: "C:/Old" },
]

describe("数据管理备份选择弹窗", () => {
  let host: HTMLDivElement
  let root: Root
  const onConfirm = vi.fn()

  beforeEach(async () => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root.render(
        <BackupExportDialog
          open
          projects={projects}
          exporting={false}
          onOpenChange={vi.fn()}
          onConfirm={onConfirm}
        />,
      )
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.clearAllMocks()
  })

  it("完整备份默认全选并保证弹窗内容可滚动", () => {
    expect(document.body.textContent).toContain("选择备份内容")
    expect(document.querySelector('[data-slot="dialog-content"]')?.className).toContain("max-h-[85vh]")
    expect(document.querySelector('[data-backup-export-scroll]')?.className).toContain("overflow-y-auto")
    expect((document.querySelector('[aria-label="完整备份"]') as HTMLInputElement).checked).toBe(true)
    expect((document.querySelector('[aria-label="API Key 和其他凭据"]') as HTMLInputElement).checked).toBe(true)
    expect(document.querySelectorAll('[data-backup-project] input:checked')).toHaveLength(2)
    expect(document.querySelectorAll('[data-backup-section] input:checked')).toHaveLength(5)
  })

  it("自定义备份默认排除凭据并只提交用户选中的项目和类别", async () => {
    const custom = document.querySelector('[aria-label="自定义备份"]') as HTMLInputElement
    await act(async () => custom.click())

    const credentials = document.querySelector('[aria-label="API Key 和其他凭据"]') as HTMLInputElement
    expect(credentials.checked).toBe(false)

    const oldProject = document.querySelector('[aria-label="导出项目 旧梦"]') as HTMLInputElement
    const memory = document.querySelector('[aria-label="结构化记忆与章节快照"]') as HTMLInputElement
    await act(async () => {
      oldProject.click()
      memory.click()
    })

    const confirm = [...document.querySelectorAll("button")].find((button) => button.textContent === "开始导出")!
    await act(async () => confirm.click())

    expect(onConfirm).toHaveBeenCalledWith({
      includeGlobalConfig: true,
      includeUiPreferences: true,
      includeCredentials: false,
      projects: [{
        ...projects[0],
        sections: ["content", "analysis", "indexes", "trash"],
      }],
    })
  })

  it("没有选择任何内容时禁止导出，包含凭据时显示风险提示", async () => {
    await act(async () => (document.querySelector('[aria-label="自定义备份"]') as HTMLInputElement).click())
    await act(async () => {
      ;(document.querySelector('[aria-label="模型与 AI 配置"]') as HTMLInputElement).click()
      ;(document.querySelector('[aria-label="界面与软件偏好"]') as HTMLInputElement).click()
      ;(document.querySelector('[aria-label="取消选择全部项目"]') as HTMLButtonElement).click()
    })

    const confirm = [...document.querySelectorAll("button")].find((button) => button.textContent === "开始导出") as HTMLButtonElement
    expect(confirm.disabled).toBe(true)

    await act(async () => (document.querySelector('[aria-label="API Key 和其他凭据"]') as HTMLInputElement).click())
    expect(document.body.textContent).toContain("备份文件未加密")
  })

  it("取消全部项目类别时不提交空项目条目", async () => {
    await act(async () => (document.querySelector('[aria-label="自定义备份"]') as HTMLInputElement).click())
    for (const input of document.querySelectorAll<HTMLInputElement>('[data-backup-section] input:checked')) {
      await act(async () => input.click())
    }

    const confirm = [...document.querySelectorAll("button")].find((button) => button.textContent === "开始导出")!
    await act(async () => confirm.click())

    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ projects: [] }))
  })
})
