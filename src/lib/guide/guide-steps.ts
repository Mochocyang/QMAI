import type { GuideChapter, GuideDefinition, GuideStep } from "./guide-types"

/**
 * 新手引导的完整步骤链。
 *
 * 内容口径（改文案前先看这里）：
 *   · 只写**当前界面上真实存在**的按钮名与位置。按钮改了名，这里必须同步改，
 *     否则用户照着引导找不到东西 —— `guide-steps.spec.ts` 会把每一步的锚点
 *     与渲染端声明的锚点清单对齐，但「文案写的是不是那个按钮」只能人工核对。
 *   · 每个阶段的第一步带 `chapterBreak`，用户可以在阶段边界整段跳过。
 *   · 需要用户亲手点一次的步骤用 `requireClick`：遮罩会在靶点留洞，
 *     只按「下一步」不会前进 —— 否则用户看完十几步还是不会点。
 */

const startChapter: GuideChapter = {
  id: "start",
  title: "从书架进入设置",
  summary: "先认识软件的两层结构：书架放书，设置放模型。",
}

const modelsChapter: GuideChapter = {
  id: "models",
  title: "配置大语言模型",
  summary: "以 DeepSeek 为例，走完「选模型 → 填密钥 → 拉取 → 测试 → 保存」。",
}

const extrasChapter: GuideChapter = {
  id: "extras",
  title: "其他模型与默认模型",
  summary: "重排、向量、默认模型分别管什么，哪个模型用在哪里。",
}

const createChapter: GuideChapter = {
  id: "create",
  title: "新建一本小说",
  summary: "用一份示例书名与目录，创建一本可以随手试的书。",
}

const outlineChapter: GuideChapter = {
  id: "outline",
  title: "生成并保存大纲",
  summary: "提交需求、拿到大纲、保存落地，再认识四种大纲模式。",
}

const chapterChapter: GuideChapter = {
  id: "chapter",
  title: "进入章节写作",
  summary: "章节模式、标题栏五枚功能、计划与文风、示例正文。",
}

const featuresChapter: GuideChapter = {
  id: "features",
  title: "四个核心能力",
  summary: "记忆、灵魂、技能库、拆书库，决定长期写下去的质量。",
}

export const GUIDE_CHAPTERS: GuideChapter[] = [
  startChapter,
  modelsChapter,
  extrasChapter,
  createChapter,
  outlineChapter,
  chapterChapter,
  featuresChapter,
]

