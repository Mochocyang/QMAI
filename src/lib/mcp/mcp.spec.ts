import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_NOVEL_CONFIG, useWikiStore, type LlmConfig, type ProviderConfigs } from "@/stores/wiki-store"
import { registerOpenDocument } from "./open-document"
import { formatProjectChapter } from "./format-chapter"
import { saveProjectDocument } from "./save-document"
import { extractProjectMemory } from "./extract-memory"
import { planPageRename } from "@/lib/wiki/rename-page"
import { renameProjectDocument } from "./rename-document"
import { buildAgentInstallText, buildMcpConfigInstallText, buildSkillInstallText } from "./copy-text"
import { compareSemver, decideSkillSync, parseSkillVersion, syncQmaiMcpSkill, type SkillSyncIo } from "./skill-sync"
import { resolveWritingParameters } from "./writing-parameters"
import { runWritingConversation } from "./writing-conversation"
import { stopProjectWriting } from "./stop-writing"
import { createWritingProgressStore } from "./writing-progress"

const baseConfig: LlmConfig = {
  provider: "custom",
  apiKey: "test-key",
  model: "",
  ollamaUrl: "",
  customEndpoint: "https://example.test/v1",
  maxContextSize: 8192,
}

const providerConfigs: ProviderConfigs = {
  custom: {
    enabled: true,
    apiKey: "test-key",
    savedModels: [
      { id: "writer", name: "Writer", model: "writer-model", createdAt: 1 },
      { id: "workflow", name: "Workflow", model: "workflow-model", createdAt: 2 },
    ],
  },
}

afterEach(() => {
  registerOpenDocument(null)
  useWikiStore.setState({
    aiChatModel: "",
    aiWorkflowMode: "standard",
    aiChatReasoningDepth: "auto",
    defaultLlmModel: "",
    providerConfigs: {},
    novelConfig: { ...DEFAULT_NOVEL_CONFIG },
    project: null,
    llmConfig: baseConfig,
  })
})

