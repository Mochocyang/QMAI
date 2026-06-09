export interface ChangelogEntry {
  version: string
  date: string
  highlights: {
    en: string[]
    zh: string[]
  }
}

const TWO_POINT_TWO_TEN_CHANGELOG: ChangelogEntry = {
  version: "2.2.10",
  date: "2026-06-09",
  highlights: {
    en: [
      "Restored the LLM provider model fetch control so fetched models can be selected from a dropdown and the model test uses the selected model.",
    ],
    zh: [
      "恢复大语言/LLM 模型中的拉取模型入口：拉取后可从下拉框选择模型，点击测试模型时会测试当前选中的模型。",
    ],
  },
}

const TWO_POINT_TWO_ELEVEN_CHANGELOG: ChangelogEntry = {
  version: "2.2.11",
  date: "2026-06-10",
  highlights: {
    en: [
      "Fixed the AI Chat save-to-chapter-library flow so the first blank chapter keeps the full right-side chapter toolbar after saving.",
      "Restored frontmatter-dependent chapter actions after AI Chat saving, including Save as Final Chapter and View Memory.",
      "Synced preview-body updates when AI Chat appends to or overwrites the currently open chapter, preventing the same toolbar-state regression from reappearing.",
      "Removed the hard 2,200-3,200 character limit from later deep chapter stages, so review, revision, and final de-AI passes no longer stop or rewrite solely because of that range.",
      "Removed the old full-text hard cutoff warning from AI Chat streaming, so long chapters no longer stop at a fixed limit while duplicate-output detection stays in place.",
      "Refined the novel de-AI rules to preserve plot movement, character voice, rough dialogue edges, narrative rhythm, and subtext.",
      "Fixed local Claude Code CLI and Codex CLI mode so subprocesses explicitly inherit local PATH, HOME, USERPROFILE, APPDATA, and HTTP/HTTPS/ALL/NO_PROXY proxy variables.",
      "Fixed local CLI mode being overridden by preset default models; when no model is entered manually, QMAI now reads the current default model from ~/.claude/settings.json and ~/.codex/config.toml and runs with the local CLI configuration first.",
      "Added regression coverage for local CLI config reading, empty-model fallback, and CLI spawn arguments so local environment and proxy mode do not regress again.",
    ],
    zh: [
      "修复 AI 会话“保存到章节库”后，首章空白章节的右侧章节工具栏变成不完整工具栏的问题。",
      "修复保存后缺少“保存为正式章节”“查看记忆”等依赖章节 frontmatter 的按钮问题。",
      "补齐 AI 会话将内容追加/覆盖到当前已打开章节时的预览正文同步，避免出现同类工具栏状态错乱回归。",
      "删除 AI 会话深度章节生成后续阶段的 2200-3200 字硬性限制，审稿、返修和最终去 AI 味阶段不再因为字数区间强制重写或中止。",
      "移除 AI 会话流式输出的旧全文硬截断提示，避免长正文因固定上限直接停止；重复输出检测仍然保留。",
      "优化小说去AI味规则，强调保留剧情、角色声线、对白毛边、叙事节奏和潜台词。",
      "修复本地 Claude Code CLI / Codex CLI 无法正确继承本机环境的问题，启动时会显式带上本机 PATH、HOME、USERPROFILE、APPDATA 以及 HTTP/HTTPS/ALL/NO_PROXY 代理变量。",
      "修复本地 CLI 模式会被软件预设默认模型覆盖的问题；当未手动填写模型时，软件会读取本机 ~/.claude/settings.json 与 ~/.codex/config.toml 中的当前默认模型，并优先按本地 CLI 配置运行。",
      "补充本地 CLI 配置读取、空模型回退、以及 CLI 启动参数的回归测试，避免后续再次出现“本地环境读不到”或“走不到本地代理模式”的回退。",
    ],
  },
}

const TWO_POINT_TWO_NINE_CHANGELOG: ChangelogEntry = {
  version: "2.2.9",
  date: "2026-06-09",
  highlights: {
    en: [
      "Fixed AI Outline deep-thinking generation so missing outline context or conversation fields no longer crash the panel with undefined length/trim errors.",
    ],
    zh: [
      "修复 AI 大纲深度思考生成报错：当大纲上下文或对话字段缺失时，不会再因为 undefined 的 length / trim 报错而直接生成失败。",
    ],
  },
}

