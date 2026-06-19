import { create } from "zustand"
import type { WikiProject, FileNode } from "@/types/wiki"
import { DEFAULT_SOURCE_WATCH_CONFIG } from "@/lib/source-watch-config"
import type { LintResult } from "@/lib/lint"
import type { NovelReviewResult } from "@/lib/novel/review-adapter"
import type { DimensionReviewResult, SixReviewDimensionKey } from "@/lib/novel/dimension-review-adapter"
import type { TrashItem } from "@/lib/trash"

const GRAPH_LABEL_MODE_KEY = "lk-graph-label-display-mode"
const GRAPH_EDGE_COLOR_KEY = "lk-graph-edge-color"
const GRAPH_EDGE_STRENGTH_KEY = "lk-graph-edge-strength"
const GRAPH_EDGE_STYLE_KEY = "lk-graph-edge-style"
const GRAPH_EDGE_LABELS_ALWAYS_KEY = "lk-graph-edge-labels-always"
const CHAT_DOCK_POSITION_KEY = "qmai-chat-dock-position"
const UI_FONT_SIZE_SCALE_KEY = "qmai-ui-font-size-scale"

export type ChatDockPosition = "bottom" | "right"
export type SettingsCategoryId =
  | "llm"
  | "rerank"
  | "embedding"
  | "network"
  | "interface"
  | "novel"
  | "usage-guide"
  | "maintenance"
  | "data-management"
  | "feedback"
  | "contact-support"
  | "changelog"

const readStoredChatDockPosition = (): ChatDockPosition => {
  if (typeof localStorage === "undefined") return "bottom"
  const saved = localStorage.getItem(CHAT_DOCK_POSITION_KEY)
  return saved === "right" || saved === "bottom" ? saved : "bottom"
}

const readStoredUiFontSizeScale = (): number => {
  if (typeof localStorage === "undefined") return 1
  const saved = Number(localStorage.getItem(UI_FONT_SIZE_SCALE_KEY) ?? "1")
  return Number.isFinite(saved) ? Math.max(0.85, Math.min(1.3, Number(saved.toFixed(2)))) : 1
}

const readStoredGraphLabelDisplayMode = (): string => {
  if (typeof localStorage === "undefined") return "all"
  const saved = localStorage.getItem(GRAPH_LABEL_MODE_KEY)
  return saved === "auto" || saved === "focused" || saved === "all" ? saved : "all"
}

const readStoredGraphEdgeColorHex = (): string => {
  if (typeof localStorage === "undefined") return "#7f8ea3"
  const saved = localStorage.getItem(GRAPH_EDGE_COLOR_KEY)
  return saved && /^#[0-9a-fA-F]{6}$/.test(saved) ? saved : "#7f8ea3"
}

const readStoredGraphEdgeStrengthPercent = (): number => {
  if (typeof localStorage === "undefined") return 180
  const saved = Number(localStorage.getItem(GRAPH_EDGE_STRENGTH_KEY) ?? "180")
  return Number.isFinite(saved) ? Math.max(100, Math.min(260, saved)) : 180
}

const readStoredGraphEdgeStyle = (): string => {
  if (typeof localStorage === "undefined") return "curve"
  const saved = localStorage.getItem(GRAPH_EDGE_STYLE_KEY)
  return saved === "curve" || saved === "arrow" || saved === "line" ? saved : "curve"
}

const readStoredGraphEdgeLabelsAlways = (): boolean => {
  if (typeof localStorage === "undefined") return false
  return localStorage.getItem(GRAPH_EDGE_LABELS_ALWAYS_KEY) === "true"
}

/**
 * Wire protocol used when `provider === "custom"`. Other providers have a
 * fixed protocol (openai → OpenAI chat; anthropic → Anthropic messages;
 * etc.), so this field is ignored for them. `undefined` defaults to
 * `chat_completions` for backward compatibility with pre-0.3.7 configs.
 */
export type CustomApiMode = "chat_completions" | "responses" | "anthropic_messages"
export type AzureModelFamily = "auto" | "gpt5"
export type ReasoningMode = "auto" | "off" | "low" | "medium" | "high" | "max" | "custom"

