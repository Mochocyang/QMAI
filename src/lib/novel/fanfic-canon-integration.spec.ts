/**
 * 同人正典的端到端集成测试。
 *
 * 前面的单元测试各自验证了一段（数据源读文件、上下文包渲染正典），
 * 这里把整条链串起来验证：磁盘上的 `.novel/fanfic-canon.md`
 * → buildContextPack 真实装配 → contextPackToPrompt 正文提示词。
 *
 * 这是「同人作品在正文生成时确实看得到原作正典」这一验收点的直接证据。
 * 调用方式与生产一致：不传 categories，让注册器装配全部数据源。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const PROJECT = "/proj"
const CANON_PATH = `${PROJECT}/.novel/fanfic-canon.md`

const CANON_FILE = [
  "---",
  'fanfic_mode: "au"',
  'source_name: "斗破苍穹"',
  "allowed_deviations:",
  '  - "时间线整体后移十年"',
  "compiled: false",
  "chunk_count: 1",
  "---",
  "",
  "# 同人正典（斗破苍穹）",
  "",
  "## 正典内容",
  "",
  "- 斗气大陆，斗气分九段。",
  "- 萧炎曾是天才，后跌为废物。",
].join("\n")

describe("同人正典端到端注入", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.doUnmock("@/commands/fs")
    vi.doUnmock("@/lib/search")
    vi.doUnmock("@/stores/wiki-store")
    vi.resetModules()
  })

  /** 装配一个「项目里只有这些文件」的磁盘，其余读取一律失败。 */
  async function loadPrompt(
    files: Record<string, string>,
    tokenBudget = 20000,
    searchWikiImpl?: (projectPath: string, query: string) => Promise<Array<{ path: string }>>,
  ) {
    vi.doMock("@/commands/fs", () => ({
      readFile: vi.fn(async (path: string) => {
        const normalized = path.replace(/\\/g, "/")
        if (normalized in files) return files[normalized]
        throw new Error(`ENOENT: ${normalized}`)
      }),
      fileExists: vi.fn(async (path: string) => path.replace(/\\/g, "/") in files),
      writeFileAtomic: vi.fn(),
      writeFileIfAbsent: vi.fn(),
      createDirectory: vi.fn(),
      deleteFile: vi.fn(),
      listDirectory: vi.fn(async () => []),
      readFileAsBase64: vi.fn(),
    }))
    // 默认所有模糊检索都返回空，确保正典只可能来自固定路径直读。
    vi.doMock("@/lib/search", () => ({
      searchWiki: vi.fn(searchWikiImpl ?? (async () => [])),
      // 其它检索类数据源也会经过这个模块；给出空分词，避免无关源报缺失导出。
      tokenizeQuery: vi.fn(() => []),
      searchFiles: vi.fn(async () => []),
      flattenMdFiles: vi.fn(() => []),
    }))

    const { useWikiStore } = await import("@/stores/wiki-store")
    useWikiStore.setState({
      novelMode: true,
      novelConfig: { recentSummaryWindow: 3, searchTopK: 3 } as never,
    })

    const { buildContextPack, contextPackToPrompt } = await import("./context-engine")
    const pack = await buildContextPack(PROJECT, "写第1章正文", 1)
    return { pack, prompt: contextPackToPrompt(pack, tokenBudget) }
  }

  it("磁盘上的正典经真实上下文包装配后进入正文提示词", async () => {
    const { pack, prompt } = await loadPrompt({ [CANON_PATH]: CANON_FILE })

    // 1) 上下文包字段被真实填充
    expect(pack.sourceCanon).toContain("斗气分九段")
    // 2) frontmatter 不占预算
    expect(pack.sourceCanon).not.toContain("fanfic_mode")
    // 3) 正文提示词出现正典段与内容
    expect(prompt).toContain("## 原作正典（不可违背）")
    expect(prompt).toContain("斗气分九段")
    expect(prompt).toContain("萧炎曾是天才")
  })

  it("正典走硬约束：预算不足时停止生成而不是静默丢弃", async () => {
    const { pack, contextPackToPrompt } = await (async () => {
      const base = await loadPrompt({ [CANON_PATH]: CANON_FILE })
      const { contextPackToPrompt: render } = await import("./context-engine")
      return { pack: base.pack, contextPackToPrompt: render }
    })()

    expect(() => contextPackToPrompt(pack, 60)).toThrow("原作正典")
  })

  it("原创项目没有正典文件时整条链不产生正典段", async () => {
    const canonPath = `${PROJECT}/wiki/canon.md`
    const { pack, prompt } = await loadPrompt(
      { [canonPath]: "- 死者不能复活" },
      20000,
      // 让本作正史（走检索）命中，证明两条机制彼此独立、互不干扰
      async (_projectPath, query) => (query.includes("canon 正史") ? [{ path: canonPath }] : []),
    )

    expect(pack.sourceCanon ?? "").toBe("")
    expect(prompt).not.toContain("原作正典")
    // 本作自有正史仍照常走 canonRules，不受同人改动影响
    expect(pack.canonRules).toContain("死者不能复活")
    expect(prompt).toContain("死者不能复活")
  })

  it("同人与本作正史同时存在时各走各的段，不互相污染", async () => {
    const canonPath = `${PROJECT}/wiki/canon.md`
    const { pack, prompt } = await loadPrompt(
      { [CANON_PATH]: CANON_FILE, [canonPath]: "- 死者不能复活" },
      20000,
      async (_projectPath, query) => (query.includes("canon 正史") ? [{ path: canonPath }] : []),
    )

    expect(pack.sourceCanon).toContain("斗气分九段")
    expect(pack.canonRules).toContain("死者不能复活")
    expect(prompt).toContain("## 原作正典（不可违背）")
    expect(prompt).toContain("## 禁止违背")
    // 正典段排在本作正史段之前，原作既成事实优先
    expect(prompt.indexOf("## 原作正典（不可违背）")).toBeLessThan(prompt.indexOf("## 禁止违背"))
  })
})