export const GUIDE_STEPS: GuideStep[] = [
  // ── 1. 从书架进入设置 ────────────────────────────────────────────────
  {
    id: "start-settings",
    chapter: "start",
    title: "欢迎使用青幕 AI 写作",
    body: [
      "这是你第一次打开，跟着走一遍，大约十分钟就能把「配模型 → 建书 → 出大纲 → 写第一章」全跑通。",
      "先找到顶栏右上角的 **设置**（齿轮图标）。模型、字号、备份这些长期设置，都在里面。",
    ],
    bullets: [
      { title: "书架", text: "顶栏最左边的「书架」，每本小说一个卡片，点开就进入写作界面。" },
      { title: "设置", text: "模型与全局偏好都在这里，配一次长期有效。" },
    ],
    anchor: "shell.settings",
    requireClick: true,
    chapterBreak: true,
    padding: 8,
  },

  // ── 2. 配置大语言模型 ────────────────────────────────────────────────
  {
    id: "models-tab-llm",
    chapter: "models",
    title: "先配模型，再谈写作",
    body: [
      "设置左侧选**模型**，右侧有四个页签：默认模型、大语言模型、重排模型、向量模型。",
      "先点**大语言模型** —— 负责写正文、出大纲、改稿子的都是这一类模型。",
    ],
    anchor: "settings.model-tab.llm",
    prepare: { settingsCategory: "model" },
    // 用户中途关掉设置时自愈：重新把设置打开，锚点才不会永远缺席。
    directive: "open-settings",
    requireClick: true,
    chapterBreak: true,
  },
  {
    id: "models-two-ways",
    chapter: "models",
    title: "两种添加方式",
    body: [
      "大语言模型有两种接法，**先用「添加提供方」**：内置了 DeepSeek、Kimi、智谱、OpenAI 等常见服务商，只需填密钥。",
      "另一种是**添加自定义模型**，适合中转站、公司内网、本地 Ollama 这类没有预设的服务。",
    ],
    bullets: [
      { title: "添加提供方（推荐）", text: "服务商地址与模型列表都已内置，少填错。" },
      { title: "添加自定义模型", text: "需要自己填接口地址、线路协议（OpenAI / Responses / Anthropic）与模型名。" },
    ],
    anchor: "model.add-provider",
    requireClick: true,
    padding: 10,
  },
  {
    id: "models-pick-deepseek",
    chapter: "models",
    title: "选择 DeepSeek",
    body: [
      "下方展开的是提供方列表。点 **DeepSeek** —— 它就是本示例要配置的模型。",
      "选中后会出现一张 DeepSeek 配置卡，接下来要填密钥。",
    ],
    anchor: "model.preset.deepseek",
    requireClick: true,
    padding: 10,
  },
  {
    id: "models-api-key",
    chapter: "models",
    title: "填写 API 密钥",
    body: [
      "在 DeepSeek 配置卡里找到 **API Key**，把密钥粘进去。",
      "还没有密钥的话：打开 [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys) 登录账号 → 点「创建 API key」→ 复制以 `sk-` 开头的那串字符 → 回到这里粘贴。",
      "密钥只存在你自己的电脑上，用于让软件代表你调用该服务商的接口。",
    ],
    bullets: [
      { title: "找不到密钥入口？", text: "登录后在控制台左侧找「API Keys / 密钥管理」，各家路径都差不多。" },
      { title: "用的不是 DeepSeek？", text: "下一步把二十多个内置提供方按「除了密钥还要不要填别的」分成三类，并列出常用几家的密钥入口。" },
    ],
    anchor: "model.api-key",
    padding: 10,
  },
  {
    id: "models-key-map",
    chapter: "models",
    title: "其他模型怎么接",
    body: [
      "内置提供方二十多个，按「除了密钥还要不要填别的」分三类。**绝大多数只要密钥**：接口地址、常用模型清单、上下文与输出上限都已预填，选中、填密钥、测试即可。",
      "密钥都在各家自己的控制台里，路径几乎一样：登录 → 左侧「API Keys / 密钥管理」→ 创建 → 复制。",
    ],
    bullets: [
      { title: "国内常用（只要密钥）", text: "DeepSeek（platform.deepseek.com/api_keys）、Kimi（platform.moonshot.cn/console/api-keys，另有国际版与 Coding Plan）、智谱 GLM（open.bigmodel.cn/usercenter/apikeys）、MiniMax、阿里百炼 Coding Plan（bailian.console.aliyun.com）、火山引擎 Ark（console.volcengine.com/ark）、小米 MiMo。" },
      { title: "海外常用（只要密钥）", text: "OpenAI（platform.openai.com/api-keys）、Anthropic（console.anthropic.com/settings/keys）、Google Gemini（aistudio.google.com/apikey）、xAI（console.x.ai）、Groq（console.groq.com/keys）、Atlas Cloud、NVIDIA NIM（build.nvidia.com）、Ollama Cloud。" },
      { title: "还要多填一两项", text: "Azure OpenAI 要填**资源端点**与**部署名**；Ollama 本地要填本机地址（默认 `http://localhost:11434`，不需要密钥）；自定义模型要填**接口地址 + 线路协议**。" },
      { title: "完全不要密钥", text: "Claude Code CLI、Codex CLI、Cursor CLI：复用你本机已经登录的命令行，装好就能选，按订阅额度走。" },
    ],
    placement: "center",
  },
  {
    id: "models-fetch",
    chapter: "models",
    title: "拉取模型列表",
    body: [
      "密钥填好后，点 **拉取模型**。软件会用这把密钥向服务商请求一次可用模型列表。",
      "拉取成功后，下方会出现模型清单；点一下模型名即可加入上方输入框，再点一次取消。",
    ],
    anchor: "model.fetch",
    padding: 8,
  },
  {
    id: "models-test",
    chapter: "models",
    title: "测试模型",
    body: [
      "选好模型，点 **测试模型**。这一步会真的发一次最小请求，验证密钥、地址、模型名三者都对。",
      "只有测试通过，才说明这个配置能用。测试不会自动保存，放心点。",
    ],
    anchor: "model.test",
    padding: 8,
  },
  {
    id: "models-context",
    chapter: "models",
    title: "上下文窗口",
    body: [
      "测试通过后，往下是 **上下文窗口**。它决定「这一次对话最多能塞多少字进去」——包括你 @ 的资料、前文、记忆和提示词。",
      "填小了：长章节会被截断，模型看不到前面的剧情。填大了：超出模型真实上限会直接报错，而且每一轮都更贵。",
    ],
    bullets: [
      { title: "怎么填", text: "按服务商文档里该模型的最大上下文填。不确定就用预设推荐值，软件已按常见模型预设好。" },
      { title: "写作时的实际表现", text: "上下文越宽，越能一次带进更多前文与设定，适合长篇；短篇或对话可以调小省钱。" },
    ],
    anchor: "model.context",
    padding: 10,
  },
  {
    id: "models-output",
    chapter: "models",
    title: "输出上限",
    body: [
      "**输出上限**是「模型一次最多能写多少 token」。它限制的是**单次回答的长度**，不是整本书。",
      "写一整章经常需要几千字，上限太低会出现「写到一半被截断」。注意它不能超过上下文窗口，软件会自动帮你夹在合理区间内。",
    ],
    bullets: [
      { title: "常见症状", text: "生成到一半停住、提示「达到最大输出 token」——先来这里调高。" },
      { title: "与推理模型的关系", text: "开启推理档位后，思考过程也算在输出里；软件会在你调档位时自动抬高上限，避免正文被思考挤掉。" },
    ],
    anchor: "model.output",
    padding: 10,
  },
  {
    id: "models-save",
    chapter: "models",
    title: "保存配置",
    body: [
      "最后点 **保存配置**。保存后这张卡片才会进入「我的模型配置」，写作时才能被选到。",
      "卡片右上角的开关是「启用」：关掉它，这个提供方在写作时不可选，但配置不会丢。",
    ],
    anchor: "model.save",
    padding: 8,
  },

  // ── 3. 其他模型与默认模型 ────────────────────────────────────────────
  {
    id: "models-custom",
    chapter: "models",
    title: "如果是自定义模型",
    body: [
      "内置提供方走完了，顺带说清另一种：**添加自定义模型**。它比内置提供方多填两样 —— **接口地址**与**线路协议**。",
      "接口地址填服务商文档里的完整 base URL（多数以 `/v1` 结尾，例如中转站给的 `https://xxx.com/v1`）。协议按对方的兼容方式选：OpenAI 兼容 / Responses / Anthropic Messages。",
      "填完之后的步骤完全一样：**拉取模型 → 测试模型 → 保存配置**。本地 Ollama 也走这条，地址通常是 `http://127.0.0.1:11434/v1`。",
    ],
    anchor: "model.add-custom",
    padding: 10,
  },
  {
    id: "extras-rerank",
    chapter: "extras",
    title: "重排模型做什么",
    body: [
      "写作时，软件会先从记忆库、大纲、旧章节里**粗筛**出一批可能相关的段落；**重排模型**再把这批段落按「和当前这一章的相关度」重新排序。",
      "它不写一个字，只决定「哪些资料该排在最前面被模型先看到」。长篇写到几十万字、记忆条目上千条时，差别很明显。",
    ],
    bullets: [
      { title: "可以留空", text: "不配也能写，只是资料筛选更依赖关键词与向量。" },
      { title: "配什么", text: "选服务商提供的 rerank 接口（如 bge-reranker、gte-rerank 一类）。" },
    ],
    anchor: "settings.model-tab.rerank",
    prepare: { settingsCategory: "model", modelTab: "rerank" },
    directive: "open-settings",
    chapterBreak: true,
    padding: 6,
  },
  {
    id: "extras-embedding",
    chapter: "extras",
    title: "向量模型做什么",
    body: [
      "**向量模型**把文字变成一串数字（向量），让软件能按「意思相近」而不是「字面相同」来检索。",
      "你说「主角那把断剑」，它能找到记忆里写成「残刃」的那一条。这是长期记忆与剧情搜索的底座。",
    ],
    bullets: [
      { title: "配一次就够", text: "建议开启并选一个便宜的小模型；同一本书不要中途换，换了要重建索引。" },
      { title: "和重排的分工", text: "向量负责「找得全」，重排负责「排得准」。" },
    ],
    anchor: "settings.model-tab.embedding",
    prepare: { settingsCategory: "model", modelTab: "embedding" },
    padding: 6,
  },
  {
    id: "extras-default",
    chapter: "extras",
    title: "默认模型",
    body: [
      "配好多个模型后，**默认模型**决定「没有特别指定时用哪一个」。",
      "大纲、章节、去 AI 味、记忆提取可以各自指定模型；没指定的地方，一律回落到默认模型。",
    ],
    bullets: [
      { title: "五种用途行", text: "**默认模型（通用）**管审稿、摘要、提取、去AI味以外的常规调用；另有**审稿模型**（连贯性、人物、文笔审查）、**摘要模型**（章节与上下文摘要）、**提取模型**（结构化记忆与初始记忆）、**去AI味模型**（文本自然化与候选生成）。" },
      { title: "留空就是跟随", text: "每种用途都可以留空：第一行留空表示「跟随聊天模型」，其余留空表示「跟随默认模型」。所以只配一个模型也能跑。" },
      { title: "建议", text: "默认与审稿选能力最强的；摘要、提取、去AI味调用频繁、单次短，可以单独指派便宜的小模型，明显省钱。" },
    ],
    anchor: "settings.model-tab.default",
    prepare: { settingsCategory: "model", modelTab: "default" },
    padding: 6,
  },
  {
    id: "extras-map",
    chapter: "extras",
    title: "每个模型分别用在哪",
    body: ["记住这张分工表，以后加模型就不会乱："],
    bullets: [
      { title: "大语言模型 · 正文与大纲", text: "生成大纲、写章节正文、去 AI 味、改稿、审查。最吃能力，也最吃额度。" },
      { title: "大语言模型 · 记忆提取", text: "每章写完把人物状态、伏笔、设定变更抽成条目。调用频繁、单次短，适合便宜模型。" },
      { title: "向量模型 · 检索", text: "把章节与记忆切成片转成向量，供语义检索。" },
      { title: "重排模型 · 精排", text: "对检索结果按当前章节的相关度重排。" },
      { title: "默认模型 · 兜底", text: "任何没有单独指派模型的功能，都用它。" },
    ],
    placement: "center",
  },

  // ── 4. 新建小说 ──────────────────────────────────────────────────────
  {
    id: "create-back-shelf",
    chapter: "create",
    title: "回到书架",
    body: [
      "模型配完了，回书架建一本新书。点顶栏最左边的 **书架**。",
      "后续想改设置时，随时从右上角齿轮再进来。",
    ],
    anchor: "shell.shelf",
    directive: "open-shelf",
    requireClick: true,
    chapterBreak: true,
    padding: 8,
  },
  {
    id: "create-open-dialog",
    chapter: "create",
    title: "新建小说",
    body: ["点 **新建小说**。一本小说就是一个独立文件夹，里面的正文、大纲、记忆都跟着它走。"],
    anchor: "shelf.create",
    requireClick: true,
    padding: 8,
  },
  {
    id: "create-name",
    chapter: "create",
    title: "书名已经替你填好",
    body: [
      "为了让你马上能试，引导会随机填一个示例书名。**你可以直接改成自己想写的名字**，也可以保留它先跑通流程。",
      "书名随时能改，不用在这里纠结。",
    ],
    anchor: "create.name",
    // 中途关掉弹窗时自愈（重复打开是幂等的，书名不会丢：输入框非空就不覆盖）。
    directive: "open-create-dialog",
    padding: 10,
  },
  {
    id: "create-location",
    chapter: "create",
    title: "存放位置",
    body: [
      "**存放位置**默认是本机的「小说」目录，并会在下面显示完整路径。想换地方点 **选择目录**。",
      "建议放在你日常会备份的盘里 —— 这本书的全部内容（正文、大纲、记忆、快照）都在这个文件夹内，复制文件夹就是完整备份。",
    ],
    anchor: "create.location",
    directive: "open-create-dialog",
    padding: 10,
  },
  {
    id: "create-submit",
    chapter: "create",
    title: "创建并写大纲",
    body: [
      "点 **创建并写大纲**。软件会建好目录结构，并直接把你带进这本书的**大纲**界面。",
      "如果只是想手动写、不打算用 AI，到这一步也够用了 —— 正文可以直接在编辑器里敲。",
    ],
    anchor: "create.submit",
    directive: "open-create-dialog",
    requireClick: true,
    padding: 8,
  },

  // ── 5. 大纲生成与默认内容 ────────────────────────────────────────────
  {
    id: "outline-generate",
    chapter: "outline",
    title: "生成小说大纲",
    body: [
      "现在在**大纲**界面。右侧是 AI 对话栏，中间空会话里只有这一个入口：**生成小说大纲**。",
      "点它，会打开需求向导。",
    ],
    anchor: "outline.generate",
    directive: "open-outline-view",
    requireClick: true,
    chapterBreak: true,
    padding: 8,
  },
  {
    id: "outline-wizard",
    chapter: "outline",
    title: "填写大纲需求",
    body: [
      "向导里可以选生成任务、篇幅、频道、题材，再写**故事灵感 / 处理要求** —— 这是最关键的一栏：主角是谁、他想要什么、阻力是什么。",
      "本次是示范：**已为你填好一段内置示例需求，不会调用模型、不消耗 Token**。直接往下走即可。",
    ],
    anchor: "outline.wizard.inspiration",
    padding: 10,
  },
  {
    id: "outline-submit",
    chapter: "outline",
    title: "提交需求",
    body: [
      "点 **提交需求**。正常情况下模型会开始生成；本次示范会立刻返回一份**内置示例大纲**，内容完整、可直接保存。",
      "这样即使你还没拿到 API 密钥，也能先把整条流程走一遍。",
    ],
    anchor: "outline.wizard.submit",
    requireClick: true,
    padding: 8,
  },
  {
    id: "outline-save",
    chapter: "outline",
    title: "保存这份大纲",
    body: [
      "示例大纲出现在对话里之后，点消息下方的 **保存为大纲**（软盘图标）。",
      "随后弹出确认框：可以勾掉不想写的文件、改文件名、换保存文件夹，也能取消 HTML 版本。",
      "在确认框里再点一次 **确认保存**，文件才真正落到这本书的 `wiki/outlines/`。**没点确认就什么都没写**，可以放心试。",
    ],
    /*
     * 弹窗开了以后，软盘按钮会被压在下面。此时继续按它的矩形挖洞，
     * 遮罩会正好把弹窗里的「确认保存」盖住（用户点不动）。所以给两个候选：
     * 优先高亮弹窗里的确认按钮，没有弹窗时再退回软盘。
     */
    anchors: ["outline.save.confirm", "outline.save"],
    // 确认按钮点下去就真的写盘了，不必再让用户回头找「下一步」。
    advanceOn: ["outline.save.confirm"],
    padding: 8,
  },
  {
    id: "outline-where",
    chapter: "outline",
    title: "保存后去哪里看",
    body: [
      "保存成功有三处可以找到它，都指向同一份文件：",
    ],
    bullets: [
      { title: "自动跳转", text: "保存完成后，中间预览区会自动打开刚写入的文档（默认显示 HTML 卡片版）。" },
      { title: "左侧目录", text: "目录栏 → 大纲 → 对应子文件夹，能找到 `.md` 与同名 `.html` 两份。" },
      { title: "文件本身", text: "在小说文件夹里：`wiki/outlines/`。复制或备份都以此为准。" },
    ],
    placement: "center",
  },
  {
    id: "outline-memory",
    chapter: "outline",
    title: "把大纲的设定变成记忆",
    body: [
      "大纲落地后，下一步是让它「被记住」：点大纲文档顶部的 **提取记忆**（大脑图标）。",
      "软件会把大纲里的人物、势力、设定与伏笔抽成结构化记忆。以后写章节时，这些记忆会自动进入上下文，不用你每次重复交代。",
      "旁边的 **查看记忆** 可以核对抽出来的条目；抽错了，改完大纲重新提取即可覆盖。",
    ],
    bullets: [
      { title: "这一步需要模型", text: "提取记忆会调用大语言模型。如果还没配好模型，可以先跳过，配置完成后再回来点。" },
    ],
    anchor: "outline.memory",
    padding: 8,
  },
  {
    id: "outline-modules",
    chapter: "outline",
    title: "还能单独生成哪些大纲内容",
    body: [
      "整个大纲体系不止「全书大纲」一种。输入框左边那枚**清单加号图标**（生成大纲模块）里，一次列全十种：卷纲、章节细纲、人物小传、组织势力设定、力量体系、金手指设定、背景设定、地理设定、伏笔计划、地点设定。",
      "用法都一样：点某个模块 → 需求已按该模块的规格带好 → 对 AI 说生成 → 结果回到对话里 → 保存。哪份不满意就单独重生成哪份，不用整本重来。",
    ],
    bullets: [
      { title: "先补哪三样", text: "**卷纲**定骨架、**人物小传**定人、**章节细纲**定每一章写什么。这三样齐了，正文质量的差别最大。" },
      { title: "人物小传为什么重要", text: "人物越完整（外貌、动机、说话方式、关系、当前状态），生成的对话与行为越像那个人；只有名字的角色，写出来容易千人一面。" },
    ],
    anchor: "outline.modules",
    padding: 8,
  },
  {
    id: "outline-modes",
    chapter: "outline",
    title: "四种大纲模式",
    body: [
      "大纲对话栏底部有模式选择，按**由省到细**的顺序理解它们：",
    ],
    bullets: [
      { title: "快速", text: "像普通聊天，直接给结果。不走向意图分析、多 Agent、强制需求分析。适合「先随便聊聊、要个大概」。" },
      { title: "标准", text: "完整工作流：先做意图分析或向导多 Agent，再产出可保存的大纲，保留澄清与分步生成。日常首选。" },
      { title: "计划", text: "先问后写：按大纲结构盘点要素，缺口用选项追问补齐，出计划等你确认后才开始写。适合自己也没想清楚的时候。" },
      { title: "共创", text: "把 AI 当责编来回讨论：每轮给判断、抛出分歧点和它的倾向，等你说定稿才输出正文。适合要磨故事核心。" },
    ],
    anchor: "outline.mode",
    padding: 10,
  },

  // ── 6. 章节阶段 ──────────────────────────────────────────────────────
  {
    id: "chapter-stage",
    chapter: "chapter",
    title: "从大纲进入章节",
    body: [
      "大纲交付后，点顶栏 **章节** 进入正文阶段。",
      "进正文前建议先补**人物信息**：人物小传越完整（外貌、动机、说话方式、关系、当前状态），生成的对话与行为就越像那个人。只有名字的角色，写出来容易千人一面。",
    ],
    bullets: [
      { title: "怎么补人物", text: "回**大纲**界面，点输入框左边的「生成大纲模块」→ **人物小传**，AI 会按角色逐个生成并保存；也可以直接对大纲对话说「生成人物小传」。" },
      { title: "其他设定同理", text: "组织势力、力量体系、金手指、背景、地理、地点、伏笔都走同一个菜单；也可以自己写进 `wiki/` 对应目录，软件照样读得到。" },
    ],
    anchor: "shell.nav.wiki",
    directive: "open-chapter-view",
    requireClick: true,
    chapterBreak: true,
    padding: 8,
  },
  {
    id: "chapter-modes",
    chapter: "chapter",
    title: "四种章节模式",
    body: ["章节的模式管的是「这一章怎么产出」，按质量与耗时递增："],
    bullets: [
      { title: "快速", text: "普通对话，可读上下文，但不自动启用 Skill、不走多任务写作循环、不分析剧情走向。适合试写一段。" },
      { title: "标准", text: "读上下文 → 出任务书 → 写正文初稿，直接完成，不做正文后审核。速度与质量的平衡点。" },
      { title: "严格", text: "读更完整的上下文，写完后审稿、返修、复审，按需局部重写并验收计划。正式章节用它。" },
      { title: "共创", text: "先读前文推演后续走向，给 3–4 个不同方向让你挑；选定后才生成正文。适合卡文。" },
    ],
    anchor: "chat.mode",
    padding: 10,
  },
  {
    id: "chapter-toolbar",
    chapter: "chapter",
    title: "章节标题栏的五枚按钮",
    body: [
      "为了对着讲，这一步先打开一章**内置示例正文**（不消耗 Token，写的是草稿章节）。",
      "标题栏右侧有一排图标，作用在**当前这一章**上，从左到右是：去 AI 味、提取记忆、查看记忆、字体设置、生成章节细纲。接下来逐个说明。",
    ],
    anchor: "chapter.toolbar",
    directive: "load-demo-chapter",
    padding: 8,
  },
  {
    id: "chapter-deai",
    chapter: "chapter",
    title: "去 AI 味",
    body: [
      "橡皮图标。它把当前章节交给「去 AI 味」Skill 重写，专治：句式过于整齐、形容词堆叠、每段都总结、对话像念稿。",
    ],
    bullets: [
      { title: "① 点橡皮图标", text: "弹出「去 AI 味」技能选择。" },
      { title: "② 选一个技能", text: "内置的，或你自己从拆书库里提炼的；选完开始处理。" },
      { title: "③ 看草稿再决定", text: "结果另存为**草稿预览**，不会直接覆盖原文；满意才替换，不满意直接关掉。" },
    ],
    anchor: "chapter.deai",
    padding: 10,
  },
  {
    id: "chapter-memory",
    chapter: "chapter",
    title: "提取记忆",
    body: [
      "大脑图标。它把这一章发生的事抽成结构化记忆：人物状态变化、关系变化、伏笔埋设与回收、设定新增、时间地点推进。",
      "**每写完一章就提取一次**，是长期写作不掉设定的关键。",
    ],
    bullets: [
      { title: "① 草稿章先转正", text: "草稿章点它会先弹「保存为正式章节」；已是正式章节时，这枚按钮显示为「重新提取记忆」。" },
      { title: "② 等它跑完", text: "提取会调用大语言模型；完成后左侧目录里这一章会带上记忆标记。" },
      { title: "③ 核对", text: "点旁边的「查看记忆」逐条检查；抽错了改完章节重新提取即可覆盖。" },
    ],
    anchor: "chapter.memory",
    padding: 10,
  },
  {
    id: "chapter-view-memory",
    chapter: "chapter",
    title: "查看记忆",
    body: [
      "书本图标。打开这一章提取出的记忆快照，逐条核对 AI 抽得对不对。",
      "还没提取过时会提示你先提取。发现抽错了，改完章节重新提取即可覆盖。",
    ],
    anchor: "chapter.view-memory",
    padding: 10,
  },
  {
    id: "chapter-font",
    chapter: "chapter",
    title: "字体设置",
    body: [
      "「T」图标。调整**正文**的字号、行高、字间距、页边距与底部安全区，只管阅读观感，不改文件内容。",
      "大纲与章节共用同一套排版参数，调一次两边都生效。",
    ],
    anchor: "chapter.font",
    padding: 10,
  },
  {
    id: "chapter-event-outline",
    chapter: "chapter",
    title: "生成章节细纲",
    body: [
      "清单图标。在写正文前，先把「这一章要发生哪几件事、按什么顺序」列成细纲，再照着写，能显著减少跑偏。",
    ],
    bullets: [
      { title: "① 点清单图标", text: "打开章节细纲向导。" },
      { title: "② 确认章号与目标字数", text: "默认取当前这一章，按需改。" },
      { title: "③ 提交并保存", text: "结果回到 AI 对话里，满意就保存成细纲文件。" },
    ],
    anchor: "chapter.event-outline",
    padding: 10,
  },
  {
    id: "chapter-plan",
    chapter: "chapter",
    title: "计划模式",
    body: [
      "输入框上方的清单按钮。开启后，这一次写作会**先出计划、等你看过并确认，再动笔**。",
      "适合长章、多线并进、或者你只想先看结构不想它直接写完。可与标准、严格模式组合；快速与共创模式下不支持。",
    ],
    anchor: "chapter.plan",
    padding: 10,
  },
  {
    id: "chapter-style",
    chapter: "chapter",
    title: "文风模式",
    body: [
      "笔形按钮。选一条**文风预设**（可以是你自己从拆书库里提炼的，也可以是内置的），这一轮就按那个文风写。",
      "浮层里还能选「本次不用文风」。文风只影响这一次生成，不会永久改掉项目设定。",
    ],
    anchor: "chapter.style",
    padding: 10,
  },
  {
    id: "chapter-reference",
    chapter: "chapter",
    title: "章节引用（@）",
    body: [
      "输入框里打 **@**，可以点名引用：某一章、某份大纲、某条记忆、某个角色灵魂、某条文风。",
      "被引用的内容会优先、完整地进入这一轮的上下文 —— 比让模型自己去找更准。写「接着第 12 章」时尤其有用。",
    ],
    anchor: "chat.reference",
    padding: 10,
  },
  {
    id: "chapter-demo",
    chapter: "chapter",
    title: "用示例正文试一次",
    body: [
      "这一章**内置示例正文**就是刚才打开的那份（同样不消耗 Token，写的是草稿章节），可以放心改、放心试。",
      "编辑器会**自动保存**，标题区能看到保存状态；想带走就点进正文全选（⌘/Ctrl + A）再复制（⌘/Ctrl + C）。",
    ],
    bullets: [
      { title: "想换成自己的开头", text: "直接在编辑器里改。这份草稿是给你练手的，不是模板。" },
      { title: "想试提取记忆", text: "就在这一章点「提取记忆」，它会先问你要不要把草稿保存为正式章节。" },
    ],
    anchor: "chapter.toolbar",
    directive: "load-demo-chapter",
    padding: 8,
  },

  // ── 7. 核心功能 ──────────────────────────────────────────────────────
  {
    id: "feature-memory",
    chapter: "features",
    title: "记忆中心",
    body: [
      "「记忆中心」汇总全书提取出的记忆：人物状态、关系、伏笔台账、设定变更、时间线。",
      "写作时软件会按当前章节自动检索相关记忆塞进上下文；你也可以在这里手动核对、修正、清理。",
    ],
    bullets: [
      { title: "在哪打开", text: "顶栏「创作工具」菜单 → 记忆中心。" },
      { title: "配套工具", text: "同一菜单里还有「审查中心」（一致性检查）与「剧情搜索」（按语义找段落）。" },
    ],
    chapterBreak: true,
    placement: "center",
  },
  {
    id: "feature-soul",
    chapter: "features",
    title: "灵魂",
    body: [
      "「灵魂」分两层：**项目灵魂**是这本书的整体气质与叙事偏好；**角色灵魂**是每个角色的说话方式、行为逻辑、底线。",
      "绑定后，写这个角色的对话时会自动带上他的「味儿」，避免所有角色说话都像同一个人。",
    ],
    anchor: "shell.tool.soul",
    padding: 8,
  },
  {
    id: "feature-skill",
    chapter: "features",
    title: "技能库",
    body: [
      "「技能库」管理三类可复用的写作能力：**去 AI 味技能**、**写作 Skill**、**文风**。",
      "可以从拆书库里提炼，也可以自己写；生成时按需选用，或在输入框 @ 引用。",
    ],
    anchor: "shell.tool.skillLibrary",
    padding: 8,
  },
  {
    id: "feature-book-analysis",
    chapter: "features",
    title: "拆书库",
    body: [
      "「拆书库」导入你喜欢的作品，分析它的结构、节奏、人物与文风，产出可复用的写作 DNA、故事导图和文风预设。",
      "这是把「我喜欢这本」变成「我能写出这种感觉」的地方。入口在顶栏「创作工具」菜单。",
    ],
    placement: "center",
  },
  {
    id: "feature-done",
    chapter: "features",
    title: "引导结束",
    body: [
      "到这里，配模型、建书、出大纲、写章节、提取记忆这条路你已经亲手走过一遍了。",
      "以后忘了某一步，回 **设置 → 新手引导**，可以随时重播整段或只重播某一节；那里也能彻底关闭引导。",
    ],
    bullets: [
      { title: "想再练一次", text: "设置 → 新手引导 → 重新开始。" },
      { title: "只想看某一节", text: "同一页里按阶段单独重播，例如只看「大纲模式」。" },
    ],
    placement: "center",
  },
]