describe("MCP documents", () => {
  it("rejects paths outside the project and does not format or ingest on save", async () => {
    const write = vi.fn(async () => {})
    await expect(saveProjectDocument({
      projectPath: "/book",
      path: "/book/QM/chapters/../../secret.md",
      content: "x",
    }, write)).rejects.toThrow("只能操作当前项目知识库中的章节或大纲文件")
    expect(write).not.toHaveBeenCalled()
    const saved = await saveProjectDocument({
      projectPath: "/book",
      path: "/book/QM/chapters/第1章.md",
      content: "正文",
    }, write)
    expect(saved).toContain("已保存")
    expect(write).toHaveBeenCalledWith("/book/QM/chapters/第1章.md", "正文")
    const saveSource = readFileSync(new URL("./save-document.ts", import.meta.url), "utf8")
    const extractSource = readFileSync(new URL("./extract-memory.ts", import.meta.url), "utf8")
    expect(saveSource).not.toContain("formatChapterWriting")
    expect(saveSource).not.toContain("ingestChapter")
    expect(extractSource).not.toContain("formatChapterWriting")
    expect(extractSource).toContain("ingestChapter")
  })

  it("refuses to overwrite a dirty editor unless overwrite is set", async () => {
    registerOpenDocument({
      path: "/book/wiki/chapters/第1章.md",
      isDirty: () => true,
      applyMarkdown: () => {},
    })
    const write = vi.fn(async () => {})
    await expect(saveProjectDocument({
      projectPath: "/book",
      path: "/book/wiki/chapters/第1章.md",
      content: "新正文",
    }, write)).rejects.toThrow("未保存的修改")
    expect(write).not.toHaveBeenCalled()
    await saveProjectDocument({
      projectPath: "/book",
      path: "/book/wiki/chapters/第1章.md",
      content: "新正文",
      overwrite: true,
    }, write)
    expect(write).toHaveBeenCalledOnce()
  })

  it("formats chapter paragraphs and rejects outlines", async () => {
    const files = new Map<string, string>([[
      "/book/QM/chapters/第1章.md",
      "---\ntitle: \"第1章\"\n---\n# 第1章\n\n```\ncode\n```\n\n你好世界。",
    ]])
    const io = {
      readFile: async (path: string) => files.get(path) ?? "",
      writeFile: async (path: string, content: string) => { files.set(path, content) },
    }
    await formatProjectChapter({ projectPath: "/book", path: "/book/QM/chapters/第1章.md" }, io)
    const formatted = files.get("/book/QM/chapters/第1章.md") ?? ""
    expect(formatted).toContain("　　你好世界。")
    expect(formatted).toContain("# 第1章")
    expect(formatted).toContain("```\ncode\n```")
    expect(formatted).not.toContain("　　code")
    await expect(formatProjectChapter({
      projectPath: "/book",
      path: "/book/QM/outlines/大纲.md",
    }, io)).rejects.toThrow("只能排版章节正文")
  })

  it("rejects duplicate titles, chapter number conflicts, and draft extraction", async () => {
    const duplicate = planPageRename({
      path: "/book/QM/chapters/a.md",
      nextTitle: "既有",
      content: "# 旧\n",
      type: "chapter",
      currentTitle: "旧",
      siblings: [{ path: "/book/QM/chapters/b.md", title: "既有", type: "chapter", chapterNumber: 2 }],
    })
    expect(duplicate.status).toBe("rejected")
    const conflict = planPageRename({
      path: "/book/QM/chapters/a.md",
      nextTitle: "第2章 新名字",
      content: "---\ntitle: \"第1章\"\nchapter_number: 1\n---\n# 第1章\n",
      type: "chapter",
      currentTitle: "第1章",
      siblings: [{ path: "/book/QM/chapters/b.md", title: "第2章", type: "chapter", chapterNumber: 2 }],
    })
    expect(conflict.message).toBe("章节号与已有章节冲突")

    const ingestChapter = vi.fn()
      .mockResolvedValueOnce({ snapshot: null, failReason: "not_final", error: "章节不是正式稿" })
      .mockResolvedValueOnce({ snapshot: { chapterNumber: 1 } })
    const ingestOutline = vi.fn(async () => ({ snapshot: { chapterNumber: 3 }, failureReason: null, truncated: false, originalLength: 0, bodyLength: 0, bodyBudget: 0 }))
    await expect(extractProjectMemory({
      projectPath: "/book",
      path: "/book/QM/chapters/第1章.md",
    }, { ingestChapter: ingestChapter as never, ingestOutline: ingestOutline as never })).rejects.toThrow("章节不是正式稿")
    expect(ingestChapter).toHaveBeenCalledWith("/book", "/book/QM/chapters/第1章.md", undefined, undefined, undefined, { allowDraft: false })
    await expect(extractProjectMemory({
      projectPath: "/book",
      path: "/book/QM/chapters/第1章.md",
      allowDraft: true,
    }, { ingestChapter: ingestChapter as never, ingestOutline: ingestOutline as never })).resolves.toContain("章节记忆提取完成")
    expect(ingestChapter).toHaveBeenLastCalledWith("/book", "/book/QM/chapters/第1章.md", undefined, undefined, undefined, { allowDraft: true })
  })

  it("renames by writing the new path and deleting the old file", async () => {
    const files = new Map<string, string>([[
      "/book/QM/outlines/旧.md",
      "---\ntitle: \"旧\"\n---\n# 旧\n正文",
    ]])
    const renamed = await renameProjectDocument({
      projectPath: "/book",
      path: "/book/QM/outlines/旧.md",
      title: "新大纲",
      siblings: [],
    }, {
      readFile: async (path) => files.get(path) ?? "",
      writeFile: async (path, content) => { files.set(path, content) },
      deleteFile: async (path) => { files.delete(path) },
      fileExists: async (path) => files.has(path),
    })
    expect(renamed.title).toBe("新大纲")
    expect(files.has("/book/QM/outlines/旧.md")).toBe(false)
    expect(files.get(renamed.path)).toContain("title: \"新大纲\"")
    expect(files.get(renamed.path)).toContain("# 新大纲")
  })
})

