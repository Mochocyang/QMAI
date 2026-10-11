/**
 * 丁-4：「只对这一条消息生效」的角色灵魂绑定 —— **真**存储路径。
 *
 * 这个文件刻意**不** mock `character-aura.ts`：整条链（
 * `beginMessageScopedSoulBinding` → `bindCharacterAura` → `hasCharacterProfile`
 * → `listBindableNovelCharacters` → `saveCharacterAuraStore`）都走真实现，
 * 只把 `@/commands/fs` 换成一个内存盘。理由是本子批最容易失守的一条
 * 就是「按人物名一对一覆盖」那个语义：
 *   - 用 mock 掉 `bindCharacterAura` 的写法，只能验证「我调用了它」，
 *     验证不了「它会把同名人物原有的绑定顶掉」——而还原逻辑正是为这条语义写的；
 *   - 还原三个分支里有两个（「原本就是同一条」与「原本是另一条」）只有在
 *     真覆盖语义下才**可达**，mock 版根本走不到，于是是一条杀不掉任何东西的假绿。
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  createDirectory: vi.fn(),
  fileExists: vi.fn(),
  listDirectory: vi.fn(),
  readFile: vi.fn(),
  writeFileAtomic: vi.fn(),
}))

vi.mock("@/lib/has-usable-llm", () => ({ hasUsableLlm: vi.fn(() => false) }))
vi.mock("@/lib/llm-client", () => ({ streamChat: vi.fn() }))
vi.mock("@/lib/search", () => ({ searchWiki: vi.fn(async () => []) }))
vi.mock("@/lib/tauri-fetch", () => ({ getHttpFetch: vi.fn() }))
vi.mock("@/lib/web-search", () => ({ webSearch: vi.fn() }))
vi.mock("@/stores/wiki-store", () => ({
  useWikiStore: {
    getState: () => ({
      llmConfig: { provider: "openai", apiKey: "", model: "", ollamaUrl: "", customEndpoint: "", maxContextSize: 128000 },
      providerConfigs: {},
      aiChatModel: "",
      defaultLlmModel: "",
      novelConfig: { defaultLlmModel: "" },
    }),
  },
}))

import { listDirectory, readFile, writeFileAtomic } from "@/commands/fs"
import { bindableCharactersCachePath } from "./bindable-characters-cache"
import { buildCharacterSoulContext } from "./character-aura"
import {
  beginMessageScopedSoulBinding,
  describePortablePersonalityRisk,
  describeSoulBlastRadius,
  releaseMessageScopedSoulBinding,
  type MessageScopedSoulBinding,
} from "./message-scoped-soul-binding"
import { contextPackToPrompt } from "./context-engine"
import { personality } from "@/test-helpers/portable-personality-fixture"

const PROJECT_PATH = "E:/Novel"
const AURA_STORE_PATH = `${PROJECT_PATH}/.qmai/character-aura.json`
const ENTITIES_DIR = `${PROJECT_PATH}/wiki/entities`

const mockListDirectory = vi.mocked(listDirectory)
const mockReadFile = vi.mocked(readFile)
const mockWriteFileAtomic = vi.mocked(writeFileAtomic)

type DiskFile = { name: string; path: string; is_dir: boolean; children?: DiskFile[] }

/** 内存盘：只放 `character-aura.json` 与人物实体页，其它路径一律读失败。 */
let auraStoreRaw = ""
let entityNames: string[] = []

function entityPage(name: string): string {
  return ["---", "type: entity", "tags: [character]", `title: "${name}"`, "---", "", `# ${name}`, ""].join("\n")
}

/** 读回磁盘上的绑定表。所有断言都走它，而不是断言 mock 的调用参数。 */
async function diskBindings(): Promise<Array<{ characterName: string; auraId: string; aliases?: string[] }>> {
  return JSON.parse(auraStoreRaw).bindings
}

