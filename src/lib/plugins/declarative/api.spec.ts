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

  it("toSlotActionEntry 带上传入的已授予权限；不传时是空数组", () => {
    const wire = { pluginId: "p1", id: "a", title: "A", prompt: {}, output: {} }
    expect(toSlotActionEntry(wire, ["fs:project-read"])?.grantedPermissions).toEqual(["fs:project-read"])
    // 缺省 = 什么都没授予（执行器据此拒绝读项目，而不是当成有权限）
    expect(toSlotActionEntry(wire)?.grantedPermissions).toEqual([])
  })

  it("toSlotPackEntry 同样带上已授予权限（内容包的 run-action 也会读项目）", () => {
    const meta = { pluginId: "p1", packId: "scifi", title: "科幻" }
    expect(toSlotPackEntry(meta, ["fs:project-read"])?.grantedPermissions).toEqual(["fs:project-read"])
    expect(toSlotPackEntry(meta)?.grantedPermissions).toEqual([])
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
    expect(entry?.pack.actions?.[0]).toMatchObject({ kind: "run-action", actionId: "expand", label: "让 AI 扩写" })
  })

  it("pack.id 保持包内 id，loadKey 才是合成键（取条目按 loadKey）", () => {
    const entry = toSlotPackEntry({
      pluginId: "p1",
      pluginName: "插件一",
      packId: "p1/scifi",
      id: "scifi",
      title: "科幻灵感包",
    })
    expect(entry?.pack.id).toBe("scifi")
    expect(entry?.loadKey).toBe("p1/scifi")
  })

  it("只有 packId 时退回它当包内 id，并合成 loadKey", () => {
    const entry = toSlotPackEntry({ pluginId: "p1", packId: "p1/scifi", title: "科幻" })
    expect(entry?.loadKey).toBe("p1/scifi")
    expect(entry?.pack.id).toBe("p1/scifi")
  })
})

describe("loadSlotIndex", () => {
  /** `plugins === null` 表示 `plugins_list` 这个命令不可用（未注册/失败）。 */
  function mockSlotCommands(actions: unknown[], packs: unknown[], plugins: unknown[] | null) {
    invoke.mockImplementation((command: string) => {
      if (command === "plugins_actions") return Promise.resolve(actions)
      if (command === "plugins_content_packs") return Promise.resolve(packs)
      if (command === "plugins_list") {
        return plugins === null ? Promise.reject("命令 plugins_list 未注册") : Promise.resolve(plugins)
      }
      return Promise.reject("未注册")
    })
  }

  it("把 action 与内容包分发到各自插槽，并按 id 去重", async () => {
    mockSlotCommands(
      [
        { pluginId: "p1", pluginName: "插件一", id: "a", title: "A", slot: "outline-toolbar", prompt: {}, output: {} },
        { pluginId: "p1", pluginName: "插件一", id: "a", title: "A", slot: "outline-toolbar", prompt: {}, output: {} },
      ],
      [{ pluginId: "p1", pluginName: "插件一", packId: "scifi", title: "科幻" }],
      [],
    )

    const { index, degraded } = await loadSlotIndex()
    expect(degraded).toBe(false)
    expect(index["outline-toolbar"].actions).toHaveLength(1)
    expect(index["plugin-center"].packs).toHaveLength(1)
  })

  it("从 plugins_list 按 pluginId join 出已授予权限（声明式动作的执行闸门靠它）", async () => {
    mockSlotCommands(
      [
        { pluginId: "p1", pluginName: "插件一", id: "a", title: "A", prompt: {}, output: {} },
        { pluginId: "p2", pluginName: "插件二", id: "b", title: "B", prompt: {}, output: {} },
      ],
      [{ pluginId: "p1", pluginName: "插件一", packId: "scifi", title: "科幻" }],
      [
        { id: "p1", grantedPermissions: ["fs:project-read", "net:https"] },
        // p2 没有授权；p3 根本不在清单里 —— 两者都必须落成 `[]`（失败方向是拒绝）
        { id: "p2", grantedPermissions: [] },
      ],
    )

    const { index } = await loadSlotIndex()
    // 按 pluginId 断言（桶内顺序由中文排序决定，与本用例无关）
    const byPlugin = new Map(index["plugin-center"].actions.map((entry) => [entry.pluginId, entry.grantedPermissions]))
    expect(byPlugin.get("p1")).toEqual(["fs:project-read", "net:https"])
    expect(byPlugin.get("p2")).toEqual([])
    expect(index["plugin-center"].packs[0].grantedPermissions).toEqual(["fs:project-read", "net:https"])
  })

  it("plugins_list 不可用 → 权限一律为空且标降级（宁可拒绝，也不放行）", async () => {
    mockSlotCommands(
      [{ pluginId: "p1", pluginName: "插件一", id: "a", title: "A", prompt: {}, output: {} }],
      [],
      null,
    )

    const { index, degraded } = await loadSlotIndex()
    expect(degraded).toBe(true)
    expect(index["plugin-center"].actions[0].grantedPermissions).toEqual([])
  })
})

describe("createDefaultRunDeps", () => {
  it("默认依赖：模型调用、项目/章节读取、配置读取全部接好（不再有「未接线」占位）", async () => {
    const deps = createDefaultRunDeps()

    // 四项都是可调用的真实实现
    expect(typeof deps.llm.call).toBe("function")
    expect(typeof deps.readProject).toBe("function")
    expect(typeof deps.readChapter).toBe("function")
    expect(typeof deps.getSelection).toBe("function")

    // 默认 store 里没选模型 → 可读中文原因（不会静默失败，也不会假装成功）
    await expect(
      deps.llm.call({ system: "", user: "" }, () => {}, new AbortController().signal),
    ).rejects.toThrow("当前模型不可用")

    invoke.mockResolvedValue({ style: "爆点" })
    await expect(deps.getConfig("p1")).resolves.toEqual({ style: "爆点" })
  })

  it("覆盖项优先（测试与将来的「指定模型」策略都从这里注入）", async () => {
    const llm = { call: vi.fn(async () => ({ text: "ok" })) }
    const deps = createDefaultRunDeps({ llm })
    await expect(deps.llm.call({ system: "", user: "" }, () => {}, new AbortController().signal)).resolves.toEqual({
      text: "ok",
    })

    const readProject = vi.fn(async () => ({ bookTitle: "长夜" }))
    await expect(createDefaultRunDeps({ llm, readProject }).readProject?.()).resolves.toEqual({ bookTitle: "长夜" })
  })
})