const TWO_POINT_TWO_EIGHT_CHANGELOG: ChangelogEntry = {
  version: "2.2.8",
  date: "2026-06-08",
  highlights: {
    en: [
      "Added local-environment LLM defaults so an unset model can be filled from VITE_QMAI_LLM_API_KEY, VITE_QMAI_LLM_ENDPOINT, and VITE_QMAI_LLM_MODEL.",
      "Fixed review history chapter attribution so selected chapter file names take priority over stale frontmatter chapter numbers.",
      "Improved review streaming updates to reduce UI refresh pressure without reducing the amount of memory material used for review.",
      "Improved graph cache isolation so different projects no longer share retrieval graphs when they have the same data version.",
      "Added a 3,500-character cap to the deep chapter stage 3 draft prompt so models are asked to keep the first draft under control before later review stages.",
      "Raised the deep chapter length-rewrite failure ceiling to 6,000 characters; after four failed compression attempts, usable long chapters continue to review instead of stopping solely because they are above 3,200 characters.",
    ],
    zh: [
      "修复未单独设置模型时的默认模型读取问题，现在会优先回退到本地环境变量中的模型配置。",
      "修复审查历史的章节归属问题，优先使用当前选中的章节文件名而不是旧 frontmatter 章节号。",
      "优化审查流式更新，减少界面频繁刷新带来的压力，同时保留完整审查上下文。",
      "优化图谱缓存隔离，不同项目即使 dataVersion 相同也不会共用检索图谱。",
      "深度章节第 3 阶段新增 3500 字草稿提示上限，先在初稿阶段抑制模型失控扩写。",
      "深度章节长度重写失败上限提升到 6000 字，连续压缩失败时可保留可用长稿继续审查。",
    ],
  },
}

const TWO_POINT_TWO_SEVEN_CHANGELOG: ChangelogEntry = {
  version: "2.2.7",
  date: "2026-06-06",
  highlights: {
    en: [
      "Hidden the Dismantling Library UI for 2.2.7 and disabled dismantling-structure injection in AI Chat so the feature is fully out of the visible writing flow for now.",
      "Removed the 2.2.6 to 2.2.1 release notes from the in-app changelog list, leaving 2.2.7 as the latest visible 2.2.x entry before 2.2.0.",
      "Fixed AI Chat Continue Unfinished so deep chapter recovery now resumes from a saved stage checkpoint instead of asking the model to guess where to continue.",
      "Deep chapter failures now persist the first interrupted chain, the latest recoverable checkpoint, and the original request, so repeated Continue Unfinished clicks stay anchored to the same task even after later retries fail.",
      "Switching models during Continue Unfinished now still reloads the original interrupted request and resume snapshot before continuing the remaining deep chapter stages.",
      "Fixed immersive chapter editing so typing into a newly inserted paragraph no longer collapses back onto the first line while auto-format saving runs in the background.",
    ],
    zh: [
      "修复沉浸式章节编辑时新段落输入会回跳到首行的问题。",
      "暂时隐藏拆书库界面入口，并停用 AI 会话中的拆书结构注入。",
      "移除软件内 2.2.6 到 2.2.1 的更新日志显示，2.2.x 只保留 2.2.7 与 2.2.0。",
      "修复 AI 会话“继续未完成”偏离原始深度章节任务的问题，恢复时优先读取保存的阶段快照。",
      "深度章节失败时会同时保存原始任务链、最近可恢复快照和原始请求，重复继续时不会越跑越偏。",
      "继续未完成时即使切换模型，也会重新加载原始请求和恢复快照后再继续后续阶段。",
    ],
  },
}