export interface ReasoningConfig {
  mode: ReasoningMode
  budgetTokens?: number
}

interface LlmConfig {
  provider: "openai" | "anthropic" | "google" | "azure" | "ollama" | "custom" | "minimax" | "claude-code" | "codex-cli"
  apiKey: string
  model: string
  ollamaUrl: string
  customEndpoint: string
  azureApiVersion?: string
  azureModelFamily?: AzureModelFamily
  maxContextSize: number // max context window in characters
  apiMode?: CustomApiMode
  reasoning?: ReasoningConfig
  localCliIsolation?: boolean
  codexCliTimeoutMinutes?: number
}

export type SearchProvider = "tavily" | "serpapi" | "searxng" | "none"
export type SerpApiEngine =
  | "google"
  | "google_news"
  | "google_scholar"
  | "google_patents"
  | "bing"
  | "duckduckgo"
  | "google_images"
  | "google_videos"
  | "youtube"
  | string
export type SearXngCategory =
  | "general"
  | "news"
  | "science"
  | "it"
  | "images"
  | "videos"
  | "files"
  | "map"
  | "music"
  | "social media"
  | string

export interface SearchProviderOverride {
  apiKey?: string
  serpApiEngine?: SerpApiEngine
  searXngUrl?: string
  searXngCategories?: SearXngCategory[]
}

export type SearchProviderConfigs = Partial<Record<Exclude<SearchProvider, "none">, SearchProviderOverride>>

interface SearchApiConfig {
  provider: SearchProvider
  apiKey: string
  serpApiEngine?: SerpApiEngine
  searXngUrl?: string
  searXngCategories?: SearXngCategory[]
  providerConfigs?: SearchProviderConfigs
}

interface EmbeddingConfig {
  enabled: boolean
  endpoint: string // e.g. "http://127.0.0.1:1234/v1/embeddings"
  apiKey: string
  model: string // e.g. "text-embedding-qwen3-embedding-0.6b"
  /** Optional Gemini native `output_dimensionality` value. Ignored by OpenAI-compatible endpoints. */
  outputDimensionality?: number
  /**
   * Chunking knobs (Phase 1 RAG). Undefined values fall back to the
   * chunker's built-in defaults in `src/lib/text-chunker.ts`:
   *   targetChars   1000
   *   maxChars      1500
   *   minChars      200
   *   overlapChars  200
   *
   * Users on small-context endpoints (e.g. llama.cpp with n_ctx=512,
   * Ollama `mxbai-embed-large`) should lower `maxChunkChars` to avoid
   * per-request rejections; fetchEmbedding also auto-halves on
   * "too long" server errors as a second line of defence.
   */
  maxChunkChars?: number
  overlapChunkChars?: number
}

export interface RerankConfig {
  enabled: boolean
  useMainLlm: boolean
  provider: LlmConfig["provider"]
  apiKey: string
  model: string
  ollamaUrl: string
  customEndpoint: string
  apiMode?: CustomApiMode
  maxCandidates: number
}

export const DEFAULT_RERANK_CONFIG: RerankConfig = {
  enabled: false,
  useMainLlm: true,
  provider: "custom",
  apiKey: "",
  model: "",
  ollamaUrl: "http://127.0.0.1:11434",
  customEndpoint: "",
  apiMode: "chat_completions",
  maxCandidates: 12,
}

/**
 * Image-captioning settings (Phase 4 of the multimodal-images plan).
 *
 * Decoupled from `llmConfig` because vision-capable endpoints are
 * usually NOT the same model the user picks for analysis/generation:
 * - the analysis stage often goes to a strong text-only model (Claude
 *   Sonnet, DeepSeek, etc.) that doesn't speak vision at all;
 * - captioning is happy with a small local VL model (Qwen2.5-VL-7B,
 *   LLaVA-1.6) that costs near-zero per call.
 *
 * `enabled` is the master gate. When false the caption pipeline is
 * skipped entirely — `read_file`'s extracted images still appear
 * inline (with empty alt text) and the safety-net `## Embedded
 * Images` section still gets written, but we never touch the LLM.
 *
 * `useMainLlm`: when true (the default for first-time users we
 * onboard), captioning calls go through the same `llmConfig`
 * everything else uses. When false, the dedicated fields below are
 * sent through the same provider machinery — same `streamChat`,
 * same `getProviderConfig`, no duplicate code.
 *
 * `concurrency` bounds parallel caption requests during ingest.
 * 30-image PDFs with sequential captioning at ~10s/image (a Qwen3
 * thinking model on consumer GPU) take 5 minutes. At concurrency=4
 * that drops to ~75s. Going wider than 8 typically just queues
 * behind a single-GPU server's batch slot, so we cap the slider
 * UI at a tasteful max in the settings view.
 */
