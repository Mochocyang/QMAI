import { describe, expect, it, vi } from "vitest"
import type { LlmConfig, SearchApiConfig } from "@/stores/wiki-store"
import type { ChatMessage, StreamCallbacks } from "@/lib/llm-client"
import type { ContextPack } from "./context-engine"
import {
  buildLocalWritingCorpus,
  buildWritingEntityExtractionSource,
  collectWritingEntityWebSearch,
  displayWritingEntitySearchWorkflowContent,
  formatWritingEntitySearchMarkdown,
  formatWritingEntitySearchWorkflowResult,
  isLocallyResolvedEntity,
  isWebSearchConfigured,
  parseExtractedEntityNames,
  parseNeedExternalNames,
  parseWritingEntitySearchWorkflowResult,
  selectUnresolvedEntities,
  serializeWritingEntitySearchWorkflowResult,
  writingEntitySearchSourceLabels,
  WRITING_ENTITY_SEARCH_HEADING,
} from "./writing-entity-web-search"

const llmConfig = {
  provider: "custom",
  apiKey: "test-key",
  model: "test-model",
  ollamaUrl: "",
  customEndpoint: "https://example.test/v1",
  maxContextSize: 120000,
} satisfies LlmConfig

const configuredSearch: SearchApiConfig = {
  provider: "bocha",
  apiKey: "search-key",
  serpApiEngine: "google",
  searXngUrl: "",
  searXngCategories: ["general"],
  providerConfigs: {},
}

const pack: ContextPack = {
  task: "写第三章，黄蓉出场",
  chapterGoal: "黄蓉与郭靖会合",
  outline: "第3章：郭靖在客栈等候。",
  recentSummaries: ["第1章：郭靖离乡。"],
  previousChapterEnding: "客栈门帘掀开。",
  characterStates: "郭靖刚到中原。",
  soulDoc: "",
  characterAuras: "",
  storyFrameworkBinding: "",
  cognitionStates: "",
  foreshadowingStates: "",
  timeline: "",
  relatedSettings: "",
  canonRules: "",
  writingStyle: "",
  searchResults: "",
  graphSearchResults: "",
  mustDo: "",
  mustAvoid: "",
  nextChapterAdvice: "",
  revisionDirectives: "",
}

function streamChatReturning(responses: string[]) {
  let index = 0
  return vi.fn(async (_config: LlmConfig, _messages: ChatMessage[], callbacks: StreamCallbacks) => {
    callbacks.onToken(responses[Math.min(index, responses.length - 1)] ?? "")
    index += 1
    callbacks.onDone()
  })
}

describe("writing entity local lookup", () => {
  it("treats entity-table or previous-text hits as resolved", () => {
    const corpus = buildLocalWritingCorpus(pack, ["前文里出现过穆念慈。"])
    expect(isLocallyResolvedEntity("郭靖", corpus, ["黄蓉"])).toBe(true)
    expect(isLocallyResolvedEntity("穆念慈", corpus, [])).toBe(true)
    expect(isLocallyResolvedEntity("黄蓉", "无关正文", ["黄蓉"])).toBe(true)
    expect(isLocallyResolvedEntity("降龙十八掌", corpus, ["黄蓉"])).toBe(false)
  })

  it("does not treat names that only appear in the chapter outline as resolved", () => {
    const corpus = buildLocalWritingCorpus({
      ...pack,
      outline: "第3章：李鸿章在总理衙门与赫德会面。",
      chapterGoal: "李鸿章与赫德谈判",
    })
    expect(corpus).not.toContain("李鸿章")
    expect(corpus).not.toContain("赫德")
    expect(isLocallyResolvedEntity("李鸿章", corpus, [])).toBe(false)
    expect(isLocallyResolvedEntity("赫德", corpus, [])).toBe(false)
    expect(isLocallyResolvedEntity("郭靖", corpus, [])).toBe(true)
  })

  it("selects only names missing from both corpus and entity table", () => {
    const corpus = buildLocalWritingCorpus(pack)
    expect(selectUnresolvedEntities(["郭靖", "黄蓉", "降龙十八掌"], corpus, ["黄蓉"])).toEqual([
      "降龙十八掌",
    ])
  })
})