const TWO_POINT_TWO_ZERO_CHANGELOG: ChangelogEntry = {
  version: "2.2.0",
  date: "2026-06-05",
  highlights: {
    en: [
      "Consolidated the recent AI Chat, deep chapter generation, memory import, deletion cleanup, and network resilience fixes into the 2.2.0 release.",
      "Fixed Continue Next Chapter so AI Chat resolves a concrete target chapter number for prompts, context retrieval, chapter goals, timeline positioning, and review calls.",
      "Improved Character Soul matching by using chapter goals, outlines, character states, memory, and cognition context in addition to the latest user request.",
      "Reworked deep chapter length control with a 6,000-character stage-3 safety cap, strict stage-4 optimization to 2,200-3,200 characters, and up to four retries when output remains over 4,000 characters.",
      "Improved Continue Unfinished so failed deep chapter runs preserve and reuse the original request, recoverable stage context, and rebuilt novel context pack.",
      "Extended shared LLM request retry windows and replaced raw request-send/network errors with clearer Chinese explanations.",
      "Kept chapter and outline import memory extraction progress visible in the extraction panel, added cancel-import behavior, and improved source-related memory/entity cleanup after deletion.",
      "Fixed AI Chat stop handling so stopping during thinking or streaming finalizes immediately and ignores late callbacks.",
    ],
    zh: [
      "将近期 AI 会话、深度章节、导入记忆、删除清理和网络稳定性修复整合到 2.2.0。",
      "修复“继续生成下一章”时目标章节号解析错误，确保提示词、上下文、章节目标和时间线都使用正确章节号。",
      "优化 Character Soul 绑定，除最后一句请求外，也会综合章节目标、大纲、角色状态、记忆和认知上下文。",
      "重做深度章节长度控制，第 3 阶段安全上限为 6000 字，第 4 阶段严格优化到 2,200-3,200 字，并允许最多四次重试。",
      "优化“继续未完成”恢复逻辑，失败后会保留原始请求、可恢复阶段上下文和重建后的小说上下文包。",
      "延长共享 LLM 请求重试窗口，并将原始 request-send/network errors 替换为更清晰的中文提示。",
      "保留章节和大纲导入后的记忆提取进度显示，新增取消导入，并完善删除后的来源记忆与实体清理。",
      "修复 AI 会话停止生成不及时的问题，思考阶段和流式阶段都能立即收口。",
    ],
  },
}

const TWO_POINT_ONE_ZERO_CHANGELOG: ChangelogEntry = {
  version: "2.1.0",
  date: "2026-06-05",
  highlights: {
    en: [
      "Added independent Golden Three Chapters constraints for opening, first chapter, and first-three-chapter requests.",
      "Applied Golden Three Chapters rules to both deep chapter generation and ordinary chapter generation.",
      "Optimized Golden Three Chapters output: opening requests generate the first chapter plus directions for chapters two and three, while explicit chapter two or three requests generate only that chapter.",
      "Improved AI Chat dock controls so only one target switch is shown at a time.",
      "Added vertical resizing for AI Chat and AI Outline input boxes.",
      "Fixed AI Chat input resizing limits so the input can expand up to half of the real panel height.",
      "Added chapter file and folder import with automatic chapter-number sorting.",
      "Improved chapter folder import with a pre-scan and memory extraction confirmation.",
      "Added optional chapter memory extraction progress with cancellation during import.",
      "Improved chapter filename wildcard matching for volume and chapter formats.",
      "Lazy-loaded deep chapter generation only when deep mode is enabled.",
      "Cleaned up stale mock assertions so the mocked test suite passes again.",
      "Removed Source Watch and Scheduled Import entries from Settings.",
      "Fixed proxy startup behavior so disabled proxy settings clear inherited proxy environment variables.",
      "Fixed update checks in environments with stale lowercase proxy variables or ALL_PROXY values, and replaced the raw updater error with a clearer Chinese message.",
      "Clarified the deep chapter length limit message for the 4500-character chapter limit.",
      "Fixed deep writing so internal request cancellation after a chapter length cutoff no longer appears as a generation failure.",
      "Fixed AI Review rewrite application so original fragments can still be located when line breaks or spacing differ.",
    ],
    zh: [
      "新增独立的黄金三章开篇约束，覆盖开篇、第一章和前三章请求。",
      "黄金三章规则同时接入深度章节生成和普通章节生成流程。",
      "优化黄金三章输出策略：开篇请求生成第一章正文并附带第二、第三章方向。",
      "明确请求第二章或第三章时，只生成目标章节内容。",
      "优化 AI 会话停靠切换按钮，同一时刻只显示一个停靠目标。",
      "AI 会话与 AI 大纲输入框支持竖向拖拽调整高度。",
      "修复输入框高度上限，最高可扩展到面板实际高度的一半。",
      "新增章节文件与文件夹导入，并自动按章节号排序。",
      "优化章节文件夹导入，导入前先预扫描可导入章节数量。",
      "新增导入时的记忆提取确认流程，可选择是否提取记忆。",
      "新增导入记忆进度显示，并支持在导入过程中取消。",
      "增强章节文件名匹配，兼容卷、章等更复杂命名格式。",
      "深度章节模块改为按需加载，仅在开启深度模式后初始化。",
      "清理过期 mock 断言，恢复 mock 测试套件可通过状态。",
      "设置页移除 Source Watch 与 Scheduled Import 入口。",
      "修复代理启动行为，禁用代理时会清理继承的代理环境变量。",
      "修复更新检查在异常代理环境下的报错，并改成更清晰的中文提示。",
      "补强 AI 审查改写落地逻辑，换行或空格变化后仍能定位原文片段。",
    ],
  },
}