/**
 * Global outbound HTTP proxy. When `enabled` and `url` is a valid
 * http(s) URL, the Rust setup hook reads this on app launch and
 * sets HTTP_PROXY / HTTPS_PROXY / NO_PROXY env vars before the
 * reqwest client used by tauri-plugin-http is constructed. Changes
 * apply on app restart only.
 */
interface ProxyConfig {
  enabled: boolean
  url: string
  bypassLocal: boolean
}

export interface ClipServerConfig {
  enabled: boolean
  port: number
}

interface ScheduledImportConfig {
  enabled: boolean
  path: string // 监控目录的相对路径（相对于项目根目录），空字符串表示使用默认的 "raw"
  interval: number // 扫描间隔（分钟）
  lastScan: number | null // 上次扫描时间戳
}

interface SourceWatchConfig {
  enabled: boolean
  autoIngest: boolean
  includeExtensions: string[]
  excludeExtensions: string[]
  excludeDirs: string[]
  excludeGlobs: string[]
  maxFileSizeMb: number
}

export interface NovelConfig {
  contextTokenBudget: number
  recentSummaryWindow: number
  searchTopK: number
  /** 单章目标字数（按去除空白后的字符数计），章节生成提示词和扩写阈值都按它推算。 */
  chapterTargetChars: number
  autoIngestOnSave: boolean
  autoExtractOnImport: boolean
  reviewBeforeSave: boolean
  /** 深度生成阶段0：读取并 LLM 分析前几章完整正文。关闭可省一次调用，记忆库的近期摘要与上一章结尾仍会注入（默认关）。 */
  deepPreviousChaptersAnalysis: boolean
  /** 深度生成阶段4-5：AI 审稿 + 自动返修。关闭则初稿直接进入简单审查与去AI味，省审稿与返修调用（默认开）。 */
  deepChapterReview: boolean
  /** 审稿（含六维审查）使用的 reasoning 档位。下调可省审稿推理 Token，但连贯性把关会变弱（默认 high）。 */
  reviewReasoningEffort: "low" | "medium" | "high"
  writingModel: string
  reviewModel: string
  summaryModel: string
  extractModel: string
}

export const DEFAULT_NOVEL_CONFIG: NovelConfig = {
  contextTokenBudget: 0,
  recentSummaryWindow: 8,
  searchTopK: 5,
  chapterTargetChars: 3000,
  autoIngestOnSave: true,
  autoExtractOnImport: true,
  reviewBeforeSave: false,
  deepPreviousChaptersAnalysis: false,
  deepChapterReview: true,
  reviewReasoningEffort: "high",
  writingModel: "",
  reviewModel: "",
  summaryModel: "",
  extractModel: "",
}

export interface RevisionFeedbackWindowConfig {
  currentChapterIncludeShouldImprove: boolean
  previousChapterCarryEnabled: boolean
  lookbackChapterCount: number
  lookbackIncludeMustFixOnly: boolean
}

interface MultimodalConfig {
  enabled: boolean
  /** Reuse `llmConfig` for caption calls. When true, the fields
   *  below are ignored. */
  useMainLlm: boolean
  provider: LlmConfig["provider"]
  apiKey: string
  model: string
  ollamaUrl: string
  customEndpoint: string
  azureApiVersion?: string
  azureModelFamily?: AzureModelFamily
  apiMode?: CustomApiMode
  /** Max parallel caption requests during ingest. >=1. */
  concurrency: number
}

