// @vitest-environment jsdom
import { act } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { agentConfigArgs, renderChatPanel } from "@/test/chat-panel-mount"
import { clearTaskBreakpoint, loadTaskBreakpoint } from "@/lib/agent/task-breakpoint"
import type { Conversation } from "@/stores/chat-store"
import { useChatStore } from "@/stores/chat-store"
import { chatConversationRunRegistry } from "@/lib/conversation-run-registry"
import { createDirectory, deleteFile, readFile, writeFileAtomic } from "@/commands/fs"
import type { ReferenceToken } from "@/lib/reference/types"

const breakpoint = {
  taskId: "task_resume_1",
  taskGoal: "生成第19章",
  completedStages: ["agent_round_4"],
  currentStage: "agent_round_4",
  usedSkills: [],
  usedTools: ["run_chapter_workflow"],
  searches: [],
  createdAt: 100,
  updatedAt: 200,
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve()
  })
}

function conversation(id: string, title: string, updatedAt: number, inputDraft = ""): Conversation {
  return { id, title, createdAt: updatedAt, updatedAt, deAiMode: false, inputDraft }
}

async function click(element: Element | null) {
  expect(element).not.toBeNull()
  await act(async () => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
}

describe("ChatPanel mount 基础设施", () => {
  it("根据当前会话是否已发送用户消息控制新建对话按钮", async () => {
    const first = await renderChatPanel()
    expect((first.container.querySelector(".qmai-new-conversation-button") as HTMLButtonElement).disabled).toBe(false)
    await first.unmount()

    const empty = await renderChatPanel({ activeConversationId: "empty" })
    const emptyButton = empty.container.querySelector(".qmai-new-conversation-button") as HTMLButtonElement
    expect(emptyButton.disabled).toBe(true)
    expect(emptyButton.title).toBe("请先发送当前会话内容，再新建对话。")
    const reasonId = emptyButton.getAttribute("aria-describedby")
    expect(reasonId).toBeTruthy()
    expect(empty.container.querySelector(`#${reasonId}`)?.textContent).toBe(
      "请先发送当前会话内容，再新建对话。",
    )
    await empty.unmount()

    const draft = await renderChatPanel({
      activeConversationId: "draft",
      conversations: [conversation("draft", "草稿", 100, "仅填写未发送")],
    })
    expect((draft.container.querySelector(".qmai-new-conversation-button") as HTMLButtonElement).disabled).toBe(true)
    await draft.unmount()

    const sent = await renderChatPanel({
      activeConversationId: "sent",
      messages: [{ id: "user-1", role: "user", content: "已发送内容", timestamp: 1, conversationId: "sent" }],
    })
    expect((sent.container.querySelector(".qmai-new-conversation-button") as HTMLButtonElement).disabled).toBe(false)
    await sent.unmount()
  })

  it("基础渲染：chat-panel mount 成功并显示空会话入口", async () => {
    const view = await renderChatPanel()

    expect(view.container.textContent).toContain("一起写下一段故事")

    await view.unmount()
  })

  it("Agent skill 配置为空时仍可打开 ChatPanel", async () => {
    const view = await renderChatPanel({ agentSkillConfig: null })

    expect(view.container.textContent).toContain("一起写下一段故事")

    await view.unmount()
  })

  it("输入工具栏显示模式下拉按钮，不再显示深度模式按钮", async () => {
    const view = await renderChatPanel({ activeConversation: true })

    expect(view.container.textContent).toContain("标准")
    expect(view.container.querySelector('[aria-label="开启深度模式"]')).toBeNull()
    expect(view.container.querySelector('[aria-label="关闭深度模式"]')).toBeNull()

    await view.unmount()
  })

  it("输入工具栏单独显示计划开关，可与模式下拉按钮并列使用", async () => {
    const view = await renderChatPanel({ activeConversation: true })

    expect(view.container.textContent).toContain("标准")
    expect(view.container.textContent).toContain("计划")
    expect(view.container.querySelector('[aria-label="开启计划模式"]')).not.toBeNull()

    await view.unmount()
  })

  it("存在旧断点时不再自动弹出继续未完成任务对话框", async () => {
    const loadMock = vi.mocked(loadTaskBreakpoint)
    const clearMock = vi.mocked(clearTaskBreakpoint)
    loadMock.mockClear()
    clearMock.mockClear()

    const view = await renderChatPanel({ taskBreakpoint: breakpoint })
    await flushEffects()

    expect(loadMock).not.toHaveBeenCalled()
    expect(clearMock).not.toHaveBeenCalled()
    expect(view.container.textContent).not.toContain("继续未完成任务")
    expect(view.container.textContent).not.toContain("确认后将继续执行断点任务")
    expect(view.container.textContent).not.toContain("恢复提示词")

    await view.unmount()
  })

  it("顶栏身份区显示当前运行会话的状态", async () => {
    const view = await renderChatPanel({
      activeConversationId: "conv-active",
      conversations: [conversation("conv-active", "当前会话", 400)],
      runStates: {
        "conv-active": { status: "running", updatedAt: 500, runId: "run-running" },
      },
    })

    const statusIcon = view.container.querySelector('[aria-label="正在生成"]')
    expect(statusIcon).not.toBeNull()
    expect(statusIcon?.querySelector("svg")).not.toBeNull()
    expect(statusIcon?.hasAttribute("data-slot")).toBe(false)
    expect(view.container.textContent).not.toContain("正在生成")
    expect(document.body.querySelector('[data-slot="tooltip-content"]')).toBeNull()
    await view.unmount()
  })

  it("普通会话达到三任务并发上限时只禁止发送", async () => {
    const view = await renderChatPanel({
      activeConversationId: "conv-draft",
      conversations: [
        conversation("conv-a", "任务 A", 400),
        conversation("conv-b", "任务 B", 300),
        conversation("conv-c", "任务 C", 200),
        conversation("conv-draft", "草稿会话", 100, "仍可编辑的草稿"),
      ],
      runStates: {
        "conv-a": { status: "running", updatedAt: 500, runId: "run-a" },
        "conv-b": { status: "running", updatedAt: 501, runId: "run-b" },
        "conv-c": { status: "running", updatedAt: 502, runId: "run-c" },
      },
    })

    const input = view.container.querySelector('[aria-label="引用输入框"]') as HTMLTextAreaElement | null
    const send = view.container.querySelector('[aria-label="发送消息"]') as HTMLButtonElement | null
    expect(input?.disabled).toBe(false)
    expect(send?.disabled).toBe(true)
    expect(send?.title).toBe("普通 AI 会话最多同时运行 3 个任务，请等待任一任务结束后再发送。")
    await view.unmount()
  })

  it("停止当前会话不会中止其他正在运行的会话", async () => {
    const currentController = new AbortController()
    const backgroundController = new AbortController()
    chatConversationRunRegistry.register("conv-current", currentController)
    chatConversationRunRegistry.register("conv-background", backgroundController)
    const view = await renderChatPanel({
      activeConversationId: "conv-current",
      conversations: [
        conversation("conv-current", "当前任务", 200),
        conversation("conv-background", "后台任务", 100),
      ],
      runStates: {
        "conv-current": { status: "running", updatedAt: 300, runId: "run-current" },
        "conv-background": { status: "running", updatedAt: 301, runId: "run-background" },
      },
    })
    await act(async () => {
      useChatStore.setState({
        streamingContents: { "conv-current": "部分内容", "conv-background": "后台内容" },
        messages: [{
          id: "assistant-running",
          role: "assistant",
          content: "部分内容",
          timestamp: 300,
          conversationId: "conv-current",
          isAgentRunning: true,
        }],
      })
    })

    await click(view.container.querySelector('[aria-label="停止生成"]'))

    expect(currentController.signal.aborted).toBe(true)
    expect(backgroundController.signal.aborted).toBe(false)
    expect(useChatStore.getState().runStates["conv-current"]?.status).toBe("idle")
    expect(useChatStore.getState().runStates["conv-background"]?.status).toBe("running")
    const currentMessages = useChatStore.getState().messages.filter((message) => message.conversationId === "conv-current")
    expect(currentMessages).toHaveLength(1)
    expect(currentMessages[0]).toMatchObject({ isAgentRunning: false })
    expect(currentMessages[0].content).toContain("已停止生成。")
    expect(currentMessages[0].content).not.toContain("出错")
    chatConversationRunRegistry.abort("conv-background")
    await view.unmount()
  })

  it("删除运行中会话时先显示中文确认，取消后不删除", async () => {
    const view = await renderChatPanel({
      activeConversationId: "conv-running",
      conversations: [conversation("conv-running", "运行中会话", 100)],
      runStates: {
        "conv-running": { status: "running", updatedAt: 200, runId: "run-delete" },
      },
    })
    // 运行中会话的 chip 位于历史下拉面板中，先打开再操作
    await click(view.container.querySelector('[aria-label="novel.chat.conversationHistory"]'))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    const chip = document.body.querySelector('button[title="运行中会话"]')
    expect(chip).not.toBeNull()
    await act(async () => {
      chip?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
    })
    await click(document.body.querySelector('[aria-label="删除会话"]'))
    expect(document.body.textContent).toContain("停止并删除会话？")
    await click(Array.from(document.body.querySelectorAll("button")).find((button) => button.textContent === "取消") ?? null)
    expect(useChatStore.getState().conversations.some((item) => item.id === "conv-running")).toBe(true)
    await view.unmount()
  })

  it("一键清理只删除历史会话并保留顶部当前会话", async () => {
    const deleteFileMock = vi.mocked(deleteFile)
    deleteFileMock.mockClear()
    const view = await renderChatPanel({
      activeConversationId: "conv-current",
      conversations: [
        conversation("conv-current", "当前会话", Date.now()),
        conversation("conv-history-a", "历史会话 A", 100),
        conversation("conv-history-b", "历史会话 B", 200),
      ],
      messages: [
        { id: "current", role: "user", content: "保留", timestamp: 300, conversationId: "conv-current" },
        { id: "history-a", role: "user", content: "删除 A", timestamp: 100, conversationId: "conv-history-a" },
        { id: "history-b", role: "assistant", content: "删除 B", timestamp: 200, conversationId: "conv-history-b" },
      ],
    })

    await click(view.container.querySelector('[aria-label="novel.chat.conversationHistory"]'))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    await click(document.body.querySelector('[aria-label="清理旧会话"]'))
    expect(document.body.textContent).toContain("chat.clearHistoryTitle")
    await click(Array.from(document.body.querySelectorAll("button"))
      .find((button) => button.textContent === "chat.clearHistoryConfirm") ?? null)

    const state = useChatStore.getState()
    expect(state.conversations.map((item) => item.id)).toEqual(["conv-current"])
    expect(state.messages.map((item) => item.id)).toEqual(["current"])
    expect(deleteFileMock).toHaveBeenCalledWith("C:/QMAI_C/QMAI-main/.qmai/chats/conv-history-a.json")
    expect(deleteFileMock).toHaveBeenCalledWith("C:/QMAI_C/QMAI-main/.qmai/chats/conv-history-b.json")
    await view.unmount()
  })

  it.todo("PrePlugin 链触发：发送消息后 pipeline 执行")
  it.todo("Stage C 对话框：standard 模式 chapter_plan 触发对话框")
  it.todo("Stage C 跳过：fast 模式直接生成正文")
  it.todo("Stage D 自检：章节写完后 PostWriteCheck 写入 trace")
  it.todo("Stage D 降级：无模型时降级到规则检查")
  it.todo("断点保存：失败时记录调试信息但不自动弹窗")
})

/*
 * 丙-4c：教程的挂载点在 ChatPanel，而「该不该弹」的判据在 App.tsx（用刚加载到的
 * 这本书自己的配置）。两者之间靠 chat-store 的一次性标记交接，所以这里测的是
 * **消费端**：标记置位时 ChatPanel 挂载后必须真的把教程弹出来、并把标记清零。
 */
describe("ChatPanel 分步引导教程的一次性消费", () => {
  afterEach(() => {
    useChatStore.setState({ usageTutorialRequested: false })
  })

  it("标记置位时挂载 ChatPanel 会弹出教程，并清零标记", async () => {
    useChatStore.setState({ usageTutorialRequested: true })
    const view = await renderChatPanel({ activeConversation: true })
    expect(
      document.body.querySelector(".ui-test-usage-tutorial"),
      "标记置位时 ChatPanel 首次可用就必须弹出教程",
    ).not.toBeNull()
    expect(useChatStore.getState().usageTutorialRequested, "消费即清零，避免第二次误弹").toBe(false)
    await view.unmount()
  })

  it("标记未置位时不弹（默认路径不许误弹）", async () => {
    useChatStore.setState({ usageTutorialRequested: false })
    const view = await renderChatPanel({ activeConversation: true })
    expect(document.body.querySelector(".ui-test-usage-tutorial")).toBeNull()
    await view.unmount()
  })

  it("标记消费过一次后，重新挂载 ChatPanel 不再弹", async () => {
    useChatStore.setState({ usageTutorialRequested: true })
    const first = await renderChatPanel({ activeConversation: true })
    expect(document.body.querySelector(".ui-test-usage-tutorial")).not.toBeNull()
    await first.unmount()

    const second = await renderChatPanel({ activeConversation: true })
    expect(document.body.querySelector(".ui-test-usage-tutorial")).toBeNull()
    await second.unmount()
  })
})

/*
 * 丁-2「文风写作」的**产出端**。
 *
 * run_chapter_workflow 的消费端断言（`getWritingStyleIdOverride` 的值真的进了
 * `DeepChapterGenerationInput`）在 run-chapter-workflow.spec.ts 里。
 * 这一条补的是另一半：**chat-panel 交出去的那个 getter 到底返回什么**。
 * 两条都在，才不是「getter 没有产出者」的死通道
 * （本仓库已有一个 `getPlanBlueprint` 形状的先例，那条通道必须两头都接）。
 */
describe("ChatPanel 的「文风写作」产出端", () => {
  const styleStore = JSON.stringify({
    version: 1,
    enabledStyleId: "style-b",
    styles: [
      { id: "style-a", name: "甲书 · 文风", sourceBook: "甲书", profile: { schemaVersion: 1 }, createdAt: 1, updatedAt: 1 },
      { id: "style-b", name: "乙书 · 文风", sourceBook: "乙书", profile: { schemaVersion: 1 }, createdAt: 1, updatedAt: 1 },
    ],
  })

  /** 取最近一次 useAgentConfig 调用交出去的第 4 个参数（= 文风覆盖 getter）。 */
  function writingStyleGetter(): () => string | null | undefined {
    const args = agentConfigArgs.at(-1)
    expect(args, "useAgentConfig 应已被调用").toBeDefined()
    expect(args?.[3], "第 4 个参数应是文风覆盖 getter").toBeTypeOf("function")
    return args![3] as () => string | null | undefined
  }

  async function pickStyle(container: HTMLElement, text: string) {
    const trigger = container.querySelector<HTMLButtonElement>('[data-testid="writing-style-picker-trigger"]')
    expect(trigger, "输入工具栏应有「文风写作」选择器").not.toBeNull()
    await click(trigger)
    const popover = container.querySelector('[data-testid="writing-style-picker-popover"]')
    expect(popover, "浮层应已打开").not.toBeNull()
    // 预设是 role="option"，「本次不用」/「跟随项目设置」是普通按钮 ⇒ 一起找
    const option = Array.from(popover!.querySelectorAll<HTMLButtonElement>("button"))
      .find((item) => item.textContent?.includes(text))
    expect(option, `浮层里应有「${text}」`).toBeDefined()
    await click(option!)
  }

  afterEach(() => {
    vi.mocked(readFile).mockImplementation(async () => "")
  })

  it("选中一条文风后，交给 agent 配置的 getter 就返回它的 id（且不改项目启用项）", async () => {
    vi.mocked(readFile).mockImplementation(async (path: string) =>
      path.includes("writing-style.json") ? styleStore : "")
    const view = await renderChatPanel({ activeConversation: true })
    await flushEffects()

    // 没有覆盖时 getter 返回 undefined（= 沿用项目启用项），不能返回 null
    expect(writingStyleGetter()()).toBeUndefined()

    await pickStyle(view.container, "甲书 · 文风")
    expect(writingStyleGetter()()).toBe("style-a")

    // 「本次不用文风」= null，且**不能**被抹成 undefined
    await pickStyle(view.container, "本次不用文风")
    expect(writingStyleGetter()()).toBeNull()

    // 「跟随项目设置」把它退回没有覆盖
    await pickStyle(view.container, "跟随项目设置的文风")
    expect(writingStyleGetter()()).toBeUndefined()

    await view.unmount()
  })

  /*
   * ⚠️ 断言的对象必须是**文风库真正用的那个**写盘函数。
   *
   * 文风库的写盘在 `writing-style-store.ts` 的 `saveWritingStyleStore` 里，就两笔：
   * 先 `createDirectory(<project>/.qmai)`、再 `writeFileAtomic(<project>/.qmai/writing-style.json)`
   * —— 该文件从 `@/commands/fs` import 的正是 `createDirectory, readFile, writeFileAtomic`，
   * **没有** `writeFile`。
   * （这里刻意写符号名而不是行号：上一版引用的行号被我自己的注释改动带偏过一格。）
   * 本文件原先断言的是 **`writeFile`** —— 那是**另一个** mock，文风库一辈子
   * 都不会碰它。后果：这条用例永远观察不到任何一次文风库写盘。
   * 实测过（M-VACUOUS）：在 picker 的 `onPick` 里真调用
   * `setEnabledWritingStyle(project.path, styleId)` —— 也就是**每次点选都真的改写
   * `enabledStyleId`** —— 旧断言下 7 个 spec / 211 用例**全绿**。
   * 而这只发生在用户决定 2（项目设置不得被改）这条最重要的约束上。
   *
   * 所以这里连同 `createDirectory` 一起断言：真实写盘是
   * `createDirectory(<project>/.qmai)` + `writeFileAtomic(<project>/.qmai/writing-style.json)`，
   * 两笔都不许出现。
   */
  it("选择只改界面状态：没有写 .qmai/writing-style.json", async () => {
    const atomicMock = vi.mocked(writeFileAtomic)
    const mkdirMock = vi.mocked(createDirectory)
    atomicMock.mockClear()
    mkdirMock.mockClear()
    vi.mocked(readFile).mockImplementation(async (path: string) =>
      path.includes("writing-style.json") ? styleStore : "")
    const view = await renderChatPanel({ activeConversation: true })
    await flushEffects()

    await pickStyle(view.container, "甲书 · 文风")

    expect(
      atomicMock.mock.calls.filter(([path]) => String(path).includes("writing-style.json")),
      "点选文风不得写文风库文件（用户决定 2）",
    ).toEqual([])
    expect(
      mkdirMock.mock.calls.filter(([path]) => String(path).includes(".qmai")),
      "一次都不该为文风库建目录",
    ).toEqual([])
    await view.unmount()
  })
})

/*
 * 丁-3「输入框引用」：`@` 一条文风必须真的接上丁-2 的覆盖通道
 * （`getWritingStyleIdOverride` → `run_chapter_workflow` → `DeepChapterGenerationInput`）。
 *
 * 为什么这组必须是**真实 UI 路径**：产出端（引用弹窗里的条目）和消费端
 * （`handleSend` / getter）隔着整个 UI，任何一侧换字段都**没有编译错误**，
 * 只会静默变成「弹窗里能选、生成时没有任何覆盖」——本仓库已经有过这种死通道。
 * 下游那半程（getter → 生成输入、以及真的进了提示词）由
 * `run-chapter-workflow.spec.ts` 与 `writing-style-override.spec.ts` 钉住。
 *
 * 用例统一用 `aiWorkflowMode: "fast"`：跳过 novel pre-plugin 链，
 * 让每个用例只依赖被测的那条通道（快且不依赖磁盘 mock 的细节）。
 */
describe("ChatPanel 的「@ 引用文风」消费端（丁-3）", () => {
  const styleStore = JSON.stringify({
    version: 1,
    enabledStyleId: "style-b",
    styles: [
      { id: "style-a", name: "甲书 · 文风", sourceBook: "甲书", profile: { schemaVersion: 1 }, createdAt: 1, updatedAt: 1 },
      { id: "style-b", name: "乙书 · 文风", sourceBook: "乙书", profile: { schemaVersion: 1 }, createdAt: 1, updatedAt: 1 },
    ],
  })

  /** 取最近一次 useAgentConfig 调用交出去的第 4 个参数（= 文风覆盖 getter）。 */
  function writingStyleGetter(): () => string | null | undefined {
    const args = agentConfigArgs.at(-1)
    expect(args, "useAgentConfig 应已被调用").toBeDefined()
    expect(args?.[3], "第 4 个参数应是文风覆盖 getter").toBeTypeOf("function")
    return args![3] as () => string | null | undefined
  }

  /** 文风条目在 token 上的形状必须与 `createSkillProvider` 的透传一致。 */
  function styleReferenceToken(id: string, presetId: string, name: string): ReferenceToken {
    return {
      id,
      category: "skill",
      title: name,
      skillId: presetId,
      skillSubtype: "style",
      displayTitle: name,
    }
  }

  async function enqueueReferences(tokens: ReferenceToken[]) {
    await act(async () => {
      useChatStore.setState({ pendingReferenceTokens: tokens })
    })
    await flushEffects()
    await flushEffects()
  }

  async function typePrompt(container: HTMLElement, text: string) {
    const input = container.querySelector<HTMLTextAreaElement>('[aria-label="引用输入框"]')
    expect(input, "应有引用输入框").not.toBeNull()
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set
      valueSetter?.call(input, text)
      input!.dispatchEvent(new Event("input", { bubbles: true }))
    })
  }

  async function sendMessage(container: HTMLElement) {
    const sendButton = container.querySelector<HTMLButtonElement>('[aria-label="发送消息"]')
    expect(sendButton, "应有发送按钮").not.toBeNull()
    expect(sendButton?.disabled, "发送按钮应可用").toBe(false)
    await click(sendButton)
    await flushEffects()
  }

  /** 等这一次运行结束；同会话的第二次发送会被 `canStartConversationRun` 挡住。 */
  async function waitForRunSettled(conversationId: string) {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (useChatStore.getState().runStates[conversationId]?.status !== "running") return
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }
    throw new Error(`会话 ${conversationId} 的运行没有在预期轮数内结束`)
  }

  /** 打开引用弹窗 → 「技能库」分类 → 「文风」子 tab，返回弹窗元素。 */
  async function openStyleSubtab(container: HTMLElement) {
    await click(container.querySelector('[aria-label="引用内容"]'))
    await flushEffects()
    await flushEffects()

    const dialogFor = () => {
      const dialog = container.querySelector<HTMLElement>('[data-ui-reference="dialog"]')
      expect(dialog, "引用弹窗应已打开").not.toBeNull()
      return dialog!
    }
    const findButton = (text: string) => Array.from(dialogFor().querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === text)

    const skillTab = findButton("技能库")
    expect(skillTab, "弹窗应有「技能库」分类").toBeDefined()
    await click(skillTab!)
    await flushEffects()
    await flushEffects()

    const styleSubtab = findButton("文风")
    expect(styleSubtab, "技能库下应有「文风」子 tab").toBeDefined()
    await click(styleSubtab!)
    await flushEffects()
    await flushEffects()
    return dialogFor()
  }

  let activeView: Awaited<ReturnType<typeof renderChatPanel>> | null = null

  afterEach(async () => {
    // 断言失败时测试会直接抛出、跳过用例末尾的 unmount；而没卸载的面板还订阅着
    // `pendingReferenceTokens`，会把下一条用例的引用抢走（实测：M-DEAD 变异下
    // 冲突用例的红是这条级联造成的，不是它自己的断言）。所以统一在这里兜底卸载。
    if (activeView) {
      await activeView.unmount()
      activeView = null
    }
    vi.mocked(readFile).mockImplementation(async () => "")
    useChatStore.setState({ pendingReferenceTokens: [] })
  })

  async function renderPanel() {
    vi.mocked(readFile).mockImplementation(async (path: string) =>
      path.includes("writing-style.json") ? styleStore : "")
    activeView = await renderChatPanel({ activeConversation: true, aiWorkflowMode: "fast" })
    await flushEffects()
    await flushEffects()
    return activeView
  }

  it("从「文风」子 tab 引用一条文风并发送：getter 返回该预设 id", async () => {
    const view = await renderPanel()

    // 发送前：没有任何覆盖
    expect(writingStyleGetter()()).toBeUndefined()

    const dialog = await openStyleSubtab(view.container)
    const styleRow = Array.from(dialog.querySelectorAll("label"))
      .find((label) => label.textContent?.includes("甲书 · 文风"))
    expect(styleRow, "「文风」子 tab 里应列出项目里的文风预设").toBeDefined()
    await act(async () => {
      styleRow!.querySelector<HTMLInputElement>("input[type='checkbox']")!.click()
    })
    const confirm = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("确认引用"))
    await click(confirm!)

    // 芯片必须真的进入输入框（引用不是直接发送）
    const chip = view.container.querySelector('[data-reference-category="skill"]')
    expect(chip?.textContent, "选中后应插入引用芯片").toContain("甲书 · 文风")

    await typePrompt(view.container, "用这条文风写一段开头")
    await sendMessage(view.container)

    expect(
      writingStyleGetter()(),
      "@ 引用的文风必须成为本次生成的覆盖值",
    ).toBe("style-a")

    await waitForRunSettled("conv_mount")
  })

  it("同时引用两条不同文风：拒绝发送、保留输入，且不挑一条当赢家", async () => {
    const view = await renderPanel()

    await enqueueReferences([
      styleReferenceToken("ref-style-a", "style-a", "甲书 · 文风"),
      styleReferenceToken("ref-style-b", "style-b", "乙书 · 文风"),
    ])
    expect(view.container.querySelectorAll('[data-reference-category="skill"]')).toHaveLength(2)

    await typePrompt(view.container, "用这两条文风写一段")
    await sendMessage(view.container)

    expect(view.container.textContent).toContain("一条消息只能引用一条文风")
    expect(useChatStore.getState().messages, "拒绝发送时不得产生任何消息").toHaveLength(0)
    expect(
      view.container.querySelectorAll('[data-reference-category="skill"]'),
      "拒绝发送必须保留已选引用（否则用户要重选一遍）",
    ).toHaveLength(2)
    expect(writingStyleGetter()(), "冲突时不许静默挑一条").toBeUndefined()
  })

  it("工具栏选了「本次不用文风」时，本条消息的 @ 引用仍然生效", async () => {
    const view = await renderPanel()

    const trigger = view.container.querySelector<HTMLButtonElement>('[data-testid="writing-style-picker-trigger"]')
    expect(trigger, "输入工具栏应有「文风写作」选择器").not.toBeNull()
    await click(trigger)
    const popover = view.container.querySelector('[data-testid="writing-style-picker-popover"]')
    const disableOption = Array.from(popover!.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("本次不用文风"))
    await click(disableOption!)
    expect(writingStyleGetter()(), "「本次不用文风」= null，且不许被抹成 undefined").toBeNull()

    await enqueueReferences([styleReferenceToken("ref-style-a", "style-a", "甲书 · 文风")])
    await typePrompt(view.container, "这条消息点名用甲书文风")
    await sendMessage(view.container)

    expect(
      writingStyleGetter()(),
      "本条消息点名的文风必须赢过工具栏的「本次不用」——否则引用被静默丢掉",
    ).toBe("style-a")

    await waitForRunSettled("conv_mount")
  })

  it("上一条消息的 @ 文风不会漏进下一次生成", async () => {
    const view = await renderPanel()

    await enqueueReferences([styleReferenceToken("ref-style-a", "style-a", "甲书 · 文风")])
    await typePrompt(view.container, "第一条：用甲书文风")
    await sendMessage(view.container)
    expect(writingStyleGetter()()).toBe("style-a")
    await waitForRunSettled("conv_mount")

    await typePrompt(view.container, "第二条：没有引用任何文风")
    await sendMessage(view.container)
    expect(
      writingStyleGetter()(),
      "发送时写回 undefined：上一条消息点名的文风不得成为下一次生成的覆盖",
    ).toBeUndefined()

    await waitForRunSettled("conv_mount")
  })
})