describe("writing parameters", () => {
  it("uses a saved legacy Antigravity chat model without requiring an enabled field", () => {
    const selected = "antigravity-cli/gemini-4-argon-medium"
    useWikiStore.setState({
      aiChatModel: selected,
      aiWorkflowMode: "standard",
      providerConfigs: {
        ...providerConfigs,
        "antigravity-cli": {
          model: "gemini-3.8-flash-high",
          savedModels: [
            { id: "flash", name: "Flash", model: "gemini-3.8-flash-high", createdAt: 1 },
            { id: "argon", name: "Argon", model: "gemini-4-argon-medium", createdAt: 2 },
          ],
        },
      },
      llmConfig: baseConfig,
      novelConfig: { ...DEFAULT_NOVEL_CONFIG, defaultLlmModel: "custom/workflow-model" },
    })
    const resolved = resolveWritingParameters()
    expect(resolved.chapterWritingLlm.provider).toBe("antigravity-cli")
    expect(resolved.chapterWritingLlm.model).toBe("gemini-4-argon-medium")
    expect(resolved.agentLlm.model).toBe("workflow-model")
    expect(useWikiStore.getState().aiChatModel).toBe(selected)
    expect(useWikiStore.getState().providerConfigs["antigravity-cli"].enabled).toBeUndefined()

    useWikiStore.setState({ providerConfigs: {
      ...useWikiStore.getState().providerConfigs,
      "antigravity-cli": { ...useWikiStore.getState().providerConfigs["antigravity-cli"], enabled: false },
    } })
    expect(() => resolveWritingParameters()).toThrow("聊天框选中的写作模型不可用")
  })

  it.each(["fast", "standard", "strict", "discuss"] as const)("inherits the selected %s mode and keeps body and orchestration models separate", (mode) => {
    useWikiStore.setState({
      aiChatModel: "custom/writer-model",
      aiWorkflowMode: mode,
      providerConfigs,
      llmConfig: baseConfig,
      defaultLlmModel: "custom/workflow-model",
      novelConfig: { ...DEFAULT_NOVEL_CONFIG, defaultLlmModel: "custom/workflow-model" },
    })
    const resolved = resolveWritingParameters()
    expect(resolved.workflowMode).toBe(mode)
    expect(resolved.chapterWritingLlm.model).toBe("writer-model")
    expect(resolved.agentLlm.model).toBe(mode === "fast" ? "writer-model" : "workflow-model")
    expect(useWikiStore.getState().aiWorkflowMode).toBe(mode)
  })

  it("reads the current chat mode again for each call without caching it", () => {
    useWikiStore.setState({
      aiChatModel: "custom/writer-model",
      providerConfigs,
      llmConfig: baseConfig,
      novelConfig: { ...DEFAULT_NOVEL_CONFIG, defaultLlmModel: "custom/workflow-model" },
    })
    for (const mode of ["strict", "fast", "discuss", "standard"] as const) {
      useWikiStore.setState({ aiWorkflowMode: mode })
      expect(resolveWritingParameters().workflowMode).toBe(mode)
    }
  })

  it("overrides only this call's body model and mode while retaining the configured workflow model", () => {
    useWikiStore.setState({
      aiChatModel: "custom/writer-model",
      aiWorkflowMode: "discuss",
      providerConfigs,
      llmConfig: baseConfig,
      novelConfig: { ...DEFAULT_NOVEL_CONFIG, defaultLlmModel: "custom/workflow-model" },
    })
    const resolved = resolveWritingParameters({ workflowMode: "strict", model: "custom/writer-model" })
    expect(resolved.workflowMode).toBe("strict")
    expect(resolved.chapterWritingLlm.model).toBe("writer-model")
    expect(resolved.agentLlm.model).toBe("workflow-model")
    expect(useWikiStore.getState().aiWorkflowMode).toBe("discuss")
    expect(useWikiStore.getState().aiChatModel).toBe("custom/writer-model")
    expect(useWikiStore.getState().novelConfig.defaultLlmModel).toBe("custom/workflow-model")
  })

  it.each(["custom/missing-model", "disabled/writer-model"])("rejects an unavailable selection %s instead of silently using the default", (selected) => {
    useWikiStore.setState({
      aiChatModel: selected,
      aiWorkflowMode: "standard",
      providerConfigs: { ...providerConfigs, disabled: { ...providerConfigs.custom, enabled: false } },
      llmConfig: baseConfig,
      novelConfig: { ...DEFAULT_NOVEL_CONFIG, defaultLlmModel: "custom/workflow-model" },
    })
    expect(() => resolveWritingParameters()).toThrow("聊天框选中的写作模型不可用")
    expect(useWikiStore.getState().aiChatModel).toBe(selected)
    expect(resolveWritingParameters({ model: "custom/writer-model" }).chapterWritingLlm.model).toBe("writer-model")
  })

  it("uses the default only when no chat model is selected", () => {
    useWikiStore.setState({
      aiChatModel: "",
      providerConfigs,
      llmConfig: baseConfig,
      novelConfig: { ...DEFAULT_NOVEL_CONFIG, defaultLlmModel: "custom/workflow-model" },
    })
    expect(resolveWritingParameters().chapterWritingLlm.model).toBe("workflow-model")
  })

  it("uses the current mode and model when the call omits them, and does not write them back", () => {
    useWikiStore.setState({
      aiChatModel: "custom/writer-model",
      aiWorkflowMode: "standard",
      aiChatReasoningDepth: "low",
      defaultLlmModel: "custom/workflow-model",
      providerConfigs,
      llmConfig: baseConfig,
      novelConfig: { ...DEFAULT_NOVEL_CONFIG, defaultLlmModel: "custom/workflow-model" },
    })
    const resolved = resolveWritingParameters({})
    expect(resolved.workflowMode).toBe("standard")
    expect(resolved.reasoningDepth).toBe("low")
    expect(resolved.agentLlm.model).toBe("workflow-model")
    expect(resolved.chapterWritingLlm.model).toBe("writer-model")
    expect(useWikiStore.getState().aiWorkflowMode).toBe("standard")
    expect(useWikiStore.getState().aiChatModel).toBe("custom/writer-model")
  })

  it("applies an override only to this call", () => {
    useWikiStore.setState({
      aiChatModel: "custom/writer-model",
      aiWorkflowMode: "standard",
      defaultLlmModel: "custom/workflow-model",
      providerConfigs,
      llmConfig: baseConfig,
      novelConfig: { ...DEFAULT_NOVEL_CONFIG, defaultLlmModel: "custom/workflow-model" },
    })
    const resolved = resolveWritingParameters({ workflowMode: "fast", model: "custom/workflow-model", reasoningDepth: "high" })
    expect(resolved.workflowMode).toBe("fast")
    expect(resolved.agentLlm.model).toBe("workflow-model")
    expect(resolved.agentLlm.reasoning).toEqual({ mode: "high" })
    expect(useWikiStore.getState().aiWorkflowMode).toBe("standard")
    expect(useWikiStore.getState().aiChatModel).toBe("custom/writer-model")
    expect(() => resolveWritingParameters({ model: "missing-model" })).toThrow("找不到写作模型")
  })
})

