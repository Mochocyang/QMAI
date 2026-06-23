export interface ChangelogEntry {
  version: string
  date: string
  highlights: {
    en: string[]
    zh: string[]
  }
}

const TWO_POINT_TWO_TWENTY_TWO_CHANGELOG: ChangelogEntry = {
  version: "2.2.22",
  date: "2026-06-23",
  highlights: {
    en: [
      "In Settings > LLM Models, fetching models and selecting multiple models now tests all selected models sequentially when clicking Test Model.",
      "Model testing shows live progress: Testing model (1/N): model-name.",
      "When all selected models pass, a success summary is shown.",
      "When some models fail, failed models are listed with errors and highlighted in red.",
      "If no models are selected, Test Model falls back to testing the current model input.",
      "Custom model card model input is now tag-based: each selected model appears as a removable chip.",
      "Fetched model tags sync into the custom model card input automatically.",
      "The model input supports typing and pressing Enter or clicking Add; multiple models can be added at once with comma separation.",
      "Selected models in the custom model card are persisted and no longer cleared when fetching models again.",
      "Failed model tags are shown in red with a red border for easy removal.",
      "Added a Retry Failed Models button to re-test only the failed models.",
    ],
    zh: [
      "在「设置 - LLM 模型」页面中，拉取模型列表并勾选多个模型后，点击「测试模型」按钮将依次测试所有已选模型。",
      "测试过程中显示实时进度：正在测试模型 (1/N): model-name。",
      "全部模型测试成功后提示「N 个模型全部测试成功」。",
      "部分模型失败时提示「success/total 个模型测试成功，失败：model: error」，失败模型以红色标签展示。",
      "未选择任何模型时保持原有行为，仅测试输入框中的当前模型。",
      "自定义模型卡片「模型」输入框改为标签式输入：每个已选模型是一个带「×」的小标签，点击即可移除。",
      "拉取模型后选中模型标签，模型名称会自动同步到「模型」输入框中并显示为标签。",
      "输入框内可直接输入模型名称，按回车或点击「添加」进入已选列表；多个模型可用逗号分隔批量添加。",
      "已选模型不再以文本形式回填输入框，输入框保持空白供用户输入新模型。",
      "已选模型列表不再因重新拉取模型而被清空，仅用户手动清空时才会清除。",
      "自定义模型卡片的「测试模型」按钮改为测试已选模型列表；无已选模型时仍测试输入框内容。",
      "批量测试部分失败时，失败模型以红色标签展示，并新增「重试失败模型」按钮，仅对失败模型重新测试。",
      "自定义模型卡片输入框内的失败模型标签会高亮变红并带红框，用户可直接点击「×」移除；移除后该模型会从失败列表中清除。",
    ],
  },
}

const TWO_POINT_TWO_TWENTY_CHANGELOG: ChangelogEntry = {
  version: "2.2.20",
  date: "2026-06-23",
  highlights: {
    en: [
      "Added book-style extraction in the Dismantling Library: one-click analysis of novel writing style with 9-dimension metrics, style constitution, and original text samples.",
      "Added default model setting in LLM configuration for background AI tasks (memory extraction, character recognition, etc.).",
      "Added batch select/clear buttons for custom model list management.",
      "Added quick help links to core features (chapters, outlines, graph, memory, soul, settings).",
      "Optimized character recognition to use LLM-only extraction, eliminating invalid regex-generated candidate names.",
      "Unified AI operation model invocation: user-triggered AI actions now follow default/chat model settings.",
      "Refactored outline toolbar into a shared component, fixing disappearing toolbar entries after tab switches.",
      "Optimized token consumption across AI chat and review center workflows.",
      "Improved Chinese diagnostics for reasoning-only responses and input-length limit errors.",
      "Fixed custom model input field being read-only; now editable with add button and working test connectivity.",
      "Fixed recent chapter body reading: now reads N chapters of body text instead of only summaries.",
      "Fixed long chapter generation exceeding model input limits with automatic context trimming and retry.",
      "Fixed review stage character recognition: re-matches character auras from draft text before review.",
      "Fixed wiki relative-path image preview not displaying on first load.",
      "Enhanced character consistency checking in deep chapter generation with memory library validation.",
      "Improved Windows updater: waits for old executable release before copying new version.",
    ],
    zh: [
      "新增拆书库作品文风提取功能，支持一键提取小说写作风格，输出9维文风指标和风格宪法。",
      "新增默认模型设置项，用于AI会话提取记忆、提取角色等后台自动任务。",
      "自定义模型拉取区域新增「全选」「清空」按钮，支持批量管理。",
      "为核心功能新增使用说明快捷入口，可快速查看操作指引。",
      "角色识别改为仅通过LLM提取真实人名，大幅提升识别准确率。",
      "用户主动触发的AI操作统一跟随默认模型/AI会话当前模型调用。",
      "大纲工具栏重构为共享组件，修复切页后入口消失的问题。",
      "全链路Token消耗优化，降低模型调用成本。",
      "优化reasoning-only回复和输入长度超限错误的中文提示文案。",
      "修复自定义模型输入框只读问题，改为可编辑并新增添加按钮。",
      "修复最近章节正文读取不完整，改为读取正文片段并结合摘要。",
      "修复长章节生成上下文超限问题，发送前按模型预算自动裁剪。",
      "修复审查阶段无法识别初稿中新出现角色的问题。",
      "修复项目Wiki内相对路径图片首次预览可能不显示的问题。",
      "增强深度章节生成的角色一致性校验能力，严控人设崩塌。",
      "优化Windows更新安装流程，减少文件占用导致的更新失败。",
    ],
  },
}

