import type { LlmConfig, SearchApiConfig } from "@/stores/wiki-store"
import type { ChatMessage, RequestOverrides, StreamCallbacks } from "@/lib/llm-client"
import { providerRequiresApiKey, resolveSearchConfig, webSearch, type WebSearchResult } from "@/lib/web-search"
import { rethrowIfUserAbort, throwIfAborted } from "@/lib/user-abort"
import { listLocalEntityNames } from "./local-entity-names"
import { readPreviousChapterBodies } from "./previous-chapters-analysis"
import type { ContextPack } from "./context-engine"

export const WRITING_ENTITY_SEARCH_HEADING = "外部检索（仅补本地缺失实体）"
const MIN_NAME_LENGTH = 2
const MAX_EXTRACTED_ENTITIES = 20
const MAX_SEARCH_QUERIES = 8
const SOURCE_TEXT_CHAR_CAP = 8000

export interface WritingEntityWebSearchResult {
  markdown: string
  searchedNames: string[]
  notes: string[]
  items?: Array<{ name: string; results: WebSearchResult[] }>
}

export interface CollectWritingEntityWebSearchInput {
  projectPath: string
  userRequest: string
  outline?: string
  planBlueprint?: string
  contextPack: ContextPack
  chapterNumber?: number
  previousChaptersAnalysis?: string
  streamChat: (
    config: LlmConfig,
    messages: ChatMessage[],
    callbacks: StreamCallbacks,
    signal?: AbortSignal,
    requestOverrides?: RequestOverrides,
  ) => Promise<void>
  llmConfig: LlmConfig
  searchApiConfig?: SearchApiConfig | null
  signal?: AbortSignal
  onRequestTrace?: StreamCallbacks["onRequestTrace"]
  onSearchStart?: (queries: string[]) => void
  listEntityNames?: typeof listLocalEntityNames
  readPreviousBodies?: typeof readPreviousChapterBodies
  search?: typeof webSearch
}

export function isWebSearchConfigured(
  config: SearchApiConfig | null | undefined,
): config is SearchApiConfig {
  if (!config) return false
  const resolved = resolveSearchConfig(config)
  if (resolved.provider === "none") return false
  if (providerRequiresApiKey(resolved.provider) && !resolved.apiKey?.trim()) return false
  if (resolved.provider === "searxng" && !resolved.searXngUrl?.trim()) return false
  return true
}

export function buildLocalWritingCorpus(
  pack: Pick<
    ContextPack,
    | "characterStates"
    | "characterAuras"
    | "relatedSettings"
    | "canonRules"
    | "cognitionStates"
    | "foreshadowingStates"
    | "previousChapterEnding"
    | "recentSummaries"
    | "searchResults"
    | "soulDoc"
  >,
  extraTexts: readonly string[] = [],
): string {
  // 故意不纳入 outline / chapterGoal：实体正是从本章大纲抽出的，
  // 再拿同一份大纲当「本地已有」会把几乎所有名字短路掉。
  return [
    pack.characterStates,
    pack.characterAuras,
    pack.relatedSettings,
    pack.canonRules,
    pack.cognitionStates,
    pack.foreshadowingStates,
    pack.previousChapterEnding,
    pack.searchResults,
    pack.soulDoc,
    ...(pack.recentSummaries ?? []),
    ...extraTexts,
  ]
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .join("\n")
}

export function buildWritingEntityExtractionSource(
  input: Pick<
    CollectWritingEntityWebSearchInput,
    "userRequest" | "outline" | "planBlueprint" | "contextPack"
  >,
): string {
  const outline = input.outline?.trim()
    || input.contextPack.entitySearchOutline?.trim()
    || input.contextPack.outline?.trim()
    || ""

  return [
    input.userRequest.trim(),
    outline,
    input.planBlueprint?.trim() ?? "",
  ].filter(Boolean).join("\n\n").slice(0, SOURCE_TEXT_CHAR_CAP)
}

export function isLocallyResolvedEntity(
  name: string,
  corpus: string,
  entityNames: readonly string[],
): boolean {
  const trimmed = name.trim()
  if (trimmed.length < MIN_NAME_LENGTH) return true
  if (corpus.includes(trimmed)) return true
  return entityNames.some((entityName) => (
    entityName.length >= MIN_NAME_LENGTH
    && (trimmed.includes(entityName) || entityName.includes(trimmed))
  ))
}

