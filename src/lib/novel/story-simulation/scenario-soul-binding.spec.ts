import { beforeEach, describe, expect, it, vi } from "vitest"

const fsMocks = vi.hoisted(() => ({
  fileExists: vi.fn(async () => false),
  writeFileAtomic: vi.fn(async () => {}),
}))

vi.mock("@/commands/fs", () => ({
  fileExists: fsMocks.fileExists,
  writeFileAtomic: fsMocks.writeFileAtomic,
}))

const auraMocks = vi.hoisted(() => ({
  bindCharacterAura: vi.fn(async () => ({ customAuras: [], bindings: [] })),
}))

vi.mock("@/lib/novel/character-aura", async () => {
  const actual = await vi.importActual<typeof import("@/lib/novel/character-aura")>(
    "@/lib/novel/character-aura",
  )
  return { ...actual, bindCharacterAura: auraMocks.bindCharacterAura }
})

import { CHARACTER_AURA_BINDING_BLOCK_MESSAGE } from "@/lib/novel/character-aura"
import { parseFrontmatter, type FrontmatterValue } from "@/lib/frontmatter"
import type { ScenarioCandidate } from "./scenario-types"
import {
  bindScenarioSoul,
  buildProfileDraftFromCandidate,
  buildProfilePageContent,
  createProfilePageThenBind,
  isMissingProfileError,
  scenarioProfileFileName,
  scenarioProfilePagePath,
} from "./scenario-soul-binding"

const PROJECT = "/proj"

function makeCandidate(
  overrides: Partial<ScenarioCandidate> = {},
): ScenarioCandidate {
  return {
    id: "沈砚",
    name: "沈砚",
    profile: "账房出身，谨慎寡言",
    auraId: null,
    auraName: null,
    speakingStyle: "短句，先问再答",
    personality: ["谨慎", "寡言"],
    knowledgeScope: ["账目", "东家底细"],
    doesNotKnow: ["北境的战事"],
    ...overrides,
  }
}

describe("buildProfileDraftFromCandidate", () => {
  it("用已提取的信息拼出小传：姓名 / 性格 / 风格 / 认知", () => {
    const draft = buildProfileDraftFromCandidate(makeCandidate())
    expect(draft).toContain("# 沈砚")
    expect(draft).toContain("谨慎、寡言")
    expect(draft).toContain("短句，先问再答")
    expect(draft).toContain("- 账目")
    expect(draft).toContain("- 北境的战事")
  })

  it("已有灵魂时把灵魂写进基本信息", () => {
    const draft = buildProfileDraftFromCandidate(
      makeCandidate({ auraId: "a1", auraName: "账房先生" }),
    )
    expect(draft).toContain("灵魂：账房先生")
  })

  it("性格与风格缺省时落成「（待补充）」，不留空行", () => {
    const draft = buildProfileDraftFromCandidate(
      makeCandidate({ personality: [], speakingStyle: "" }),
    )
    expect(draft.match(/（待补充）/g)?.length).toBe(2)
  })

  it("认知范围各最多 10 条", () => {
    const draft = buildProfileDraftFromCandidate(
      makeCandidate({
        knowledgeScope: Array.from({ length: 12 }, (_, i) => `知道${i}`),
        doesNotKnow: Array.from({ length: 12 }, (_, i) => `不知道${i}`),
      }),
    )
    expect(draft).toContain("- 知道9")
    expect(draft).not.toContain("- 知道10")
    expect(draft).toContain("- 不知道9")
    expect(draft).not.toContain("- 不知道10")
  })

  it("完全没有认知信息时不渲染认知段落", () => {
    const draft = buildProfileDraftFromCandidate(
      makeCandidate({ knowledgeScope: [], doesNotKnow: [] }),
    )
    expect(draft).not.toContain("## 认知范围")
  })

  it("结尾留一行说明，标明这是可改的草稿", () => {
    expect(buildProfileDraftFromCandidate(makeCandidate())).toContain(
      "由「舞台情景」根据已写章节自动整理",
    )
  })
})