const TWO_POINT_TWO_NINETEEN_CHANGELOG: ChangelogEntry = {
  version: "2.2.19",
  date: "2026-06-20",
  highlights: {
    en: [
      "Fixed the Dismantling Library character picker not appearing after chapter analysis when some models return Chinese field names.",
      "Character recognition now accepts Chinese keys such as 角色名, 重要度, 类别, 章节索引, and 别名 while keeping the existing English JSON format.",
      "Added regression coverage for Chinese-key character recognition responses.",
    ],
    zh: [
      "修复拆书库选择分析章节后，部分模型返回中文字段名导致角色列表为空、角色人物选择弹窗不弹出的问题。",
      "角色识别结果现在兼容“角色名、重要度、类别、章节索引、别名”等中文字段，并保留原有英文 JSON 字段兼容。",
      "新增角色识别回归测试，覆盖中文字段返回格式，防止同类问题再次出现。",
    ],
  },
}

const TWO_POINT_TWO_EIGHTEEN_CHANGELOG: ChangelogEntry = {
  version: "2.2.18",
  date: "2026-06-19",
  highlights: {
    en: [
      "Added global font-size control (Settings > Interface, 85%-130% slider).",
      "Added seamless auto-refresh after AI generation or file save.",
      "Added data management: export/import to fully restore all content including AI conversations, outlines, models, and memory before OS reinstall.",
      "Optimized and fixed various minor issues.",
    ],
    zh: [
      "新增全局界面字号调节（设置 → 界面，支持 85%-130%）",
      "新增 AI 生成/保存文件后的无感自动刷新",
      "新增数据管理功能，如果要装系统可以使用导出数据功能，之后再使用导入数据功能，可完美恢复所有内容，包括AI会话，AI大纲，模型,记忆等",
      "优化修复一些其他小问题",
    ],
  },
}

const TWO_POINT_TWO_SEVENTEEN_CHANGELOG: ChangelogEntry = {
  version: "2.2.17",
  date: "2026-06-18",
  highlights: {
    en: [
      "Added full data export and import: back up model configs, AI conversations, novel content, outlines, memory libraries, and knowledge graphs before reinstalling the OS.",
      "Added global font-size control in Settings > Interface, with a slider from 85% to 130% and quick preset buttons.",
      "Added automatic UI refresh after generation so new chapters and outlines appear immediately without manual reopening.",
      "Improved multi-model selection so AI Chat and novel task models can use any saved custom model independently.",
      "Fixed various issues reported in the Dismantling Library beta and model configuration flows.",
    ],
    zh: [
      "新增数据导出导入功能：可在重装系统前备份模型配置、AI 会话、小说内容、大纲、记忆库和知识图谱，并在导入后恢复完整状态。",
      "新增全局字号调节：在设置-界面中可通过滑块将界面缩放至 85%-130%，并提供快捷档位按钮。",
      "新增生成结束自动刷新：章节或大纲生成完成后自动刷新项目状态，无需手动重新打开。",
      "优化多模型选择：AI 会话与小说写作任务可独立选择任意已保存的自定义模型。",
      "修复拆书测试版与模型配置流程中反馈的若干问题。",
    ],
  },
}

const TWO_POINT_TWO_SIXTEEN_CHANGELOG: ChangelogEntry = {
  version: "2.2.16",
  date: "2026-06-18",
  highlights: {
    en: [
      "Added support for multiple custom LLM models and fixed related model configuration issues.",
      "Added the Dismantling Library beta feature: import TXT novels to extract characters and add them to custom souls.",
      "Fixed AI Chat sometimes deviating from the outline; it now always reads the full outline content before generating.",
      "Fixed various other issues.",
    ],
    zh: [
      "LLM 模型增加多个自定义模型添加，修复模型等其他内容。",
      "增加拆书测试版功能，导入 txt 小说文档可以提取小说角色加入到自定义灵魂当中。",
      "AI 会话有时会脱离大纲，已修复当前问题，每次都会强制读取大纲内容。",
      "修复一些其他问题。",
    ],
  },
}