describe("writing conversation", () => {
  it("creates a conversation and saves it without calling a real model", async () => {
    useWikiStore.setState({
      aiChatModel: "custom/writer-model",
      aiWorkflowMode: "standard",
      providerConfigs,
      llmConfig: baseConfig,
      novelConfig: { ...DEFAULT_NOVEL_CONFIG, defaultLlmModel: "custom/workflow-model" },
      project: null,
    })
    const saved: { current: { conversations: { id: string }[]; messages: { role: string; content: string }[] } | null } = { current: null }
    const reply = await runWritingConversation({
      projectPath: "/books/demo",
      message: "继续写下一章",
    }, {
      progressStore: createWritingProgressStore({ read: async () => "", write: async () => {} }),
      loadHistory: async () => ({ conversations: [], messages: [], runStates: {} }),
      saveHistory: async (_path, conversations, messages) => {
        saved.current = { conversations, messages }
      },
      readLive: () => null,
      runSession: async (ctx) => {
        expect(ctx.workflowMode).toBe("standard")
        expect(ctx.agentLlm.model).toBe("workflow-model")
        expect(ctx.chapterWritingLlm.model).toBe("writer-model")
        return "这是回复"
      },
    })
    expect(reply).toContain("这是回复")
    expect(reply).toContain("正文模型：writer-model")
    expect(reply).toContain("工作流模型：workflow-model")
    expect(saved.current?.conversations).toHaveLength(1)
    expect(saved.current?.messages.map((message) => message.role)).toEqual(["user", "assistant"])
    expect(useWikiStore.getState().aiWorkflowMode).toBe("standard")
  })

  it("rejects a second call while one is still running for the same project", async () => {
    useWikiStore.setState({
      aiChatModel: "custom/writer-model",
      providerConfigs,
      llmConfig: baseConfig,
      novelConfig: { ...DEFAULT_NOVEL_CONFIG, defaultLlmModel: "custom/writer-model" },
      project: null,
    })
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const first = runWritingConversation({
      projectPath: "/books/locked",
      message: "第一句",
    }, {
      progressStore: createWritingProgressStore({ read: async () => "", write: async () => {} }),
      loadHistory: async () => ({ conversations: [], messages: [], runStates: {} }),
      saveHistory: async () => {},
      readLive: () => null,
      runSession: async () => {
        await gate
        return "完成"
      },
    })
    await expect(runWritingConversation({
      projectPath: "/books/locked",
      message: "第二句",
    }, {
      progressStore: createWritingProgressStore({ read: async () => "", write: async () => {} }),
      loadHistory: async () => ({ conversations: [], messages: [], runStates: {} }),
      saveHistory: async () => {},
      readLive: () => null,
      runSession: async () => "不该执行",
    })).rejects.toThrow("进行中的写作对话")
    release()
    await first
  })

  it("stops an in-flight writing conversation and records the stop", async () => {
    useWikiStore.setState({
      aiChatModel: "custom/writer-model",
      providerConfigs,
      llmConfig: baseConfig,
      novelConfig: { ...DEFAULT_NOVEL_CONFIG, defaultLlmModel: "custom/writer-model" },
      project: null,
    })
    let entered: () => void = () => {}
    const ready = new Promise<void>((resolve) => { entered = resolve })
    const saved: { current: { role: string; content: string }[] | null } = { current: null }
    const running = runWritingConversation({
      projectPath: "/books/stop",
      message: "编写第 200 章",
    }, {
      progressStore: createWritingProgressStore({ read: async () => "", write: async () => {} }),
      loadHistory: async () => ({ conversations: [], messages: [], runStates: {} }),
      saveHistory: async (_path, _conversations, messages) => {
        saved.current = messages
      },
      readLive: () => null,
      runSession: (ctx) => new Promise((_resolve, reject) => {
        entered()
        ctx.signal?.addEventListener("abort", () => reject(new Error("操作已取消")), { once: true })
      }),
    })
    await ready
    expect(stopProjectWriting("/books/stop")).toBe("已停止生成。")
    await expect(running).resolves.toBe("已停止生成。")
    expect(saved.current?.map((message) => message.content)).toEqual(["编写第 200 章", "已停止生成。"])
    expect(stopProjectWriting("/books/stop")).toBe("当前没有正在进行的写作生成。")
  })
})