describe("buildProfilePageContent", () => {
  it("frontmatter 是 type=entity + tags 含 character（才认得出可绑定人物）", () => {
    const page = buildProfilePageContent(
      "沈砚",
      "# 沈砚",
      new Date("2026-10-12T00:00:00Z"),
    )
    expect(page).toContain("type: entity")
    expect(page).toContain("tags: [character]")
    expect(page).toContain('title: "沈砚"')
    expect(page).toContain("created: 2026-10-12")
    expect(page).toContain("# 沈砚")
  })

  it("正文被去掉了首尾空白", () => {
    const page = buildProfilePageContent(
      "沈砚",
      "\n\n# 沈砚\n\n",
      new Date("2026-10-12T00:00:00Z"),
    )
    expect(page.endsWith("# 沈砚\n")).toBe(true)
  })
})

describe("scenarioProfileFileName / scenarioProfilePagePath", () => {
  it("把文件名非法字符换成连字符", () => {
    expect(scenarioProfileFileName('林/清:越*?"<>|')).toBe("林-清-越------")
  })

  it("空白名回退为「未命名角色」", () => {
    expect(scenarioProfileFileName("   ")).toBe("未命名角色")
  })

  it("落盘路径是 wiki/entities 下的同名 md", () => {
    expect(scenarioProfilePagePath(PROJECT, "沈砚")).toBe("/proj/wiki/entities/沈砚.md")
  })
})

describe("isMissingProfileError", () => {
  it("只认 character-aura 自己那条文案", () => {
    expect(
      isMissingProfileError(new Error(CHARACTER_AURA_BINDING_BLOCK_MESSAGE)),
    ).toBe(true)
    expect(isMissingProfileError(new Error("磁盘满了"))).toBe(false)
    expect(isMissingProfileError("字符串错误")).toBe(false)
  })
})

describe("bindScenarioSoul", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auraMocks.bindCharacterAura.mockResolvedValue({ customAuras: [], bindings: [] })
  })

  it("成功时返回 ok", async () => {
    await expect(bindScenarioSoul(PROJECT, "沈砚", "aura-1")).resolves.toEqual({
      ok: true,
    })
    expect(auraMocks.bindCharacterAura).toHaveBeenCalledWith(PROJECT, {
      characterName: "沈砚",
      auraId: "aura-1",
    })
  })

  it("缺小传时归类为 missing-profile，而不是笼统的失败", async () => {
    auraMocks.bindCharacterAura.mockRejectedValueOnce(
      new Error(CHARACTER_AURA_BINDING_BLOCK_MESSAGE),
    )
    await expect(bindScenarioSoul(PROJECT, "沈砚", "aura-1")).resolves.toEqual({
      ok: false,
      reason: "missing-profile",
    })
  })

  it("其它错误原样带出 message，不吞错", async () => {
    auraMocks.bindCharacterAura.mockRejectedValueOnce(new Error("磁盘满了"))
    await expect(bindScenarioSoul(PROJECT, "沈砚", "aura-1")).resolves.toEqual({
      ok: false,
      reason: "error",
      message: "磁盘满了",
    })
  })
})

describe("createProfilePageThenBind", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsMocks.fileExists.mockResolvedValue(false)
    auraMocks.bindCharacterAura.mockResolvedValue({ customAuras: [], bindings: [] })
  })

  it("页不存在时先写盘再绑定，created=true", async () => {
    const result = await createProfilePageThenBind(PROJECT, "沈砚", "aura-1", "# 沈砚")
    expect(result).toEqual({ ok: true, created: true })
    expect(fsMocks.writeFileAtomic).toHaveBeenCalledWith(
      "/proj/wiki/entities/沈砚.md",
      expect.stringContaining("tags: [character]"),
    )
    expect(auraMocks.bindCharacterAura).toHaveBeenCalledTimes(1)
  })

  it("页已存在时绝不覆盖：跳过写入，created=false，但仍绑定", async () => {
    fsMocks.fileExists.mockResolvedValue(true)
    const result = await createProfilePageThenBind(
      PROJECT,
      "沈砚",
      "aura-1",
      "# 我手写的小传",
    )
    expect(result).toEqual({ ok: true, created: false })
    expect(fsMocks.writeFileAtomic).not.toHaveBeenCalled()
    expect(auraMocks.bindCharacterAura).toHaveBeenCalledTimes(1)
  })

  it("写入失败时如实报错，且不去调用绑定", async () => {
    fsMocks.writeFileAtomic.mockRejectedValueOnce(new Error("只读磁盘"))
    const result = await createProfilePageThenBind(PROJECT, "沈砚", "aura-1", "# 沈砚")
    expect(result.ok).toBe(false)
    expect(result.created).toBe(false)
    if (!result.ok) expect(result.message).toContain("只读磁盘")
    expect(auraMocks.bindCharacterAura).not.toHaveBeenCalled()
  })

  it("补完小传仍被拒时，如实说明人物页已写入", async () => {
    auraMocks.bindCharacterAura.mockRejectedValueOnce(
      new Error(CHARACTER_AURA_BINDING_BLOCK_MESSAGE),
    )
    const result = await createProfilePageThenBind(PROJECT, "沈砚", "aura-1", "# 沈砚")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain("人物页已写入")
      // 草稿里必然已经写了角色名（`# 名字` 与 `- 姓名：名字`），所以这条路径上
      // 不能再把责任推给「没写名字」，否则用户照提示改也修不好。
      expect(result.message).not.toContain("请确认这份小传里写到了角色姓名")
      // 真实出路之一：名字过长会被可绑定名单的 40 字上限筛掉。
      expect(result.message).toContain("更短的常用名")
    }
  })
})