describe("writing entity extraction source", () => {
  it("orders user request and selected outline before plan blueprint, then caps at 8000 chars", () => {
    const source = buildWritingEntityExtractionSource({
      userRequest: "生成第277章",
      outline: `第277章章纲：猎户座侦察系统。${"章".repeat(9000)}`,
      planBlueprint: "任务蓝图：不应挤占章纲窗口。",
      contextPack: {
        ...pack,
        outline: "总纲：877型基洛级潜艇。",
      },
    })

    expect(source).toHaveLength(8000)
    expect(source).toMatch(/^生成第277章\n\n第277章章纲：猎户座侦察系统。/)
    expect(source).not.toContain("877型基洛级潜艇")
    expect(source).not.toContain("任务蓝图")
  })

  it("uses the search-only outline instead of the merged outline fallback", () => {
    const source = buildWritingEntityExtractionSource({
      userRequest: "生成第276章",
      planBlueprint: "",
      contextPack: {
        ...pack,
        outline: "总纲：971型阿库拉级攻击核潜艇。",
        entitySearchOutline: "第276章章纲：武装走廊完成清场。",
      },
    })

    expect(source).toContain("武装走廊")
    expect(source).not.toContain("阿库拉级")
  })
})

describe("writing entity parse helpers", () => {
  it("parses extracted entity names from JSON", () => {
    expect(parseExtractedEntityNames('{"entities":["黄蓉","降龙十八掌"]}')).toEqual(["黄蓉", "降龙十八掌"])
    expect(parseExtractedEntityNames("```json\n[\"郭靖\"]\n```")).toEqual(["郭靖"])
  })

  it("parses needExternal names against candidates", () => {
    expect(parseNeedExternalNames('{"needExternal":["黄蓉","原创甲"]}', ["黄蓉", "降龙十八掌"])).toEqual(["黄蓉"])
    expect(parseNeedExternalNames('{"entities":[{"name":"黄蓉","needExternal":true},{"name":"林烬","needExternal":false}]}', ["黄蓉", "林烬"])).toEqual(["黄蓉"])
  })
})

describe("isWebSearchConfigured", () => {
  it("rejects missing provider or api key", () => {
    expect(isWebSearchConfigured(null)).toBe(false)
    expect(isWebSearchConfigured({
      provider: "none",
      apiKey: "",
      searXngUrl: "",
      searXngCategories: ["general"],
    })).toBe(false)
    expect(isWebSearchConfigured(configuredSearch)).toBe(true)
  })
})