beforeEach(() => {
  vi.clearAllMocks()
  auraStoreRaw = JSON.stringify({ customAuras: [], bindings: [] })
  entityNames = []
  mockReadFile.mockImplementation(async (path: string) => {
    if (path === AURA_STORE_PATH) return auraStoreRaw
    if (path.endsWith(".qmai/character-aura.json")) return auraStoreRaw
    if (path.startsWith(`${ENTITIES_DIR}/`)) {
      const name = path.slice(ENTITIES_DIR.length + 1).replace(/\.md$/, "")
      if (entityNames.includes(name)) return entityPage(name)
    }
    throw new Error(`missing: ${path}`)
  })
  mockListDirectory.mockImplementation(async (path: string) => {
    if (path === ENTITIES_DIR) {
      return entityNames.map<DiskFile>((name) => ({
        name: `${name}.md`,
        path: `${ENTITIES_DIR}/${name}.md`,
        is_dir: false,
      }))
    }
    throw new Error(`missing dir: ${path}`)
  })
  mockWriteFileAtomic.mockImplementation(async (path: string, content: string) => {
    if (path === AURA_STORE_PATH || path.endsWith(".qmai/character-aura.json")) {
      auraStoreRaw = content
      return
    }
    if (path === bindableCharactersCachePath(PROJECT_PATH)) return
    throw new Error(`unexpected write: ${path}`)
  })
})

describe("beginMessageScopedSoulBinding", () => {
  it("写入临时绑定，并把该人物此前的绑定快照带回来", async () => {
    entityNames = ["李四"]
    auraStoreRaw = JSON.stringify({
      customAuras: [{ id: "custom-a", name: "甲灵魂" }, { id: "custom-b", name: "乙灵魂" }],
      bindings: [],
    })

    const binding = await beginMessageScopedSoulBinding(PROJECT_PATH, { auraId: "custom-b", characterName: "李四" })

    expect(binding).toEqual({ characterName: "李四", auraId: "custom-b", previousBinding: null })
    expect(await diskBindings()).toEqual([{ characterName: "李四", auraId: "custom-b" }])
  })

  it("人物没有档案时抛出可操作的原话，且**磁盘上一个字都没写**", async () => {
    // 没有任何实体页/大纲页 ⇒ listBindableNovelCharacters 拿不到「王五」，
    // searchWiki 也被 mock 成空 ⇒ hasCharacterProfile 为 false。
    entityNames = ["李四"]
    auraStoreRaw = JSON.stringify({ customAuras: [{ id: "custom-a", name: "甲灵魂" }], bindings: [] })
    const before = auraStoreRaw

    await expect(
      beginMessageScopedSoulBinding(PROJECT_PATH, { auraId: "custom-a", characterName: "王五" }),
    ).rejects.toThrow("请先在大纲中添加人物小传或人物设定，再绑定角色灵魂")

    expect(auraStoreRaw).toBe(before)
  })

  it("灵魂 id 不存在时抛出「请选择有效的角色灵魂」，且不写盘", async () => {
    entityNames = ["李四"]
    auraStoreRaw = JSON.stringify({ customAuras: [], bindings: [] })
    const before = auraStoreRaw

    await expect(
      beginMessageScopedSoulBinding(PROJECT_PATH, { auraId: "custom-不存在", characterName: "李四" }),
    ).rejects.toThrow("请选择有效的角色灵魂")

    expect(auraStoreRaw).toBe(before)
  })

  it("人物名为空白时直接拒绝（调用方不该把空名字递进来）", async () => {
    await expect(
      beginMessageScopedSoulBinding(PROJECT_PATH, { auraId: "custom-a", characterName: "   " }),
    ).rejects.toThrow("请选择要把角色灵魂绑定到哪个小说人物")
  })
})

