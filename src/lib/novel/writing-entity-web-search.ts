import type { LlmConfig, SearchApiConfig } from "@/stores/wiki-store"
import type { ChatMessage, RequestOverrides, StreamCallbacks } from "@/lib/llm-client"
import { providerRequiresApiKey, resolveSearchConfig, webSearch, webSearchDetailed, type WebSearchOutcome, type WebSearchResult } from "@/lib/web-search"
import { formatGeminiContextBlock } from "@/lib/search-display"
import { rethrowIfUserAbort, throwIfAborted } from "@/lib/user-abort"
import { listLocalEntityNames } from "./local-entity-names"
import { readPreviousChapterBodies } from "./previous-chapters-analysis"
import type { ContextPack } from "./context-engine"

export const WRITING_ENTITY_SEARCH_HEADING = "外部检索（仅补本地缺失实体）"
const MIN_NAME_LENGTH = 2
const MAX_EXTRACTED_ENTITIES = 20
/** 每章最多联网补搜的实体数（中间档默认）。 */
export const MAX_SEARCH_QUERIES = 5
const RESULTS_PER_QUERY = 5
const SOURCE_TEXT_CHAR_CAP = 8000

/** 启发式：search=硬信号必搜；skip=自造黑名单；gray=交给模型。 */
export type NameSearchHint = "search" | "skip" | "gray"

const PLACEHOLDER_NAME_PATTERN = /^(主角|女主|男主|反派|路人甲|路人乙|某某)(?:\d*)$/u
/** 网文自造常见后缀；命中则默认不搜。 */
const INVENTED_SUFFIX_PATTERN = /(?:宗|殿|阁|盟|派|诀|功|掌|式|丹|符|阵|门派)$/u
/** 现实/公开世界硬信号：拉丁字母、型号、少数机构后缀。不用「镇/市/县」以免架空地名误搜。 */
const HARD_SIGNAL_LATIN_PATTERN = /[A-Za-z]/
const HARD_SIGNAL_MODEL_PATTERN = /(?:\d+[A-Za-z]|[A-Za-z]+[\s\-]?\d|\d+[\s\-][A-Za-z])/
const HARD_SIGNAL_ORG_PATTERN = /(?:大学|医院|公司|集团|银行|博物馆|大使馆|总理衙门)$/u

/**
 * 一个实体的搜索结果。`searchQueries` / `summary` / `searchSuggestionsHtml`
 * 只有 Gemini 后端会给；其它后端与旧记录没有这些字段。
 */
export interface WritingEntitySearchItem {
  name: string
  results: WebSearchResult[]
  searchQueries?: string[]
  summary?: string
  searchSuggestionsHtml?: string
}