/**
 * Output language for LLM-generated content (wiki pages, chat responses, research).
 * "auto" = detect from user input / source document language.
 * Otherwise = force all LLM output to use the specified language.
 */
type OutputLanguage =
  | "auto"
  | "English"
  | "Chinese"
  | "Traditional Chinese"
  | "Japanese"
  | "Korean"
  | "Vietnamese"
  | "French"
  | "German"
  | "Spanish"
  | "Portuguese"
  | "Italian"
  | "Russian"
  | "Arabic"
  | "Persian"
  | "Hindi"
  | "Turkish"
  | "Dutch"
  | "Polish"
  | "Swedish"
  | "Indonesian"
  | "Thai"
  | "Ukrainian"

/**
 * 已保存的模型配置项
 */
export interface SavedModel {
  /** 唯一ID */
  id: string
  /** 显示名称 */
  name: string
  /** 模型ID */
  model: string
  /** API密钥（可选，可以复用供应商的密钥） */
  apiKey?: string
  /** 自定义接口地址（可选，可以复用供应商的地址） */
  customEndpoint?: string
  /** 备注说明 */
  description?: string
  /** 创建时间 */
  createdAt: number
}

/**
 * Per-preset saved fields. Each entry survives turning the preset off
 * and coming back — users don't have to re-enter an API key when they
 * briefly switch to a different provider.
 */
export interface ProviderOverride {
  label?: string             // 自定义配置的显示名称
  apiKey?: string
  model?: string
  baseUrl?: string           // customEndpoint for custom presets, ollamaUrl for ollama
  azureApiVersion?: string
  azureModelFamily?: AzureModelFamily
  apiMode?: CustomApiMode
  maxContextSize?: number
  reasoning?: ReasoningConfig
  localCliIsolation?: boolean
  codexCliTimeoutMinutes?: number
  /** 是否在 AI 会话中显示该 provider 下的模型（仅用于自定义供应商）。默认 true。 */
  enabled?: boolean
  /** 已保存的模型列表（仅用于自定义供应商） */
  savedModels?: SavedModel[]
}

export type ProviderConfigs = Record<string, ProviderOverride>

interface BaseTaskState {
  projectPath: string
  filePath?: string
}

interface AsyncTaskState extends BaseTaskState {
  runId: string
  running: boolean
  error?: string
}

export type FinalChapterSavePhase =
  | "saving"
  | "reviewing"
  | "saved"
  | "reingesting"
  | "ingested"
  | "blocked_by_review"
  | "ingest_failed"
  | "ingest_no_llm"
  | "ingest_no_chapter_number"
  | "ingest_not_final"
  | "ingest_extract_failed"
  | "review_warnings"
  | "review_failed_proceed"

export interface FinalChapterSaveState extends BaseTaskState {
  filePath: string
  saving: boolean
  phase: FinalChapterSavePhase | null
  params?: Record<string, string | number>
}

export interface LintRunState extends AsyncTaskState {
  hasRun: boolean
  results: LintResult[]
}

export interface ReviewRunState extends AsyncTaskState {
  results: NovelReviewResult[]
  thinking?: string
  dimensionResults?: Partial<Record<SixReviewDimensionKey, DimensionReviewResult>>
  dimensionThinking?: Partial<Record<SixReviewDimensionKey, string>>
  activeDimension?: SixReviewDimensionKey
  dimensionProgress?: string
}

export interface PendingEditorHighlight {
  path: string
  text: string
  nonce: number
}

type LintRunFinishState = Omit<Partial<LintRunState>, "runId" | "projectPath" | "filePath">
type ReviewRunFinishState = Omit<Partial<ReviewRunState>, "runId" | "projectPath" | "filePath">

