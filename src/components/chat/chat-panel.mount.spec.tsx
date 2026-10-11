// @vitest-environment jsdom
import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { agentConfigArgs, renderChatPanel } from "@/test/chat-panel-mount"
import { clearTaskBreakpoint, loadTaskBreakpoint } from "@/lib/agent/task-breakpoint"
import type { Conversation } from "@/stores/chat-store"
import { useChatStore } from "@/stores/chat-store"
import { chatConversationRunRegistry } from "@/lib/conversation-run-registry"
import { createDirectory, deleteFile, listDirectory, readFile, writeFileAtomic } from "@/commands/fs"
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

/*
 * 点选工具栏「文风写作」里的一个选项（预设 / 「本次不用文风」/「跟随项目设置的文风」）。
 *
 * 放在模块级只此一份：丁-2 的产出端用例与丁-3 的消费端用例（含「@ 引用压过**具体**选中值」
 * 那条）都点同一个控件，两份实现会让其中一份漂移。
 */
async function pickWritingStyleOption(container: HTMLElement, text: string) {
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

    await pickWritingStyleOption(view.container, "甲书 · 文风")
    expect(writingStyleGetter()()).toBe("style-a")

    // 「本次不用文风」= null，且**不能**被抹成 undefined
    await pickWritingStyleOption(view.container, "本次不用文风")
    expect(writingStyleGetter()()).toBeNull()

    // 「跟随项目设置」把它退回没有覆盖
    await pickWritingStyleOption(view.container, "跟随项目设置的文风")
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

    await pickWritingStyleOption(view.container, "甲书 · 文风")

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
  /*
   * `enabledStyleId` 取 `style-c`（谁都没点选过的那条），只是**去掉 id 撞名的卫生改动**，
   * **不是**可演示的判别力增强 —— 实测把它改回 `"style-b"` 仍然全绿：
   * `toBe("style-b")` 读的是 getter 的直接返回值，而 getter 既不读 store、
   * 也不会落到项目启用项 ⇒「下游回退到项目启用项」这条通道在该断言处**根本不经过**。
   * 它留下的价值是**潜在**的：将来真有人把 store 的启用项泄进 getter 时，
   * 这里的值会是 `style-c` 而不是恰好与所选项相同，那时这条断言才有鉴别力。
   */
  const styleStore = JSON.stringify({
    version: 1,
    enabledStyleId: "style-c",
    styles: [
      { id: "style-a", name: "甲书 · 文风", sourceBook: "甲书", profile: { schemaVersion: 1 }, createdAt: 1, updatedAt: 1 },
      { id: "style-b", name: "乙书 · 文风", sourceBook: "乙书", profile: { schemaVersion: 1 }, createdAt: 1, updatedAt: 1 },
      { id: "style-c", name: "丙书 · 文风", sourceBook: "丙书", profile: { schemaVersion: 1 }, createdAt: 1, updatedAt: 1 },
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

    await pickWritingStyleOption(view.container, "本次不用文风")
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

  /*
   * ⚠️ 这条补的是**优先级裁决里最容易漏掉的那一半**。
   *
   * 「@ 引用 > 工具栏选择器」有两半：选择器是 `null`（本次不用）那一半，和
   * 选择器是**具体某一条**那一半。只钉 `null` 那一半是不够的 ——
   * 实测把 getter 改成「**具体选中值**赢、`null` 不赢」：
   *     () => (typeof sessionWritingStyleId === "string"
   *       ? sessionWritingStyleId
   *       : (ref.current !== undefined ? ref.current : sessionWritingStyleId))
   * 加上这条用例之前，mount spec 20 passed、**全量 738 文件 / 7419 通过 / 0 失败**、
   * typecheck exit 0 —— 也就是这个回归会全绿发布。
   * 而「工具栏选了乙书、又在同一条消息里 @ 甲书」正是最自然的真实交互。
   */
  it("工具栏选到**具体**一条文风时，本条消息的 @ 引用仍然赢", async () => {
    const view = await renderPanel()

    await pickWritingStyleOption(view.container, "乙书 · 文风")
    expect(writingStyleGetter()(), "工具栏的具体选中值应先生效").toBe("style-b")

    await enqueueReferences([styleReferenceToken("ref-style-a", "style-a", "甲书 · 文风")])
    await typePrompt(view.container, "这条消息点名改用甲书文风")
    await sendMessage(view.container)

    expect(
      writingStyleGetter()(),
      "工具栏选中了乙书、本条消息又 @ 了甲书 ⇒ 必须用甲书；否则用户刚敲的引用被静默丢弃",
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

/*
 * 丁-4「输入框引用角色灵魂」的消费端。
 *
 * 这组必须是**真实 UI 路径 + 真实存储层**，理由是丁-4 唯一可行的实现方式是
 * 「生成前真绑定、生成后还原」：
 *   - `buildCharacterSoulContext` 只过滤绑定表，没有第二条注入路径
 *     ⇒ 只断言「调用了 bindCharacterAura」是不够的，必须断言**绑定真的落到了
 *       上下文读取的那个文件上**，且生成结束后**真的被还原**；
 *   - release 的三个分支里有两个（原本就有同一条绑定 / 原本是另一条）只有
 *     在真覆盖语义下才可达 ⇒ 用 mock 掉存储层的写法根本走不到，是假绿。
 * 所以这里把 `@/commands/fs` 换成一个**只针对 `.qmai/character-aura.json` 的
 * 内存盘**：读盘/写盘都是真的（`loadCharacterAuraStore` / `writeFileAtomic`
 * 都走真代码），只是落点换成内存里的一个字符串。
 *
 * 下游那半程（绑定后的 aura 真的进 `contextPack.characterAuras`）由
 * `message-scoped-soul-binding.spec.ts` 与 `character-aura.spec.ts` 钉住。
 *
 * 用例统一用 `aiWorkflowMode: "fast"`：跳过 novel pre-plugin 链，
 * 让每个用例只依赖被测的那条通道。
 */
describe("ChatPanel 的「@ 引用角色灵魂」消费端（丁-4）", () => {
  const AURA_ID = "custom-xu"
  const CHARACTER_NAME = "陈拾"
  const ENTITIES_DIR = "C:/QMAI_C/QMAI-main/wiki/entities"

  function entityPage(name: string): string {
    return ["---", "type: entity", "tags: [character]", `title: "${name}"`, "---", "", `# ${name}`, ""].join("\n")
  }

  /**
   * 内存盘上的 `.qmai/character-aura.json`。
   * 每个用例重置；绑定/还原的断言全部读它，而不是读 mock 的调用参数。
   */
  let auraDisk = ""
  /**
   * 每一次写进 `.qmai/character-aura.json` 的**完整内容**（按发生顺序）。
   *
   * ⚠️ 为什么必须有它：本轮生成的 mock `streamChat` 是**同步完成**的，
   * 所以「点确认」之后回到断言时，`finally` 里的还原**可能已经跑完** ——
   * 只看最终盘面会把「先绑定、后还原」误读成「压根没绑过」。
   * 写入日志让「真的绑过」和「最后还原了」成为两个各自独立可查的事实，
   * 而不是被时序夹在中间的二选一。
   */
  let auraWrites: string[] = []

  function bindingsOf(raw: string): Array<{ characterName: string; auraId: string }> {
    return (JSON.parse(raw) as { bindings: Array<{ characterName: string; auraId: string }> }).bindings
  }

  function diskBindings(): Array<{ characterName: string; auraId: string }> {
    return bindingsOf(auraDisk)
  }

  /** 写入日志里是否出现过「把 auraId 绑给 characterName」这一笔。 */
  function wroteBinding(characterName: string, auraId: string): boolean {
    return auraWrites.some((raw) =>
      bindingsOf(raw).some((binding) => binding.characterName === characterName && binding.auraId === auraId),
    )
  }

  function installDisk(characterNames: string[], initialBindings: Array<{ characterName: string; auraId: string }> = []) {
    auraWrites = []
    auraDisk = JSON.stringify({
      customAuras: [{
        id: AURA_ID,
        builtIn: false,
        name: "许七安",
        category: "古装权谋",
        sourceNote: "拆书结果",
        corpus: "抄诗、断案、铜锣腰牌",
        styleDescription: "先调侃后收束。",
        behaviorRules: "遇事先问证据。",
        boundaries: "不替角色下道德结论。",
        notes: "",
      }],
      bindings: initialBindings,
    })
    /*
     * 只有 `wiki/entities` 有内容：这是让 `hasCharacterProfile` 为真的**真实**路径
     * （它会先查 `listBindableNovelCharacters`）。不 mock `character-aura` 的任何导出——
     * 一 mock 就等于把「真绑定」这件事换成「我以为我调用了它」。
     */
    vi.mocked(listDirectory).mockImplementation(async (path: string) => {
      if (String(path).replace(/\\/g, "/").endsWith("/wiki/entities")) {
        return characterNames.map((name) => ({
          name: `${name}.md`,
          path: `${ENTITIES_DIR}/${name}.md`,
          is_dir: false,
          size: 100,
          mtimeMs: 1,
        })) as never
      }
      return [] as never
    })
    vi.mocked(readFile).mockImplementation(async (path: string) => {
      const normalized = String(path).replace(/\\/g, "/")
      if (normalized.endsWith(".qmai/character-aura.json")) return auraDisk
      if (normalized.startsWith(`${ENTITIES_DIR}/`)) {
        const name = normalized.slice(ENTITIES_DIR.length + 1).replace(/\.md$/, "")
        if (characterNames.includes(name)) return entityPage(name)
      }
      // 其它一切（配置、风格库、技能库、缓存）都读不到 —— 逐一返回空串会让
      // `JSON.parse("")` 抛错，但那几处 loader 都自带 try/catch、退化成空库。
      return ""
    })
    vi.mocked(writeFileAtomic).mockImplementation(async (path: string, content: string) => {
      if (String(path).replace(/\\/g, "/").endsWith(".qmai/character-aura.json")) {
        auraDisk = content
        auraWrites.push(content)
      }
    })
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
    await flushEffects()
  }

  async function waitForRunSettled(conversationId: string) {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (useChatStore.getState().runStates[conversationId]?.status !== "running") return
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }
    throw new Error(`会话 ${conversationId} 的运行没有在预期轮数内结束`)
  }

  /**
   * 等到条件成立（或超时抛错）。盘面相关的断言**一律**用它，不要用「等运行结束」代替。
   *
   * ⚠️ `waitForRunSettled` 在「运行还没开始」时**立刻返回**
   * （`runStates[id]` 是 `undefined`，而 `undefined?.status !== "running"` 为真），
   * 而点确认之后那串「读绑定表 → 校验人物档案 → 写盘 → 起运行」要跑好几轮异步，
   * 所以「先等运行结束、再断言盘面」会把「还在写」误判成「没写」。
   * 本机空载时它常常刚好跑完，**CPU 一忙就红** —— 实测：全量套件并行时本组
   * 两条用例失败（一条报「临时绑定没写进去」、一条报盘上还是临时那条），
   * 单独跑同一个文件则全绿，且失败的两条**都不走**「同一条就跳过」那条分支。
   * ⇒ 条件等待同时也回答了「这事到底发生了没有」，比猜轮数可靠。
   */
  async function waitFor(condition: () => boolean, message: string, attempts = 400) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (condition()) return
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1))
      })
    }
    throw new Error(`等待超时：${message}`)
  }

  /** 打开引用弹窗 → 「技能库」分类 → 「角色灵魂」子 tab，返回弹窗元素。 */
  async function openSoulSubtab(container: HTMLElement) {
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

    const soulSubtab = findButton("角色灵魂")
    expect(soulSubtab, "技能库下应有「角色灵魂」子 tab").toBeDefined()
    await click(soulSubtab!)
    await flushEffects()
    await flushEffects()
    return dialogFor()
  }

  const soulDialog = () => document.body.querySelector<HTMLElement>('[data-testid="soul-binding-target-dialog"]')

  /** 在确认弹窗里选人物名并点确认。 */
  async function confirmSoulBinding(characterName: string) {
    const dialog = soulDialog()
    expect(dialog, "发送后应弹出「绑给哪个小说人物」的确认弹窗").not.toBeNull()
    const radio = dialog!.querySelector<HTMLInputElement>(
      `input[type="radio"][aria-label="绑定到${characterName}"]`,
    )
    expect(radio, `确认弹窗里应能选「${characterName}」`).not.toBeNull()
    await click(radio)
    const confirm = dialog!.querySelector<HTMLButtonElement>('[data-testid="soul-binding-confirm"]')
    expect(confirm?.disabled, "选定人物后「用这条灵魂生成」应可用").toBe(false)
    await click(confirm)
    await flushEffects()
    await flushEffects()
  }

  let activeView: Awaited<ReturnType<typeof renderChatPanel>> | null = null

  beforeEach(() => {
    installDisk([CHARACTER_NAME])
  })

  afterEach(async () => {
    if (activeView) {
      await activeView.unmount()
      activeView = null
    }
    vi.mocked(readFile).mockImplementation(async () => "")
    vi.mocked(listDirectory).mockImplementation(async () => [] as never)
    vi.mocked(writeFileAtomic).mockImplementation(async () => {})
    useChatStore.setState({ pendingReferenceTokens: [] })
  })

  async function renderPanel() {
    activeView = await renderChatPanel({ activeConversation: true, aiWorkflowMode: "fast" })
    await flushEffects()
    await flushEffects()
    return activeView
  }

  it("从「角色灵魂」子 tab 引用一条灵魂并发送：先真绑定到所选人物，生成结束后还原", async () => {
    const view = await renderPanel()

    // 发送前：项目里没有任何绑定
    expect(diskBindings()).toEqual([])

    const dialog = await openSoulSubtab(view.container)
    const soulRow = Array.from(dialog.querySelectorAll("label"))
      .find((label) => label.textContent?.includes("许七安"))
    expect(soulRow, "「角色灵魂」子 tab 里应列出项目里的角色灵魂").toBeDefined()
    await act(async () => {
      soulRow!.querySelector<HTMLInputElement>("input[type='checkbox']")!.click()
    })
    const confirm = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("确认引用"))
    await click(confirm!)

    const chip = view.container.querySelector('[data-reference-category="skill"]')
    expect(chip?.textContent, "选中后应插入引用芯片").toContain("许七安")

    await typePrompt(view.container, "按许七安的口气写一段")
    await sendMessage(view.container)

    // 生成前：真的绑上了（读盘验证，而不是看调用参数）
    await confirmSoulBinding(CHARACTER_NAME)

    /*
     * 两件事各自独立成立，顺序也钉住了：
     *  1. 临时绑定**真的写过盘**（否则这条灵魂进不了上下文）；
     *  2. 最后盘面上什么都没有（这条绑定只对上面那一条消息生效）。
     * ⚠️ 必须用**条件等待**，不能等运行结束再断言：确认之后那串异步链
     * （读绑定表 → 校验人物档案 → 写盘）要跑好几轮，而 mock 的生成又快，
     * 断在中间会把「还在写」误判成「没写」。写入日志让「写过」这件事不依赖断言的时刻。
     */
    await waitFor(
      () => wroteBinding(CHARACTER_NAME, AURA_ID),
      "确认之后临时绑定没有写进 .qmai/character-aura.json",
    )
    await waitFor(
      () => diskBindings().length === 0,
      "生成结束后临时绑定没有被还原（它会静默影响之后所有章节）",
    )

    // 再断一次：条件等待是「发生了没有」，这两条是「最终状态对不对」。
    expect(
      wroteBinding(CHARACTER_NAME, AURA_ID),
      "确认之后绑定必须真的落进 .qmai/character-aura.json —— 否则这条灵魂进不了上下文",
    ).toBe(true)
    expect(
      diskBindings(),
      "生成结束后临时绑定必须被还原，否则它会静默影响之后所有章节",
    ).toEqual([])
    // 第一笔是临时绑定、最后一笔把它清掉：两笔都在，说明还原不是「空转」。
    expect(bindingsOf(auraWrites[0]), "第一笔写入应是临时绑定").toEqual([
      { characterName: CHARACTER_NAME, auraId: AURA_ID },
    ])
    expect(bindingsOf(auraWrites.at(-1)!), "最后一笔写入应是还原后的空绑定表").toEqual([])
  })

  /*
   * 用户**本来就有**这条绑定：还原不许把它删掉。
   *
   * ⚠️ 这一条只有走**真存储层**才可达：`bindCharacterAura` 按人物名一对一
   * **覆盖**，所以「用完就 unbind」那种最朴素的清理会在这里把用户的绑定删掉
   * —— 而 mock 掉存储层的写法根本遇不到这个状态。
   */
  it("用户本来就有这条绑定：生成结束后它必须还在（不许误删）", async () => {
    installDisk([CHARACTER_NAME], [{ characterName: CHARACTER_NAME, auraId: AURA_ID }])
    const view = await renderPanel()

    await enqueueSoulReference(view.container)
    await typePrompt(view.container, "按许七安的口气写一段")
    await sendMessage(view.container)
    await confirmSoulBinding(CHARACTER_NAME)

    await waitFor(
      () => wroteBinding(CHARACTER_NAME, AURA_ID),
      "临时绑定没有写进 .qmai/character-aura.json",
    )
    await waitFor(
      () => diskBindings().length === 1,
      "生成结束后盘上没有回到「用户原本那条绑定」",
    )

    expect(
      diskBindings(),
      "原本就存在的绑定不是「临时绑定」，绝不能因为本轮生成结束而被删掉",
    ).toEqual([{ characterName: CHARACTER_NAME, auraId: AURA_ID }])
  })

  /*
   * 用户本来绑的是**另一条**灵魂：还原必须把原值写回去，而不是解绑。
   * 这是 release 三个分支里损失面最大的一个 —— 走错就是「用户的绑定没了，
   * 而它原本指向哪条灵魂已经找不回来」。
   */
  it("用户原本绑的是另一条灵魂：生成结束后原绑定必须原样还原", async () => {
    installDisk([CHARACTER_NAME], [{ characterName: CHARACTER_NAME, auraId: "builtin-li-si" }])
    const view = await renderPanel()

    await enqueueSoulReference(view.container)
    await typePrompt(view.container, "按许七安的口气写一段")
    await sendMessage(view.container)
    await confirmSoulBinding(CHARACTER_NAME)

    // 覆盖确实发生过（临时那条真的写进去过），这样下面的还原才不是空转
    await waitFor(
      () => wroteBinding(CHARACTER_NAME, AURA_ID),
      "临时绑定没有写进 .qmai/character-aura.json",
    )
    await waitFor(
      () => diskBindings().some((item) => item.auraId === "builtin-li-si"),
      "生成结束后没有把用户原本那条绑定写回原位",
    )

    expect(wroteBinding(CHARACTER_NAME, AURA_ID)).toBe(true)

    expect(
      diskBindings(),
      "本轮结束必须把用户原本那条绑定写回原位，而不是解绑",
    ).toEqual([{ characterName: CHARACTER_NAME, auraId: "builtin-li-si" }])
  })

  it("用户取消确认弹窗：不发送、不写盘、输入与引用原样保留", async () => {
    const view = await renderPanel()

    await enqueueSoulReference(view.container)
    await typePrompt(view.container, "这条先不发")
    await sendMessage(view.container)

    const dialog = soulDialog()
    expect(dialog, "应弹出确认弹窗").not.toBeNull()
    const cancel = Array.from(dialog!.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "取消")
    await click(cancel!)
    await flushEffects()

    expect(diskBindings(), "取消不得写任何绑定").toEqual([])
    expect(useChatStore.getState().messages, "取消不得产生任何消息").toHaveLength(0)
    expect(
      view.container.querySelectorAll('[data-reference-category="skill"]'),
      "取消必须保留已选引用",
    ).toHaveLength(1)
    /*
     * 「取消」必须走**取消**这一支，而不是掉进「绑定失败」再被 catch 吞成一句提示。
     * 少了这条断言，把 `if (!targetCharacterName) return` 那一行删掉时
     * （= 拿一个空人物名继续往下走）上面三条**全部仍然通过** —— 因为
     * `beginMessageScopedSoulBinding` 会先抛「请选择要把角色灵魂绑定到哪个小说人物」，
     * 同样不写盘、同样不产生消息。差别只在用户看到的提示：取消不该看到任何报错。
     */
    expect(view.container.textContent).not.toContain("请选择要把角色灵魂绑定到哪个小说人物")
    expect(view.container.textContent).not.toContain("绑定角色灵魂失败")
    expect(
      useChatStore.getState().runStates["conv_mount"]?.status,
      "取消时不该占用运行槽",
    ).toBeUndefined()
  })

  it("人物没有档案时：把「先补人物小传」这条原话显示出来，且不写盘、不发送", async () => {
    installDisk([]) // 没有任何人物档案
    const view = await renderPanel()

    await enqueueSoulReference(view.container)
    await typePrompt(view.container, "按许七安的口气写一段")
    await sendMessage(view.container)

    // 没有可绑定人物 ⇒ 确认弹窗里直接给出可操作指引，确认按钮不可用
    const dialog = soulDialog()
    expect(dialog, "应弹出确认弹窗").not.toBeNull()
    expect(dialog!.textContent).toContain("请先在大纲中添加人物小传或人物设定，再绑定角色灵魂")
    expect(
      dialog!.querySelector<HTMLButtonElement>('[data-testid="soul-binding-confirm"]')?.disabled,
      "没有可选人物时不许确认",
    ).toBe(true)

    expect(diskBindings(), "绑定失败路径一个字都不该写").toEqual([])
    expect(useChatStore.getState().messages, "绑定失败时不得开始生成").toHaveLength(0)
  })

  it("同时引用两条不同灵魂：拒绝发送、保留输入，且不挑一条当赢家", async () => {
    const view = await renderPanel()

    await enqueueReferences([
      soulReferenceToken("ref-soul-xu", AURA_ID, "许七安"),
      soulReferenceToken("ref-soul-li", "builtin-li-si", "李斯"),
    ])
    expect(view.container.querySelectorAll('[data-reference-category="skill"]')).toHaveLength(2)

    await typePrompt(view.container, "用这两条灵魂写一段")
    await sendMessage(view.container)

    expect(view.container.textContent).toContain("一条消息只能引用一条角色灵魂")
    expect(useChatStore.getState().messages, "拒绝发送时不得产生任何消息").toHaveLength(0)
    expect(
      view.container.querySelectorAll('[data-reference-category="skill"]'),
      "拒绝发送必须保留已选引用",
    ).toHaveLength(2)
    expect(soulDialog(), "冲突时不该弹确认弹窗（连问都不该问）").toBeNull()
    expect(diskBindings(), "冲突时不许静默挑一条绑定").toEqual([])
  })

  it("上一条消息的 @ 灵魂不会漏进下一次生成", async () => {
    const view = await renderPanel()

    await enqueueSoulReference(view.container)
    await typePrompt(view.container, "第一条：用许七安")
    await sendMessage(view.container)
    await confirmSoulBinding(CHARACTER_NAME)
    await waitFor(
      () => wroteBinding(CHARACTER_NAME, AURA_ID),
      "第一条消息的临时绑定没有写进 .qmai/character-aura.json",
    )
    await waitFor(() => diskBindings().length === 0, "第一条消息的临时绑定没有被还原")
    expect(diskBindings()).toEqual([])

    await typePrompt(view.container, "第二条：没有引用任何灵魂")
    await sendMessage(view.container)

    expect(soulDialog(), "第二条消息没有再引用灵魂，不许再弹确认").toBeNull()
    expect(diskBindings(), "第二条消息不该产生任何绑定").toEqual([])

    await waitForRunSettled("conv_mount")
  })

  /** 灵魂条目在 token 上的形状必须与 `createSkillProvider` 的透传一致。 */
  function soulReferenceToken(id: string, auraId: string, name: string): ReferenceToken {
    return {
      id,
      category: "skill",
      title: name,
      skillId: auraId,
      skillSubtype: "soul",
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

  async function enqueueSoulReference(container: HTMLElement) {
    await enqueueReferences([soulReferenceToken("ref-soul-xu", AURA_ID, "许七安")])
    expect(container.querySelectorAll('[data-reference-category="skill"]')).toHaveLength(1)
  }
})