export function selectUnresolvedEntities(
  names: readonly string[],
  corpus: string,
  entityNames: readonly string[],
): string[] {
  const unique: string[] = []
  for (const raw of names) {
    const name = raw.trim()
    if (name.length < MIN_NAME_LENGTH) continue
    if (unique.some((item) => item === name)) continue
    if (isLocallyResolvedEntity(name, corpus, entityNames)) continue
    unique.push(name)
    if (unique.length >= MAX_EXTRACTED_ENTITIES) break
  }
  return unique
}

export function parseExtractedEntityNames(text: string): string[] {
  const parsed = parseJsonPayload(text)
  const names = collectNameStrings(parsed)
  return uniqueNames(names).slice(0, MAX_EXTRACTED_ENTITIES)
}

export interface WritingEntitySearchQuery {
  name: string
  englishQuery?: string
}

export function parseNeedExternalNames(text: string, candidates: readonly string[]): string[] {
  return parseNeedExternalQueries(text, candidates).map((item) => item.name)
}

export function parseNeedExternalQueries(
  text: string,
  candidates: readonly string[],
): WritingEntitySearchQuery[] {
  const allowed = new Set(candidates.map((name) => name.trim()).filter(Boolean))
  const parsed = parseJsonPayload(text)
  if (!parsed) return []

  const selected: WritingEntitySearchQuery[] = []
  const add = (value: unknown, englishSource?: Record<string, unknown>) => {
    const name = String(value ?? "").trim()
    if (!name || !allowed.has(name) || selected.some((item) => item.name === name)) return
    const englishQuery = englishSource ? readEnglishQuery(englishSource, name) : undefined
    selected.push(englishQuery ? { name, englishQuery } : { name })
  }

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (typeof item === "string") add(item)
      else if (item && typeof item === "object") {
        const record = item as Record<string, unknown>
        if (record.needExternal === false) continue
        if (
          record.needExternal === true
          || record.search === true
          || typeof record.name === "string"
        ) {
          add(record.name, record)
        }
      }
    }
    return selected
  }

  if (typeof parsed !== "object") return []
  const record = parsed as Record<string, unknown>
  const needExternal = record.needExternal ?? record.search ?? record.names
  if (Array.isArray(needExternal)) {
    for (const item of needExternal) {
      if (typeof item === "string") add(item)
      else if (item && typeof item === "object") {
        const entry = item as Record<string, unknown>
        if (entry.needExternal === false) continue
        add(entry.name, entry)
      }
    }
  }
  if (Array.isArray(record.entities)) {
    for (const item of record.entities) {
      if (!item || typeof item !== "object") continue
      const entry = item as Record<string, unknown>
      if (entry.needExternal === true || entry.search === true) add(entry.name, entry)
    }
  }
  return selected
}

interface WritingEntitySearchWorkflowPersisted {
  content: string
  searchedNames: string[]
  notes: string[]
  items: Array<{ name: string; results: WebSearchResult[] }>
}

const DISPLAY_TITLE_MAX = 80
const DISPLAY_SNIPPET_MAX = 140

export function formatWritingEntitySearchMarkdown(
  items: Array<{ name: string; results: WebSearchResult[] }>,
): string {
  if (items.length === 0) return ""
  const sections = items.map((item) => {
    const lines = item.results.length > 0
      ? item.results.map((result) => {
        const title = result.title.trim() || result.url.trim() || result.source.trim() || "未命名来源"
        const url = result.url.trim()
        const snippet = result.snippet.trim()
        return [`- ${title}${url ? ` ${url}` : ""}`, snippet ? `  ${snippet}` : ""].filter(Boolean).join("\n")
      })
      : ["- 无可用结果"]
    return `### ${item.name}\n${lines.join("\n")}`
  })
  return [`## ${WRITING_ENTITY_SEARCH_HEADING}`, ...sections].join("\n\n")
}