interface WikiState {
  project: WikiProject | null
  fileTree: FileNode[]
  selectedFile: string | null
  selectedTrashItem: TrashItem | null
  fileContent: string
  pendingEditorHighlight: PendingEditorHighlight | null
  /**
   * One-shot scroll target for the markdown preview. When the user
   * clicks an image in search results and chooses "jump to source",
   * we set this to the image URL alongside `selectedFile`. The
   * markdown preview consumes it on its next render — finds the
   * `<img data-mdsrc="..."/>` whose attribute matches and scrolls
   * it into view, then clears this back to null so a stale target
   * doesn't fire on the NEXT page open.
   *
   * Match by raw URL (the literal `src` from the markdown) rather
   * than the resolved `convertFileSrc` URL — same image referenced
   * across two pages with different URL conventions (one absolute,
   * one wiki-relative) still works.
   */
  pendingScrollImageSrc: string | null
  selectedMemoryCenterEntry: string | null
  chatExpanded: boolean
  chatDockPosition: ChatDockPosition
  searchPanelOpen: boolean
  activeView: "wiki" | "sources" | "search" | "graph" | "lint" | "soul" | "dismantling" | "bookAnalysis" | "settings" | "trash" | "reviewCenter"
  activeSettingsCategory: SettingsCategoryId | null
  selectedSoulId: string | null
  selectedSoulTab: "project" | "character"
  selectedSoulSection: "builtIn" | "custom"
  selectedReviewDimension: string | null
  selectedReviewFilePath: string
  selectedDismantlingProjectId: string | null
  graphMode: string
  graphDisplayMode: string
  graphColorMode: string
  graphLabelDisplayMode: string
  graphShowFilters: boolean
  graphShowEdgeControls: boolean
  graphEdgeStyle: string
  graphEdgeColorHex: string
  graphEdgeStrengthPercent: number
  graphEdgeLabelsAlwaysVisible: boolean
  graphStats: { nodeCount: number; edgeCount: number; hiddenCount: number; filteredNodeCount: number; filteredEdgeCount: number }
  refreshGraph: (() => void) | null
  llmConfig: LlmConfig
  aiChatModel: string
  /** Per-provider-preset stored overrides (API key, model, endpoint, …). */
  providerConfigs: ProviderConfigs
  /** Which preset is currently active. `null` = no LLM configured. */
  activePresetId: string | null
  searchApiConfig: SearchApiConfig
  embeddingConfig: EmbeddingConfig
  rerankConfig: RerankConfig
  multimodalConfig: MultimodalConfig
  outputLanguage: OutputLanguage
  proxyConfig: ProxyConfig
  clipServerConfig: ClipServerConfig
  scheduledImportConfig: ScheduledImportConfig
  sourceWatchConfig: SourceWatchConfig
  novelMode: boolean
  chatEditModeEnabled: boolean
  novelConfig: NovelConfig
  searchHistory: string[]
  searchTrigger: { query: string; ts: number } | null
  revisionFeedbackWindowConfig: RevisionFeedbackWindowConfig
  finalChapterSave: FinalChapterSaveState | null
  lintRun: LintRunState | null
  reviewRun: ReviewRunState | null
  theme: "light" | "dark" | "deep-blue"
  uiFontSizeScale: number
  dataVersion: number