const TWO_POINT_TWO_FOURTEEN_CHANGELOG: ChangelogEntry = {
  version: "2.2.14",
  date: "2026-06-13",
  highlights: {
    en: [
      "Fixed Issue #10: AI-modified chapters no longer fail with 'missing frontmatter, write-back stopped' error; now automatically inherits original frontmatter and tolerates code fences and missing titles.",
      "Fixed Issue #9: 'Continue Next Chapter' no longer regenerates Chapter 1; prompt mentions of 'opening/first chapter' no longer hijack target chapter to 1; session remembers just-generated unsaved chapter numbers.",
      "Fixed Issue #6: Outline refinement logic unified to check directory for .md files; updated hasOutlineForRefinement from search-based to direct filesystem check.",
      "Fixed Issue #8: Added per-chapter word-count target control in settings; chapter generation, expansion threshold, and 'Continue Next Chapter' prompts now follow configured target.",
      "Enhanced de-AI rules with Chinese novel adaptation notes: preserve character voice, dialogue edges, narrative rhythm, and necessary pauses; don't apply non-fiction article rules to delete adverbs or compress to fixed word count.",
    ],
    zh: [
      "修复 Issue #10：AI 修改章节时不再报错\"返回内容缺少 frontmatter，已停止写回\"，现在自动沿用原章节 frontmatter，并容错代码围栏与缺失标题。",
      "修复 Issue #9：\"继续生成下一章\"不再重复生成第一章；提示词中顺带出现的\"开篇/第一章\"字样不再把目标章节劫持为第1章；本会话记住刚生成、尚未保存的章节号。",
      "修复 Issue #6：大纲细化生成逻辑统一按目录是否已有 .md 文件判断；hasOutlineForRefinement 从基于搜索改为直接文件系统检查。",
      "修复 Issue #8：新增\"单章目标字数\"设置，章节生成、扩写阈值和\"继续生成下一章\"提示词都按设置目标执行。",
      "增强去AI味规则的中文小说适配说明：保留角色声线、对白毛边、叙事节奏和必要停顿；不要按非虚构文章规则硬删副词或压缩到固定字数。",
    ],
  },
}