describe("skill sync", () => {
  it("parses versions and decides without writing when nothing changed", () => {
    expect(parseSkillVersion("---\nmetadata:\n  version: 1.2.3\n---\n")).toBe("1.2.3")
    expect(parseSkillVersion("---\nmetadata:\n  version: bad\n---\n")).toBeNull()
    expect(compareSemver("1.0.0", "1.0.1")).toBe(-1)
    expect(decideSkillSync({ parentExists: false, bundledVersion: "1.0.0", installedVersion: null }).status).toBe("skipped")
    expect(decideSkillSync({ parentExists: true, bundledVersion: "1.0.0", installedVersion: "1.0.0" }).status).toBe("unchanged")
    expect(decideSkillSync({ parentExists: true, bundledVersion: "1.0.0", installedVersion: "2.0.0" }).status).toBe("kept-newer")
    expect(decideSkillSync({ parentExists: true, bundledVersion: "1.0.1", installedVersion: null }).status).toBe("updated")
    expect(decideSkillSync({ parentExists: true, bundledVersion: "1.0.1", installedVersion: "1.0.0" }).message).toContain("1.0.0")
  })

  it("replaces only qmai-mcp and leaves sibling skills alone", async () => {
    const files = new Map<string, string>([
      ["/skills/other-skill/SKILL.md", "keep"],
      ["/bundle/SKILL.md", "---\nmetadata:\n  version: 1.0.1\n---\nnew"],
      ["/skills/qmai-mcp/SKILL.md", "---\nmetadata:\n  version: 1.0.0\n---\nold"],
    ])
    const io = memoryIo(files)
    const report = await syncQmaiMcpSkill({ bundledDir: "/bundle", agentSkillsDir: "/skills", io })
    expect(report.status).toBe("updated")
    expect(files.get("/skills/qmai-mcp/SKILL.md")).toContain("version: 1.0.1")
    expect(files.get("/skills/other-skill/SKILL.md")).toBe("keep")
    const writesBefore = io.writes
    const same = await syncQmaiMcpSkill({ bundledDir: "/bundle", agentSkillsDir: "/skills", io })
    expect(same.status).toBe("unchanged")
    expect(io.writes).toBe(writesBefore)
    files.set("/skills/qmai-mcp/SKILL.md", "---\nmetadata:\n  version: not-a-version\n---\n")
    const repaired = await syncQmaiMcpSkill({ bundledDir: "/bundle", agentSkillsDir: "/skills", io })
    expect(repaired.status).toBe("updated")
    const missingParent = await syncQmaiMcpSkill({
      bundledDir: "/bundle",
      agentSkillsDir: "/missing",
      io: memoryIo(files, new Set(["/skills"])),
    })
    expect(missingParent.status).toBe("skipped")
    expect(files.has("/missing/qmai-mcp/SKILL.md")).toBe(false)
  })
})