describe("releaseMessageScopedSoulBinding", () => {
  it("原本没有绑定：释放后删掉临时那条（绑定表回到空）", async () => {
    entityNames = ["李四"]
    auraStoreRaw = JSON.stringify({ customAuras: [{ id: "custom-b", name: "乙灵魂" }], bindings: [] })
    const binding = await beginMessageScopedSoulBinding(PROJECT_PATH, { auraId: "custom-b", characterName: "李四" })

    await releaseMessageScopedSoulBinding(PROJECT_PATH, binding)

    expect(await diskBindings()).toEqual([])
  })

  it("⚠️ 用户本来就有**同一条**绑定：释放后它必须还在（不许误删）", async () => {
    entityNames = ["李四"]
    auraStoreRaw = JSON.stringify({
      customAuras: [{ id: "custom-b", name: "乙灵魂" }],
      bindings: [{ characterName: "李四", auraId: "custom-b" }],
    })

    const binding = await beginMessageScopedSoulBinding(PROJECT_PATH, { auraId: "custom-b", characterName: "李四" })
    expect(binding.previousBinding).toEqual({ characterName: "李四", auraId: "custom-b" })

    await releaseMessageScopedSoulBinding(PROJECT_PATH, binding)

    expect(await diskBindings()).toEqual([{ characterName: "李四", auraId: "custom-b" }])
  })

  it("⚠️ 本来就是**同一条**灵魂、且带着 aliases：释放后 aliases 必须回来", async () => {
    /*
     * 这条是复核批抓出来的真缺口（探针实测），现有用例原本看不见它：
     * 上面那条「同一条」用例的既有绑定**没有** aliases，所以
     * 「释放时短路返回」与「按快照写回」在那里表现完全一样。
     *
     * 机制：`beginMessageScopedSoulBinding` 只把 `{ characterName, auraId }`
     * 递给 `bindCharacterAura`，后者落盘 `{ ...binding, characterName }`
     * ⇒ **临时写入这一步就已经把 aliases 抹掉了**。于是「同一条」时盘上
     * 并不是原样，「什么都不做」= 永久删掉用户的别名。
     * 别名不是装饰：`buildCharacterSoulContext` 靠它认人，删了就改变上下文。
     */
    entityNames = ["李四"]
    auraStoreRaw = JSON.stringify({
      customAuras: [{ id: "custom-b", name: "乙灵魂" }],
      bindings: [{ characterName: "李四", auraId: "custom-b", aliases: ["四哥"] }],
    })

    const binding = await beginMessageScopedSoulBinding(PROJECT_PATH, { auraId: "custom-b", characterName: "李四" })
    expect(binding.previousBinding).toEqual({ characterName: "李四", auraId: "custom-b", aliases: ["四哥"] })
    // 因果链的第一半：临时写入之后盘上**只剩** characterName + auraId，aliases 没了。
    expect(
      await diskBindings(),
      "临时写入会把 aliases 丢掉 —— 这正是「同一条」也必须写回的原因",
    ).toEqual([{ characterName: "李四", auraId: "custom-b" }])

    await releaseMessageScopedSoulBinding(PROJECT_PATH, binding)

    expect(
      await diskBindings(),
      "同一条灵魂时也必须按快照完整写回，否则用户的别名被静默删掉",
    ).toEqual([{ characterName: "李四", auraId: "custom-b", aliases: ["四哥"] }])
  })

  it("⚠️ 用户本来有**另一条**绑定：临时覆盖后必须原样还原（含 aliases）", async () => {
    entityNames = ["李四"]
    auraStoreRaw = JSON.stringify({
      customAuras: [{ id: "custom-a", name: "甲灵魂" }, { id: "custom-b", name: "乙灵魂" }],
      bindings: [{ characterName: "李四", auraId: "custom-a", aliases: ["四哥"] }],
    })

    const binding = await beginMessageScopedSoulBinding(PROJECT_PATH, { auraId: "custom-b", characterName: "李四" })
    expect(binding.previousBinding).toEqual({ characterName: "李四", auraId: "custom-a", aliases: ["四哥"] })
    // 覆盖语义：此刻磁盘上只有临时那一条（这正是必须快照的原因）
    expect(await diskBindings()).toEqual([{ characterName: "李四", auraId: "custom-b" }])

    await releaseMessageScopedSoulBinding(PROJECT_PATH, binding)

    expect(await diskBindings()).toEqual([{ characterName: "李四", auraId: "custom-a", aliases: ["四哥"] }])
  })

  it("还原是幂等的：连按两次不会把用户原有的绑定删掉", async () => {
    entityNames = ["李四"]
    auraStoreRaw = JSON.stringify({
      customAuras: [{ id: "custom-a", name: "甲灵魂" }, { id: "custom-b", name: "乙灵魂" }],
      bindings: [{ characterName: "李四", auraId: "custom-a" }],
    })
    const binding = await beginMessageScopedSoulBinding(PROJECT_PATH, { auraId: "custom-b", characterName: "李四" })

    await releaseMessageScopedSoulBinding(PROJECT_PATH, binding)
    await releaseMessageScopedSoulBinding(PROJECT_PATH, binding)

    expect(await diskBindings()).toEqual([{ characterName: "李四", auraId: "custom-a" }])
  })

  it("原本没有绑定、连按两次释放：第二次是 no-op（不会牵连别人）", async () => {
    entityNames = ["李四", "赵六"]
    auraStoreRaw = JSON.stringify({
      customAuras: [{ id: "custom-b", name: "乙灵魂" }, { id: "custom-c", name: "丙灵魂" }],
      bindings: [{ characterName: "赵六", auraId: "custom-c" }],
    })
    const binding = await beginMessageScopedSoulBinding(PROJECT_PATH, { auraId: "custom-b", characterName: "李四" })

    await releaseMessageScopedSoulBinding(PROJECT_PATH, binding)
    await releaseMessageScopedSoulBinding(PROJECT_PATH, binding)

    expect(await diskBindings()).toEqual([{ characterName: "赵六", auraId: "custom-c" }])
  })
})