export const GUIDE_DEFINITION: GuideDefinition = {
  chapters: GUIDE_CHAPTERS,
  steps: GUIDE_STEPS,
}

/**
 * 全部锚点。
 *
 * `guide-steps.spec.ts` 用它和「各组件里真实声明的 `data-guide`」做双向比对：
 *   · 步骤里写了锚点、代码里没有 → 那一步会永远显示「正在等待界面」；
 *   · 代码里有锚点、步骤里没人用 → 说明改名后漏改了步骤数据。
 * 新增锚点时**两边都要加**。
 */
export const GUIDE_ANCHORS = [
  "shell.settings",
  "shell.shelf",
  "shell.nav.wiki",
  "shell.tool.soul",
  "shell.tool.skillLibrary",
  "settings.model-tab.llm",
  "settings.model-tab.default",
  "settings.model-tab.rerank",
  "settings.model-tab.embedding",
  "shelf.create",
  "model.add-provider",
  "model.add-custom",
  "model.preset.deepseek",
  "model.api-key",
  "model.fetch",
  "model.test",
  "model.context",
  "model.output",
  "model.save",
  "create.name",
  "create.location",
  "create.submit",
  "outline.generate",
  "outline.wizard.inspiration",
  "outline.wizard.submit",
  "outline.save",
  "outline.save.confirm",
  "outline.memory",
  "outline.modules",
  "outline.mode",
  "chat.mode",
  "chapter.toolbar",
  "chapter.deai",
  "chapter.memory",
  "chapter.view-memory",
  "chapter.font",
  "chapter.event-outline",
  "chapter.plan",
  "chapter.style",
  "chat.reference",
] as const

export type GuideAnchor = (typeof GUIDE_ANCHORS)[number]

export function getGuideStepIndex(stepId: string): number {
  return GUIDE_STEPS.findIndex((step) => step.id === stepId)
}

export function getGuideChapter(chapterId: string): GuideChapter | undefined {
  return GUIDE_CHAPTERS.find((chapter) => chapter.id === chapterId)
}

/** 某阶段的第一步下标；找不到返回 -1。 */
export function getChapterStartIndex(chapterId: string): number {
  return GUIDE_STEPS.findIndex((step) => step.chapter === chapterId)
}