describe("install copy text", () => {
  it.each([
    "/Applications/青幕 AI.app/Contents/MacOS/青幕AI写作",
    "C:\\Program Files\\青幕AI写作\\青幕AI写作.exe",
    '/Applications/青幕 "测试".app/Contents/MacOS/青幕AI写作',
  ])("copies importable MCP JSON and preserves the executable path: %s", (executablePath) => {
    expect(JSON.parse(buildMcpConfigInstallText(executablePath))).toEqual({
      mcpServers: {
        qmai: {
          command: executablePath,
          args: ["--mcp-stdio"],
        },
      },
    })
  })

  it("includes the absolute command path and the skill version", () => {
    const config = buildMcpConfigInstallText("C:/Program Files/青幕AI写作/青幕AI写作.exe")
    expect(config).toContain("C:/Program Files/青幕AI写作/青幕AI写作.exe")
    expect(config).toContain("--mcp-stdio")
    const skill = buildSkillInstallText("/Applications/青幕.app/Contents/Resources/skills/qmai-mcp", "1.0.0")
    const combined = buildAgentInstallText("C:/Program Files/青幕AI写作/青幕AI写作.exe", "/Applications/青幕.app/Contents/Resources/skills/qmai-mcp", "1.0.0")
    expect(combined).toContain(config)
    expect(combined).toContain(skill)
    expect(skill).toContain("请安装 qmai-mcp 1.0.0")
    expect(skill).toContain("/Applications/青幕.app/Contents/Resources/skills/qmai-mcp")
    expect(skill).toContain("覆盖已有同名目录")
  })
})

function memoryIo(files: Map<string, string>, directories = new Set(["/skills", "/bundle"])): SkillSyncIo & { writes: number } {
  const io = {
    writes: 0,
    async exists(path: string) {
      const normalized = path.replace(/\/+$/, "")
      if ([...files.keys()].some((file) => file === normalized || file.startsWith(`${normalized}/`))) return true
      return directories.has(normalized)
    },
    async readFile(path: string) {
      const content = files.get(path)
      if (content === undefined) throw new Error("missing")
      return content
    },
    async copyDir(source: string, destination: string) {
      io.writes += 1
      directories.add(destination)
      for (const [path, content] of files) {
        if (path === source || path.startsWith(`${source}/`)) {
          const relative = path.slice(source.length).replace(/^\//, "")
          const target = relative ? `${destination}/${relative}` : destination
          if (relative) files.set(target, content)
        }
      }
    },
    async remove(path: string) {
      io.writes += 1
      for (const key of [...files.keys()]) {
        if (key === path || key.startsWith(`${path}/`)) files.delete(key)
      }
    },
  }
  return io
}