/**
 * 为什么这组用例必须让**真实**的 YAML 解析器去读产物。
 *
 * 上面 `buildProfilePageContent` 那两条断言只能证明「我们拼出了这几个字符」，
 * 证明不了「真实解析器认这段 frontmatter」。这个盲区正是本模块漏掉一个
 * Critical 缺陷的原因：`title: "${name}"` 遇到含 `"` 或 `\` 的名字会写出
 * `title: "林"清"` / `title: "林\清"`，字符串断言照样全绿，而 parseFrontmatter
 * 直接返回 `frontmatter: null` → character-aura.ts 的 isCharacterEntityContent
 * 判否 → 该页不算人物页 → 绑定永久被拒；又因为「已存在的人物页绝不覆盖」，
 * 用户重试多少次都不会修复。所以这里一律用真实 parseFrontmatter
 * （src/lib/frontmatter.ts 的实现，同一个 js-yaml + JSON_SCHEMA）验产物。
 */
describe("buildProfilePageContent 的 frontmatter 能被真实 YAML 解析器读回", () => {
  /** FrontmatterValue 是 string | string[]，tags 两种形态都要认，别假设一定是数组。 */
  const tagList = (value: FrontmatterValue | undefined): string[] => {
    if (value === undefined) return []
    return Array.isArray(value)
      ? value.map((item) => item.trim())
      : String(value).split(",").map((item) => item.trim())
  }

  // 与 character-aura.ts 的 extractPrimaryTitle 同一条正则：
  // 那边优先取 frontmatter 的 title，所以文件名被安全化后仍能取回原文名。
  // 如果那边改了正则，这里要同步。
  const titleOf = (page: string) =>
    page.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim()

  const NAMES: string[] = [
    "沈砚", // 普通中文名
    "林/清", // 含被文件名安全化的字符
    '林"清', // Critical：旧实现写成 title: "林"清"，YAML 解析直接失败
    "林\\清", // Critical：旧实现写成 title: "林\清"，双引号里的非法转义
    "林'清", // 含单引号：单引号标量里要按 YAML 规则加倍成 ''
    '林/清:越*?"<>|', // 多种特殊字符混合
  ]

  it.each(NAMES)("名字「%s」解析后是可绑定人物页，且标题还原成原名", (name) => {
    const page = buildProfilePageContent(
      name,
      `# ${name}\n\n草稿正文`,
      new Date("2026-10-12T00:00:00Z"),
    )
    const { frontmatter, body } = parseFrontmatter(page)

    // 1) frontmatter 必须解析成功：旧写法下含 " 或 \ 的名字会先在这里变红。
    expect(frontmatter).not.toBeNull()
    // 2) type=entity 是 isCharacterEntityContent 的第一道判据。
    expect(frontmatter?.type).toBe("entity")
    // 3) tags 含 character 是第二道判据。
    expect(tagList(frontmatter?.tags)).toContain("character")
    // 4) 命门：文件名被安全化、引号被处理之后，标题仍要还原成原名。
    expect(titleOf(page)).toBe(name)
    // 5) 修 frontmatter 不能把正文弄丢。
    expect(body).toContain(`# ${name}`)
  })
})