export interface WritingEntityWebSearchResult {
  markdown: string
  searchedNames: string[]
  notes: string[]
  items?: WritingEntitySearchItem[]
  /** 按规则主动跳过（无候选、判定无需联网、未配置搜索源），区别于检索失败。 */
  skipped?: boolean
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
  /** 带附加信息的搜索（默认 webSearchDetailed）。传了 `search` 时以 `search` 为准。 */
  searchDetailed?: typeof webSearchDetailed
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

type KnowledgePackFields = Pick<
  ContextPack,
  | "characterStates"
  | "characterAuras"
  | "relatedSettings"
  | "canonRules"
  | "sourceCanon"
  | "cognitionStates"
  | "foreshadowingStates"
  | "searchResults"
  | "soulDoc"
>

/**
 * 「有可写资料」的强语料：人设/设定/正典/已有检索等。
 * 不含正文摘要、上章结尾、前文章节——那些只是「出现过」，不能免搜。
 * 故意不纳入 outline / chapterGoal：实体常从本章大纲抽出，再当本地已有会短路。
 */
export function buildKnowledgeWritingCorpus(pack: KnowledgePackFields): string {
  return [
    pack.characterStates,
    pack.characterAuras,
    pack.relatedSettings,
    pack.canonRules,
    // 同人项目：原作既有实体属于本作已知，不纳入会被当成待查并可能搜回冲突资料。
    pack.sourceCanon ?? "",
    pack.cognitionStates,
    pack.foreshadowingStates,
    pack.searchResults,
    pack.soulDoc,
  ]
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .join("\n")
}

/**
 * 兼容旧名：现在等价于 {@link buildKnowledgeWritingCorpus}。
 * `extraTexts`（通常是前文正文）**不再**并入免搜语料——正文一笔带过 ≠ 有资料。
 */
export function buildLocalWritingCorpus(
  pack: KnowledgePackFields &
    Partial<Pick<ContextPack, "previousChapterEnding" | "recentSummaries">>,
  extraTexts: readonly string[] = [],
): string {
  void extraTexts
  void pack.previousChapterEnding
  void pack.recentSummaries
  return buildKnowledgeWritingCorpus(pack)
}

/**
 * 启发式分流：硬信号必搜、自造黑名单跳过、其余交给模型（gray）。
 */
export function classifyNameSearchHeuristic(name: string): NameSearchHint {
  const trimmed = name.trim()
  if (trimmed.length < MIN_NAME_LENGTH) return "skip"
  if (PLACEHOLDER_NAME_PATTERN.test(trimmed)) return "skip"
  if (INVENTED_SUFFIX_PATTERN.test(trimmed)) return "skip"
  if (
    HARD_SIGNAL_LATIN_PATTERN.test(trimmed)
    || HARD_SIGNAL_MODEL_PATTERN.test(trimmed)
    || HARD_SIGNAL_ORG_PATTERN.test(trimmed)
  ) {
    return "search"
  }
  return "gray"
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
  // 只认「本地条目更完整地覆盖了候选」这一个方向。反向包含会把「洛云宗」「郭靖的降龙十八掌」
  // 这类复合名按本地的两字人名短路掉，本地其实没有它们的资料。
  return entityNames.some((entityName) => (
    entityName.length >= MIN_NAME_LENGTH
    && entityName.includes(trimmed)
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

function isSkipKnownFlag(record: Record<string, unknown>): boolean {
  return record.skip_known === true || record.skipKnown === true
}

function normalizeDecisionLabel(value: unknown): string {
  return String(value ?? "").trim().toLowerCase()
}

/**
 * 解析「需要联网」的名单。
 * 新格式 decisions：label=real 且非 skip_known 才搜；invented/unsure 不搜。
 * 旧格式 needExternal：视为 real（兼容测试与旧模型输出）。
 */
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
    if (englishSource && isSkipKnownFlag(englishSource)) return
    const englishQuery = englishSource ? readEnglishQuery(englishSource, name) : undefined
    selected.push(englishQuery ? { name, englishQuery } : { name })
  }

  const addDecision = (entry: Record<string, unknown>) => {
    if (isSkipKnownFlag(entry)) return
    const label = normalizeDecisionLabel(entry.label ?? entry.decision)
    if (label === "invented" || label === "unsure" || label === "skip") return
    if (
      label === "real"
      || label === "search"
      || entry.needExternal === true
      || entry.search === true
      || (!label && typeof entry.name === "string")
    ) {
      add(entry.name, entry)
    }
  }

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (typeof item === "string") add(item)
      else if (item && typeof item === "object") {
        const record = item as Record<string, unknown>
        if (record.needExternal === false) continue
        if ("label" in record || "decision" in record) {
          addDecision(record)
          continue
        }
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

  if (Array.isArray(record.decisions)) {
    for (const item of record.decisions) {
      if (!item || typeof item !== "object") continue
      addDecision(item as Record<string, unknown>)
    }
  }

  const needExternal = record.needExternal ?? record.search ?? record.names
  if (Array.isArray(needExternal)) {
    for (const item of needExternal) {
      if (typeof item === "string") add(item)
      else if (item && typeof item === "object") {
        const entry = item as Record<string, unknown>
        if (entry.needExternal === false) continue
        if ("label" in entry || "decision" in entry) {
          addDecision(entry)
          continue
        }
        add(entry.name, entry)
      }
    }
  }
  if (Array.isArray(record.entities)) {
    for (const item of record.entities) {
      if (!item || typeof item !== "object") continue
      const entry = item as Record<string, unknown>
      if ("label" in entry || "decision" in entry) {
        addDecision(entry)
        continue
      }
      if (entry.needExternal === true || entry.search === true) add(entry.name, entry)
    }
  }
  return selected
}

interface WritingEntitySearchWorkflowPersisted {
  content: string
  searchedNames: string[]
  notes: string[]
  items: WritingEntitySearchItem[]
}

const DISPLAY_TITLE_MAX = 80
const DISPLAY_SNIPPET_MAX = 140

export function formatWritingEntitySearchMarkdown(
  items: WritingEntitySearchItem[],
): string {
  // 0 条结果且无摘要：不占写作上下文（时间线仍可由 notes/searchedNames 说明）。
  const usable = items.filter(
    (item) => Boolean(item.summary?.trim()) || item.results.length > 0,
  )
  if (usable.length === 0) return ""
  const sections = usable.map((item) => {
    const summary = item.summary?.trim() ?? ""
    if (summary) {
      // Gemini：只放搜索词 + 完整摘要；来源、片段、链接只在时间线展示。
      const block = formatGeminiContextBlock({
        queries: item.searchQueries,
        summary,
        labels: { queries: "实际搜索词：", summary: "搜索摘要：" },
      })
      return [`### ${item.name}`, ...block].join("\n")
    }
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
    const summary = item.summary?.trim()
    if (summary) {
      lines.push(summary)
    } else if (item.results.length === 0) {
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
    // 只有 Gemini 有；没有时不写这些键，保持旧记录格式不变。
    ...(item.searchQueries?.length ? { searchQueries: [...item.searchQueries] } : {}),
    ...(item.summary?.trim() ? { summary: item.summary } : {}),
    ...(item.searchSuggestionsHtml?.trim() ? { searchSuggestionsHtml: item.searchSuggestionsHtml } : {}),
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
  if (parsed.items.some((item) => item.summary?.trim())) {
    return formatWritingEntitySearchWorkflowResult({ ...parsed, markdown: "" })
  }
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

function normalizePersistedSearchItems(value: unknown): WritingEntitySearchItem[] {
  if (!Array.isArray(value)) return []
  const items: WritingEntitySearchItem[] = []
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
    const searchQueries = Array.isArray(record.searchQueries)
      ? record.searchQueries.filter((q): q is string => typeof q === "string" && q.trim().length > 0)
      : []
    items.push({
      name,
      results,
      ...(searchQueries.length ? { searchQueries } : {}),
      ...(typeof record.summary === "string" && record.summary.trim() ? { summary: record.summary } : {}),
      ...(typeof record.searchSuggestionsHtml === "string" && record.searchSuggestionsHtml.trim()
        ? { searchSuggestionsHtml: record.searchSuggestionsHtml }
        : {}),
    })
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
    return {
      markdown: "",
      searchedNames: [],
      notes: ["未配置外部搜索，跳过联网补搜；可在「设置 → 网页搜索」配置搜索源"],
      items: [],
      skipped: true,
    }
  }

  throwIfAborted(input.signal)

  try {
    const listEntityNames = input.listEntityNames ?? listLocalEntityNames
    const search: (term: string) => Promise<WebSearchOutcome> = input.search
      ? async (term) => ({
        results: await input.search!(term, input.searchApiConfig!, RESULTS_PER_QUERY),
      })
      : (term) => (input.searchDetailed ?? webSearchDetailed)(
        term,
        input.searchApiConfig!,
        RESULTS_PER_QUERY,
      )

    // 前文正文不再读入免搜语料：一笔带过 ≠ 有可写资料。
    void input.readPreviousBodies
    void input.previousChaptersAnalysis
    const entityNames = await listEntityNames(input.projectPath)
    throwIfAborted(input.signal)

    const knowledgeCorpus = buildKnowledgeWritingCorpus(input.contextPack)

    const extracted = await extractEntityNames(input)
    const unresolved = selectUnresolvedEntities(extracted, knowledgeCorpus, entityNames)
    if (unresolved.length === 0) {
      notes.push(
        extracted.length === 0
          ? "未从任务与章纲中抽出候选实体，跳过联网补搜"
          : `候选实体已有设定/实体表资料，跳过联网补搜：${extracted.join("、")}`,
      )
      return { markdown: "", searchedNames: [], notes, items: [], skipped: true }
    }

    const hardNames: string[] = []
    const grayNames: string[] = []
    const inventedNames: string[] = []
    for (const name of unresolved) {
      const hint = classifyNameSearchHeuristic(name)
      if (hint === "search") hardNames.push(name)
      else if (hint === "skip") inventedNames.push(name)
      else grayNames.push(name)
    }
    if (inventedNames.length > 0) {
      notes.push(`启发式判定为本书自造、跳过：${inventedNames.join("、")}`)
    }

    let llmQueries: WritingEntitySearchQuery[] = []
    let judgeFailed = false
    if (grayNames.length > 0) {
      try {
        llmQueries = await judgeNeedExternal(input, grayNames)
      } catch (error) {
        rethrowIfUserAbort(error, input.signal)
        judgeFailed = true
        notes.push(
          `实体联网判定失败，仅保留硬信号补搜：${error instanceof Error ? error.message : String(error)}`,
        )
        llmQueries = []
      }
      // JSON 空/解析失败时 parse 返回 []：gray 全部当 unsure，不搜。
      if (!judgeFailed && llmQueries.length === 0 && grayNames.length > 0) {
        notes.push(`模型未选出需联网项（自造/不确定/已知充分）：${grayNames.join("、")}`)
      }
    }

    const queries = mergeSearchQueries(hardNames, llmQueries).slice(0, MAX_SEARCH_QUERIES)
    if (queries.length === 0) {
      if (hardNames.length === 0 && inventedNames.length === unresolved.length) {
        notes.push(`判定为本书自造、无需联网：${unresolved.join("、")}`)
      } else if (notes.length === 0) {
        notes.push(`无需联网补搜：${unresolved.join("、")}`)
      }
      return { markdown: "", searchedNames: [], notes, items: [], skipped: true }
    }

    input.onSearchStart?.(launchedQueriesFor(queries))

    const items: WritingEntitySearchItem[] = []
    const searchedNames: string[] = []
    for (const query of queries) {
      throwIfAborted(input.signal)
      const results: WebSearchResult[] = []
      const extraQueries: string[] = []
      const summaries: string[] = []
      const suggestions: string[] = []
      let searchedThisEntity = false
      for (const term of launchedQueriesFor([query])) {
        throwIfAborted(input.signal)
        try {
          const outcome = await search(term)
          mergeSearchResults(results, outcome.results)
          if (outcome.queries?.length) extraQueries.push(...outcome.queries)
          if (outcome.summary?.trim()) summaries.push(outcome.summary.trim())
          if (outcome.searchSuggestionsHtml?.trim()) suggestions.push(outcome.searchSuggestionsHtml)
          searchedNames.push(term)
          searchedThisEntity = true
        } catch (error) {
          rethrowIfUserAbort(error, input.signal)
          notes.push(`搜索「${term}」失败：${error instanceof Error ? error.message : String(error)}`)
        }
      }
      if (searchedThisEntity) {
        items.push({
          name: query.name,
          results,
          ...(extraQueries.length ? { searchQueries: [...new Set(extraQueries)] } : {}),
          ...(summaries.length ? { summary: summaries.join("\n\n") } : {}),
          ...(suggestions.length ? { searchSuggestionsHtml: suggestions.join("\n") } : {}),
        })
      }
    }

    const markdown = formatWritingEntitySearchMarkdown(items)
    if (!markdown.trim() && searchedNames.length > 0) {
      notes.push(`已搜索但无可用结果：${[...new Set(items.map((item) => item.name))].join("、")}`)
    }

    return {
      markdown,
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
      content: "你判断这些本地没有设定资料的名字是否需要联网查公开资料。只输出 JSON。",
    },
    {
      role: "user",
      content: [
        "下列名称在本库设定/实体表中没有可写资料（正文里提过一嘴不算有资料）。",
        "先判断名称性质，再判断是否值得联网：",
        "label=real：较有把握对应现实人物/地点/机构/历史事件/装备型号/专业术语，或公开 IP / 已出版作品设定。",
        "label=invented：本书自造人名、门派、功法、法宝、架空地名，或占位词。",
        "label=unsure：无法判断真实还是自造。",
        "规则：invented 与 unsure 一律不搜。",
        "对 real：若你已充分了解该公开事物、写作用不上传新外链细节，设 skip_known=true（可不搜）；",
        "若细节可能过时、易写错、或本章需要核对具体事实，则 skip_known=false 或不写该字段（要搜）。",
        "不要用「知识不够」当唯一门槛，也不要把不确定标成 real。",
        '只输出 JSON：{"decisions":[{"name":"名称","label":"real|invented|unsure","skip_known":false,"englishQuery":"English query"}]}',
        "englishQuery 仅在英文检索明显更好时填写（外国人名、外文机构、技术型号）；不要为自造名硬翻英文，不要把拼音当英文检索词。",
        "无合适英文检索词时省略 englishQuery。",
        "",
        unresolved.join("\n"),
      ].join("\n"),
    },
  ])
  return parseNeedExternalQueries(raw, unresolved)
}

/** 硬信号优先，再合并模型选出的 real；同名去重。 */
export function mergeSearchQueries(
  hardNames: readonly string[],
  llmQueries: readonly WritingEntitySearchQuery[],
): WritingEntitySearchQuery[] {
  const merged: WritingEntitySearchQuery[] = []
  const seen = new Set<string>()
  for (const name of hardNames) {
    const trimmed = name.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    const fromLlm = llmQueries.find((item) => item.name === trimmed)
    merged.push(fromLlm?.englishQuery ? { name: trimmed, englishQuery: fromLlm.englishQuery } : { name: trimmed })
  }
  for (const query of llmQueries) {
    if (seen.has(query.name)) continue
    seen.add(query.name)
    merged.push(query)
  }
  return merged
}

async function completeText(
  input: CollectWritingEntityWebSearchInput,
  messages: ChatMessage[],
): Promise<string> {
  let result = ""
  // streamChat 报错走 onError 而不 throw；不记下来的话模型不可用会静默变成「没有实体要搜」。
  const failures: Error[] = []
  await input.streamChat(
    input.llmConfig,
    messages,
    {
      onToken: (token) => { result += token },
      onDone: () => {},
      onError: (error) => { failures.push(error) },
      onRequestTrace: input.onRequestTrace,
    },
    input.signal,
  )
  const text = result.trim()
  if (!text && failures.length > 0) throw failures[0]
  return text
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

function looksLikeEnglishSearchQuery(query: string, name: string): boolean {
  const trimmed = query.trim()
  if (!trimmed || trimmed === name.trim()) return false
  // 至少含拉丁字母；拒绝纯拼音无空格的短串滥翻。
  if (!/[A-Za-z]/.test(trimmed)) return false
  if (/^[a-z]+$/.test(trimmed) && trimmed.length <= 12 && !/\s/.test(trimmed)) return false
  return true
}

function launchedQueriesFor(queries: readonly WritingEntitySearchQuery[]): string[] {
  const launched: string[] = []
  for (const query of queries) {
    launched.push(query.name)
    if (query.englishQuery && looksLikeEnglishSearchQuery(query.englishQuery, query.name)) {
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
