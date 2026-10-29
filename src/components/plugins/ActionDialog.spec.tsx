// @vitest-environment jsdom
/**
 * ActionDialog / ResultPanel 测试。
 *
 * 最重要的一条是**空列表与降级的文案必须不同**（B1 特意拆开的两条路径）：
 * 如果两者渲染成同一句话，用户就分不清"我填得不对"和"模型不听话"，
 * 作者也看不到提示词跑偏的信号 —— 那是这次拆分存在的全部意义。
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { renameProject } = vi.hoisted(() => ({ renameProject: vi.fn() }))
vi.mock("@/commands/fs", () => ({ renameProject }))
const { syncPluginsProject } = vi.hoisted(() => ({ syncPluginsProject: vi.fn() }))
vi.mock("@/lib/plugins/project-sync", () => ({ syncPluginsProject }))

import type { ParsedOutput } from "@/lib/plugins/declarative/output"
import type { LlmCaller, RunActionDeps } from "@/lib/plugins/declarative/run"
import type { DeclarativeAction } from "@/lib/plugins/declarative/types"
import type { SlotActionEntry } from "@/lib/plugins/slots"
import { useWikiStore } from "@/stores/wiki-store"
import {
  ActionDialog,
  ResultPanel,
  defaultTargetApplier,
  describeRunError,
  resultToText,
  targetBlockedReason,
} from "./ActionDialog"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

function entry(overrides: Partial<DeclarativeAction> = {}, grantedPermissions: string[] = []): SlotActionEntry {
  return {
    pluginId: "idea-generator",
    pluginName: "灵感生成器",
    // 缺省按"什么都没授予"：多数用例只关心对话框状态机，不需要项目权限
    grantedPermissions,
    action: {
      id: "generate-titles",
      title: "生成书名",
      prompt: { system: "sys", user: "user" },
      output: {
        mode: "list",
        presentation: "chips",
        targets: [
          { kind: "project-field", field: "bookTitle", label: "设为书名", confirm: true },
          { kind: "insert-at-cursor", label: "插入到光标处" },
          { kind: "clipboard", label: "复制" },
        ],
      },
      ...overrides,
    },
  }
}

function depsWith(llm: LlmCaller): RunActionDeps {
  return { llm, getConfig: async () => ({}) }
}

function fixedLlm(text: string): LlmCaller {
  return {
    async call(_input, onDelta) {
      onDelta(text)
      return { text }
    },
  }
}

describe("ResultPanel：空列表与降级必须长得不一样", () => {
  it("空列表 → 「模型没有给出结果，可以调整后重试」", () => {
    const parsed: ParsedOutput = { kind: "list", items: [], degraded: false }
    act(() => {
      root.render(<ResultPanel parsed={parsed} presentation="chips" />)
    })

    expect(host.querySelector('[data-result-state="empty"]')).not.toBeNull()
    expect(host.textContent).toContain("模型没有给出结果，可以调整后重试")
    // 空列表**不该**出现"解析失败/原文"这类降级话术
    expect(host.textContent).not.toContain("没能按预期格式解析")
  })

  it("降级 → 显示原因 + 原文 + 重试", () => {
    const parsed: ParsedOutput = { kind: "degraded", text: "好的，我来分析一下……", reason: "没有解析出任何条目" }
    const onRetry = vi.fn()
    act(() => {
      root.render(<ResultPanel parsed={parsed} presentation="chips" onRetry={onRetry} />)
    })

    expect(host.querySelector('[data-result-state="degraded"]')).not.toBeNull()
    expect(host.textContent).toContain("没能按预期格式解析模型输出")
    expect(host.textContent).toContain("没有解析出任何条目")
    // 原文必须原样可见：用户可能只想从噪音里挑一句复制
    expect(host.textContent).toContain("好的，我来分析一下……")
    expect(host.textContent).not.toContain("模型没有给出结果")
  })

  it("有条目时按 chips 渲染", () => {
    act(() => {
      root.render(
        <ResultPanel
          parsed={{ kind: "list", items: ["《长夜》", "《归途》"], degraded: false }}
          presentation="chips"
        />,
      )
    })
    const chips = [...host.querySelectorAll('[data-result-state="list"] button')].map((node) => node.textContent)
    expect(chips).toEqual(["《长夜》", "《归途》"])
  })

  it("resultToText 把列表拼成按行文本（复制语义）", () => {
    expect(resultToText({ kind: "list", items: ["a", "b"], degraded: false })).toBe("a\nb")
    expect(resultToText({ kind: "text", text: "整段" })).toBe("整段")
  })
})

describe("ActionDialog：状态机与流式", () => {
  it("无表单时打开即开始生成，完成后展示 chips 与 targets", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const localRoot = createRoot(container)

    await act(async () => {
      localRoot.render(
        <ActionDialog
          open
          entry={entry()}
          onClose={() => {}}
          deps={depsWith(fixedLlm("《长夜》\n《归途》"))}
          onApplyTarget={async () => {}}
        />,
      )
    })
    // 让 runDeclarativeAction 的 promise 链跑完
    await act(async () => {
      await Promise.resolve()
    })

    const text = document.body.textContent ?? ""
    expect(text).toContain("生成书名")
    expect(text).toContain("《长夜》")
    expect(text).toContain("设为书名")
    // 没编辑器时「插入到光标处」必须禁用（并带 tooltip 说明）
    const insertButton = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "插入到光标处",
    ) as HTMLButtonElement | undefined
    expect(insertButton?.disabled).toBe(true)
    expect(insertButton?.title).toContain("需要先打开一个章节编辑器")

    await act(async () => localRoot.unmount())
    container.remove()
  })

  it("解析降级时对话框显示原因与原文，不报错也不空白", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const localRoot = createRoot(container)

    await act(async () => {
      localRoot.render(
        <ActionDialog
          open
          entry={entry({ output: { mode: "json", schema: { type: "array" }, targets: [] } })}
          onClose={() => {}}
          deps={depsWith(fixedLlm("我觉得可以这样：先写个开头"))}
          onApplyTarget={async () => {}}
        />,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    const text = document.body.textContent ?? ""
    expect(text).toContain("没能按预期格式解析模型输出")
    expect(text).toContain("我觉得可以这样")

    await act(async () => localRoot.unmount())
    container.remove()
  })

  it("模型调用失败时显示可读原因并给重试", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const localRoot = createRoot(container)

    await act(async () => {
      localRoot.render(
        <ActionDialog
          open
          entry={entry()}
          onClose={() => {}}
          deps={depsWith({
            call: () => Promise.reject(new Error("模型连接超时")),
          })}
          onApplyTarget={async () => {}}
        />,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("模型连接超时")
    expect([...document.body.querySelectorAll("button")].some((button) => button.textContent === "重试")).toBe(true)

    await act(async () => localRoot.unmount())
    container.remove()
  })
})

describe("ActionDialog：读项目前的 fs:project-read 闸门（设计 §3.3）", () => {
  function projectAction(overrides: Partial<DeclarativeAction> = {}): DeclarativeAction {
    return {
      id: "expand",
      title: "扩写本章",
      prompt: { system: "你在扩写网文", user: "续写：{{chapter.text}}" },
      output: { mode: "text", targets: [] },
      ...overrides,
    }
  }

  async function renderDialog(entryValue: SlotActionEntry, deps: RunActionDeps) {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const localRoot = createRoot(container)

    await act(async () => {
      localRoot.render(
        <ActionDialog open entry={entryValue} onClose={() => {}} deps={deps} onApplyTarget={async () => {}} />,
      )
    })
    for (let index = 0; index < 4; index += 1) {
      await act(async () => {
        await Promise.resolve()
      })
    }
    return localRoot
  }

  it("没获批：显示「需要读取你的项目内容」，不是「生成失败」，且一次模型请求都没发", async () => {
    const llm = { call: vi.fn(async () => ({ text: "不该出现" })) }
    const readChapter = vi.fn(async () => ({ title: "第一章", text: "列车在雨里停了很久。" }))

    const localRoot = await renderDialog(entry(projectAction(), []), {
      llm,
      readChapter,
      getConfig: async () => ({}),
    })

    const text = document.body.textContent ?? ""
    expect(text).toContain("需要读取你的项目内容")
    expect(text).toContain("fs:project-read")
    // 不能降级成"生成失败"：模型根本没跑，重试也不会好，得去插件中心授权
    expect(text).not.toContain("生成失败")
    expect(llm.call).not.toHaveBeenCalled()
    expect(readChapter).not.toHaveBeenCalled()

    // 只有「重试」是合理的下一步；「停止」意味着仍在生成，是误导
    const labels = [...document.body.querySelectorAll("button")].map((button) => (button.textContent ?? "").trim())
    expect(labels).not.toContain("停止")
    expect(labels).toContain("重试")

    await act(async () => localRoot.unmount())
  })

  it("已获批：照常读章节并展示生成结果（闸门不能误伤正常插件）", async () => {
    const llm = { call: vi.fn(async () => ({ text: "扩写后的正文" })) }
    const readChapter = vi.fn(async () => ({ title: "第一章", text: "列车在雨里停了很久。" }))

    const localRoot = await renderDialog(entry(projectAction(), ["fs:project-read"]), {
      llm,
      readChapter,
      getConfig: async () => ({}),
    })

    expect(readChapter).toHaveBeenCalledTimes(1)
    expect(llm.call).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain("扩写后的正文")

    await act(async () => localRoot.unmount())
  })
})

describe("工具函数", () => {
  it("targetBlockedReason：insert-at-cursor 需要编辑器，其它目标不阻塞", () => {
    expect(targetBlockedReason({ kind: "insert-at-cursor", label: "插入到光标处" })).toContain("章节编辑器")
    expect(
      targetBlockedReason({ kind: "insert-at-cursor", label: "插入到光标处" }, { editorAvailable: true }),
    ).toContain("插入通道")
    expect(targetBlockedReason({ kind: "clipboard", label: "复制" })).toBeUndefined()
  })

  it("describeRunError 优先展示中文原文", () => {
    expect(describeRunError("模型额度不足")).toBe("模型额度不足")
    expect(describeRunError(new Error("网络错误"))).toBe("网络错误")
    expect(describeRunError(undefined)).toBe("生成失败，请重试。")
  })
})

describe("defaultTargetApplier：bookTitle 真的写回项目", () => {
  beforeEach(() => {
    renameProject.mockReset()
    syncPluginsProject.mockReset()
    useWikiStore.setState({
      project: { id: "p1", name: "旧名", path: "D:/QM-BOOK/旧名" },
      selectedFile: "D:/QM-BOOK/旧名/wiki/chapters/001.md",
      fileContent: "# 第一章\n\n正文",
    })
  })

  it("调 rename_project(projectPath, 清洗后的书名) 并更新 store", async () => {
    renameProject.mockResolvedValue({ id: "p1", name: "长夜", path: "D:/QM-BOOK/长夜" })

    await defaultTargetApplier(
      { kind: "project-field", field: "bookTitle", label: "设为书名" },
      { kind: "text", text: "《长夜》\n（备选：归途）" },
    )

    expect(renameProject).toHaveBeenCalledWith("D:/QM-BOOK/旧名", "长夜")
    // store 必须用 rename_project 返回的新 WikiProject 更新（路径也变了）
    expect(useWikiStore.getState().project).toEqual({ id: "p1", name: "长夜", path: "D:/QM-BOOK/长夜" })
    // 项目根目录变了 → 插件宿主要跟着换
    expect(syncPluginsProject).toHaveBeenCalledWith("D:/QM-BOOK/长夜")
    // 已打开的文档路径失效：必须关掉，避免往旧路径自动保存
    expect(useWikiStore.getState().selectedFile).toBeNull()
  })

  it("Rust 报错原样抛给 UI（不吞错、不假装成功）", async () => {
    renameProject.mockRejectedValue("目标目录已存在：D:/QM-BOOK/长夜")

    await expect(
      defaultTargetApplier({ kind: "project-field", field: "bookTitle", label: "设为书名" }, { kind: "text", text: "长夜" }),
    ).rejects.toBe("目标目录已存在：D:/QM-BOOK/长夜")
    // 失败时 store 不动
    expect(useWikiStore.getState().project?.name).toBe("旧名")
  })

  it("其它 project-field 明确拒绝，不写 wiki 页面", async () => {
    await expect(
      defaultTargetApplier({ kind: "project-field", field: "bookIntro", label: "设为简介" }, { kind: "text", text: "简介" }),
    ).rejects.toThrow("宿主还没有该字段的写入通道")
    expect(renameProject).not.toHaveBeenCalled()
  })

  it("没有项目 / 空结果都给出可读原因", async () => {
    useWikiStore.setState({ project: null })
    await expect(
      defaultTargetApplier({ kind: "project-field", field: "bookTitle", label: "设为书名" }, { kind: "text", text: "长夜" }),
    ).rejects.toThrow("还没有打开项目")

    useWikiStore.setState({ project: { id: "p1", name: "旧名", path: "D:/QM-BOOK/旧名" } })
    await expect(
      defaultTargetApplier({ kind: "project-field", field: "bookTitle", label: "设为书名" }, { kind: "text", text: "   " }),
    ).rejects.toThrow("没有可用的书名")
    expect(renameProject).not.toHaveBeenCalled()
  })

  it("chapter-note / insert-at-cursor 明确拒绝（宿主没有存储/插入通道）", async () => {
    await expect(
      defaultTargetApplier({ kind: "chapter-note", label: "追加到章节备注" }, { kind: "text", text: "备注" }),
    ).rejects.toThrow("章节备注")
    await expect(
      defaultTargetApplier({ kind: "insert-at-cursor", label: "插入到光标处" }, { kind: "text", text: "正文" }),
    ).rejects.toThrow("章节编辑器")
  })
})

describe("ActionDialog：targets 按 targetAvailability 禁用", () => {
  async function renderDoneDialog(props: { projectAvailable?: boolean; editorAvailable?: boolean } = {}) {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const localRoot = createRoot(container)

    await act(async () => {
      localRoot.render(
        <ActionDialog
          open
          entry={entry({
            output: {
              mode: "text",
              targets: [
                { kind: "project-field", field: "bookTitle", label: "设为书名" },
                { kind: "project-field", field: "bookIntro", label: "设为简介" },
                { kind: "chapter-note", label: "追加到章节备注" },
                { kind: "clipboard", label: "复制" },
              ],
            },
          })}
          onClose={() => {}}
          deps={depsWith(fixedLlm("《长夜》"))}
          onApplyTarget={async () => {}}
          {...props}
        />
      )
    })
    await act(async () => {
      await Promise.resolve()
    })
    const buttons = [...document.body.querySelectorAll<HTMLButtonElement>("button")].filter((button) =>
      ["设为书名", "设为简介", "追加到章节备注", "复制"].includes(button.textContent ?? ""),
    )
    return { localRoot, container, buttons }
  }

  it("有项目：书名可点；无写入通道的字段禁用且 tooltip 说明原因", async () => {
    const { localRoot, container, buttons } = await renderDoneDialog({ projectAvailable: true })
    const byLabel = new Map(buttons.map((button) => [button.textContent, button]))

    expect(byLabel.get("设为书名")?.disabled).toBe(false)
    expect(byLabel.get("复制")?.disabled).toBe(false)

    const intro = byLabel.get("设为简介")
    expect(intro?.disabled).toBe(true)
    expect(intro?.title).toContain("宿主还没有该字段的写入通道")

    const note = byLabel.get("追加到章节备注")
    expect(note?.disabled).toBe(true)
    expect(note?.title).toContain("章节备注")

    await act(async () => localRoot.unmount())
    container.remove()
  })

  it("没项目：书名禁用并说明「还没有打开项目」", async () => {
    const { localRoot, container, buttons } = await renderDoneDialog({ projectAvailable: false })
    const title = buttons.find((button) => button.textContent === "设为书名")
    expect(title?.disabled).toBe(true)
    expect(title?.title).toContain("还没有打开项目")

    await act(async () => localRoot.unmount())
    container.remove()
  })
})