export function formatWritingEntitySearchWorkflowResult(
  result: Pick<WritingEntityWebSearchResult, "searchedNames" | "notes" | "items" | "markdown">,
): string {
  const blocks: string[] = []
  if (result.searchedNames.length > 0) {
    blocks.push(`已搜索：${result.searchedNames.join("、")}`)
  }
  for (const item of result.items ?? []) {
    const lines = [`${item.name}`]
    if (item.results.length === 0) {
      lines.push("- 无可用结果")
    } else {
      for (const source of item.results) {
        const title = clipDisplayText(
          source.title.trim() || writingEntitySearchSourceHost(source) || "未命名来源",
          DISPLAY_TITLE_MAX,
        )
        const host = writingEntitySearchSourceHost(source)
        const headline = host && host !== title ? `${title} · ${host}` : title
        const snippet = clipDisplayText(source.snippet.replace(/\s+/g, " ").trim(), DISPLAY_SNIPPET_MAX)
        lines.push(`- ${headline}`)
        if (snippet) lines.push(`  ${snippet}`)
      }
    }
    blocks.push(lines.join("\n"))
  }
  if (result.notes.length > 0) {
    blocks.push(result.notes.join("\n"))
  }
  if (blocks.length === 0 && result.markdown.trim()) return result.markdown.trim()
  return blocks.join("\n\n")
}

export function serializeWritingEntitySearchWorkflowResult(
  result: Pick<WritingEntityWebSearchResult, "searchedNames" | "notes" | "items" | "markdown">,
): string {
  const items = (result.items ?? []).map((item) => ({
    name: item.name,
    results: item.results.map((source) => ({
      title: source.title,
      url: source.url,
      snippet: source.snippet,
      source: source.source,
    })),
  }))
  const persisted: WritingEntitySearchWorkflowPersisted = {
    content: formatWritingEntitySearchWorkflowResult({ ...result, items }),
    searchedNames: [...result.searchedNames],
    notes: [...result.notes],
    items,
  }
  return JSON.stringify(persisted)
}

export function parseWritingEntitySearchWorkflowResult(
  text: string | undefined,
): WritingEntitySearchWorkflowPersisted | null {
  if (!text?.trim()) return null
  try {
    const parsed = JSON.parse(text) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    const rawItems = record.items
    const rawSearchedNames = record.searchedNames
    const hasItems = Array.isArray(rawItems)
    const hasSearchedNames = Array.isArray(rawSearchedNames)
    if (!hasItems && !hasSearchedNames) return null

    const items = hasItems ? normalizePersistedSearchItems(rawItems) : []
    const searchedNames = hasSearchedNames
      ? rawSearchedNames.filter(
          (name: unknown): name is string => typeof name === "string" && name.trim().length > 0,
        )
      : items.map((item) => item.name)
    const notes = Array.isArray(record.notes)
      ? record.notes.filter((note): note is string => typeof note === "string")
      : []
    const content = typeof record.content === "string" ? record.content : ""
    return {
      content,
      searchedNames,
      notes,
      items,
    }
  } catch {
    return null
  }
}

export function displayWritingEntitySearchWorkflowContent(text: string | undefined): string {
  const parsed = parseWritingEntitySearchWorkflowResult(text)
  if (!parsed) return (text ?? "").trim()
  return parsed.content.trim() || formatWritingEntitySearchWorkflowResult({ ...parsed, markdown: "" })
}

function writingEntitySearchSourceHost(
  result: Pick<WebSearchResult, "url" | "source">,
): string {
  const source = result.source.trim()
  if (source) {
    if (/^https?:\/\//i.test(source)) return hostnameFromUrl(source)
    if (!source.includes("/")) return source
  }
  return hostnameFromUrl(result.url.trim())
}

export function writingEntitySearchSourceLabels(
  items: Array<{ name: string; results: WebSearchResult[] }> | undefined,
): string[] {
  const labels: string[] = []
  const seen = new Set<string>()
  for (const item of items ?? []) {
    for (const source of item.results) {
      const title = clipDisplayText(
        source.title.trim() || writingEntitySearchSourceHost(source) || source.url.trim(),
        DISPLAY_TITLE_MAX,
      )
      const host = writingEntitySearchSourceHost(source)
      const label = host && host !== title ? `${title} · ${host}` : title
      if (!label || seen.has(label)) continue
      seen.add(label)
      labels.push(label)
    }
  }
  return labels
}

function normalizePersistedSearchItems(value: unknown): Array<{ name: string; results: WebSearchResult[] }> {
  if (!Array.isArray(value)) return []
  const items: Array<{ name: string; results: WebSearchResult[] }> = []
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const record = item as Record<string, unknown>
    const name = typeof record.name === "string" ? record.name.trim() : ""
    if (!name) continue
    const results: WebSearchResult[] = []
    if (Array.isArray(record.results)) {
      for (const result of record.results) {
        if (!result || typeof result !== "object") continue
        const source = result as Record<string, unknown>
        results.push({
          title: typeof source.title === "string" ? source.title : "",
          url: typeof source.url === "string" ? source.url : "",
          snippet: typeof source.snippet === "string" ? source.snippet : "",
          source: typeof source.source === "string" ? source.source : "",
        })
      }
    }
    items.push({ name, results })
  }
  return items
}