const TWO_POINT_ZERO_CHANGELOG: ChangelogEntry = {
  version: "2.0.0",
  date: "2026-06-04",
  highlights: {
    en: [
      "Major release: upgraded QMAI from a basic AI writing assistant into a staged novel-writing workflow with planning, generation, review, rewrite, and traceable revision loops.",
      "AI Chat now supports deep chapter generation with context analysis, task brief, draft writing, AI review, revision, final lightweight review, and de-AI polish.",
      "AI Outline now uses staged thinking generation with live progress, outline task briefs, draft generation, self-checking, cleaner saving, and quick generation tools for chapter outlines, characters, factions, abilities, foreshadowing, and locations.",
      "Review Center was rebuilt around staged deep review and six independent professional review workflows.",
      "AI Rewrite now provides multi-change previews, editable generated content, regenerate support, confirm-to-replace behavior, View Change highlighting, Ignore, and Restore Original.",
      "Thinking and model compatibility were improved across OpenAI-compatible endpoints, Responses API, Qwen3 thinking models, custom model diagnostics, Chinese endpoint hints, and model list handling.",
      "Memory and chapter workflows were strengthened with re-extract memory actions, persistent progress after page switching, Memory Center edit/delete controls, and clearer memory-risk warnings.",
      "Interface improvements include AI Chat / AI Outline bottom-right docking, fixed double-scrollbar issues, responsive chapter toolbar actions, clearer thinking panels, and localized review/model-setting text.",
      "Feedback submission now includes a fallback path for networks where the desktop HTTP client fails.",
    ],
    zh: [
      "2.0.0 是一次大的能力升级，QMAI 从基础 AI 写作助手升级为分阶段小说创作工作流。",
      "AI 会话新增深度章节生成流程，覆盖上下文分析、任务书、正文草稿、AI 审查、修订与去 AI 润色。",
      "AI 大纲升级为分阶段思考生成，并支持实时进度、任务书、草稿、自检与更干净的保存。",
      "审查中心围绕多阶段深度审查重建，并加入多种独立的专业审查工作流。",
      "AI Rewrite 提供多处改动预览、可编辑生成内容、重新生成、确认替换、查看变化与恢复原文。",
      "加强 thinking 与模型兼容能力，覆盖 OpenAI 兼容接口、Responses API、Qwen3 thinking 等模型。",
      "强化记忆与章节流程，支持重新提取记忆、跨页面保留进度、记忆中心编辑删除与更清晰的风险提示。",
      "界面体验同步优化，包括 AI 会话和 AI 大纲停靠、滚动条问题、章节工具栏与中文化提示。",
      "反馈提交流程增加兜底通道，桌面端 HTTP 客户端异常时仍可尝试提交。",
    ],
  },
}

