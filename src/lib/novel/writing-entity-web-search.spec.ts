import { describe, expect, it, vi } from "vitest"
import type { LlmConfig, SearchApiConfig } from "@/stores/wiki-store"
import type { ChatMessage, StreamCallbacks } from "@/lib/llm-client"
import type { ContextPack } from "./context-engine"
import {
  buildLocalWritingCorpus,
  collectWritingEntityWebSearch,
  formatWritingEntitySearchMarkdown,
  isLocallyResolvedEntity,
  isWebSearchConfigured,
  parseExtractedEntityNames,
  parseNeedExternalNames,
  selectUnresolvedEntities,
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

  it("selects only names missing from both corpus and entity table", () => {
    const corpus = buildLocalWritingCorpus(pack)
    expect(selectUnresolvedEntities(["郭靖", "黄蓉", "降龙十八掌"], corpus, ["黄蓉"])).toEqual([
      "降龙十八掌",
    ])
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
    expect(search).toHaveBeenCalledWith("降龙十八掌", configuredSearch, 4)
    expect(result.searchedNames).toEqual(["降龙十八掌"])
    expect(result.markdown).toContain(WRITING_ENTITY_SEARCH_HEADING)
    expect(result.markdown).toContain("降龙十八掌")
    expect(result.markdown).toContain("公开资料摘要")
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