describe("确认弹窗要告诉用户的文本", () => {
  it("影响范围：点名人物名 + 说明匹配是包含式（含拼音/简繁）且不按章节过滤", () => {
    const text = describeSoulBlastRadius("李四")

    // 用户的原话要求：让他知道「会在提到『李四』的章节生效」
    expect(text).toContain("李四")
    expect(text).toContain("包含式")
    // 与 character-aura.ts 的匹配实现逐条对应，别写成比实现更窄的承诺
    expect(text).toContain("拼音")
    expect(text).toContain("简繁")
    expect(text).toContain("不会按章节范围过滤")
  })

  it("人名缺失时也有可读文案，不出现空的「」", () => {
    expect(describeSoulBlastRadius("  ")).not.toContain("「」")
  })

  it("人格风险文案与 fail-closed 断言的原话一致（不是预算结论，是失败模式说明）", () => {
    const text = describePortablePersonalityRisk()

    expect(text).toContain("上下文预算不足，角色人格规则未完整保留")
    // 它**不**断言「这次一定超预算」——本批没有做预检，别把文案写成结论
    expect(text).not.toContain("本次已超预算")
  })
})

/*
 * 风险 6（fail-closed 硬停机）选的是 (乙)「接受该失败模式」。
 * 这条用例就是 (乙) 要求的那颗钉子：**真绑定**一条带 portablePersonality 的
 * 拆书灵魂之后，预算装不下时抛出的必须是那条**可读**错误，
 * 而不是别的东西（比如 TypeError、或者干脆静默丢掉人格规则）。
 */
describe("风险 6：带人格规则的灵魂装不下预算时，抛的是那条可读错误", () => {
  it("buildCharacterSoulContext 产出的角色人格规则被裁掉 ⇒ contextPackToPrompt 抛出可读错误", async () => {
    entityNames = ["陆衡"]
    auraStoreRaw = JSON.stringify({
      customAuras: [{ id: "custom-persona", name: "许七安", portablePersonality: personality }],
      bindings: [],
    })
    await beginMessageScopedSoulBinding(PROJECT_PATH, { auraId: "custom-persona", characterName: "陆衡" })

    const soul = await buildCharacterSoulContext(PROJECT_PATH, "陆衡查账")
    expect(soul.portablePersonalities).toHaveLength(1)

    const pack = {
      task: "陆衡查账",
      chapterGoal: "", outline: "大纲内容".repeat(500), recentSummaries: [], previousChapterEnding: "",
      characterStates: "", soulDoc: "", storyFrameworkBinding: "", cognitionStates: "",
      foreshadowingStates: "", timeline: "", relatedSettings: "", canonRules: "",
      writingStyle: "", searchResults: "", graphSearchResults: "", mustDo: "", mustAvoid: "",
      nextChapterAdvice: "", revisionDirectives: "", recentChapterContents: [],
      characterAuras: soul.text,
      portablePersonalities: soul.portablePersonalities,
    }

    // 预算极小时：人格规则整段进不了提示词 ⇒ 必须停机，且错误可读
    expect(() => contextPackToPrompt(pack, 200)).toThrow("上下文预算不足，角色人格规则未完整保留")
    // 对照：预算充足时同一个 pack 能完整带上人格规则（证明上面不是「恒抛」的假绿）
    expect(contextPackToPrompt(pack, 12000)).toContain(soul.text)

    await releaseMessageScopedSoulBinding(PROJECT_PATH, {
      characterName: "陆衡", auraId: "custom-persona", previousBinding: null,
    } satisfies MessageScopedSoulBinding)
    expect(await diskBindings()).toEqual([])
  })
})