function isMergedOnePointRelease(version: string): boolean {
  const match = /^1\.0\.(\d+)$/.exec(version)
  if (!match) return false
  const patch = Number(match[1])
  return patch >= 8 && patch <= 32
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.0.7",
    date: "2026-06-02",
    highlights: {
      en: [
        "Improved local LLM model handling and startup stability for daily writing sessions.",
        "Refined chapter, memory, and review interactions for a more consistent writing workflow.",
      ],
      zh: [
        "优化本地 LLM 模型处理与启动稳定性，提升日常写作可用性。",
        "继续打磨章节、记忆和审查之间的协同流程。",
      ],
    },
  },
  {
    version: "1.0.0",
    date: "2026-06-01",
    highlights: {
      en: [
        "Fixed stale-memory usage after outline, graph, or snapshot updates.",
        "Snapshot sync now records revision metadata and separates current memory from history.",
      ],
      zh: [
        "修复大纲、图谱或快照更新后仍可能误用旧记忆的问题。",
        "快照同步开始记录修订元数据，并更清楚地区分当前记忆与历史。",
      ],
    },
  },
  {
    version: "0.4.20",
    date: "2026-06-01",
    highlights: {
      en: [
        "AI Chat removed the old final-save/discard draft buttons and kept saving to the chapter library as the draft path.",
        "AI Outline generation added copy and regenerate actions with clearer source references.",
      ],
      zh: [
        "AI 会话移除旧的最终保存与丢弃草稿按钮，保留保存到章节库作为草稿路径。",
        "AI 大纲生成新增复制与重新生成动作，并更清楚地显示引用来源。",
      ],
    },
  },
  {
    version: "0.4.10",
    date: "2026-05-20",
    highlights: {
      en: [
        "Refocused the app as a novel-writing assistant around chapters, outlines, character state, foreshadowing, timelines, and graph views.",
        "Strengthened long-form writing support such as context continuity, chapter memory, and review checks to reduce forgotten details and setting conflicts.",
      ],
      zh: [
        "将产品重新聚焦为小说写作助手，围绕章节、大纲、角色状态、伏笔、时间线和图谱展开。",
        "加强长篇写作支持，提升上下文连续性、章节记忆和审查能力，减少遗忘与设定冲突。",
      ],
    },
  },
]

export function currentVersionChangelog(version: string): ChangelogEntry[] {
  if (version === TWO_POINT_TWO_ELEVEN_CHANGELOG.version) return [TWO_POINT_TWO_ELEVEN_CHANGELOG]
  if (version === TWO_POINT_TWO_TEN_CHANGELOG.version) return [TWO_POINT_TWO_TEN_CHANGELOG]
  if (version === TWO_POINT_TWO_NINE_CHANGELOG.version) return [TWO_POINT_TWO_NINE_CHANGELOG]
  if (version === TWO_POINT_TWO_EIGHT_CHANGELOG.version) return [TWO_POINT_TWO_EIGHT_CHANGELOG]
  if (version === TWO_POINT_TWO_SEVEN_CHANGELOG.version) return [TWO_POINT_TWO_SEVEN_CHANGELOG]
  if (version === TWO_POINT_TWO_ZERO_CHANGELOG.version) return [TWO_POINT_TWO_ZERO_CHANGELOG]
  if (version === TWO_POINT_ONE_ZERO_CHANGELOG.version) return [TWO_POINT_ONE_ZERO_CHANGELOG]
  if (version === TWO_POINT_ZERO_CHANGELOG.version) return [TWO_POINT_ZERO_CHANGELOG]
  if (/^2\.2\.(?:[1-6]|11|12|13)$/.test(version)) return []
  if (/^2\.1\.(?:[1-9]|10)$/.test(version)) return []
  if (/^2\.0\.(?:[1-9]|1[0-2])$/.test(version)) return []
  if (isMergedOnePointRelease(version)) return []
  return CHANGELOG.filter((entry) => entry.version === version)
}

export function allChangelog(): ChangelogEntry[] {
  return [
    TWO_POINT_TWO_ELEVEN_CHANGELOG,
    TWO_POINT_TWO_TEN_CHANGELOG,
    TWO_POINT_TWO_NINE_CHANGELOG,
    TWO_POINT_TWO_EIGHT_CHANGELOG,
    TWO_POINT_TWO_SEVEN_CHANGELOG,
    TWO_POINT_TWO_ZERO_CHANGELOG,
    TWO_POINT_ONE_ZERO_CHANGELOG,
    TWO_POINT_ZERO_CHANGELOG,
    ...CHANGELOG.filter((entry) => !isMergedOnePointRelease(entry.version)),
  ]
}