const TWO_POINT_TWO_THIRTEEN_CHANGELOG: ChangelogEntry = {
  version: "2.2.13",
  date: "2026-06-11",
  highlights: {
    en: [
      "Added De-AI Skill customization system in Soul to Project Soul with editable rules, reset button, and global application.",
      "Upgraded de-AI rules by integrating Stop Slop, AI Flavor Remover, and Writing Humanizer best practices with 50+ banned words, 5 core methods, and 10-item checklist.",
      "Added Stage 0: Previous Context Analysis that reads full text of previous 3 chapters and performs deep AI analysis before deep-thinking generation.",
      "Added Alibaba Cloud DashScope vector model support (tongyi-embedding-vision-plus/flash-2026-03-06).",
      "Fixed outline refinement showing no available outline despite outline files being listed.",
      "Fixed chapter list sorting (now correctly displays Chapter 1, 2, ..., 10, 20).",
      "Fixed Stage 4: AI Review timeout issues by extending timeout from 2 to 5 minutes, adding auto-retry (max 2 times), and enabling streaming output.",
      "Fixed Cannot read properties of undefined error in review stage with exception protection.",
      "Fixed new/switched AI chat displaying previous chat thinking content by clearing streaming state on each switch.",
      "Optimized context memory: previous chapter ending now extracts body content correctly (removes frontmatter) and increases from 10 to 30 lines (max 1200 chars); recent chapter summaries increased from 500 to 800 chars.",
      "Renamed Deep Chapter Generation to Deep Thinking and Edit Mode to Normal Mode and Edit Chapter for clearer functionality.",
      "Deep Thinking and Normal Mode now mutually exclusive; Normal Mode allows regular chat without deep-thinking flow.",
    ],
    zh: [
      "新增去AI味Skill自定义系统，在灵魂到项目灵魂中可编辑规则、重置为默认、全局应用到所有去AI味功能。",
      "升级去AI味规则，整合Stop Slop、AI Flavor Remover、Writing Humanizer最佳实践，新增50+个禁用词汇、5大核心方法、10项检查清单。",
      "新增阶段0前情分析，深度思考生成章节前强制读取前3章完整正文并进行AI深度分析。",
      "新增阿里百炼DashScope向量模型支持（tongyi-embedding-vision-plus/flash-2026-03-06）。",
      "修复大纲细化生成提示当前项目还没有可用大纲，但界面却显示大纲文件列表的矛盾问题。",
      "修复大纲列表章节排序问题，现在按数字顺序正确排列（第1章到第2章到第10章到第20章）。",
      "修复AI会话深度思考阶段4AI审稿容易中断或长时间卡住的问题，超时从2分钟延长到5分钟，新增自动重试（最多2次），实时流式输出。",
      "修复审稿失败时可能出现的Cannot read properties of undefined报错，增加异常保护。",
      "修复新建或切换AI会话时，新会话会显示上一个会话思考内容的问题，现在每次切换都会清空流式输出状态。",
      "优化上下文记忆：上一章结尾正确提取正文内容（去除frontmatter）并从10行增加到30行（最多1200字符）；近期章节摘要从500字符增加到800字符。",
      "功能命名优化：深度章节生成改名为深度思考，修改模式改名为普通模式和编辑章节，功能更清晰。",
      "深度思考和普通模式互斥切换，普通模式下可以正常对话不走深度思考流程。",
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
  if (version === TWO_POINT_TWO_TWENTY_TWO_CHANGELOG.version) return [TWO_POINT_TWO_TWENTY_TWO_CHANGELOG]
  if (version === TWO_POINT_TWO_TWENTY_CHANGELOG.version) return [TWO_POINT_TWO_TWENTY_CHANGELOG]
  if (version === TWO_POINT_TWO_NINETEEN_CHANGELOG.version) return [TWO_POINT_TWO_NINETEEN_CHANGELOG]
  if (version === TWO_POINT_TWO_EIGHTEEN_CHANGELOG.version) return [TWO_POINT_TWO_EIGHTEEN_CHANGELOG]
  if (version === TWO_POINT_TWO_SEVENTEEN_CHANGELOG.version) return [TWO_POINT_TWO_SEVENTEEN_CHANGELOG]
  if (version === TWO_POINT_TWO_SIXTEEN_CHANGELOG.version) return [TWO_POINT_TWO_SIXTEEN_CHANGELOG]
  if (version === TWO_POINT_TWO_FOURTEEN_CHANGELOG.version) return [TWO_POINT_TWO_FOURTEEN_CHANGELOG]
  if (version === TWO_POINT_TWO_THIRTEEN_CHANGELOG.version) return [TWO_POINT_TWO_THIRTEEN_CHANGELOG]
  if (version === TWO_POINT_TWO_TWELVE_CHANGELOG.version) return [TWO_POINT_TWO_TWELVE_CHANGELOG]
  if (version === TWO_POINT_TWO_ELEVEN_CHANGELOG.version) return [TWO_POINT_TWO_ELEVEN_CHANGELOG]
  if (version === TWO_POINT_TWO_TEN_CHANGELOG.version) return [TWO_POINT_TWO_TEN_CHANGELOG]
  if (version === TWO_POINT_TWO_NINE_CHANGELOG.version) return [TWO_POINT_TWO_NINE_CHANGELOG]
  if (version === TWO_POINT_TWO_EIGHT_CHANGELOG.version) return [TWO_POINT_TWO_EIGHT_CHANGELOG]
  if (version === TWO_POINT_TWO_SEVEN_CHANGELOG.version) return [TWO_POINT_TWO_SEVEN_CHANGELOG]
  if (version === TWO_POINT_TWO_ZERO_CHANGELOG.version) return [TWO_POINT_TWO_ZERO_CHANGELOG]
  if (version === TWO_POINT_ONE_ZERO_CHANGELOG.version) return [TWO_POINT_ONE_ZERO_CHANGELOG]
  if (version === TWO_POINT_ZERO_CHANGELOG.version) return [TWO_POINT_ZERO_CHANGELOG]
  if (/^2\.2\.[1-6]$/.test(version)) return []
  if (/^2\.1\.(?:[1-9]|10)$/.test(version)) return []
  if (/^2\.0\.(?:[1-9]|1[0-2])$/.test(version)) return []
  if (isMergedOnePointRelease(version)) return []
  return CHANGELOG.filter((entry) => entry.version === version)
}

export function allChangelog(): ChangelogEntry[] {
  return [
    TWO_POINT_TWO_TWENTY_TWO_CHANGELOG,
    TWO_POINT_TWO_TWENTY_CHANGELOG,
    TWO_POINT_TWO_NINETEEN_CHANGELOG,
    TWO_POINT_TWO_EIGHTEEN_CHANGELOG,
    TWO_POINT_TWO_SEVENTEEN_CHANGELOG,
    TWO_POINT_TWO_SIXTEEN_CHANGELOG,
    TWO_POINT_TWO_FOURTEEN_CHANGELOG,
    TWO_POINT_TWO_THIRTEEN_CHANGELOG,
    TWO_POINT_TWO_TWELVE_CHANGELOG,
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