  setProject: (project: WikiProject | null) => void
  setFileTree: (tree: FileNode[]) => void
  setSelectedFile: (path: string | null) => void
  setSelectedTrashItem: (item: TrashItem | null) => void
  setFileContent: (content: string) => void
  setPendingEditorHighlight: (highlight: PendingEditorHighlight | null) => void
  setPendingScrollImageSrc: (src: string | null) => void
  setSelectedMemoryCenterEntry: (entry: string | null) => void
  setChatExpanded: (expanded: boolean) => void
  setChatDockPosition: (position: ChatDockPosition) => void
  setSearchPanelOpen: (open: boolean) => void
  setActiveView: (view: WikiState["activeView"]) => void
  setActiveSettingsCategory: (category: SettingsCategoryId | null) => void
  setSelectedSoulId: (id: string | null) => void
  setSelectedSoulTab: (tab: "project" | "character") => void
  setSelectedSoulSection: (section: "builtIn" | "custom") => void
  setSelectedReviewDimension: (dimension: string | null) => void
  setSelectedReviewFilePath: (path: string) => void
  setSelectedDismantlingProjectId: (id: string | null) => void
  setGraphMode: (mode: string) => void
  setGraphDisplayMode: (mode: string) => void
  setGraphColorMode: (mode: string) => void
  setGraphLabelDisplayMode: (mode: string) => void
  setGraphShowFilters: (v: boolean) => void
  setGraphShowEdgeControls: (v: boolean) => void
  setGraphEdgeStyle: (style: string) => void
  setGraphEdgeColorHex: (hex: string) => void
  setGraphEdgeStrengthPercent: (pct: number) => void
  setGraphEdgeLabelsAlwaysVisible: (v: boolean) => void
  setGraphStats: (stats: WikiState["graphStats"]) => void
  setRefreshGraph: (refreshGraph: (() => void) | null) => void
  setLlmConfig: (config: LlmConfig) => void
  setAiChatModel: (model: string) => void
  setProviderConfigs: (configs: ProviderConfigs) => void
  setActivePresetId: (id: string | null) => void
  setSearchApiConfig: (config: SearchApiConfig) => void
  setEmbeddingConfig: (config: EmbeddingConfig) => void
  setRerankConfig: (config: Partial<RerankConfig>) => void
  setMultimodalConfig: (config: MultimodalConfig) => void
  setOutputLanguage: (lang: OutputLanguage) => void
  setProxyConfig: (config: ProxyConfig) => void
  setClipServerConfig: (config: ClipServerConfig) => void
  setScheduledImportConfig: (config: ScheduledImportConfig) => void
  setSourceWatchConfig: (sourceWatchConfig: SourceWatchConfig) => void
  setNovelMode: (novelMode: boolean) => void
  setChatEditModeEnabled: (enabled: boolean) => void
  setNovelConfig: (config: Partial<NovelConfig>) => void
  setSearchHistory: (history: string[]) => void
  setSearchTrigger: (trigger: { query: string; ts: number } | null) => void
  setRevisionFeedbackWindowConfig: (revisionFeedbackWindowConfig: RevisionFeedbackWindowConfig) => void
  setFinalChapterSave: (finalChapterSave: FinalChapterSaveState | null) => void
  setLintRun: (lintRun: LintRunState | null) => void
  finishLintRun: (runId: string, lintRun: LintRunFinishState) => void
  setReviewRun: (reviewRun: ReviewRunState | null) => void
  finishReviewRun: (runId: string, reviewRun: ReviewRunFinishState) => void
  clearTransientTaskState: () => void
  setTheme: (theme: "light" | "dark" | "deep-blue") => void
  setUiFontSizeScale: (scale: number) => void
  bumpDataVersion: () => void
}