describe("collectWritingEntityWebSearch", () => {
  it("skips search when the provider is not configured", async () => {
    const search = vi.fn()
    const result = await collectWritingEntityWebSearch({
      projectPath: "/project",
      userRequest: "写一章黄蓉出场",
      contextPack: pack,
      streamChat: streamChatReturning(['{"entities":["黄蓉"]}']),
      llmConfig,
      searchApiConfig: { provider: "none", apiKey: "", searXngUrl: "", searXngCategories: ["general"] },
      search,
    })
    expect(search).not.toHaveBeenCalled()
    expect(result.markdown).toBe("")
    expect(result.notes).toContain("未配置外部搜索")
  })

  it("does not search names found in previous text or the entity table", async () => {
    const search = vi.fn()
    const result = await collectWritingEntityWebSearch({
      projectPath: "/project",
      userRequest: "写一章郭靖和黄蓉出场",
      contextPack: pack,
      streamChat: streamChatReturning([
        '{"entities":["郭靖","黄蓉"]}',
        '{"needExternal":["郭靖","黄蓉"]}',
      ]),
      llmConfig,
      searchApiConfig: configuredSearch,
      listEntityNames: async () => ["黄蓉"],
      readPreviousBodies: async () => [],
      search,
    })
    expect(search).not.toHaveBeenCalled()
    expect(result.searchedNames).toEqual([])
    expect(result.markdown).toBe("")
  })

  it("searches outline-only names the model marks as needExternal", async () => {
    const search = vi.fn(async (query: string) => [{
      title: `${query} 资料`,
      url: `https://example.test/${encodeURIComponent(query)}`,
      snippet: "公开资料摘要",
      source: "example.test",
    }])
    const result = await collectWritingEntityWebSearch({
      projectPath: "/project",
      userRequest: "写一章李鸿章出场",
      outline: "第3章：李鸿章在总理衙门。",
      contextPack: {
        ...pack,
        outline: "第3章：李鸿章在总理衙门。",
        chapterGoal: "李鸿章与赫德谈判",
      },
      streamChat: streamChatReturning([
        '{"entities":["李鸿章"]}',
        '{"needExternal":["李鸿章"]}',
      ]),
      llmConfig,
      searchApiConfig: configuredSearch,
      listEntityNames: async () => ["黄蓉"],
      readPreviousBodies: async () => [],
      search,
    })
    expect(search).toHaveBeenCalledWith("李鸿章", configuredSearch, 8)
    expect(result.searchedNames).toEqual(["李鸿章"])
  })

  it("searches unresolved names the model marks as needExternal", async () => {
    const search = vi.fn(async (query: string) => [{
      title: `${query} 资料`,
      url: `https://example.test/${encodeURIComponent(query)}`,
      snippet: "公开资料摘要",
      source: "example.test",
    }])
    const result = await collectWritingEntityWebSearch({
      projectPath: "/project",
      userRequest: "写一章降龙十八掌对决",
      contextPack: pack,
      streamChat: streamChatReturning([
        '{"entities":["降龙十八掌"]}',
        '{"needExternal":["降龙十八掌"]}',
      ]),
      llmConfig,
      searchApiConfig: configuredSearch,
      listEntityNames: async () => ["黄蓉"],
      readPreviousBodies: async () => [],
      search,
    })
    expect(search).toHaveBeenCalledWith("降龙十八掌", configuredSearch, 8)
    expect(result.searchedNames).toEqual(["降龙十八掌"])
    expect(result.items?.[0]?.name).toBe("降龙十八掌")
    expect(result.markdown).toContain(WRITING_ENTITY_SEARCH_HEADING)
    expect(result.markdown).toContain("降龙十八掌")
    expect(result.markdown).toContain("公开资料摘要")
  })

  it("notifies onSearchStart with the queries it is about to run", async () => {
    const onSearchStart = vi.fn()
    const search = vi.fn(async () => [{
      title: "李鸿章",
      url: "https://example.test/ljz",
      snippet: "摘要",
      source: "example.test",
    }])
    await collectWritingEntityWebSearch({
      projectPath: "/project",
      userRequest: "写一章李鸿章出场",
      contextPack: pack,
      streamChat: streamChatReturning([
        '{"entities":["李鸿章"]}',
        '{"needExternal":["李鸿章"]}',
      ]),
      llmConfig,
      searchApiConfig: configuredSearch,
      listEntityNames: async () => ["黄蓉"],
      readPreviousBodies: async () => [],
      search,
      onSearchStart,
    })
    expect(onSearchStart).toHaveBeenCalledWith(["李鸿章"])
  })

  it("searches more than three needExternal names", async () => {
    const names = ["李鸿章", "赫德", "总理衙门", "北洋水师"]
    const search = vi.fn(async (query: string) => [{
      title: `${query} 资料`,
      url: `https://example.test/${encodeURIComponent(query)}`,
      snippet: "公开资料摘要",
      source: "example.test",
    }])
    const result = await collectWritingEntityWebSearch({
      projectPath: "/project",
      userRequest: "写一章李鸿章与赫德在总理衙门谈北洋水师",
      contextPack: pack,
      streamChat: streamChatReturning([
        JSON.stringify({ entities: names }),
        JSON.stringify({ needExternal: names }),
      ]),
      llmConfig,
      searchApiConfig: configuredSearch,
      listEntityNames: async () => ["黄蓉"],
      readPreviousBodies: async () => [],
      search,
    })
    expect(search).toHaveBeenCalledTimes(4)
    expect(search).toHaveBeenCalledWith("北洋水师", configuredSearch, 8)
    expect(result.searchedNames).toEqual(names)
  })

  it("does not search original names the model can invent", async () => {
    const search = vi.fn()
    const result = await collectWritingEntityWebSearch({
      projectPath: "/project",
      userRequest: "写一章林烬出场",
      contextPack: pack,
      streamChat: streamChatReturning([
        '{"entities":["林烬"]}',
        '{"needExternal":[]}',
      ]),
      llmConfig,
      searchApiConfig: configuredSearch,
      listEntityNames: async () => ["黄蓉"],
      readPreviousBodies: async () => [],
      search,
    })
    expect(search).not.toHaveBeenCalled()
    expect(result.searchedNames).toEqual([])
  })
})

describe("formatWritingEntitySearchMarkdown", () => {
  it("returns empty string without results", () => {
    expect(formatWritingEntitySearchMarkdown([])).toBe("")
  })
})

