/**
 * 命令封装的测试。
 *
 * 这里防的是**并行开发的时序风险**：Rust 侧命令还没注册时，前端不能崩、不能空白，
 * 但也**不能假装"插件没有能力"** —— 所以读命令要带 `degraded`，写命令要把 Rust
 * 的中文原文带回来。
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke }))

import {
  UNWIRED_LLM_MESSAGE,
  createDefaultRunDeps,
  declarativePluginsApi,
  loadSlotIndex,
  normalizeActionDeclaration,
  toSlotActionEntry,
  toSlotPackEntry,
} from "./api"

beforeEach(() => {
  invoke.mockReset()
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("命令未注册时的容错", () => {
  it("plugins_actions 失败 → 空数组，不抛错", async () => {
    invoke.mockRejectedValue("命令 plugins_actions 未注册")
    await expect(declarativePluginsApi.actions()).resolves.toEqual([])
  })

  it("plugins_content_packs / items / config_get 失败同样降级", async () => {
    invoke.mockRejectedValue(new Error("not found"))
    await expect(declarativePluginsApi.contentPacks()).resolves.toEqual([])
    await expect(declarativePluginsApi.contentPackItems("p1")).resolves.toEqual([])
    await expect(declarativePluginsApi.configGet("p1")).resolves.toEqual({})
    await expect(declarativePluginsApi.configSecretHas("p1", "apiKey")).resolves.toBe(false)
  })

  it("loadSlotIndex 标出 degraded，但索引仍然可用（6 个插槽都在）", async () => {
    invoke.mockRejectedValue("未注册")
    const result = await loadSlotIndex()
    expect(result.degraded).toBe(true)
    expect(result.index["plugin-center"]).toEqual({ actions: [], packs: [] })
    expect(result.index["outline-toolbar"]).toEqual({ actions: [], packs: [] })
  })

  it("写命令失败时把 Rust 的中文原文带回来（不吞错）", async () => {
    invoke.mockRejectedValue("配置校验失败：apiKey 不能为空")
    const result = await declarativePluginsApi.configSet("p1", { a: 1 })
    expect(result).toEqual({ ok: false, error: "配置校验失败：apiKey 不能为空" })
  })

  it("写命令成功返回 ok", async () => {
    invoke.mockResolvedValue(undefined)
    await expect(declarativePluginsApi.configSecretSet("p1", "apiKey", "sk-1")).resolves.toEqual({ ok: true })
    expect(invoke).toHaveBeenCalledWith("plugins_config_secret_set", {
      pluginId: "p1",
      field: "apiKey",
      value: "sk-1",
    })
  })
})

describe("命令返回值归一化", () => {
  it("内容包条目：字符串 JSON 走 parseContentPack", async () => {
    invoke.mockResolvedValue(
      JSON.stringify({ version: 1, items: [{ id: "i1", title: "地铁", body: "末班车", tags: ["悬疑"] }] }),
    )
    const items = await declarativePluginsApi.contentPackItems("scifi")
    expect(items).toEqual([{ id: "i1", title: "地铁", body: "末班车", tags: ["悬疑"] }])
  })

  it("内容包条目：坏 JSON / 坏内容 → 空数组", async () => {
    invoke.mockResolvedValue("{ 不是 json")
    await expect(declarativePluginsApi.contentPackItems("scifi")).resolves.toEqual([])
    invoke.mockResolvedValue(JSON.stringify({ version: 2, items: [] }))
    await expect(declarativePluginsApi.contentPackItems("scifi")).resolves.toEqual([])
  })

  it("扁平形状的 action wire 也能解析出插槽条目", () => {
    const entry = toSlotActionEntry({
      pluginId: "idea-generator",
      pluginName: "灵感生成器",
      id: "generate-titles",
      title: "生成书名",
      slot: "chapter-toolbar",
      prompt: { system: "sys", user: "{{genre}}" },
      output: { mode: "list", targets: [{ kind: "clipboard" }] },
    })

    expect(entry?.pluginId).toBe("idea-generator")
    expect(entry?.pluginName).toBe("灵感生成器")
    expect(entry?.action.slot).toBe("chapter-toolbar")
    expect(entry?.action.output.targets).toEqual([{ kind: "clipboard", label: "复制" }])
  })

  it("嵌套形状（action 字段）同样解析，且表单被归一化", () => {
    const entry = toSlotActionEntry({
      pluginId: "p1",
      pluginName: "插件一",
      packId: "scifi",
      action: {
        id: "expand",
        title: "扩写",
        form: { fields: [{ key: "text", type: "textarea", label: "正文", required: true }] },
        prompt: { system: "", user: "" },
        output: { mode: "text", targets: [] },
      },
    })

    expect(entry?.action.form?.fields[0].key).toBe("text")
  })

  it("没有 id 的 action 被丢弃", () => {
    expect(normalizeActionDeclaration({ title: "无 id" })).toBeUndefined()
    expect(toSlotActionEntry({ pluginId: "p1", title: "无 id" })).toBeUndefined()
  })

  it("未知的输出目标 kind 被丢弃（写通道白名单）", () => {
    const action = normalizeActionDeclaration({
      id: "a",
      title: "A",
      prompt: { system: "", user: "" },
      output: { mode: "text", targets: [{ kind: "write-file", label: "写文件" }, { kind: "clipboard" }] },
    })
    expect(action?.output.targets.map((target) => target.kind)).toEqual(["clipboard"])
  })

  it("内容包元信息：id 键名两种写法都认，条目留空待懒加载", () => {
    const entry = toSlotPackEntry({
      pluginId: "p1",
      pluginName: "插件一",
      id: "scifi",
      title: "科幻灵感包",
      slot: "inspiration-browser",
      actions: [{ kind: "run-action", actionId: "expand", label: "让 AI 扩写" }],
    })

    expect(entry?.pack.id).toBe("scifi")
    expect(entry?.pack.items).toEqual([])
    expect(entry?.pack.actions?.[0]).toMatchObject({ label: "让 AI 扩写" })
  })

  it("同时给了 packId（合成键）与 id 时，pack.id 用合成键（items 命令按它取值）", () => {
    const entry = toSlotPackEntry({
      pluginId: "p1",
      pluginName: "插件一",
      packId: "p1/scifi",
      id: "scifi",
      title: "科幻灵感包",
    })
    expect(entry?.pack.id).toBe("p1/scifi")
  })
})

describe("loadSlotIndex", () => {
  it("把 action 与内容包分发到各自插槽，并按 id 去重", async () => {
    invoke.mockImplementation((command: string) => {
      if (command === "plugins_actions") {
        return Promise.resolve([
          { pluginId: "p1", pluginName: "插件一", id: "a", title: "A", slot: "outline-toolbar", prompt: {}, output: {} },
          { pluginId: "p1", pluginName: "插件一", id: "a", title: "A", slot: "outline-toolbar", prompt: {}, output: {} },
        ])
      }
      if (command === "plugins_content_packs") {
        return Promise.resolve([{ pluginId: "p1", pluginName: "插件一", packId: "scifi", title: "科幻" }])
      }
      return Promise.reject("未注册")
    })

    const { index, degraded } = await loadSlotIndex()
    expect(degraded).toBe(false)
    expect(index["outline-toolbar"].actions).toHaveLength(1)
    expect(index["plugin-center"].packs).toHaveLength(1)
  })
})

describe("createDefaultRunDeps", () => {
  it("没接线时模型调用给出可读原因，配置读取走真实命令", async () => {
    const deps = createDefaultRunDeps()
    await expect(
      deps.llm.call({ system: "", user: "" }, () => {}, new AbortController().signal),
    ).rejects.toThrow(UNWIRED_LLM_MESSAGE)

    invoke.mockResolvedValue({ style: "爆点" })
    await expect(deps.getConfig("p1")).resolves.toEqual({ style: "爆点" })
  })

  it("覆盖项优先（接线任务只需传 llm）", async () => {
    const llm = { call: vi.fn(async () => ({ text: "ok" })) }
    const deps = createDefaultRunDeps({ llm })
    await expect(deps.llm.call({ system: "", user: "" }, () => {}, new AbortController().signal)).resolves.toEqual({
      text: "ok",
    })
  })
})