function hostnameFromUrl(url: string): string {
  if (!url) return ""
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return ""
  }
}

function clipDisplayText(value: string, maxLength: number): string {
  if (!value || value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}…`
}

export async function collectWritingEntityWebSearch(
  input: CollectWritingEntityWebSearchInput,
): Promise<WritingEntityWebSearchResult> {
  const notes: string[] = []
  if (!isWebSearchConfigured(input.searchApiConfig)) {
    return { markdown: "", searchedNames: [], notes: ["未配置外部搜索"], items: [] }
  }

  throwIfAborted(input.signal)

  try {
    const listEntityNames = input.listEntityNames ?? listLocalEntityNames
    const readPreviousBodies = input.readPreviousBodies ?? readPreviousChapterBodies
    const search = input.search ?? webSearch

    const [entityNames, previousBodies] = await Promise.all([
      listEntityNames(input.projectPath),
      input.chapterNumber && input.chapterNumber > 1
        ? readPreviousBodies(input.projectPath, input.chapterNumber, 3, input.signal)
        : Promise.resolve([]),
    ])
    throwIfAborted(input.signal)

    const corpus = buildLocalWritingCorpus(input.contextPack, [
      input.previousChaptersAnalysis ?? "",
      ...previousBodies.map((chapter) => chapter.content),
    ])

    const extracted = await extractEntityNames(input)
    const unresolved = selectUnresolvedEntities(extracted, corpus, entityNames)
    if (unresolved.length === 0) {
      return { markdown: "", searchedNames: [], notes, items: [] }
    }

    const needExternal = await judgeNeedExternal(input, unresolved)
    const queries = needExternal.slice(0, MAX_SEARCH_QUERIES)
    if (queries.length === 0) {
      return { markdown: "", searchedNames: [], notes, items: [] }
    }

    input.onSearchStart?.(launchedQueriesFor(queries))

    const items: Array<{ name: string; results: WebSearchResult[] }> = []
    const searchedNames: string[] = []
    for (const query of queries) {
      throwIfAborted(input.signal)
      const results: WebSearchResult[] = []
      let searchedThisEntity = false
      for (const term of launchedQueriesFor([query])) {
        throwIfAborted(input.signal)
        try {
          mergeSearchResults(results, await search(term, input.searchApiConfig, 8))
          searchedNames.push(term)
          searchedThisEntity = true
        } catch (error) {
          rethrowIfUserAbort(error, input.signal)
          notes.push(`搜索「${term}」失败：${error instanceof Error ? error.message : String(error)}`)
        }
      }
      if (searchedThisEntity) {
        items.push({ name: query.name, results })
      }
    }

    return {
      markdown: formatWritingEntitySearchMarkdown(items),
      searchedNames,
      notes,
      items,
    }
  } catch (error) {
    rethrowIfUserAbort(error, input.signal)
    notes.push(`实体补搜失败：${error instanceof Error ? error.message : String(error)}`)
    return { markdown: "", searchedNames: [], notes, items: [] }
  }
}

async function extractEntityNames(input: CollectWritingEntityWebSearchInput): Promise<string[]> {
  const source = buildWritingEntityExtractionSource(input)

  const raw = await completeText(input, [
    {
      role: "system",
      content: "你提取小说写作请求里的人物名、势力名、地点名、功法或公开 IP 名。只输出 JSON。",
    },
    {
      role: "user",
      content: [
        "从以下文本提取专有名称，最多 20 个。",
        "不要提取章节号、普通动词、纯原创占位词如「主角」。",
        "自造行动、功法、人名仍可抽出，是否联网由下一步判定，不要暗示这些名称都需要核实。",
        '只输出 JSON：{"entities":["名称"]}',
        "",
        source || "（无文本）",
      ].join("\n"),
    },
  ])
  return parseExtractedEntityNames(raw)
}

async function judgeNeedExternal(
  input: CollectWritingEntityWebSearchInput,
  unresolved: readonly string[],
): Promise<WritingEntitySearchQuery[]> {
  const raw = await completeText(input, [
    {
      role: "system",
      content: "你判断这些本地找不到的名字是否需要联网查公开资料。只输出 JSON。",
    },
    {
      role: "user",
      content: [
        "下列名称在本库前文和实体表都未找到。",
        "确信真实且知识不够才搜：必须同时满足「明确不是本书自造、对应现实人物/地点/机构/历史事件/公开 IP/已出版作品设定」以及「内置知识不足以支撑本章写准」。",
        "已知则不搜：内置知识已经明确它是什么、足够写准。",
        "不确定则不搜：本书原创、占位、捏造，或无法确定是真实还是自造时，一律排除。",
        "englishQuery 仅在已知但要补资料、且英文检索明显更好时填写；不要为自造名硬翻英文，不要把拼音当英文检索词。",
        '只输出 JSON：{"needExternal":[{"name":"名称","englishQuery":"English query"}]}',
        "无合适英文检索词时省略 englishQuery。",
        "",
        unresolved.join("\n"),
      ].join("\n"),
    },
  ])
  return parseNeedExternalQueries(raw, unresolved)
}

async function completeText(
  input: CollectWritingEntityWebSearchInput,
  messages: ChatMessage[],
): Promise<string> {
  let result = ""
  await input.streamChat(
    input.llmConfig,
    messages,
    {
      onToken: (token) => { result += token },
      onDone: () => {},
      onError: () => {},
      onRequestTrace: input.onRequestTrace,
    },
    input.signal,
  )
  return result.trim()
}

function parseJsonPayload(text: string): unknown | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidates = [fenced?.[1]?.trim(), trimmed].filter((item): item is string => Boolean(item))
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      const objectMatch = candidate.match(/\{[\s\S]*\}/)
      if (objectMatch) {
        try {
          return JSON.parse(objectMatch[0])
        } catch {
          // continue
        }
      }
      const arrayMatch = candidate.match(/\[[\s\S]*\]/)
      if (arrayMatch) {
        try {
          return JSON.parse(arrayMatch[0])
        } catch {
          // continue
        }
      }
    }
  }
  return null
}

function collectNameStrings(parsed: unknown): string[] {
  if (!parsed) return []
  if (Array.isArray(parsed)) {
    return parsed.flatMap((item) => {
      if (typeof item === "string") return [item]
      if (item && typeof item === "object" && "name" in item) {
        return [String((item as { name?: unknown }).name ?? "")]
      }
      return []
    })
  }
  if (typeof parsed !== "object") return []
  const record = parsed as Record<string, unknown>
  const list = record.entities ?? record.names ?? record.needExternal
  return collectNameStrings(Array.isArray(list) ? list : [])
}

function uniqueNames(names: readonly string[]): string[] {
  const output: string[] = []
  for (const raw of names) {
    const name = raw.trim()
    if (name.length < MIN_NAME_LENGTH || output.includes(name)) continue
    output.push(name)
  }
  return output
}

function readEnglishQuery(record: Record<string, unknown>, name: string): string | undefined {
  const raw = record.englishQuery ?? record.english ?? record.queryEn
  const query = typeof raw === "string" ? raw.trim() : ""
  if (!query || query === name) return undefined
  return query
}

function launchedQueriesFor(queries: readonly WritingEntitySearchQuery[]): string[] {
  const launched: string[] = []
  for (const query of queries) {
    launched.push(query.name)
    if (query.englishQuery && query.englishQuery !== query.name) {
      launched.push(query.englishQuery)
    }
  }
  return launched
}

function mergeSearchResults(target: WebSearchResult[], incoming: readonly WebSearchResult[]): void {
  const seen = new Set(
    target.map((result) => normalizeSearchResultKey(result)).filter(Boolean),
  )
  for (const result of incoming) {
    const key = normalizeSearchResultKey(result)
    if (key && seen.has(key)) continue
    if (key) seen.add(key)
    target.push(result)
  }
}

function normalizeSearchResultKey(result: WebSearchResult): string {
  const url = result.url.trim().toLowerCase()
  if (url) return url
  return `${result.title.trim()}\0${result.snippet.trim()}`
}