describe("writing entity search workflow display and persistence", () => {
  const groupedItems = [
    {
      name: "鲁茨科伊",
      results: [
        {
          title: "亚历山大·弗拉基米罗维奇·鲁茨科伊",
          url: "https://m.baike.com/wikiid/123",
          snippet: "俄罗斯政治家，1991年至1993年任副总统。",
          source: "m.baike.com",
        },
        {
          title: "Alexander-Rutskoy",
          url: "http://www.bing.com/dict/Alexander-Rutskoy",
          snippet: "英语词典释义。",
          source: "bing.com",
        },
      ],
    },
    {
      name: "哈斯布拉托夫",
      results: [
        {
          title: "鲁斯兰·哈斯布拉托夫",
          url: "https://zh.wikipedia.org/wiki/%E9%B2%81%E6%96%AF%E5%85%B0%C2%B7%E5%93%88%E6%96%AF%E5%B8%83%E6%8B%89%E6%89%98%E5%A4%AB",
          snippet: "前俄罗斯最高苏维埃主席。",
          source: "zh.wikipedia.org",
        },
      ],
    },
    {
      name: "格拉乔夫",
      results: [],
    },
  ]

  const searchResult = {
    markdown: "",
    searchedNames: ["鲁茨科伊", "哈斯布拉托夫", "格拉乔夫"],
    notes: ["搜索「叶利钦」失败：网络超时"],
    items: groupedItems,
  }

  it("groups the human summary by name with title and snippet, not bare URLs", () => {
    const summary = formatWritingEntitySearchWorkflowResult(searchResult)
    expect(summary).toContain("已搜索：鲁茨科伊、哈斯布拉托夫、格拉乔夫")
    expect(summary).toMatch(/鲁茨科伊\n- 亚历山大·弗拉基米罗维奇·鲁茨科伊 · m\.baike\.com\n {2}俄罗斯政治家/)
    expect(summary).toContain("Alexander-Rutskoy · bing.com")
    expect(summary).toContain("英语词典释义。")
    expect(summary).toContain("哈斯布拉托夫")
    expect(summary).toContain("前俄罗斯最高苏维埃主席。")
    expect(summary).toContain("格拉乔夫")
    expect(summary).toContain("- 无可用结果")
    expect(summary).toContain("搜索「叶利钦」失败：网络超时")
    expect(summary).not.toMatch(/https?:\/\/\S+/)
    expect(writingEntitySearchSourceLabels(groupedItems)).toEqual([
      "亚历山大·弗拉基米罗维奇·鲁茨科伊 · m.baike.com",
      "Alexander-Rutskoy · bing.com",
      "鲁斯兰·哈斯布拉托夫 · zh.wikipedia.org",
    ])
  })

  it("serializes the full title/url/snippet/source payload and can read it back", () => {
    const serialized = serializeWritingEntitySearchWorkflowResult(searchResult)
    const parsed = parseWritingEntitySearchWorkflowResult(serialized)
    expect(parsed).not.toBeNull()
    expect(parsed?.searchedNames).toEqual(["鲁茨科伊", "哈斯布拉托夫", "格拉乔夫"])
    expect(parsed?.notes).toEqual(["搜索「叶利钦」失败：网络超时"])
    expect(parsed?.items[0]?.results[0]).toEqual({
      title: "亚历山大·弗拉基米罗维奇·鲁茨科伊",
      url: "https://m.baike.com/wikiid/123",
      snippet: "俄罗斯政治家，1991年至1993年任副总统。",
      source: "m.baike.com",
    })
    expect(parsed?.items[2]).toEqual({ name: "格拉乔夫", results: [] })
    expect(displayWritingEntitySearchWorkflowContent(serialized)).toBe(parsed?.content)
    expect(displayWritingEntitySearchWorkflowContent(serialized)).not.toMatch(/https?:\/\/\S+/)
    expect(JSON.parse(serialized).items[0].results[0].url).toBe("https://m.baike.com/wikiid/123")
  })

  it("still displays legacy 已搜索 + title URL strings", () => {
    const legacy = [
      "已搜索：鲁茨科伊、哈斯布拉托夫、格拉乔夫",
      "- 亚历山大·弗拉基米罗维奇·鲁茨科伊 https://m.baike.com/wikiid/123",
      "- Alexander-Rutskoy http://www.bing.com/dict/Alexander-Rutskoy",
    ].join("\n")
    expect(parseWritingEntitySearchWorkflowResult(legacy)).toBeNull()
    expect(displayWritingEntitySearchWorkflowContent(legacy)).toBe(legacy)
    expect(displayWritingEntitySearchWorkflowContent(legacy)).toContain("https://m.baike.com/wikiid/123")
  })

  it("filters malformed persisted names without trusting unknown array entries", () => {
    const persisted = JSON.stringify({
      content: "",
      searchedNames: ["鲁茨科伊", null, 42, "", "哈斯布拉托夫"],
      notes: ["有效备注", false],
      items: [],
    })

    expect(parseWritingEntitySearchWorkflowResult(persisted)).toEqual({
      content: "",
      searchedNames: ["鲁茨科伊", "哈斯布拉托夫"],
      notes: ["有效备注"],
      items: [],
    })
  })

  it("rebuilds display content when persisted content is empty", () => {
    const persisted = JSON.stringify({
      content: "",
      searchedNames: ["鲁茨科伊"],
      notes: [],
      items: [],
    })

    expect(displayWritingEntitySearchWorkflowContent(persisted)).toBe("已搜索：鲁茨科伊")
  })
})