export const useWikiStore = create<WikiState>((set) => ({
  project: null,
  fileTree: [],
  selectedFile: null,
  selectedTrashItem: null,
  fileContent: "",
  pendingEditorHighlight: null,
  pendingScrollImageSrc: null,
  selectedMemoryCenterEntry: null,
  chatExpanded: false,
  chatDockPosition: readStoredChatDockPosition(),
  searchPanelOpen: false,
  activeView: "wiki",
  activeSettingsCategory: null,
  selectedSoulId: null,
  selectedSoulTab: "project",
  selectedSoulSection: "builtIn",
  selectedReviewDimension: null,
  selectedReviewFilePath: "",
  selectedDismantlingProjectId: null,
  graphMode: "overview",
  graphDisplayMode: "graph",
  graphColorMode: "type",
  graphLabelDisplayMode: readStoredGraphLabelDisplayMode(),
  graphShowFilters: false,
  graphShowEdgeControls: false,
  graphEdgeStyle: readStoredGraphEdgeStyle(),
  graphEdgeColorHex: readStoredGraphEdgeColorHex(),
  graphEdgeStrengthPercent: readStoredGraphEdgeStrengthPercent(),
  graphEdgeLabelsAlwaysVisible: readStoredGraphEdgeLabelsAlways(),
  graphStats: { nodeCount: 0, edgeCount: 0, hiddenCount: 0, filteredNodeCount: 0, filteredEdgeCount: 0 },
  refreshGraph: null,
  llmConfig: {
    provider: "openai",
    apiKey: "",
    maxContextSize: 204800,
    model: "",
    ollamaUrl: "http://localhost:11434",
    customEndpoint: "",
    azureApiVersion: "2024-10-21",
    azureModelFamily: "auto",
    reasoning: { mode: "auto" },
    localCliIsolation: false,
  },
  aiChatModel: "",
  providerConfigs: {},
  activePresetId: null,

  dataVersion: 0,

  setProject: (project) => set({ project }),
  setFileTree: (fileTree) => set({ fileTree }),
  setSelectedFile: (selectedFile) => set({ selectedFile, selectedTrashItem: null }),
  setSelectedTrashItem: (selectedTrashItem) => set({ selectedTrashItem, selectedFile: null }),
  setFileContent: (fileContent) => set({ fileContent }),
  setPendingEditorHighlight: (pendingEditorHighlight) => set({ pendingEditorHighlight }),
  setPendingScrollImageSrc: (pendingScrollImageSrc) => set({ pendingScrollImageSrc }),
  setSelectedMemoryCenterEntry: (selectedMemoryCenterEntry) => set({ selectedMemoryCenterEntry }),
  setChatExpanded: (chatExpanded) => set({ chatExpanded }),
  setChatDockPosition: (chatDockPosition) => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(CHAT_DOCK_POSITION_KEY, chatDockPosition)
    }
    set({ chatDockPosition })
  },
  setSearchPanelOpen: (searchPanelOpen) => set({ searchPanelOpen }),
  setActiveView: (activeView) => set({ activeView }),
  setActiveSettingsCategory: (activeSettingsCategory) => set({ activeSettingsCategory }),
  setSelectedSoulId: (selectedSoulId) => set({ selectedSoulId }),
  setSelectedSoulTab: (selectedSoulTab) => set({ selectedSoulTab }),
  setSelectedSoulSection: (selectedSoulSection) => set({ selectedSoulSection }),
  setSelectedReviewDimension: (selectedReviewDimension) => set({ selectedReviewDimension }),
  setSelectedReviewFilePath: (selectedReviewFilePath) => set({ selectedReviewFilePath }),
  setSelectedDismantlingProjectId: (selectedDismantlingProjectId) => set({ selectedDismantlingProjectId }),
  setGraphMode: (graphMode) => set({ graphMode }),
  setGraphDisplayMode: (graphDisplayMode) => set({ graphDisplayMode }),
  setGraphColorMode: (graphColorMode) => set({ graphColorMode }),
  setGraphLabelDisplayMode: (graphLabelDisplayMode) => set({ graphLabelDisplayMode }),
  setGraphShowFilters: (graphShowFilters) => set({ graphShowFilters }),
  setGraphShowEdgeControls: (graphShowEdgeControls) => set({ graphShowEdgeControls }),
  setGraphEdgeStyle: (graphEdgeStyle) => set({ graphEdgeStyle }),
  setGraphEdgeColorHex: (graphEdgeColorHex) => set({ graphEdgeColorHex }),
  setGraphEdgeStrengthPercent: (graphEdgeStrengthPercent) => set({ graphEdgeStrengthPercent }),
  setGraphEdgeLabelsAlwaysVisible: (graphEdgeLabelsAlwaysVisible: boolean) => set({ graphEdgeLabelsAlwaysVisible }),
  setGraphStats: (graphStats) => set({ graphStats }),
  setRefreshGraph: (refreshGraph) => set({ refreshGraph }),
  searchApiConfig: {
    provider: "none",
    apiKey: "",
    serpApiEngine: "google",
    searXngUrl: "",
    searXngCategories: ["general"],
    providerConfigs: {},
  },

  embeddingConfig: {
    enabled: false,
    endpoint: "",
    apiKey: "",
    model: "",
  },

  rerankConfig: { ...DEFAULT_RERANK_CONFIG },

  multimodalConfig: {
    // Off by default — captioning is a non-trivial token spend
    // (one VLM call per extracted image), and silently turning it
    // on for every user the first time they import a PDF would be
    // a budget surprise. Users who want it flip the toggle in
    // Settings → Image captioning.
    enabled: false,
    useMainLlm: true,
    provider: "custom",
    apiKey: "",
    model: "",
    ollamaUrl: "http://localhost:11434",
    customEndpoint: "",
    azureApiVersion: "2024-10-21",
    azureModelFamily: "auto",
    apiMode: "chat_completions",
    concurrency: 4,
  },

  outputLanguage: "Chinese",

  proxyConfig: {
    enabled: false,
    url: "",
    bypassLocal: true,
  },

  clipServerConfig: {
    enabled: true,
    port: 19827,
  },

  scheduledImportConfig: {
    enabled: false,
    path: "",
    interval: 60,
    lastScan: null,
  },

  sourceWatchConfig: DEFAULT_SOURCE_WATCH_CONFIG,

  novelMode: false,
  chatEditModeEnabled: false,
  novelConfig: { ...DEFAULT_NOVEL_CONFIG },
  searchHistory: [],
  searchTrigger: null,
  revisionFeedbackWindowConfig: {
    currentChapterIncludeShouldImprove: true,
    previousChapterCarryEnabled: true,
    lookbackChapterCount: 2,
    lookbackIncludeMustFixOnly: true,
  },
  finalChapterSave: null,
  lintRun: null,
  reviewRun: null,
  theme: "light",
  uiFontSizeScale: readStoredUiFontSizeScale(),

  setLlmConfig: (llmConfig) => set({ llmConfig }),
  setAiChatModel: (aiChatModel) => set({ aiChatModel }),
  setProviderConfigs: (providerConfigs) => set({ providerConfigs }),
  setActivePresetId: (activePresetId) => set({ activePresetId }),
  setSearchApiConfig: (searchApiConfig) => set({ searchApiConfig }),
  setEmbeddingConfig: (embeddingConfig) => set({ embeddingConfig }),
  setRerankConfig: (rerankConfig) => set((state) => ({ rerankConfig: { ...state.rerankConfig, ...rerankConfig } })),
  setMultimodalConfig: (multimodalConfig) => set({ multimodalConfig }),
  setOutputLanguage: (outputLanguage) => set({ outputLanguage }),
  setProxyConfig: (proxyConfig) => set({ proxyConfig }),
  setClipServerConfig: (clipServerConfig) => set({ clipServerConfig }),
  setScheduledImportConfig: (scheduledImportConfig) => set({ scheduledImportConfig }),
  setSourceWatchConfig: (sourceWatchConfig) => set({ sourceWatchConfig }),
  setNovelMode: (novelMode) => set({ novelMode }),
  setChatEditModeEnabled: (chatEditModeEnabled) => set({ chatEditModeEnabled }),
  setNovelConfig: (config) => set((state) => ({ novelConfig: { ...state.novelConfig, ...config } })),
  setSearchHistory: (searchHistory) => set({ searchHistory }),
  setSearchTrigger: (searchTrigger) => set({ searchTrigger }),
  setRevisionFeedbackWindowConfig: (revisionFeedbackWindowConfig) => set({ revisionFeedbackWindowConfig }),
  setFinalChapterSave: (finalChapterSave) => set({ finalChapterSave }),
  setLintRun: (lintRun) => set({ lintRun }),
  finishLintRun: (runId, lintRun) => set((state) => {
    if (state.lintRun?.runId !== runId) return {}
    return { lintRun: { ...state.lintRun, ...lintRun } }
  }),
  setReviewRun: (reviewRun) => set({ reviewRun }),
  finishReviewRun: (runId, reviewRun) => set((state) => {
    if (state.reviewRun?.runId !== runId) return {}
    return { reviewRun: { ...state.reviewRun, ...reviewRun } }
  }),
  clearTransientTaskState: () => set({ finalChapterSave: null, lintRun: null, reviewRun: null }),
  setTheme: (theme) => set({ theme }),
  setUiFontSizeScale: (scale) => {
    const clamped = Math.max(0.85, Math.min(1.3, Number(scale.toFixed(2))))
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(UI_FONT_SIZE_SCALE_KEY, String(clamped))
    }
    set({ uiFontSizeScale: clamped })
  },
  bumpDataVersion: () => set((state) => ({ dataVersion: state.dataVersion + 1 })),
}))

export type { WikiState, LlmConfig, SearchApiConfig, EmbeddingConfig, MultimodalConfig, OutputLanguage, ProxyConfig, ScheduledImportConfig, SourceWatchConfig }
