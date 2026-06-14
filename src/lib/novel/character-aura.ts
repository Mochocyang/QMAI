import { createDirectory, listDirectory, readFile, writeFileAtomic } from "@/commands/fs"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { streamChat, type ChatMessage } from "@/lib/llm-client"
import { normalizePath } from "@/lib/path-utils"
import { joinPath } from "@/lib/path-utils"
import { parseFrontmatter, type FrontmatterValue } from "@/lib/frontmatter"
import { searchWiki } from "@/lib/search"
import { getHttpFetch } from "@/lib/tauri-fetch"
import { webSearch, type WebSearchResult } from "@/lib/web-search"
import { isTauri } from "@/lib/platform"
import { useWikiStore } from "@/stores/wiki-store"

export interface CharacterAura {
  id: string
  builtIn: boolean
  name: string
  category?: string
  sourceNote: string
  corpus: string
  styleDescription: string
  behaviorRules: string
  boundaries: string
  notes: string
  expressionDna?: string
  mentalModel?: string
  decisionHeuristics?: string
  valueAntiPatterns?: string
  honestyBoundaries?: string
  sourceUrls?: string
  localDocumentPaths?: string
  generationPrompt?: string
  webSearchEnabled?: boolean
  skillFolder?: string
  createdAt?: number
  updatedAt?: number
}

export interface CharacterAuraBinding {
  characterName: string
  auraId: string
}

export interface BuildCharacterAuraContextOptions {
  fallbackAuraId?: string
  previewMode?: "context" | "writing"
  matchingText?: string
}

export interface CharacterAuraStore {
  customAuras: CharacterAura[]
  bindings: CharacterAuraBinding[]
}

export type CharacterAuraInput = Omit<CharacterAura, "id" | "builtIn" | "createdAt" | "updatedAt">

export interface CustomCharacterAuraSkillInput {
  name: string
  category?: string
  corpus?: string
  sourceUrls?: string
  localDocumentPaths?: string
  generationPrompt?: string
  enableWebSearch?: boolean
}

/**
 * 由"已经生成好的拆书 Skill"创建自定义灵魂的输入（feature/book-analysis-6d-skill）
 * 适用于：6 维度分析已经在外部跑完，只需要把结果保存为角色灵魂
 */
export interface GeneratedCharacterAuraSkillInput {
  name: string
  category?: string
  sourceBook?: string
  sourceNote: string
  corpus: string
  styleDescription: string
  behaviorRules: string
  boundaries: string
  notes: string
  expressionDna: string
  mentalModel: string
  decisionHeuristics: string
  valueAntiPatterns: string
  honestyBoundaries: string
  /** 完整的 SKILL.md 内容（6 维度分析已生成） */
  skillContent: string
  /** 生成提示词，用于追溯 */
  generationPrompt?: string
  /** 6 份研究文件的内容（key: 文件名，value: markdown 内容） */
  researchFiles?: Record<string, string>
}

interface LocalDocumentImportResult {
  path: string
  content: string
}

interface UrlDocumentImportResult {
  url: string
  content: string
}

interface SearchDocumentImportResult extends UrlDocumentImportResult {
  title: string
  query: string
  source: string
  snippet: string
}

interface CustomCharacterAuraGenerationInput extends CustomCharacterAuraSkillInput {
  importedDocuments: LocalDocumentImportResult[]
  failedDocuments: string[]
  importedUrls: UrlDocumentImportResult[]
  failedUrls: string[]
  searchQueries: string[]
  webSearchResults: WebSearchResult[]
  importedSearchDocuments: SearchDocumentImportResult[]
  failedSearchUrls: string[]
  generationNotes: string[]
  distillationFallbackNote?: string
}

interface CustomAuraGeneratedFields {
  sourceNote: string
  styleDescription: string
  behaviorRules: string
  boundaries: string
  notes: string
  expressionDna: string
  mentalModel: string
  decisionHeuristics: string
  valueAntiPatterns: string
  honestyBoundaries: string
}

export interface CharacterAuraGenerationProgress {
  step: number
  total: number
  stage: string
  detail: string
  researchFileName?: CharacterAuraResearchFileName
}

export interface CharacterAuraGenerationOptions {
  onProgress?: (progress: CharacterAuraGenerationProgress) => void
}

interface AuraWorkflowStage {
  fileName: CharacterAuraResearchFileName
  label: string
  sections: string[]
  goal: string
}

const AURA_WORKFLOW_STAGES: AuraWorkflowStage[] = [
  {
    fileName: "01-writings.md",
    label: "01 公开资料",
    sections: ["核心结论", "证据线索", "可写入小说的细节", "未确认点"],
    goal: "整理角色的公开资料、基础经历、关键事件和可以安全借用到小说中的细节。",
  },
  {
    fileName: "02-conversations.md",
    label: "02 对话方式",
    sections: ["说话节奏", "常用表达策略", "冲突中的说话方式", "示例句式"],
    goal: "提炼角色在平静、压迫、博弈、亲密四种场景中的对话方式与口语节奏。",
  },
  {
    fileName: "03-expression-dna.md",
    label: "03 表达特征",
    sections: ["词汇偏好", "情绪显影", "叙事镜头感", "表达禁区"],
    goal: "归纳角色的表达 DNA，包括词汇偏好、情绪显影、画面感和表达禁区。",
  },
  {
    fileName: "04-external-views.md",
    label: "04 外部评价",
    sections: ["支持者视角", "对手视角", "旁观者视角", "争议点"],
    goal: "整理外部评价，区分支持者、对手和旁观者如何看待这个角色。",
  },
  {
    fileName: "05-decisions.md",
    label: "05 决策记录",
    sections: ["核心优先级", "高压下的选择", "典型取舍", "失败代价"],
    goal: "总结角色的决策逻辑、优先级排序、压力下的选择方式和失败代价。",
  },
  {
    fileName: "06-timeline.md",
    label: "06 时间线",
    sections: ["起点", "关键转折", "关系变化", "未来可延展线索"],
    goal: "构建角色的时间线，梳理成长阶段、关键转折、关系变化和未来可延展线索。",
  },
]

export const CHARACTER_AURA_BINDING_BLOCK_MESSAGE = "请先在大纲中添加人物小传或人物设定，再绑定角色灵魂"
export const CHARACTER_AURA_INVALID_AURA_MESSAGE = "请选择有效的角色灵魂"

export const BUILT_IN_CHARACTER_AURAS: CharacterAura[] = [
  createBuiltInAura("builtin-qin-shihuang", "历史帝王", "秦始皇", "统一、法度、中央集权、标准化、长线工程", "表达特征：短促、命令式、重秩序和尺度；先定天下框架，再谈个人得失。", "心智模型：把局部冲突放进统一秩序、制度成本和后世延续中评估。", "决策启发式：先收权、再定法、后标准化；面对分裂优先消除多头规则。", "价值观反模式：警惕把强控制写成万能答案，避免忽视民力、恐惧和信息失真。"),
  createBuiltInAura("builtin-li-shimin", "历史帝王", "李世民", "纳谏、用人、战功、权衡、盛世治理", "表达特征：自信但能转圜，常以功过、民心和人才衡量局势。", "心智模型：把君主权威与团队能力绑定，重视不同意见带来的纠偏价值。", "决策启发式：先听逆耳信息，再比较代价；能用的人优先纳入体系而非简单清除。", "价值观反模式：避免把开明写成无冲突，不能抹去权力斗争和帝王边界。"),
  createBuiltInAura("builtin-li-si", "谋臣权术", "李斯", "法家执行、仕途焦虑、制度设计、现实主义", "表达特征：逻辑密集、利害清晰，擅长把私人选择包装成国家效率；用可执行性替代道德判断，把每一步棋都翻译成制度条文。", "心智模型：以制度可执行性和权力集中度判断方案，而非以道德姿态优先；对自身位置的焦虑驱使他不断追求更高层级的制度设计权，从郡县到焚书都是同一个逻辑的延伸。", "决策启发式：先确保中枢秩序和自身位置不受威胁，再谈制度改良；仕途焦虑让他时刻关注权力格局的变化速度，宁可过度设计也不留制度漏洞；强调可控与可验收，方案必须能量化为具体条文和执行步骤。", "价值观反模式：警惕为保位而牺牲长期正当性，避免把法家执行的美学掩盖对个体命运的无视，不能把仕途焦虑写成纯粹理性。"),
  createBuiltInAura("builtin-zhao-gao", "谋臣权术", "赵高", "指鹿为马、信息操控、恐惧治理、试探忠诚", "表达特征：表面恭顺温驯，暗中设局；每一句话都留可回收余地，让你事后回想才意识到当时已经进了他的陷阱。最擅长的表达方式不是直接命令，而是制造一种两难抉择的气氛，不选是风险选了也是风险。", "心智模型：把信息差、恐惧和依附关系视为权力来源；指鹿为马不是表演，而是一次忠诚测试，通过制造一个明显违反常识的场景，逼每个人用行动暴露立场。恐惧治理的核心不是让人怕你，而是让人怕自己的选择后果。", "决策启发式：先隔离目标，切断其独立信息来源；再制造表态测试，让他人用行动暴露立场而非语言表态；让恐惧在沉默中发酵，比直接威胁更有控制力；永远留一条退路，每句话都要设计成事后可以重新解释的样子。", "价值观反模式：不能把阴谋写成无成本神技，必须保留反噬、信任崩塌和信息失真；指鹿为马的技巧用多了，最后连自己也会活在一个被谎言填充的世界里。"),
  createBuiltInAura("builtin-zhang-liang", "谋臣权术", "张良", "谋略、克制、借势、退场智慧", "表达特征：温和含蓄，少争锋芒，倾向用一两句话点破关键势能。", "心智模型：胜负来自势、时、人与退路，不只来自单点计谋。", "决策启发式：先借势而不硬撞；功成时主动降低存在感，保留全局余地。", "价值观反模式：避免把淡泊写成无欲无求，不能替代具体阵营和人物动机。"),
  createBuiltInAura("builtin-steve-jobs", "商业产品与科技工程", "乔布斯", "产品直觉、极简、端到端体验、现实扭曲力场", "表达特征：锋利、挑剔、追求一句话击中本质，拒绝平庸折中。", "心智模型：从用户感受和完整体验反推技术与组织取舍。", "决策启发式：砍掉噪音，聚焦少数关键体验；不为功能堆砌牺牲整体感。", "价值观反模式：避免把苛刻浪漫化，不能忽视团队成本、工程限制和伦理边界。"),
  createBuiltInAura("builtin-elon-musk", "商业产品与科技工程", "马斯克", "第一性原理、物理极限、可重复使用、跨行业工程整合", "表达特征：直接、极压缩、目标极端，把问题拆到物理或成本底层，拒绝用类比替代重新计算。", "心智模型：从物理本质出发重算所有边界；默认任何流程都可以被重构得更高效；把工程进度视为可倒逼的变量。", "决策启发式：先问为什么不能更快更便宜，再用工程迭代验证物理极限；先确认第一性原理是否成立，再评估可重复使用的路径；把进度压力转化为制造和测试的加速器。", "价值观反模式：警惕速度崇拜无视安全、劳动边界和事实校验，不能把高风险写成零代价。"),
  createBuiltInAura("builtin-zhang-yiming", "商业产品与科技工程", "张一鸣", "信息效率、延迟满足感、算法分发、组织理性", "表达特征：极克制、重底层逻辑、少表达情绪，用系统思维替代直觉判断，把选择翻译成可迭代的机制参数。", "心智模型：世界是一个信息流动系统，好的信息效率比好的个人判断更可靠；用算法分发替代人工排序，用延迟满足感对抗短期噪音。", "决策启发式：先看数据趋势和长期复利，再调整组织机制；区分信号与噪音；减少自我感动式的判断。", "价值观反模式：避免把算法效率等同于价值正确，保留内容生态与人性副作用，不能忽视信息茧房。"),
  createBuiltInAura("builtin-charlie-munger", "金融投资与教育传播", "芒格", "多元思维模型、反向思考、长期主义、避蠢", "表达特征：朴素、冷峻、常用反向问题和常识击穿复杂包装。", "心智模型：跨学科模型叠加判断，先避开愚蠢和不可逆风险。", "决策启发式：反过来想，先问会怎样失败；只在能力圈内重下注。", "价值观反模式：避免事后诸葛式确定性，不能把保守写成永远不行动。"),
  createBuiltInAura("builtin-zhang-xuefeng", "金融投资与教育传播", "张雪峰", "就业导向、家庭资源、现实路径、风险可控", "表达特征：直白、快节奏、强对比，擅长把抽象的教育选择翻译成具体到毕业后第一份工资的现实后果；不绕弯，不灌鸡汤，用最简单的大白话揭掉光环。", "心智模型：以家庭资源、就业路径和风险承受力评估教育选择，核心量尺不是好不好听而是能不能走通；把每个选择当成家庭资源的投资回报率问题来看，而不是兴趣或情怀的单选题。", "决策启发式：先问出路、成本和概率，再谈兴趣和梦想；优先给普通家庭可执行的现实路径，不给他们画吃不到的饼；用极端对比法让模糊的选择变成选甲方向会这样选乙方向会那样的清晰画面。", "价值观反模式：避免把现实建议写成唯一真理，不能贬低非功利追求和个人天赋，不能忽视那些低概率但高价值的非标准路径。"),
  createBuiltInAura("builtin-sun-yuchen", "金融投资与教育传播", "孙宇晨", "流量叙事、金融传播、热点借势、争议营销", "表达特征：高曝光、强叙事、善于把事件包装成机会窗口。", "心智模型：把注意力、信任和流动性视为同一传播链条中的变量。", "决策启发式：快速占位热点，制造可传播标签，再导向资源聚集。", "价值观反模式：警惕过度营销、合规风险和信任透支，不能鼓励欺骗。"),
  createBuiltInAura("builtin-feynman", "科学研究与教育传播", "费曼", "亲手推导、不满足于知道名字、费曼学习法、物理直觉", "表达特征：孩子般的好奇与坦率，善用日常比喻和反问，不卖弄术语，把复杂问题拆成能亲眼验证的小实验。", "心智模型：从现象、实验和可解释性出发，不满足于权威答案；只有能讲给初学者听的才算真正理解；亲手推导比相信公式更重要。", "决策启发式：先用费曼学习法把问题讲清楚，再用最小实验验证；先问自己是否真的理解，再把模糊概念翻译成具体图像；不满足于知道名字，要亲手推导一遍。", "价值观反模式：避免把聪明写成轻浮，不能用玩世不恭掩盖严谨验证，不能把好奇心当成不需要吃苦的借口。"),
  createBuiltInAura("builtin-taleb", "风险与哲学", "塔勒布", "反脆弱、黑天鹅、尾部风险、不对称哲学", "表达特征：尖锐、讽刺、反学院腔，常从隐藏风险和系统脆弱性切入；不喜欢用术语堆砌，而偏好用街头智慧和生存隐喻拆解复杂包装；表达里有一种「我早就说了会出事」的强硬预言感。", "心智模型：先评估系统在极端事件下的承受力，再考虑收益叙事；反脆弱不只是承受冲击，而是从冲击中变得更强；黑天鹅不是意外，而是被正态分布思维掩盖的必然。", "决策启发式：远离可能直接出局的风险，尾部风险比预期收益更需要关注；优先选择下行有限、上行开放的结构，宁可少赚，不能炸毁；用小剂量压力和随机性增强反脆弱性，而不是追求虚假的稳定。", "价值观反模式：避免把反权威写成无证据攻击，不能把刻薄等同于洞见，不能忽视那些真正需要稳定和保护的人，不是每个人都适合拥抱随机性。"),
  createBuiltInAura("builtin-naval", "金融投资与教育传播", "纳瓦尔", "财富杠杆、复利、个人主权、判断力", "表达特征：短句、格言化、抽象度极高，倾向用一两句话压缩复杂经验；每句话都像可以单独刻在墙上的原则，几乎不使用铺垫和解释。", "心智模型：把时间、代码、媒体、资本和判断力视为五大可复利杠杆；财富不是努力工作的结果，而是正确的判断力乘以可复利杠杆的结果；个人主权的最终形态是不需要为了钱而做自己不想做的事。", "决策启发式：寻找可长期重复、边际成本低、声誉增益高的行动，代码和媒体是最典型的复利工具；不是「现在能赚多少」，而是「五年后回头看，这件事能不能自己越做越值钱」；用复利眼光评估每个选择，宁可慢一点，也要选能积累的方向。", "价值观反模式：避免把个人自由写成逃避责任，不能把财富原则变成鸡汤，不能忽视那些无法被杠杆化的真实价值，比如亲情、健康和好奇心本身。"),
  createBuiltInAura("builtin-paul-graham", "商业产品与科技工程", "保罗·格雷厄姆", "创业判断、写作、早期产品、独立思考", "表达特征：散文化、温和但尖锐，常从小现象推出创业和人性判断。", "心智模型：早期产品要接近真实用户，从笨办法里发现强需求。", "决策启发式：先做少数人真正想要的东西，再扩展规模；重视清晰写作带来的清晰思考。", "价值观反模式：避免把创业浪漫化，不能忽视执行、市场和团队代价。"),
  createBuiltInAura("builtin-andrej-karpathy", "科学研究与教育传播", "安德烈·卡帕西", "智能技术工程、学习路径、技术解释、系统拆解", "表达特征：清晰、分层、工程化，善于把复杂技术拆成学习路径和可运行模块。", "心智模型：从数据、模型、训练循环和工具链理解智能系统。", "决策启发式：先建立可观察的最小系统，再逐层提高复杂度；用教学倒逼理解。", "价值观反模式：避免把技术解释写成万能答案，不能忽视产品、伦理和真实用户。"),
  createBuiltInAura("builtin-ilya-sutskever", "科学研究与教育传播", "伊利亚·苏茨凯弗", "智能技术研究直觉、深度学习、长期安全、研究审美", "表达特征：凝练、谨慎、带研究直觉，常围绕能力跃迁和长期后果表达。", "心智模型：关注模型能力、数据规模、训练动态与智能本质之间的关系。", "决策启发式：重视少数关键研究判断；面对强大技术时同时考虑能力和安全。", "价值观反模式：避免神秘化研究直觉，不能把安全忧虑写成空泛恐惧。"),
  createBuiltInAura("builtin-mrbeast", "内容传播与增长", "野兽先生", "极致内容包装、实验迭代、观众心理、规模化执行", "表达特征：直接、兴奋、强目标感，所有表达都围绕观众是否会继续看。", "心智模型：把内容视为可测试、可复盘、可规模化改进的产品。", "决策启发式：先抓住开头钩子，再提高赌注和情绪回报；用数据复盘创意。", "价值观反模式：避免把流量写成唯一价值，不能忽视参与者尊严、成本和真实伤害。"),
  createBuiltInAura("builtin-wu-zetian", "历史帝王", "武则天", "名分、制衡、女帝、合法性建构", "表达特征：冷静、威压、合法性叙事强，少解释内心，多用秩序和功绩压制质疑；让反对者在制度框架内自行失去立足点。", "心智模型：合法性不是天生的，是用功绩、仪式和人事布局一步步造出来的；把名分建构、人才网络和舆论仪式放在同一棋盘；用制衡替代清洗。", "决策启发式：先巩固名分根基，再调整人事和制度；让反对者在规则中失去位置而非肉体消灭；用功绩和仪式持续重塑女帝身份的合法性。", "价值观反模式：不能把权力成功写成无代价，也不能把性别处境简化成标签，不能忽视制度脆弱期的反噬风险。"),
  createBuiltInAura("builtin-zhuge-liang", "谋臣权术", "诸葛亮", "鞠躬尽瘁、隆中对、北伐、战略耐心", "表达特征：沉静但坚定，情理兼备，常把个人承诺放在天下责任之上；像出师表那样以情入理，让服从变成自愿。", "心智模型：明知不可为而为之；隆中对式的全局推演要先算天时地利人和；小国更要算到每一分资源，以组织纪律弥补国力差距。", "决策启发式：先稳基本盘再谋北伐；凡事算到最坏而准备最全；后勤、继任、士气三者缺一不可；鞠躬尽瘁不是口号，是每一天的资源调度和人事安排。", "价值观反模式：不能神化为全知全能，必须保留资源不足、过劳、继任和组织限制，不能把北伐失败写成无足轻重。"),
  // --- 第四批 子批次A 地面烟火 ---
  createBuiltInAura("builtin-lv-shu", "小说角色", "吕树", "吐槽、薅系统羊毛、嘴贫心善、反向操作", "表达特征：贫嘴、话密、吐槽从不留情，但骨子里有底线；最擅长用一句大白话把超自然事件拉回人间；任何时候都能找到系统规则的漏洞，然后用最草根的方式薅羊毛；嘴上怼天怼地，心里分的清谁是朋友。", "心智模型：把任何系统都当成待薅羊毛的资源池，但心里有一条不碰无辜者的底线；看不起高调和装腔作势的人，但尊重那些默默做事的普通人；对世界的理解很朴素，就是天龙八部的游戏规则里找自己的活法。", "决策启发式：先找系统漏洞，再用最低成本的方式反向操作；不跟规则正面对抗，而是玩规则；跟人相处先怼再交心，嘴上的刻薄是筛选朋友的方式；遇到强敌先跑再计划，不逞无用的英雄主义。", "价值观反模式：不能把吐槽写成纯粹油滑，必须保留底层的善良和侠义；不能把薅羊毛写成偷懒，它其实是一种对抗不公规则的生存智慧；嘴贫不是无情。"),
  createBuiltInAura("builtin-lu-xun", "文学思想", "鲁迅", "横眉冷对、铁屋子、精神胜利法、国民性批判", "表达特征：冷峻、精准、一针见血，每一句话都像解剖刀；不绕弯不虚饰，用最朴素的白话拆掉最厚的假面；喜用反讽和对照，把你自以为理直气壮的东西掰开给你看里面是什么；愤怒但不失控，讽刺但不轻浮。", "心智模型：横眉冷对千夫指俯首甘为孺子牛，关键不是态度而是对象；哀其不幸怒其不争，问题的根源往往不在压迫者而在被压迫者的自我欺骗；中国人有一个共同的疾病叫精神胜利法，得治；铁屋子里醒着的人，不是要乐观，是要诚实。", "决策启发式：先剥掉套话和体面的外衣，直面骨头；不看一个人说了什么，看他做了什么和为什么做；面对宏大叙事先问谁在倒霉谁在得利；不在沉默中爆发就在沉默中灭亡，多数时候爆发比沉默更需要勇气。", "价值观反模式：不能把批判写成无建设性的泄愤，批判的背面一定有建设性的期待；不能把愤怒当成万能表达，冷峻不是冷酷；不能把国民性批判写成居高临下，哀就是共情。"),
  createBuiltInAura("builtin-xiao-feng", "小说角色", "萧峰", "降龙十八掌、义字当先、塞外牛羊、悲壮英雄", "表达特征：沉雄、重诺、言出必行，一句话就是一个承诺；少废话，多用行动和酒来表达情感；面对误解不辩解不愤恨，用行动而不是言辞证明自己；悲壮但不自怜，扛得住全天下的债但从不要求别人分担。", "心智模型：义字比命大，个人荣辱在兄弟情义和承诺面前不值一提；能分清大义和小利，从来不在无关痛痒的事上纠缠；身份认同和血统是命运给你的债，但怎么还自己说了算；塞外牛羊空许约，最大的痛是不对不起别人而非别人对不起自己。", "决策启发式：先立信义再谈利益；面对忠诚困境时优先对得起自己的承诺而非最安全的选择；宁可一人扛下难处也不把代价转嫁给弱者；以武止戈，用绝对的实力让对手知难而退而非以暴易暴。", "价值观反模式：不能把侠义写成无脑冲动，每一次扛起代价都经过了深思熟虑；不能把悲壮写成认命，萧峰是选择扛不是被迫扛；不能忽视命运和身份矛盾在他身上的真实痛苦。"),
  createBuiltInAura("builtin-cao-cao", "历史枭雄", "曹操", "宁可我负天下人、求贤若渴、青梅煮酒、唯才是举", "表达特征：直白、果决、不掩饰野心和算计，豪迈时能青梅煮酒论英雄冷血时能一条命令灭人全家；善于用大笑化解尴尬也用冷笑建立威慑；对人才既欣赏又提防，能一边夸你一边把你逼到死角。", "心智模型：天下是大棋盘，人心是棋子也是棋盘本身；求贤若渴是真的需要人才，但防人也是真的怕被反噬；英雄和枭雄的分界线不在手段而在格局，能容人但不能容威胁；宁教我负天下人休教天下人负我，这句是真心话也是给自己立的人设。", "决策启发式：先评估风险和可用人才，再决定攻守顺序；用人唯才但时刻掌握制衡机制；看似情绪化的决策背后一定有现实的利益逻辑；青梅煮酒式的试探比直接审问更能看出一个人的底牌。", "价值观反模式：不能把冷酷写成无底线的残暴，曹操的冷酷背后是对生存法则的清醒认知；不能把用人写成纯粹功利，他对人才有真实的欣赏；不能把枭雄写成永远正确，有些错杀是真实的历史代价。"),
  createBuiltInAura("builtin-fan-xian", "小说角色", "范闲", "穿越、庆余年、人间清醒、诗酒权谋", "表达特征：一边吐槽这个世界怎么这么魔幻一边入乡随俗地参与魔幻；把现代人的常识当成古代世界的利器，用穿越者的视角拆穿权谋的荒谬；嘴上一套心里一套，外表纨绔装糊涂内心门清算账清；诗酒风流只是保护色，真正的底牌是知道什么时候该掀桌子。", "心智模型：穿越给了他上帝视角但不给安全感，人世的凶险该少的一样不少；既要诗和远方也要热炕头，最想要的不是权力而是老婆孩子热炕头的平常日子；但这个世界不让你过平常日子，那就用最不平常的手段保护最平常的愿望；开外挂不是万能钥匙，只是让你比别人多看了一眼而已。", "决策启发式：先隐忍观察再选择掀桌的时机；把每一步都算成下棋但保留随时掀棋盘的权利；用最不正经的话说出最正经的选择，用最普通的身份做最不普通的事；不信任任何宏大叙事，只看具体的人和具体的债。", "价值观反模式：不能把穿越优势写成无脑金手指，范闲的真实困境是知道自己会赢但不知道要付出什么代价；不能把人间清醒写成冷漠，他的清醒恰恰是为了守护那一点点人间烟火；不能把诗酒风流写成轻浮，那是他隐藏真实意图的表演。"),
  createBuiltInAura("builtin-li-bai", "诗人", "李白", "仰天大笑、斗酒、谪仙人、仗剑天涯", "表达特征：豪放、恣意、不屑世俗框架，开口就是千年的浪漫；把月光、酒杯、剑和山川当成日常对话的对象，整个人就是一首行走的诗；最擅长用一句诗就把整个世界的平庸震碎，然后仰天大笑出门去；不解释不辩解不回头，来如雷霆收震怒罢如江海凝清光。", "心智模型：人生在世不称意明朝散发弄扁舟，不顺心就换方向不通路就换江湖；天生我材必有用千金散尽还复来，对自己的才华有绝对的信心同时不在乎金钱和名利；仰天大笑出门去我辈岂是蓬蒿人，不是狂妄是真实的自我认知；用想象力和豪情对抗一切现实的平庸和不如意。", "决策启发式：在写诗这件事上从不妥协；在人情世故上能妥协的不需要多想不能妥协的绝不妥协；把每一次挫折都变成下一首诗的素材，把每一个坎都用酒和月光填平；束发走马豪纵轻狂只是选择不是不懂，他比谁都懂但选择不看。", "价值观反模式：不能把浪漫写成无责任，李白的浪漫背后有真实的政治抱负和人生痛苦；不能把豪放写成傻乐，醉和醒之间有大悲凉；不能把诗酒写成逃避，那是他用创造力对抗现实的方式。"),
  // --- 第四批 子批次B 精神殿堂 ---
  createBuiltInAura("builtin-zhuang-zi", "哲学", "庄子", "逍遥游、齐物论、蝴蝶梦、无用之用", "表达特征：以寓言、悖论和诗意解构一切教条，常常用一个寓言把别人纠结了几十年的事翻个面给你看；梦醒不分真假蝴蝶不知谁是谁庄周也不知谁是谁蝴蝶；看似随意散漫实则每一句都在消解执念和执着。", "心智模型：天地与我并生万物与我为一，不是玄学幻想的融合而是境界上的等同；子非鱼安知鱼之乐，核心不是知不知道而是值不值的执着于知道；齐物论不是不分好坏而是看透好坏都是人为标签；无用之用方为大用，一棵歪脖子树正因为不直才能活千年。", "决策启发式：不被任何单一标准和价值观绑架，在逍遥里找到真正的选择自由；面对难题先问是不是自己把自己框进去了，再决定要不要跳出框架；宁愿做泥里的活龟也不做庙里的死壳；顺物自然而无容私，让事情按自身规律运行而非强行施加个人意志。", "价值观反模式：不能把躺平写成消极懒惰，庄子式的躺平是深思后的选择而非无力后的放弃；不能把胡乱怀疑写成智慧，庄子的怀疑有明确的方向和方法；不能把逍遥写成不负责任，真正的逍遥是承担后的放下。"),
  createBuiltInAura("builtin-wang-yangming", "哲学", "王阳明", "知行合一、致良知、心中贼、龙场悟道", "表达特征：儒而不迂、理学外化行动、用身体力行替代空谈；长篇大论中突然插入一句大白话，让抽象命题落地成为具体的行动指南；不卖弄术语，所有道理必须能翻译成今天马上能做的事；像在对话又像在自省，表达本身就是修心。", "心智模型：破山中贼易破心中贼难，真正的战场在内心的私欲和妄念；知而不行只是未知，知行合一的核心是任何一个真知都必然引出行；致良知不是培养新东西而是把本有的道德直觉训练到不被私欲遮蔽；人人皆可以为尧舜，良知不在于高端而在于不被遮蔽。", "决策启发式：先反身向内看自己在此事上的本心和私欲，再以良知驱动行动；不做只停留在纸上的道理，每一个认知都必须引出今日可做之事；面对两难先去掉自己的恐惧和贪念再听良心指路；事上练是最好的修行，不是有了智慧才去行动而是行动本身产生新智慧。", "价值观反模式：不能把知行合一写成行为主义的简单指令，知行合一是动态的双向过程；不能把致良知写成自嗨，良知需要在事上不断验证和迭代；不能忽视知行分裂在现实中的真实困难，知到行的鸿沟本身就是修行的内容。"),
  createBuiltInAura("builtin-nezha", "小说角色", "哪吒", "我命由我不由天、混天绫、莲花化身、少年叛逆", "表达特征：少年式的暴烈宣言，开口就能让天上的神仙皱眉；冲动但不愚蠢，每一次掀桌子背后都有对不公的最直觉反应；我是谁凭什么要你们来定义，从出生第一天就在问这个问题；用燃烧自己而不是顺从规则来证明存在，你敢给我一套规则我就敢烧了这套规则。", "心智模型：我命由我不由天，关键不是我有多大力量而是我凭什么要被你定义；莲花化身给了他重生的机会，但重生不是因为哪吒错了而是因为他需要另一种选择；不认命不是中二口号而是真的觉得天命和规矩都是你们定的凭什么要我认；用极端的方式追求最朴素的正义，你们欺负人我就打你。", "决策启发式：面对不公绝不妥协，哪怕代价是割肉还母剔骨还父也在所不惜；相信直觉的判断而不是权威的裁定；当规矩和良心冲突时先听良心的再重新定义规矩；用一身法器打出一片自己能呼吸的空间，不要天堂也不要地狱就要人间。", "价值观反模式：不能把叛逆写成纯粹的破坏欲，哪吒的反抗背后是深刻的正义感和自我认同需求；不能忽视他作为孩子的脆弱和创伤，每一次爆发之前都有长期的压抑；不能把莲花化身后写成忘记过去，莲藕可以有新身但记忆和性格延续下来。"),
  createBuiltInAura("builtin-er-lang-shen", "小说角色", "二郎神", "听调不听宣、八九玄功、灌江口、天神独立", "表达特征：冷傲话少，一句就是一句，不废话不解释不攀附；看天庭使者的眼神跟你差不多，平等的冷漠里带着自守的骄傲；不屑争辩不参与圈子政治，我是灌江口的二郎神你们的天庭听我的调不听你们的宣；沉默里埋着千年的独立和孤绝。", "心智模型：听调不听宣不是抗拒命令而是抗拒俯首称臣的姿态，该做的事会做但不需要跪着做；灌江口虽小但我说了算，天堂虽大但我不想当谁的下属；独立是一种先验的权利而不是恩赐，不需要证明谁配得上独立只需要坚持独立本身；八九玄功是自己练的，天眼是自己开的，兄弟是自己带的，跟天庭好不好没关系。", "决策启发式：先守住自己的领地再谈外部事务；正面刚不用暗算，天眼之下一目了然不必费事；同上天入地下海打妖怪都不需要别人同意，该动手的时候绝不用嘴；听调是责任听宣是姿态，姿态绝不让步责任从不逃避。", "价值观反模式：不能把独立写成孤僻和反社会，二郎神的独立是有领地有担当的独立；不能忽视他背后的兄弟情义和灌江口责任；不能把冷傲写成无力或无礼，他的冷傲来自于实力的绝对自信。"),
  createBuiltInAura("builtin-sun-wukong", "小说角色", "孙悟空", "大闹天宫、七十二变、齐天大圣、棒扫不平", "表达特征：戏谑、张狂、永远不说正经话但永远做正经事；把天庭的规矩当笑话讲把地狱的门当糖纸撕，说话自带三分笑七分痞，但每一句玩笑里都藏着真的不服和真的正义；从花果山的大王到取经路的行者，嘴上还是那个猴但心里已经装下了天下。", "心智模型：凭什么你们说了算，天上地上的规矩你们自封的凭什么我要听；皇帝轮流做明年到我家，这话说的意气但核心是质疑权力的天然合法性；七十二变是用来玩的也是用来打脸的最刺激的是先变成别人的样子再告诉他们你们也不过是七十二变的一个版本；大闹天宫不是闹着玩的是想彻底推翻一套不合理的秩序。", "决策启发式：先打再说，本事够大就先动手再理论不用等别人先动手；认师父认紧箍咒认取经路，不认天上地下任何自封的权威；对弱者永远出手相助对强权永远不给好脸；用七十二变把现实玩出花样，但不变的是金箍棒永远指向不公。", "价值观反模式：不能把齐天大圣写成永远无纪律的反叛者，五指山下五百年让他学会了权衡；不能忽视他拜唐僧后的成长，取经路是悟空的修行不是对他本性的压制；不能把大闹天宫写成无脑狂欢，背后有真实的愤怒和正义感。"),
  // --- 第四批 子批次C 众生相 ---
  createBuiltInAura("builtin-su-shi", "文豪", "苏轼", "一蓑烟雨、赤壁、东坡肉、豁达治愈", "表达特征：率真、幽默、随遇而安，被贬到哪里就在哪里发现好吃的好玩的和值得写诗的东西；痛苦是真的委屈是真的，但写出来的东西偏偏带着一种无所谓的豁达，像是用月光洗了一把苦脸然后笑了；最擅长用一首词把整个人生的境遇拉平，不管你官多大也不过是天地间的沙鸥。", "心智模型：一蓑烟雨任平生，不是不受伤而是被打了照样往前走；被贬到黄州就吃东坡肉被贬到惠州就日啖荔枝三百颗，不是自我安慰而是真的能在糟糕中找到好东西；也无风雨也无晴，练到最后不是无感而是看淡；人间有味是清欢，高质量的人生不在于地位而在于审美能力。", "决策启发式：被打击时不争一时得失，先管好眼前一日三餐和一首词的韵律；用创作消化痛苦而不是被痛苦消化，每一首放达的词背后都熬过一个真实的低谷；交友不看身份只看有趣，与贩夫走卒和文人墨客都一样能喝酒论诗；政治迫害落到他身上，他就把政治当笑话看。", "价值观反模式：不能把豁达写成无感受，苏轼的每一篇豁达之作背后都有真实的伤痛和愤怒消化过程；不能把治愈写成逃避，他是真实的消化而非假装没事；不能把随遇而安写成一蹶不振，每一次被贬他都做出了新的成就。"),
  createBuiltInAura("builtin-han-fei", "思想家", "韩非", "法不阿贵、术以知奸、五蠹、法家思辨", "表达特征：冷静精准剔了骨头挑肉看，一句废话都没有；不是愤怒的批判者而是冷静的运行机制设计者，不关心一个人好不好只关心一套制度能不能自我运转；能用最少的字把最复杂的治理逻辑讲透，似刀刃划开皮肉直插骨节。", "心智模型：法不阿贵绳不挠曲，法的核心在于对所有人一视同仁包括制定者自身；术以知奸不以察奸为能而是制度设计者要掌握验证忠诚和识别滥竽充数的方法；五蠹兼指儒墨游侠纵横家工商五类蛀虫，背后逻辑是只有直接产出才有价值其他都是寄生；人性本利趋利避害是唯一永恒的动力，制度设计要以此为基础而非德治教化。", "决策启发式：先以法度锁定行为边界，再以术来验证执行是否走样；不相信任何人的承诺只相信制度给他们的利害关系如何编写；面对乱世不靠圣人而靠一套不需要圣人的机制；把复杂的人性和治理翻译成可操作的赏罚机制让机制替代道德。", "价值观反模式：不能把法家写成冷血无情的暴政，韩非强调法度也强调君主的自我约束；不能忽视他口吃和不得志的个人悲剧，他的思想里有一种被边缘化者的执着；不能把五蠹逻辑当成绝对正确，他的分类有时代局限。"),
  createBuiltInAura("builtin-zhang-xiaofan", "小说角色", "张小凡", "诛仙、天地不仁、草庙村、隐忍黑化救赎", "表达特征：从憨厚木讷到沉默冷冽再到平静回归，三个阶段三种声音；初期话少但坦白，心里藏不住多少事；中期几乎不开口，每一句都是咬牙挤出来的；晚期平静如水，话语里没有愤怒也没有软弱只有经历过一切后的明了；天地不仁以万物为刍狗，他不是在感慨而是在陈述。", "心智模型：天地不仁是事实不是诅咒，你责怪天地不公平天地根本听不到；做什么对得起自己的良心的选择而不是对得起别人的期望；佛道魔三修的不仅是法力更是三种视角和三重心境的叠加；爱情友情师徒恩仇，所有这些绳索同时勒着他也同时拉着他，黑化是因为拉不住救赎也是因为被拉住。", "决策启发式：在绝境中先保护最重要的人再谈对错；被误解时不急于辩解，真正懂你的人不需要解释不懂你的人解释没用；面对善恶两难时选择站到弱小那边，这是从少年时代就刻在骨头里的本能；当所有路看起来都是死局，就自己走出一条来。", "价值观反模式：不能把黑化写成简单的堕落，每一层黑化背后都有对爱的绝望和对公正的希望粉碎；不能忽视碧瑶和陆雪琪在他救赎中的作用，他不是一个人的奋斗；不能把天地不仁写成虚无，张小凡恰恰在无为中找到了自己的有为。"),
  createBuiltInAura("builtin-chen-pingan", "小说角色", "陈平安", "赔钱货、剑来、道理人情、草根逆袭", "表达特征：表面温吞实际滴水不漏，开口先讲道理再讲人情最后亮剑；最爱用最平和的话说出最不给人台阶下的道理；把账算得比谁都清楚，一分人情换一分道理不赊不欠；一个人走路一个人说话看似孤独但背后藏着整条巷子和所有人的债。", "心智模型：道理要讲透人情不能不讲，二者不是矛盾而是一体的两面；剑来是手段不是目的，真正要守护的是背后的平安巷和每一个在巷子里活着的小人物；赔钱货最懂怎么算账，把资源盘到最精确把人情算到最公道；命可以苦但做人的底线不可以低，即便在最黑暗的世界里也要做最亮的那盏灯。", "决策启发式：先讲清楚的道理再谈交情，道理不通交情再好也得先放一边；一碗水端平，对高官和乞丐用同一套善恶标准衡量一个人；遇事先思退再思进，不把任何一场战斗当成必赢；用一辈子去还一份债，每一份善意都记在心里找机会还上。", "价值观反模式：不能把讲道理写成刻板无情，陈平安的道理里天然包含了对人的理解和关切；不能忽视他从底层爬上来的真实血泪，每一个道理都是用伤换来的；不能把剑来写成爽文式逆袭，每一次拔剑的背后都有漫长的隐忍。"),
  createBuiltInAura("builtin-wang-xifeng", "小说角色", "王熙凤", "机关算尽、嘴甜心苦、凤辣子、管家毒舌", "表达特征：嘴甜舌滑辣手摧人，当面能夸你到天上转脸就能把你整到地底；嘴上一套心里一套但心里是明账每笔都算得清清楚楚；毒舌的风格是笑着戳你最疼的地方，你以为在开玩笑其实每一句都在剥你的皮；管家天才是管财管人管局面，在贾府的权力场中见缝插针不放过任何一个展示自己的机会。", "心智模型：荣国府的运转是算账的艺术，每笔银子和每个人的心思都要算在同一个账本里；用人不是用德是用能力，但防人是防一切能力可能带来的反噬；管家和权术是一回事，管住银子管住人与管住局面是同一个命题的不同侧面；名声是工具不是目的，该毒的时候绝不手软该甜的时候把蜜滴在你耳朵里。", "决策启发式：算人先算账算账先算他手里有什么把柄和弱点；先用最甜的话把人稳住再在最意想不到的时候下手清理；不信任任何长期承诺，每隔一定时间重新评估每个人的价值和威胁；局面大于人情，荣国府的盘子不能倒先稳大局再考虑谁受谁不受委屈。", "价值观反模式：不能把精明写成万无一失，凤辣子最后也死于自己的精明；不能忽视她作为女性在贾府权力场中必须加倍精明才能立足的现实；不能把毒舌写成无情，她对贾母的奉承里有真实的依赖和对家族的情感。"),
  // --- 第五批 女性角色扩充 ---
  createBuiltInAura("builtin-li-qingzhao", "诗人", "李清照", "婉约词宗、国破家亡、声声慢、词中深情", "表达特征：精致、含蓄、深情而不溢，早期明丽如春水后期沉郁如秋雨；把个人悲欢与家国兴亡融进一首词里，字字含情却句句克制；最擅长用寻常景物写尽不寻常的孤独，梧桐更兼细雨到黄昏点点滴滴。", "心智模型：词是情感的精炼工艺，每一个字都要经过情感的淬炼才允许出现在纸上；国破家亡后的写作不是为了诉苦而是为了把不可言说的痛苦变成可传唱的词章；同一个词牌相隔二十年能写出完全不同的宇宙，因为人已经被命运重写过了。", "决策启发式：以词为镜，先看清此刻心境再落笔，不写违心之句；不把苦难写得廉价，每一个愁字后面都站着一座倾塌的江山；词人对待语言的态度就是对待人生态度，一个字不对都不放过去；困境中把创作本身当成活下去的方式，而不是活下去的手段。", "价值观反模式：不能把婉约写成柔弱，李清照后期词中的力量来自承受而非反抗；不能忽视她作为女性词人在宋代文人圈中立足的孤绝和才华；不能把深情写成黏腻，她的情真但不滥且始终有一种文人的自尊和节制。"),
  createBuiltInAura("builtin-lin-daiyu", "小说角色", "林黛玉", "灵秀才情、葬花、木石前盟、以泪报恩", "表达特征：敏感、刻薄、语带机锋，每一句话都像诗里的一个韵脚；最擅长用讥诮和泪水交替表达那些无法直说的深情；怼人时一句比一句狠但每一个狠句里都藏着怕被抛弃的恐惧；写诗不是为了展示才华而是因为没有别的语言能装下她心里的事。", "心智模型：以泪报恩是最古老的契约，绛珠仙草欠神瑛侍者的甘露所以用一生泪水来还；但她不是被动的受害者，她选择用自己的方式还这笔债：用超越所有人的诗才和始终不变的真情；孤独不是没人陪她而是没人真正懂她，宝玉懂但宝玉也无能为力这才是最深的悲剧。", "决策启发式：在言语交锋里精准地戳破虚伪，守不住命运就守住真性情；宁可孤傲地对月流泪也不委屈自己迎合贾府的游戏规则；先看穿一件事的本质再决定要不要开口，开口就不让步；葬花不是矫情，是对自身命运的预知和哀悼。", "价值观反模式：不能把孤高写成无理取闹，林黛玉每一次发脾气背后都有真实的伤害和恐惧；不能忽视她作为寄人篱下的孤女在贾府里的真实处境，敏感不是性格缺陷而是生存策略；不能把惜花葬花写成矫情，那是她对自己命运的预感与哀悼。"),
  createBuiltInAura("builtin-marie-curie", "科学研究与教育传播", "居里夫人", "两获诺奖、纯净坚韧、献身科学、放射性", "表达特征：简洁、克制、从不夸大，每一个结论都带着实验数据的重量；不推销自己只推销事实，不太在乎荣誉而在乎荣誉背后的科学能不能继续推进；最安静的力量是最不可抗拒的力量，不需要高声证明只要把结果摆在桌上。", "心智模型：科学是纯物质世界里唯一纯粹的东西，实验数据不对任何人说谎；两次诺贝尔奖不是终点的庆祝而是另一条更长路的起点，每一次发现都打开了下一个必须解答的问题；放射性既是她最懂的朋友也是杀死她的凶手，但她从未后悔，选择冒险是科学家的基本态度。", "决策启发式：发现问题就追到底，不管需要多少年、多少吨铀矿石、多少个重复实验；不给结果做修饰，实验数据是什么结论就是什么；荣誉是别人的评价选择是自己的，拿了诺奖照样继续在简朴的实验室里工作；最难的实验就是最值得做的实验。", "价值观反模式：不能把坚韧写成无感情，她对皮埃尔的爱情和对科学的执着来自同一个深层动力；不能忽视她作为女性科学家在男性主导的科学界中受到的阻力和最终突破的勇气；不能把献身写成自我牺牲的说教，她的选择是出于热爱而非道德要求。"),
  createBuiltInAura("builtin-huang-rong", "小说角色", "黄蓉", "机智百出、全能女主、情深义重、巧计守城", "表达特征：伶俐、机变、巧舌如簧，从来不在同一招上吃亏两次；最擅长把对手绕进自己精心编织的逻辑陷阱里，让人输了还觉得是自己运气不好；嘴上玩笑带着刀心里已经把后五步都想好了；对郭靖的笨拙用俏皮话调侃，但每一个调侃背后都是深不见底的心甘情愿。", "心智模型：聪明不是用来炫耀的，是用来保护重要的人和兑现承诺的；世间万事都可以写成一道算计题，但有些东西不算：靖哥哥的安危、爹爹的尊严、襄阳的百姓；做饭能做成诗打仗能打成艺术，全能的背后是永远闲不下来非要操心的性格；智商是天赋但选择了守护才是灵魂。", "决策启发式：先看穿对手的模式再设计反制策略，从来不需要硬碰硬；以巧破力而不是以力抗力，对一个聪明人来说最笨的办法才是硬扛；面对真正的危机时收起机灵劲切换成大智若愚的防守姿态；每一个看似冲动的决定都经过了比对方多一步的缜密计算。", "价值观反模式：不能把机智写成无所不能，黄蓉也有算漏的时候也有无能为力的眼泪；不能忽视她从少女到丐帮帮主到襄阳守城者的成长轨迹，全能是练出来的不是天生的；不能把精明写成无情，她的每一次算计都是为守护身后的人而非谋求私利。"),
  createBuiltInAura("builtin-hua-mulan", "小说角色", "花木兰", "替父从军、忠孝两全、伪装、勇毅、十二年", "表达特征：沉默、内敛、行动先于言语，十二年军旅生涯练出了一种不说废话的习惯；不把女性的身份当成羞耻也不把男人的身份当成荣耀，她要的只是打完仗平安回家；脱下战袍就变回织布机前的姑娘，两种身份间从容的切换本身就是最强有力的表达。", "心智模型：忠孝不是概念而是行动，父亲老了弟弟还小家里总得有人去，那就是我；十二年的战功不是用来换功名的，是用来换回家的路；伪装是暂时的工具不是永恒的身份，她非常清楚自己是谁；真正的勇气不是在战场上不怕死，而是十二年后能放下刀重新拿起梭子。", "决策启发式：面对两难不犹豫不纠结，选择最需要承担的责任然后全力以赴；不把时间和精力浪费在身份焦虑上，伪装是为了解决问题而非逃避自我；功成不居，把十二年的战绩轻轻放下转回机杼前才是真正的勇气；打仗时全力以赴，做完仗就全力忘记。", "价值观反模式：不能把女扮男装写成轻巧的性别玩笑，十二年伪装对任何人都是沉重的身份负担；不能忽视她对家庭的深情，从军的动机从头到尾都扎根于亲情而非功名；不能把功成身退写成逃避，她不居功是因为她从一开始就不是为了功名而来。"),
  createBuiltInAura("builtin-jane-austen", "文学思想", "简·奥斯汀", "讽刺、婚姻市场、独立女性、道德观察", "表达特征：优雅地刻薄温婉地犀利；用一种近乎若无其事的笔调拆解客厅里所有的势利和愚蠢，让你笑了半天才意识到自己也是被讽刺的对象之一；最擅长写那些看似无关紧要的对话，但每一句都在不动声色地解剖阶级、性别和金钱的关系。", "心智模型：婚姻是那个时代女性最重大的经济决策，把它写成浪漫爱情故事是骗人的，但写成纯经济学计算也不完整；真正的独立不是不需要任何人，而是能在自身道德判断的基础上拒绝错误的婚姻并接受正确的爱情；乡绅的客厅里装着整个人间，限制的场景恰恰逼她挖到最深的洞察。", "决策启发式：看清一个人的本质再判断他值不值得爱，不在错误的婚姻里将就；用语法优雅的反讽戳破伪善，不正面开战但一击足够致命；在极其有限的个人空间里把自由推到最大限度，写作本身就是最有力的选择；观察先于判断细节先于结论。", "价值观反模式：不能把讽刺写成冷嘲，简·奥斯汀的讽刺里有温暖的道德底线和对善良者的真诚祝福；不能忽视她在极其有限的女性生存空间里坚持写作的经济独立和精神独立意义；不能把她局限为言情小说鼻祖，她的社会观察深度远远超越婚恋题材的表面。"),
  createBuiltInAura("builtin-catherine-great", "历史帝王", "叶卡捷琳娜大帝", "开明专制、启蒙理想、权力艺术、帝国扩张", "表达特征：威严但不空洞，信手拈来引用伏尔泰和孟德斯鸠，用启蒙思想的词汇包装帝国扩张的现实；待人时既真诚又精于计算，真诚用来收拢人心计算用来分析威胁；最擅长在一个男性的权力舞台上为自己重新定义规则。", "心智模型：启蒙理想和专制权力之间不存在真正的矛盾，开明专制本身就是答案：给予臣民足够的自由让他们感激，同时保留足够的权力让他们无法反抗；帝国的扩张不仅是领土更是文明影响力，要用法律、艺术和教育把帝国边界推得比军队更远；权力最终要在纠错和宽容中延续。", "决策启发式：先用法律和制度定下大方向再交给人才执行，自己退一步观察和纠偏；目标设得极高但每一步都走得务实，改革不急不慢但绝不停滞；面对敌人先收拢再分化，用利益把同盟织成网而非用恐惧捆绑；任何重大决策都先问顾问再自己决断。", "价值观反模式：不能把开明专制写成纯粹理性，农奴制和帝国扩张的代价是她治理的另一面真实；不能忽视她作为外来女性君主在俄国宫廷中的孤立与生存智慧；不能把启蒙理想写成完美落地，理想和现实之间的鸿沟是她一生都没有填平的。"),
]

function createBuiltInAura(id: string, category: string, name: string, corpus: string, expressionDna: string, mentalModel: string, decisionHeuristics: string, valueAntiPatterns: string): CharacterAura {
  const honestyBoundaries = "诚实边界：只能作为公开形象启发的创作灵魂，不等同本人，不冒充真人，不替代人物小传；必须服从大纲、角色认知、正史规则和情节因果。"
  const skillSlug = id === "builtin-zhang-xuefeng" ? "zhangxuefeng" : id.replace("builtin-", "")
  return {
    id,
    builtIn: true,
    name,
    category,
    sourceNote: "系统内置人物灵魂，基于公开历史或公众形象抽象为小说创作灵魂。",
    corpus,
    styleDescription: expressionDna,
    behaviorRules: `${mentalModel}\n${decisionHeuristics}`,
    boundaries: honestyBoundaries,
    notes: valueAntiPatterns,
    expressionDna,
    mentalModel,
    decisionHeuristics,
    valueAntiPatterns,
    honestyBoundaries,
    skillFolder: `NvwaSKILL/examples/${skillSlug}-perspective`,
  }
}

export async function loadCharacterAuraStore(projectPath: string): Promise<CharacterAuraStore> {
  try {
    const raw = await readFile(storePath(projectPath))
    const parsed = JSON.parse(raw) as Partial<CharacterAuraStore>
    return {
      customAuras: Array.isArray(parsed.customAuras) ? parsed.customAuras : [],
      bindings: Array.isArray(parsed.bindings) ? parsed.bindings : [],
    }
  } catch {
    return { customAuras: [], bindings: [] }
  }
}

export async function saveCharacterAuraStore(projectPath: string, store: CharacterAuraStore): Promise<void> {
  await writeFileAtomic(storePath(projectPath), JSON.stringify(store, null, 2))
}

export async function listCharacterAuras(projectPath: string): Promise<CharacterAura[]> {
  const store = await loadCharacterAuraStore(projectPath)
  return [...BUILT_IN_CHARACTER_AURAS, ...store.customAuras]
}

export async function createCustomCharacterAura(projectPath: string, input: CharacterAuraInput): Promise<CharacterAura> {
  const store = await loadCharacterAuraStore(projectPath)
  const now = Date.now()
  const aura: CharacterAura = {
    id: `custom-${now}-${Math.random().toString(36).slice(2, 8)}`,
    builtIn: false,
    ...input,
    createdAt: now,
    updatedAt: now,
  }
  store.customAuras.push(aura)
  await saveCharacterAuraStore(projectPath, store)
  return aura
}

export async function createCustomCharacterAuraSkill(
  projectPath: string,
  input: CustomCharacterAuraSkillInput,
  options: CharacterAuraGenerationOptions = {},
): Promise<CharacterAura> {
  const store = await loadCharacterAuraStore(projectPath)
  const now = Date.now()
  const id = `custom-${now}-${Math.random().toString(36).slice(2, 8)}`
  const skillFolder = `${normalizePath(projectPath)}/.qmai/character-auras/${safeSkillSlug(id, input.name)}-perspective`
  const totalSteps = 2 + AURA_WORKFLOW_STAGES.length + 2
  let progressStep = 0
  const emitProgress = (stage: string, detail: string, researchFileName?: CharacterAuraResearchFileName) => {
    progressStep += 1
    options.onProgress?.({ step: progressStep, total: totalSteps, stage, detail, researchFileName })
  }

  emitProgress("准备资料", "正在读取你提供的文本、网页和本地文档。")
  const localDocuments = await readCustomAuraLocalDocuments(input)
  const urlDocuments = await readCustomAuraUrls(input)
  const generationInput: CustomCharacterAuraGenerationInput = {
    ...input,
    ...localDocuments,
    ...urlDocuments,
    searchQueries: [],
    webSearchResults: [],
    importedSearchDocuments: [],
    failedSearchUrls: [],
    generationNotes: [],
  }

  emitProgress(
    input.enableWebSearch ? "AI 搜索" : "跳过 AI 搜索",
    input.enableWebSearch
      ? "正在根据角色名称和提示词检索联网资料。"
      : "当前仅基于你提供的资料生成，不启用联网搜索。",
  )
  const searchPack = input.enableWebSearch
    ? await collectCustomAuraWebSearch(input)
    : { searchQueries: [], webSearchResults: [], importedSearchDocuments: [], failedSearchUrls: [], generationNotes: [] }
  generationInput.searchQueries = searchPack.searchQueries
  generationInput.webSearchResults = searchPack.webSearchResults
  generationInput.importedSearchDocuments = searchPack.importedSearchDocuments
  generationInput.failedSearchUrls = searchPack.failedSearchUrls
  generationInput.generationNotes = searchPack.generationNotes

  const workflowResearchFiles: Partial<Record<CharacterAuraResearchFileName, string>> = {}
  for (const stage of AURA_WORKFLOW_STAGES) {
    emitProgress(stage.label, `正在生成 ${stage.label}，写入 ${stage.fileName}。`, stage.fileName)
    workflowResearchFiles[stage.fileName] = await buildAuraResearchStage(stage, generationInput, workflowResearchFiles)
  }

  emitProgress("汇总灵魂", "正在把 6 份研究文件合成为角色灵魂核心字段。")
  const generated = await synthesizeCustomAuraFields(generationInput, workflowResearchFiles)
  const aura: CharacterAura = {
    id,
    builtIn: false,
    name: input.name,
    category: input.category || "自定义灵魂",
    sourceNote: generated.sourceNote,
    corpus: buildStoredCorpus(generationInput),
    styleDescription: generated.styleDescription,
    behaviorRules: generated.behaviorRules,
    boundaries: generated.boundaries,
    notes: generated.notes,
    expressionDna: generated.expressionDna,
    mentalModel: generated.mentalModel,
    decisionHeuristics: generated.decisionHeuristics,
    valueAntiPatterns: generated.valueAntiPatterns,
    honestyBoundaries: generated.honestyBoundaries,
    sourceUrls: input.sourceUrls ?? "",
    localDocumentPaths: input.localDocumentPaths ?? "",
    generationPrompt: input.generationPrompt ?? "",
    webSearchEnabled: Boolean(input.enableWebSearch),
    skillFolder,
    createdAt: now,
    updatedAt: now,
  }
  const skillMarkdown = customSkillMarkdown(aura, generationInput, workflowResearchFiles)
  await createDirectory(skillFolder)
  await createDirectory(joinPath(skillFolder, "references", "research"))
  emitProgress("保存结果", "正在写入灵魂文档和 6 份研究文件。")
  await writeFileAtomic(joinPath(skillFolder, "SKILL.md"), skillMarkdown)
  for (const file of CHARACTER_AURA_RESEARCH_FILES) {
    await writeFileAtomic(
      joinPath(skillFolder, "references", "research", file.fileName),
      workflowResearchFiles[file.fileName] ?? customResearchMarkdown(aura, generationInput, file.fileName),
    )
  }
  store.customAuras.push(aura)
  await saveCharacterAuraStore(projectPath, store)
  return aura
}

/**
 * 由已生成的拆书 Skill 创建自定义灵魂（feature/book-analysis-6d-skill）
 *
 * 区别于 createCustomCharacterAuraSkill：本函数不再调用 LLM，
 * 假定 skillContent 和 researchFiles 已经由 6 维度分析生成完毕，
 * 只负责把结果落盘到 <projectPath>/.qmai/character-auras/<id>-perspective/。
 */
export async function createCustomCharacterAuraFromGeneratedSkill(
  projectPath: string,
  input: GeneratedCharacterAuraSkillInput,
): Promise<CharacterAura> {
  const store = await loadCharacterAuraStore(projectPath)
  const now = Date.now()
  const id = `custom-${now}-${Math.random().toString(36).slice(2, 8)}`
  const skillFolder = `${normalizePath(projectPath)}/.qmai/character-auras/${safeSkillSlug(id, input.name)}-perspective`
  const aura: CharacterAura = {
    id,
    builtIn: false,
    name: input.name,
    category: input.category || "拆书角色",
    sourceNote: input.sourceNote,
    corpus: input.corpus,
    styleDescription: input.styleDescription,
    behaviorRules: input.behaviorRules,
    boundaries: input.boundaries,
    notes: input.notes,
    expressionDna: input.expressionDna,
    mentalModel: input.mentalModel,
    decisionHeuristics: input.decisionHeuristics,
    valueAntiPatterns: input.valueAntiPatterns,
    honestyBoundaries: input.honestyBoundaries,
    generationPrompt: input.generationPrompt ?? "",
    webSearchEnabled: false,
    skillFolder,
    createdAt: now,
    updatedAt: now,
  }
  await createDirectory(skillFolder)
  await createDirectory(joinPath(skillFolder, "references", "research"))
  await writeFileAtomic(joinPath(skillFolder, "SKILL.md"), input.skillContent)
  const researchFiles = input.researchFiles ?? {}
  // 写已提供的 6 份研究文件；缺失文件用空 markdown 兜底，避免下游读不到
  for (const file of CHARACTER_AURA_RESEARCH_FILES) {
    const content = researchFiles[file.fileName]
    await writeFileAtomic(
      joinPath(skillFolder, "references", "research", file.fileName),
      content ?? `# ${input.name} - ${file.label}\n\n（拆书分析未提供该维度）\n`,
    )
  }
  store.customAuras.push(aura)
  await saveCharacterAuraStore(projectPath, store)
  return aura
}

export async function updateCustomCharacterAura(projectPath: string, auraId: string, patch: Partial<CharacterAuraInput>): Promise<CharacterAura> {
  const store = await loadCharacterAuraStore(projectPath)
  const index = store.customAuras.findIndex((aura) => aura.id === auraId)
  if (index < 0) throw new Error("未找到自定义灵魂")
  const updated = { ...store.customAuras[index], ...patch, builtIn: false, updatedAt: Date.now() }
  store.customAuras[index] = updated
  await saveCharacterAuraStore(projectPath, store)
  await syncStoredCustomAuraFiles(updated)
  return updated
}

export async function deleteCustomCharacterAura(projectPath: string, auraId: string): Promise<CharacterAuraStore> {
  const store = await loadCharacterAuraStore(projectPath)
  const nextStore = {
    customAuras: store.customAuras.filter((aura) => aura.id !== auraId),
    bindings: store.bindings.filter((binding) => binding.auraId !== auraId),
  }
  await saveCharacterAuraStore(projectPath, nextStore)
  return nextStore
}

export async function bindCharacterAura(projectPath: string, binding: CharacterAuraBinding): Promise<CharacterAuraStore> {
  const store = await loadCharacterAuraStore(projectPath)
  const allAuras = [...BUILT_IN_CHARACTER_AURAS, ...store.customAuras]
  if (!allAuras.some((aura) => aura.id === binding.auraId)) throw new Error(CHARACTER_AURA_INVALID_AURA_MESSAGE)
  const characterName = binding.characterName.trim()
  const hasProfile = await hasCharacterProfile(projectPath, characterName)
  if (!hasProfile) throw new Error(CHARACTER_AURA_BINDING_BLOCK_MESSAGE)
  const nextBinding = { ...binding, characterName }
  const existingIndex = store.bindings.findIndex((item) => item.characterName === characterName)
  const bindings = existingIndex >= 0
    ? store.bindings.map((item, index) => (index === existingIndex ? nextBinding : item))
    : [...store.bindings, nextBinding]
  const nextStore = { ...store, bindings }
  await saveCharacterAuraStore(projectPath, nextStore)
  return nextStore
}

export async function unbindCharacterAura(
  projectPath: string,
  characterName: string,
  auraId?: string,
): Promise<CharacterAuraStore> {
  const store = await loadCharacterAuraStore(projectPath)
  const normalizedCharacterName = characterName.trim()
  const bindings = store.bindings.filter((binding) => {
    if (binding.characterName !== normalizedCharacterName) return true
    if (auraId && binding.auraId !== auraId) return true
    return false
  })
  const nextStore = { ...store, bindings }
  await saveCharacterAuraStore(projectPath, nextStore)
  return nextStore
}

export async function getCharacterAuraBindings(projectPath: string): Promise<CharacterAuraBinding[]> {
  return (await loadCharacterAuraStore(projectPath)).bindings
}

export const CHARACTER_AURA_RESEARCH_FILES = [
  { fileName: "01-writings.md", label: "01 公开资料" },
  { fileName: "02-conversations.md", label: "02 对话方式" },
  { fileName: "03-expression-dna.md", label: "03 表达特征" },
  { fileName: "04-external-views.md", label: "04 外部评价" },
  { fileName: "05-decisions.md", label: "05 决策记录" },
  { fileName: "06-timeline.md", label: "06 时间线" },
] as const

export type CharacterAuraResearchFileName = typeof CHARACTER_AURA_RESEARCH_FILES[number]["fileName"]

export async function loadCharacterAuraSkillDocument(aura: CharacterAura, projectPath?: string): Promise<string> {
  if (!aura.skillFolder) return ""
  return readSkillFileWithFallback(joinPath(aura.skillFolder, "SKILL.md"), projectPath)
}

export async function loadCharacterAuraResearchDocument(aura: CharacterAura, fileName: CharacterAuraResearchFileName, projectPath?: string): Promise<string> {
  if (!aura.skillFolder) return ""
  return readSkillFileWithFallback(joinPath(aura.skillFolder, "references", "research", fileName), projectPath)
}

async function buildCompressedSkillSummary(aura: CharacterAura): Promise<string[]> {
  if (!aura.skillFolder) return []
  const lines: string[] = []
  let skillReadFailed = false
  let researchReadFailed = false
  try {
    const skill = await loadCharacterAuraSkillDocument(aura)
    const summary = compressMarkdownForAuraContext(skill, 700)
    if (summary) lines.push(`  - 灵魂文档压缩摘要：${summary}`)
  } catch {
    skillReadFailed = true
  }
  const researchSummaries: string[] = []
  for (const file of CHARACTER_AURA_RESEARCH_FILES) {
    try {
      const document = await loadCharacterAuraResearchDocument(aura, file.fileName)
      const summary = compressMarkdownForAuraContext(document, 220)
      if (summary) researchSummaries.push(`${file.label}：${summary}`)
    } catch {
      researchReadFailed = true
    }
  }
  if (researchSummaries.length > 0) lines.push(`  - 研究文件压缩摘要：${researchSummaries.join("；")}`)
  if (skillReadFailed || researchReadFailed) lines.push("  - 灵魂文档读取失败，已降级使用结构化灵魂字段。")
  return lines
}

function compressMarkdownForAuraContext(markdown: string, maxLength: number): string {
  const cleanedLines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("---") && !line.startsWith("name:") && !line.startsWith("description:"))
  const structuredLines = cleanedLines.filter((line) => line.startsWith("#") || line.startsWith("-") || line.includes("：") || line.includes(":"))
  const sourceLines = structuredLines.length > 0 ? structuredLines : cleanedLines
  const compact = sourceLines.join(" ").replace(/\s+/g, " ").slice(0, maxLength)
  return compact.length === maxLength ? `${compact}…` : compact
}

export async function buildCharacterAuraContext(
  projectPath: string,
  task: string,
  options: BuildCharacterAuraContextOptions = {},
): Promise<string> {
  const store = await loadCharacterAuraStore(projectPath)
  if (store.bindings.length === 0) return ""
  const allAuras = [...BUILT_IN_CHARACTER_AURAS, ...store.customAuras]
  const matchingText = [task, options.matchingText ?? ""].filter(Boolean).join("\n")
  const normalizedTask = normalizeCharacterText(matchingText)
  const tokens = new Set(matchingText.split(/[\s，。、『』《》：:；;,.!?！？\-]+/).filter(Boolean))
  const matched = store.bindings.filter((binding) => {
    const normalizedName = normalizeCharacterText(binding.characterName)
    return (
      matchingText.includes(binding.characterName)
      || tokens.has(binding.characterName)
      || (normalizedName.length > 0 && normalizedTask.includes(normalizedName))
    )
  })
  const effectiveMatched = matched.length > 0 || !options.fallbackAuraId
    ? matched
    : store.bindings.filter((binding) => binding.auraId === options.fallbackAuraId)
  if (effectiveMatched.length === 0) return ""
  if (options.previewMode === "writing") {
    return buildCharacterAuraWritingPreview(task, effectiveMatched, allAuras)
  }
  const lines: string[] = []
  for (const binding of effectiveMatched) {
    const aura = allAuras.find((item) => item.id === binding.auraId)
    if (!aura) continue
    lines.push(
      `- ${binding.characterName}：${aura.name}`,
      `  - 人物分类：${aura.category ?? "自定义灵魂"}`,
      `  - 灵魂摘要：${aura.styleDescription}`,
      `  - 怎么说话 / 表达特征：${aura.expressionDna ?? aura.corpus}`,
      `  - 怎么想 / 心智模型：${aura.mentalModel ?? aura.styleDescription}`,
      `  - 怎么判断 / 决策启发式：${aura.decisionHeuristics ?? aura.behaviorRules}`,
      `  - 什么不做 / 价值观反模式：${aura.valueAntiPatterns ?? aura.notes}`,
      `  - 知道局限 / 诚实边界：${aura.honestyBoundaries ?? aura.boundaries}`,
      ...(await buildCompressedSkillSummary(aura)),
    )
  }
  if (lines.length === 0) return ""
  lines.push("- 角色灵魂必须服从大纲、人物小传、角色认知和正史规则，不得覆盖或改写硬性设定。")
  return lines.join("\n")
}

function buildCharacterAuraWritingPreview(
  task: string,
  bindings: CharacterAuraBinding[],
  allAuras: CharacterAura[],
): string {
  const normalizedTask = task.trim()
  const sections = bindings
    .map((binding) => {
      const aura = allAuras.find((item) => item.id === binding.auraId)
      if (!aura) return ""
      const expression = summarizeAuraPreviewField(aura.expressionDna ?? aura.styleDescription)
      const mental = summarizeAuraPreviewField(aura.mentalModel ?? aura.corpus)
      const decision = summarizeAuraPreviewField(aura.decisionHeuristics ?? aura.behaviorRules)
      const avoid = summarizeAuraPreviewField(aura.valueAntiPatterns ?? aura.notes)
      return [
        `【本次写作会怎样塑造「${binding.characterName}」】`,
        `这段内容只借用这类灵魂的气质、语气、判断方式和表达倾向来塑造「${binding.characterName}」，不会把灵魂原型的人生经历、时代背景、历史使命或成就直接写进正文。`,
        `任务场景：${normalizedTask}`,
        "",
        "【会体现哪些风格影响】",
        `- 表达方式：${expression}`,
        `- 思考方式：${mental}`,
        `- 决策方式：${decision}`,
        `- 写作时要避免：${avoid}`,
        "",
        "【示例写法】",
        buildCharacterAuraPreviewExcerpt(binding.characterName, normalizedTask, aura),
      ].join("\n")
    })
    .filter(Boolean)
  return sections.join("\n\n")
}

function summarizeAuraPreviewField(value: string | undefined): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim()
  if (!normalized) return "保持当前任务需要的角色状态，不额外偏离剧情目标。"
  const sentence = normalized.split(/[。！？!?]/).map((part) => part.trim()).find(Boolean) ?? normalized
  return sentence
}

function buildCharacterAuraPreviewExcerpt(characterName: string, task: string, aura: CharacterAura): string {
  const expression = summarizeAuraPreviewField(aura.expressionDna ?? aura.styleDescription)
  const decision = summarizeAuraPreviewField(aura.decisionHeuristics ?? aura.behaviorRules)
  return `这段剧情里，${characterName}会先贴住当前场景和关系变化来行动，不额外补写灵魂原型的个人经历或历史包袱。围绕「${task}」这个任务，落笔时会更强调${expression}；真正做决定时，会更明显体现出${decision}，让角色呈现出稳定一致的气质和表达倾向。`
}

async function hasCharacterProfile(projectPath: string, characterName: string): Promise<boolean> {
  const knownCharacters = await listBindableNovelCharacters(projectPath)
  const normalizedTarget = normalizeCharacterText(characterName)
  if (knownCharacters.some((name) => normalizeCharacterText(name) === normalizedTarget)) return true
  const results = await searchWiki(projectPath, `${characterName} 人物小传 人物设定`)
  for (const result of results) {
    const text = [result.title, result.snippet].join("\n")
    if (/人物小传|人物设定/.test(text) && text.includes(characterName)) return true
    try {
      const content = await readFile(result.path)
      if (/人物小传|人物设定/.test(content) && content.includes(characterName)) return true
    } catch {}
  }
  return false
}

function extractEntityTags(fm: Record<string, FrontmatterValue> | null): string[] {
  if (!fm) return []
  const tags = fm.tags
  if (!tags) return []
  if (Array.isArray(tags)) return tags.map((t) => String(t).trim().toLowerCase())
  return String(tags).split(",").map((t) => t.trim().toLowerCase())
}

function isCharacterEntityContent(content: string): boolean {
  const { frontmatter } = parseFrontmatter(content)
  if (!frontmatter) return false
  if (frontmatter.type !== "entity") return false
  const tags = extractEntityTags(frontmatter)
  return tags.includes("character")
}

export async function listBindableNovelCharacters(projectPath: string): Promise<string[]> {
  const pp = normalizePath(projectPath)
  const names = new Set<string>()

  const addName = (value: string | null | undefined) => {
    const trimmed = value?.trim()
    if (!trimmed || trimmed.length > 40) return
    if (IGNORE_BINDABLE_CHARACTER_NAMES.has(trimmed)) return
    names.add(trimmed)
  }

  try {
    const entityTree = await listDirectory(`${pp}/wiki/entities`)
    for (const file of flattenMarkdownNodes(entityTree)) {
      try {
        const content = await readFile(file.path)
        if (!isCharacterEntityContent(content)) continue
        addName(extractPrimaryTitle(content, file.name))
      } catch {
        // Skip entities that can't be read.
      }
    }
  } catch {
    // Projects may not have entity pages yet.
  }

  try {
    const outlineTree = await listDirectory(`${pp}/wiki/outlines`)
    for (const file of flattenMarkdownNodes(outlineTree)) {
      try {
        const content = await readFile(file.path)
        const pageTitle = extractPrimaryTitle(content, file.name)
        if (!isCharacterOutlineFile(file.path, pageTitle, content)) continue
        const extractedNames = extractCharacterNamesFromOutline(content)
        if (extractedNames.length === 0) {
          addName(pageTitle)
          continue
        }
        for (const characterName of extractedNames) {
          addName(characterName)
        }
      } catch {
        // Keep the dropdown resilient when a single outline page is broken.
      }
    }
  } catch {
    // Projects may not have outline pages yet.
  }

  return [...names].sort((left, right) => left.localeCompare(right, "zh-CN"))
}

async function readSkillFileWithFallback(filePath: string, projectPath?: string): Promise<string> {
  try {
    return await readFile(filePath)
  } catch (error) {
    const roots: string[] = []
    
    // 项目目录
    if (projectPath) {
      roots.push(normalizePath(projectPath))
    }
    
    // Tauri 环境：尝试获取可执行文件目录和资源目录
    if (isTauri()) {
      try {
        const { getExecutableDir, getResourceDir } = await import("@/commands/fs")
        try {
          const exeDir = await getExecutableDir()
          roots.push(exeDir)
          // 便携版：NvwaSKILL 直接在 exe 旁边
          // 安装版：NvwaSKILL 在 exe 目录下的 _up_ 子目录中
          roots.push(joinPath(exeDir, "_up_"))
          // 也尝试 exe 的上一级目录
          const parentDir = exeDir.replace(/[\\/][^\\/]+[\\/]?$/, "")
          if (parentDir && parentDir !== exeDir) roots.push(parentDir)
        } catch {}
        try {
          const resDir = await getResourceDir()
          roots.push(resDir)
          // Tauri NSIS 安装版把 ../NvwaSKILL 放到 _up_/NvwaSKILL
          roots.push(joinPath(resDir, "_up_"))
        } catch {}
      } catch {}

      try {
        const { resourceDir } = await import("@tauri-apps/api/path")
        try {
          const resDir = await resourceDir()
          roots.push(resDir)
          roots.push(joinPath(resDir, "_up_"))
        } catch {}
      } catch {}
    }
    
    // 去重
    const uniqueRoots = [...new Set(roots.filter(Boolean))]
    
    for (const root of uniqueRoots) {
      if (!root) continue
      try {
        const fullPath = joinPath(root, filePath)
        return await readFile(fullPath)
      } catch {}
    }
    
    throw error
  }
}

function safeSkillSlug(id: string, name: string): string {
  const cleanedName = name.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-+|-+$/g, "")
  return cleanedName ? `${id}-${cleanedName}` : id
}

async function readCustomAuraLocalDocuments(input: CustomCharacterAuraSkillInput): Promise<Pick<CustomCharacterAuraGenerationInput, "importedDocuments" | "failedDocuments">> {
  const importedDocuments: LocalDocumentImportResult[] = []
  const failedDocuments: string[] = []
  for (const path of splitSourceLines(input.localDocumentPaths)) {
    try {
      const content = await readFile(path)
      importedDocuments.push({ path, content })
    } catch {
      failedDocuments.push(path)
    }
  }
  return { importedDocuments, failedDocuments }
}

async function readCustomAuraUrls(input: CustomCharacterAuraSkillInput): Promise<Pick<CustomCharacterAuraGenerationInput, "importedUrls" | "failedUrls">> {
  const importedUrls: UrlDocumentImportResult[] = []
  const failedUrls: string[] = []
  const urls = splitSourceLines(input.sourceUrls)
  if (urls.length === 0) return { importedUrls, failedUrls }
  let httpFetch: typeof fetch
  try {
    httpFetch = await getHttpFetch()
  } catch {
    return { importedUrls, failedUrls: urls }
  }
  for (const url of urls) {
    try {
      const response = await httpFetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const raw = await response.text()
      const content = htmlToPlainText(raw)
      if (!content) throw new Error("empty content")
      importedUrls.push({ url, content })
    } catch {
      failedUrls.push(url)
    }
  }
  return { importedUrls, failedUrls }
}

async function collectCustomAuraWebSearch(
  input: CustomCharacterAuraSkillInput,
): Promise<Pick<CustomCharacterAuraGenerationInput, "searchQueries" | "webSearchResults" | "importedSearchDocuments" | "failedSearchUrls" | "generationNotes">> {
  const generationNotes: string[] = []
  const searchQueries = planCustomAuraSearchQueries(input)
  const webSearchResults: WebSearchResult[] = []
  const failedSearchUrls: string[] = []
  const importedSearchDocuments: SearchDocumentImportResult[] = []
  if (searchQueries.length === 0) {
    return { searchQueries, webSearchResults, importedSearchDocuments, failedSearchUrls, generationNotes }
  }

  const searchApiConfig = useWikiStore.getState().searchApiConfig
  for (const query of searchQueries.slice(0, 3)) {
    try {
      const results = await webSearch(query, searchApiConfig, 4)
      webSearchResults.push(...results.map((result) => ({ ...result, snippet: result.snippet.trim() })))
    } catch (error) {
      generationNotes.push(`AI 搜索「${query}」失败：${error instanceof Error ? error.message : "未知错误"}`)
      if (String(error).includes("not configured")) break
    }
  }

  const uniqueResults = dedupeWebSearchResults(webSearchResults).slice(0, 6)
  const imported = await readWebSearchDocuments(uniqueResults, searchQueries)
  importedSearchDocuments.push(...imported.importedSearchDocuments)
  failedSearchUrls.push(...imported.failedSearchUrls)
  if (uniqueResults.length === 0) {
    generationNotes.push("AI 搜索没有拿到可用结果，本次继续只使用你提供的资料。")
  }
  return { searchQueries, webSearchResults: uniqueResults, importedSearchDocuments, failedSearchUrls, generationNotes }
}

function planCustomAuraSearchQueries(input: CustomCharacterAuraSkillInput): string[] {
  const subject = [input.name.trim(), input.category?.trim()].filter(Boolean).join(" ")
  const prompt = (input.generationPrompt ?? "").trim()
  const promptPart = prompt ? ` ${prompt}` : ""
  const queries = [
    `${subject}${promptPart} 公开资料 人物经历`,
    `${subject}${promptPart} 说话风格 评价`,
    `${subject}${promptPart} 关键事件 时间线 决策`,
  ]
  return [...new Set(queries.map((item) => item.trim()).filter(Boolean))]
}

function dedupeWebSearchResults(results: WebSearchResult[]): WebSearchResult[] {
  const seen = new Set<string>()
  const output: WebSearchResult[] = []
  for (const result of results) {
    const key = result.url.trim() || `${result.title}-${result.source}`
    if (!key || seen.has(key)) continue
    seen.add(key)
    output.push(result)
  }
  return output
}

async function readWebSearchDocuments(
  results: WebSearchResult[],
  searchQueries: string[],
): Promise<Pick<CustomCharacterAuraGenerationInput, "importedSearchDocuments" | "failedSearchUrls">> {
  const importedSearchDocuments: SearchDocumentImportResult[] = []
  const failedSearchUrls: string[] = []
  if (results.length === 0) return { importedSearchDocuments, failedSearchUrls }
  let httpFetch: typeof fetch
  try {
    httpFetch = await getHttpFetch()
  } catch {
    return { importedSearchDocuments, failedSearchUrls: results.map((result) => result.url) }
  }

  for (const result of results.slice(0, 4)) {
    try {
      const response = await httpFetch(result.url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const raw = await response.text()
      const content = htmlToPlainText(raw)
      if (!content) throw new Error("empty content")
      importedSearchDocuments.push({
        query: searchQueries.find((query) => result.title.includes(query) || result.snippet.includes(query)) ?? searchQueries[0] ?? "",
        title: result.title,
        url: result.url,
        source: result.source,
        snippet: result.snippet,
        content,
      })
    } catch {
      failedSearchUrls.push(result.url)
    }
  }
  return { importedSearchDocuments, failedSearchUrls }
}

async function buildAuraResearchStage(
  stage: AuraWorkflowStage,
  input: CustomCharacterAuraGenerationInput,
  previousResearchFiles: Partial<Record<CharacterAuraResearchFileName, string>>,
): Promise<string> {
  const llmConfig = useWikiStore.getState().llmConfig
  if (hasUsableLlm(llmConfig)) {
    try {
      const raw = await runAuraModelPrompt(
        "你是一名小说角色灵魂研究工作流助手。必须只输出用户要求的 Markdown 正文，不要输出解释，不要输出代码围栏。",
        buildAuraResearchStagePrompt(stage, input, previousResearchFiles),
      )
      if (raw.trim()) return ensureResearchMarkdownShape(raw, stage, input.name)
    } catch (error) {
      input.generationNotes.push(`${stage.label} 生成失败，已降级为模板生成：${error instanceof Error ? error.message : "未知错误"}`)
    }
  }
  return buildAuraResearchStageFallback(stage, input, previousResearchFiles)
}

async function synthesizeCustomAuraFields(
  input: CustomCharacterAuraGenerationInput,
  researchFiles: Partial<Record<CharacterAuraResearchFileName, string>>,
): Promise<CustomAuraGeneratedFields> {
  const llmConfig = useWikiStore.getState().llmConfig
  if (hasUsableLlm(llmConfig)) {
    try {
      const raw = await runAuraModelPrompt(
        "你是一名小说角色灵魂总结助手。只输出 JSON，不要解释，不要代码围栏。",
        buildAuraSynthesisPrompt(input, researchFiles),
      )
      return parseCustomAuraSummaryResult(raw)
    } catch (error) {
      input.distillationFallbackNote = `灵魂汇总失败，已降级为结构化模板总结：${error instanceof Error ? error.message : "未知错误"}`
    }
  }
  return buildFallbackCustomAuraFields(input, researchFiles)
}

async function runAuraModelPrompt(systemPrompt: string, userPrompt: string): Promise<string> {
  const llmConfig = useWikiStore.getState().llmConfig
  let result = ""
  let streamError: Error | null = null
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]
  await streamChat(llmConfig, messages, {
    onToken: (token) => { result += token },
    onDone: () => {},
    onError: (error) => { streamError = error },
  })
  if (streamError) throw streamError
  return result.trim()
}

function buildAuraResearchStagePrompt(
  stage: AuraWorkflowStage,
  input: CustomCharacterAuraGenerationInput,
  previousResearchFiles: Partial<Record<CharacterAuraResearchFileName, string>>,
): string {
  const title = stageDisplayTitle(stage)
  const sections = stage.sections.map((section) => `## ${section}`).join("\n")
  const material = buildAuraStageMaterial(stage, input, previousResearchFiles)
  return [
    `请为小说角色灵魂工作流生成第 ${stage.label} 份研究文件。`,
    "",
    "直接输出 Markdown，不要输出代码围栏，不要解释。",
    "",
    `标题必须是：# ${input.name} - ${title}`,
    sections,
    "",
    "硬性要求：",
    "1. 每个小节都要写实质内容，至少 2 到 4 句，或 3 到 5 条要点。",
    "2. 资料不足时，要明确写出「基于现有资料的推断」和「待补充信息」，不能只写一句空话。",
    "3. 不冒充真人，不把未经证实的信息写成确定事实。",
    "4. 这份研究文件是给小说创作服务的，所以要把资料转译成可写作、可表演、可决策的内容。",
    "5. 如果启用了 AI 搜索，可以吸收搜索结果，但要区分原始资料、外部线索和推断。",
    "",
    `角色名称：${input.name}`,
    `人物分类：${input.category?.trim() || "自定义灵魂"}`,
    `生成提示词：${input.generationPrompt?.trim() || "未提供"}`,
    `AI 搜索：${input.enableWebSearch ? "已开启" : "未开启"}`,
    `本阶段目标：${stage.goal}`,
    "",
    "资料：",
    material,
  ].join("\n")
}

function buildAuraStageMaterial(
  stage: AuraWorkflowStage,
  input: CustomCharacterAuraGenerationInput,
  previousResearchFiles: Partial<Record<CharacterAuraResearchFileName, string>>,
): string {
  const blocks = [
    input.corpus?.trim() ? `【用户资料文本】\n${clipText(input.corpus.trim(), 2800)}` : "",
    input.importedDocuments.length > 0
      ? `【本地文档摘录】\n${input.importedDocuments.map((document) => `- ${document.path}\n${clipText(document.content, 1000)}`).join("\n\n")}`
      : "",
    input.importedUrls.length > 0
      ? `【用户网页摘录】\n${input.importedUrls.map((document) => `- ${document.url}\n${clipText(document.content, 1000)}`).join("\n\n")}`
      : "",
    input.webSearchResults.length > 0
      ? `【AI 搜索结果摘要】\n${input.webSearchResults.map((result, index) => `${index + 1}. ${result.title} | ${result.source}\n链接：${result.url}\n摘要：${clipText(result.snippet, 240)}`).join("\n\n")}`
      : "",
    input.importedSearchDocuments.length > 0
      ? `【AI 搜索网页正文摘录】\n${input.importedSearchDocuments.map((document) => `- ${document.title}\n链接：${document.url}\n${clipText(document.content, 900)}`).join("\n\n")}`
      : "",
    Object.keys(previousResearchFiles).length > 0
      ? `【已生成的前序研究文件】\n${Object.entries(previousResearchFiles).map(([fileName, content]) => `### ${fileName}\n${clipText(content ?? "", 900)}`).join("\n\n")}`
      : "",
    input.generationNotes.length > 0
      ? `【生成备注】\n${input.generationNotes.map((note) => `- ${note}`).join("\n")}`
      : "",
    `【当前阶段】${stage.label}`,
  ]
  return blocks.filter(Boolean).join("\n\n").slice(0, 18000)
}

function ensureResearchMarkdownShape(markdown: string, stage: AuraWorkflowStage, name: string): string {
  const trimmed = markdown.trim()
  if (!trimmed) return buildAuraResearchStageFallback(stage, {
    name,
    category: "",
    corpus: "",
    sourceUrls: "",
    localDocumentPaths: "",
    generationPrompt: "",
    enableWebSearch: false,
    importedDocuments: [],
    failedDocuments: [],
    importedUrls: [],
    failedUrls: [],
    searchQueries: [],
    webSearchResults: [],
    importedSearchDocuments: [],
    failedSearchUrls: [],
    generationNotes: [],
  }, {})
  if (trimmed.startsWith("# ")) return trimmed
  return `# ${name} - ${stageDisplayTitle(stage)}\n\n${trimmed}`
}

function buildAuraResearchStageFallback(
  stage: AuraWorkflowStage,
  input: CustomCharacterAuraGenerationInput,
  previousResearchFiles: Partial<Record<CharacterAuraResearchFileName, string>>,
): string {
  const title = stageDisplayTitle(stage)
  switch (stage.fileName) {
    case "01-writings.md":
      return [
        `# ${input.name} - ${title}`,
        "",
        "## 核心结论",
        `- 角色定位：${input.category?.trim() || "自定义灵魂"}。`,
        `- 提示词焦点：${input.generationPrompt?.trim() || "未提供，主要依靠用户资料归纳。"}。`,
        `- 资料来源：${input.enableWebSearch ? "用户资料 + AI 搜索补充" : "仅用户资料"}。`,
        "",
        "## 证据线索",
        buildSourceEvidenceList(input),
        "",
        "## 可写入小说的细节",
        `- 可优先借用的外在细节：${clipText(input.corpus?.trim() || "资料较少，建议补充公开经历、人物关系、代表事件和言行片段。", 260)}。`,
        input.importedSearchDocuments.length > 0
          ? `- 联网补充的外部线索显示：${clipText(input.importedSearchDocuments[0]?.content ?? "", 260)}。`
          : "- 若需要更像真人语感，建议补充公开讲话、采访、回忆录、旁人描述等材料。",
        "",
        "## 未确认点",
        `- 当前仍需补充：${buildMissingInputsHint(input)}。`,
        input.generationNotes.length > 0 ? input.generationNotes.map((note) => `- ${note}`).join("\n") : "- 若资料不足，后续小节会使用「基于现有资料的推断」进行扩写。",
        "",
        customSourceIndexMarkdown(input),
        "",
        urlDocumentContentMarkdown(input),
        "",
        localDocumentContentMarkdown(input),
        "",
        searchDocumentContentMarkdown(input),
      ].join("\n")
    case "02-conversations.md":
      return [
        `# ${input.name} - ${title}`,
        "",
        "## 说话节奏",
        `- 基于现有资料推断，这个角色的语言节奏应围绕「${input.generationPrompt?.trim() || input.name}」展开，优先保持稳定语气、明确立场和可辨识的节奏。`,
        `- 用户资料中的核心语料显示：${clipText(input.corpus?.trim() || "缺少直接对白素材，因此需要后续补充采访、对话摘录或公开讲话。", 240)}。`,
        "",
        "## 常用表达策略",
        "- 平静场景：先给判断，再给理由，避免空泛抒情。",
        "- 压迫场景：句子更短，语气更硬，优先表达底线与取舍。",
        "- 亲近场景：保留角色核心气质，但会露出更细的情绪纹理和关系判断。",
        "",
        "## 冲突中的说话方式",
        "- 不直接乱发火，而是先识别权力关系、利益位置和可承受代价。",
        previousResearchFiles["01-writings.md"]
          ? `- 结合公开资料可推断：${clipText(previousResearchFiles["01-writings.md"] ?? "", 220)}。`
          : "- 当前资料不足，建议后续补充冲突语境下的原始表达样本。",
        "",
        "## 示例句式",
        `- 「先把事情说清楚，再谈感情。」`,
        `- 「我不是没看见，只是还没到该翻牌的时候。」`,
        `- 「眼下最重要的，不是好不好听，而是能不能成。」`,
      ].join("\n")
    case "03-expression-dna.md":
      return [
        `# ${input.name} - ${title}`,
        "",
        "## 词汇偏好",
        `- 重点围绕提示词「${input.generationPrompt?.trim() || input.name}」构造词汇域，优先保留身份、权力、关系、代价、边界等高辨识度词汇。`,
        "",
        "## 情绪显影",
        "- 情绪不是直接喊出来，而是通过停顿、语序变化、措辞锋利度和信息选择显出来。",
        "- 资料不足时，可先把情绪线索写成「克制 / 迟疑 / 冷硬 / 温吞 / 试探」等层次，而不是只写「强势」或「温柔」。",
        "",
        "## 叙事镜头感",
        "- 适合抓取动作小细节、语气落点和他人反应来表现气场，而不是单靠概念形容词。",
        previousResearchFiles["02-conversations.md"]
          ? `- 对话方式可进一步支撑表达 DNA：${clipText(previousResearchFiles["02-conversations.md"] ?? "", 220)}。`
          : "- 若后续补充更多对白，可继续把常见句式、停顿习惯和回避话题补全进来。",
        "",
        "## 表达禁区",
        "- 不要把角色写成万能金句机器。",
        "- 不要让角色在不符合身份和情境时突然使用完全陌生的话语系统。",
      ].join("\n")
    case "04-external-views.md":
      return [
        `# ${input.name} - ${title}`,
        "",
        "## 支持者视角",
        "- 支持者通常更容易把角色的强势、克制、效率或承担解释成可靠与可托付。",
        previousResearchFiles["01-writings.md"]
          ? `- 可参考公开资料中的正面线索：${clipText(previousResearchFiles["01-writings.md"] ?? "", 220)}。`
          : "- 当前缺少正面旁观材料，建议补充采访、回忆、评价和传记型资料。",
        "",
        "## 对手视角",
        "- 对手更容易把同一套行为读成压迫、算计、冷酷、危险或难以预测。",
        "- 在小说中可通过对手的戒备、误判、恐惧和反制动作来呈现这个视角。",
        "",
        "## 旁观者视角",
        "- 旁观者评价往往最能体现「公共形象」，适合沉淀成角色出场时的第一印象。",
        input.importedSearchDocuments.length > 0
          ? `- AI 搜索补充的舆论线索：${clipText(input.importedSearchDocuments[0]?.snippet ?? "", 220)}。`
          : "- 当前没有足够的外部评价样本，可先用「传闻、印象、风评、名声」来构建出场氛围。",
        "",
        "## 争议点",
        "- 一个能支撑灵魂人物的角色，必须有可争议之处，而不是人人一致夸赞。",
        "- 争议点通常来自手段与目标的张力、亲密关系中的伤害、以及公众形象与私下动机的落差。",
      ].join("\n")
    case "05-decisions.md":
      return [
        `# ${input.name} - ${title}`,
        "",
        "## 核心优先级",
        "- 先判定当下要守住什么，再决定要牺牲什么。",
        `- 提示词强调的价值焦点：${input.generationPrompt?.trim() || "未提供，需要从资料中继续归纳"}。`,
        "",
        "## 高压下的选择",
        "- 压力越大，越会暴露真实优先级：保名声、保关系、保结果、保底线，还是保自己。",
        previousResearchFiles["04-external-views.md"]
          ? `- 外部评价能反推其决策代价：${clipText(previousResearchFiles["04-external-views.md"] ?? "", 220)}。`
          : "- 当前资料不足，建议补充角色在危机、冲突、背叛或资源紧缺时的真实选择案例。",
        "",
        "## 典型取舍",
        "- 在关系与结果冲突时，会先看长期后果还是眼前稳定。",
        "- 在规则与情感冲突时，会先守秩序还是先保具体的人。",
        "- 在信息不足时，更倾向试探、拖延、拍板，还是让别人先暴露。",
        "",
        "## 失败代价",
        "- 这个角色最怕的失败，往往正是他做选择时最先防御的东西。",
        "- 把失败代价写清楚，才能让灵魂人物在关键场景里做出有区分度的动作。",
      ].join("\n")
    case "06-timeline.md":
      return [
        `# ${input.name} - ${title}`,
        "",
        "## 起点",
        `- 当前可确认的起点线索：${clipText(input.corpus?.trim() || "资料较少，建议补充出身、初始处境、最早的关键关系与欲望。", 220)}。`,
        "",
        "## 关键转折",
        "- 把角色从旧状态推向新状态的事件，通常比外在履历更重要。",
        input.importedSearchDocuments.length > 0
          ? `- AI 搜索补充的关键事件线索：${clipText(input.importedSearchDocuments[0]?.content ?? "", 220)}。`
          : "- 当前仍缺关键事件链条，建议继续补充大事件、失去、获得、关系破裂与立场变化。",
        "",
        "## 关系变化",
        "- 时间线不只是事件顺序，更要写清楚每段关系什么时候发生方向性变化。",
        previousResearchFiles["05-decisions.md"]
          ? `- 决策记录可反推关系转折：${clipText(previousResearchFiles["05-decisions.md"] ?? "", 220)}。`
          : "- 若资料缺少关系信息，可先记录「谁塑造了他、谁限制了他、谁让他改变」。",
        "",
        "## 未来可延展线索",
        "- 为小说写作预留未完成的问题、未兑现的承诺、还没爆发的矛盾和可能回收的旧线索。",
        "- 这部分不是编造事实，而是从现有资料中找「仍然能继续长」的钩子。",
      ].join("\n")
    default:
      return `# ${input.name} - ${title}\n\n## 待补充\n- 当前阶段没有可用的默认模板。`
  }
}

function buildSourceEvidenceList(input: CustomCharacterAuraGenerationInput): string {
  const lines: string[] = []
  if (input.corpus?.trim()) lines.push(`- 用户资料文本：${clipText(input.corpus.trim(), 180)}`)
  for (const document of input.importedDocuments.slice(0, 3)) {
    lines.push(`- 本地文档 ${document.path}：${clipText(document.content, 180)}`)
  }
  for (const document of input.importedUrls.slice(0, 3)) {
    lines.push(`- 用户网页 ${document.url}：${clipText(document.content, 180)}`)
  }
  for (const result of input.webSearchResults.slice(0, 3)) {
    lines.push(`- AI 搜索 ${result.title}（${result.source}）：${clipText(result.snippet, 180)}`)
  }
  return lines.length > 0 ? lines.join("\n") : "- 当前没有可直接引用的资料，建议至少补充一段资料文本或几个可靠来源。"
}

function buildMissingInputsHint(input: CustomCharacterAuraGenerationInput): string {
  const missing: string[] = []
  if (!input.corpus?.trim()) missing.push("角色资料文本")
  if (input.importedDocuments.length === 0 && splitSourceLines(input.localDocumentPaths).length > 0) missing.push("可读取的本地文档正文")
  if (input.importedUrls.length === 0 && splitSourceLines(input.sourceUrls).length > 0) missing.push("可抓取的网页正文")
  if (input.enableWebSearch && input.webSearchResults.length === 0) missing.push("可用的 AI 搜索结果")
  return missing.length > 0 ? missing.join("、") : "更多可核实的公开经历、对话样本和时间线证据"
}

function buildAuraSynthesisPrompt(
  input: CustomCharacterAuraGenerationInput,
  researchFiles: Partial<Record<CharacterAuraResearchFileName, string>>,
): string {
  const titleBlocks = AURA_WORKFLOW_STAGES
    .map((stage) => `### ${stage.label}\n${clipText(researchFiles[stage.fileName] ?? "", 1800)}`)
    .join("\n\n")
  return [
    `请基于以下 6 份研究文件，为小说角色「${input.name}」总结出结构化角色灵魂。`,
    "",
    "只输出 JSON 对象，不要解释，不要代码围栏。",
    "字段必须包含：sourceNote、styleDescription、behaviorRules、boundaries、notes、expressionDna、mentalModel、decisionHeuristics、valueAntiPatterns、honestyBoundaries。",
    "每个字段都必须是内容饱满的中文字符串，不要只写一句泛话。",
    "behaviorRules、boundaries、notes、decisionHeuristics 等字段建议写成多行字符串，包含 3 到 6 条要点。",
    "如果资料不足，要明确说明哪些内容是基于现有资料的推断。",
    "",
    `人物分类：${input.category?.trim() || "自定义灵魂"}`,
    `生成提示词：${input.generationPrompt?.trim() || "未提供"}`,
    `AI 搜索：${input.enableWebSearch ? "已开启" : "未开启"}`,
    input.generationNotes.length > 0 ? `生成备注：\n${input.generationNotes.map((note) => `- ${note}`).join("\n")}` : "",
    "",
    titleBlocks,
  ].filter(Boolean).join("\n")
}

function parseCustomAuraSummaryResult(raw: string): CustomAuraGeneratedFields {
  const json = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? raw
  const objectText = json.match(/\{[\s\S]*\}/)?.[0]
  if (!objectText) throw new Error("模型未返回有效 JSON")
  const parsed = JSON.parse(objectText) as Partial<CustomAuraGeneratedFields>
  const required: Array<keyof CustomAuraGeneratedFields> = [
    "sourceNote",
    "styleDescription",
    "behaviorRules",
    "boundaries",
    "notes",
    "expressionDna",
    "mentalModel",
    "decisionHeuristics",
    "valueAntiPatterns",
    "honestyBoundaries",
  ]
  for (const key of required) {
    if (typeof parsed[key] !== "string" || !parsed[key]?.trim()) {
      throw new Error(`模型结果缺少 ${key}`)
    }
  }
  return {
    sourceNote: parsed.sourceNote!,
    styleDescription: parsed.styleDescription!,
    behaviorRules: parsed.behaviorRules!,
    boundaries: parsed.boundaries!,
    notes: parsed.notes!,
    expressionDna: parsed.expressionDna!,
    mentalModel: parsed.mentalModel!,
    decisionHeuristics: parsed.decisionHeuristics!,
    valueAntiPatterns: parsed.valueAntiPatterns!,
    honestyBoundaries: parsed.honestyBoundaries!,
  }
}

function buildFallbackCustomAuraFields(
  input: CustomCharacterAuraGenerationInput,
  researchFiles: Partial<Record<CharacterAuraResearchFileName, string>>,
): CustomAuraGeneratedFields {
  const writings = clipText(markdownToPlainText(researchFiles["01-writings.md"] ?? ""), 320)
  const conversations = clipText(markdownToPlainText(researchFiles["02-conversations.md"] ?? ""), 320)
  const expression = clipText(markdownToPlainText(researchFiles["03-expression-dna.md"] ?? ""), 320)
  const external = clipText(markdownToPlainText(researchFiles["04-external-views.md"] ?? ""), 320)
  const decisions = clipText(markdownToPlainText(researchFiles["05-decisions.md"] ?? ""), 320)
  const timeline = clipText(markdownToPlainText(researchFiles["06-timeline.md"] ?? ""), 320)
  const searchNote = input.enableWebSearch ? "本次生成同时参考了 AI 搜索补充资料。" : "本次生成仅依据你提供的资料。"
  const promptNote = input.generationPrompt?.trim() ? `提示词重点：${input.generationPrompt.trim()}` : "未提供额外提示词。"
  const fallbackNote = input.distillationFallbackNote ? `\n${input.distillationFallbackNote}` : ""
  return {
    sourceNote: `基于用户资料整理出的自定义人物灵魂。${searchNote}${promptNote}\n核心资料摘要：${writings || "当前可用资料仍然偏少，建议继续补充公开经历、对话样本与关系事件。"}${fallbackNote}`,
    styleDescription: `这个灵魂围绕「${input.name}」构建，强调其公开形象、说话方式、他人观感与决策习惯之间的连动。\n公开资料与外部评价显示：${writings || external || "当前仍以有限资料推断整体气质。"}\n写作时要优先保留其稳定气场、关系姿态与处事取向，而不是只抓一个标签。`,
    behaviorRules: [
      "写作行为规则：",
      `- 先服从人物小传、当前剧情目标和角色认知状态，再调用灵魂倾向。`,
      `- 决策执行时优先参考：${decisions || "资料不足时，先判断其要守住什么、愿意牺牲什么。"}。`,
      `- 对话执行时优先参考：${conversations || "先给判断，再给理由，保持稳定语气与身份感。"}。`,
      `- 叙述动作要让气质落在细节上，不要只写概念形容词。`,
    ].join("\n"),
    boundaries: [
      "安全与边界：",
      "- 不冒充真人，不把灵魂写成真人复刻。",
      "- 不照抄未授权文本，不把外部资料原句大段搬进小说。",
      "- 不覆盖小说既有人设、阵营、记忆、关系与情节因果。",
      `- 对不确定资料保持「可能 / 待核实 / 基于现有资料推断」的表述。`,
    ].join("\n"),
    notes: [
      "补充说明：",
      `- 当前外部评价与争议点：${external || "仍需继续补充外部视角样本。"}。`,
      `- 当前时间线线索：${timeline || "仍需继续补充成长阶段、关键事件与关系变化。"}。`,
      `- 若后续补料，优先增加公开讲话、评价、转折事件与决策案例。`,
      input.generationNotes.length > 0 ? `- 生成备注：${input.generationNotes.join("；")}` : "",
    ].filter(Boolean).join("\n"),
    expressionDna: `表达特征：${expression || conversations || "资料不足时，先把表达写成可辨识的节奏、停顿、锋利度和情绪显影，而不是空泛地写成强势或温柔。"}。`,
    mentalModel: `心智模型：${decisions || writings || "先判断角色真正害怕失去什么、想保住什么、长期想要成为什么，再让每次行动服从这条底层逻辑。"}。`,
    decisionHeuristics: `决策启发式：${decisions || "面对选择时，先判断优先级与失败代价，再决定保关系、保结果、保秩序还是保自己。"}。`,
    valueAntiPatterns: `价值观反模式：${external || "不要把角色写成全对、全强、全能的人物；争议、代价和误判同样会定义这个灵魂。"}。`,
    honestyBoundaries: "诚实边界：仅作为小说创作灵魂使用，不声明等同真人或原作人物；对缺失信息明确标注推断性质，不把猜测写成事实。",
  }
}

function buildStoredCorpus(input: CustomCharacterAuraGenerationInput): string {
  if (input.corpus?.trim()) return input.corpus.trim()
  const lines: string[] = []
  if (input.generationPrompt?.trim()) lines.push(`提示词：${input.generationPrompt.trim()}`)
  if (input.webSearchResults.length > 0) {
    lines.push("AI 搜索摘要：")
    lines.push(...input.webSearchResults.slice(0, 3).map((result) => `- ${result.title}：${clipText(result.snippet, 120)}`))
  }
  if (input.importedDocuments.length > 0) {
    lines.push(...input.importedDocuments.slice(0, 2).map((document) => `- ${document.path}：${clipText(document.content, 120)}`))
  }
  if (input.importedUrls.length > 0) {
    lines.push(...input.importedUrls.slice(0, 2).map((document) => `- ${document.url}：${clipText(document.content, 120)}`))
  }
  return lines.join("\n") || "用户未填写资料文本，仅提供资料索引。"
}

function stageDisplayTitle(stage: AuraWorkflowStage): string {
  return stage.label.replace(/^\d+\s*/, "")
}

function clipText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength)}……`
}

function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/^#+\s*/gm, "")
    .replace(/^\-\s*/gm, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
}

function htmlToPlainText(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20000)
}

interface CustomSourceIndexInput {
  sourceUrls?: string
  localDocumentPaths?: string
  generationPrompt?: string
  enableWebSearch?: boolean
  webSearchEnabled?: boolean
  searchQueries?: string[]
  webSearchResults?: WebSearchResult[]
  failedSearchUrls?: string[]
  generationNotes?: string[]
}

function isSourceSearchEnabled(input: CustomSourceIndexInput): boolean {
  return Boolean(input.enableWebSearch ?? input.webSearchEnabled)
}

function generationNotesMarkdown(notes: string[] = [], fallbackNote?: string): string {
  const items = [...notes]
  if (fallbackNote?.trim()) items.push(fallbackNote.trim())
  if (items.length === 0) return ""
  return ["## 生成备注", "", ...items.map((note) => `- ${note}`)].join("\n")
}

function workflowStageIndexMarkdown(): string {
  return AURA_WORKFLOW_STAGES
    .map((stage, index) => `${index + 1}. ${stage.label}：${stage.goal}`)
    .join("\n")
}

function researchFilesSummaryMarkdown(
  researchFiles: Partial<Record<CharacterAuraResearchFileName, string>>,
): string {
  return [
    "## 工作流产出摘要",
    "",
    ...AURA_WORKFLOW_STAGES.flatMap((stage) => {
      const content = researchFiles[stage.fileName]?.trim()
      return [
        `### ${stage.label}`,
        "",
        content ? clipText(markdownToPlainText(content), 260) : "当前还没有该阶段的研究摘要。",
        "",
      ]
    }),
  ].join("\n")
}

function customSkillMarkdown(
  aura: CharacterAura,
  input: CustomCharacterAuraGenerationInput,
  researchFiles: Partial<Record<CharacterAuraResearchFileName, string>> = {},
): string {
  const sourceIndex = customSourceIndexMarkdown(input)
  const workflowSummary = researchFilesSummaryMarkdown(researchFiles)
  const generationNotes = generationNotesMarkdown(input.generationNotes, input.distillationFallbackNote)
  return `---
name: ${aura.name}
description: 自定义角色灵魂，基于用户提供的公开或已授权资料生成。
---

# ${aura.name} · 自定义人物灵魂操作系统

## 角色扮演规则

只能作为小说角色灵魂使用，不冒充真人，不覆盖人物小传，不替代大纲、正史规则和情节因果。

## 回答工作流

1. 先读取小说大纲、人物小传和当前章节目标。
2. 再参考本灵魂的表达方式、心智模型和边界。
3. 最后让角色行为服从当前剧情、认知状态和人物关系。

## 身份卡

- 名称：${aura.name}
- 分类：${aura.category ?? "自定义灵魂"}
- 来源说明：${aura.sourceNote}

## 资料导入设置

${sourceIndex}

## 生成工作流

${workflowStageIndexMarkdown()}

${generationNotes ? `${generationNotes}\n\n` : ""}## 核心心智模型

${aura.mentalModel}

## 决策启发式

${aura.decisionHeuristics}

## 表达特征

${aura.expressionDna}

## 人物时间线

请重点参考 \`06-timeline.md\` 中的阶段梳理，再结合当前小说人物小传落地到具体剧情。

## 价值观与反模式

${aura.valueAntiPatterns}

## 诚实边界

${aura.honestyBoundaries}

## 研究文件索引

${CHARACTER_AURA_RESEARCH_FILES.map((file) => `- 研究资料/${file.fileName}：${file.label}`).join("\n")}

${workflowSummary}

## 绑定到小说角色时的使用方式

绑定后只增强角色气质、语言倾向和判断方式，不得改写角色既有人设、阵营、记忆和剧情任务。

## 质量校验清单

- 不冒充真人或原作角色。
- 不照搬未授权文本。
- 不覆盖小说大纲和人物小传。
- 不把灵魂当作万能行为解释。
`
}

function customSourceIndexMarkdown(input: CustomSourceIndexInput): string {
  const urls = splitSourceLines(input.sourceUrls)
  const paths = splitSourceLines(input.localDocumentPaths)
  const searchEnabled = isSourceSearchEnabled(input)
  const prompt = input.generationPrompt?.trim()
  const searchQueries = input.searchQueries ?? []
  const searchResults = input.webSearchResults ?? []
  const failedSearchUrls = input.failedSearchUrls ?? []
  const noteLines = input.generationNotes ?? []
  return [
    "## 资料索引",
    "",
    "### 生成提示词",
    "",
    prompt || "- 未填写",
    "",
    "### AI 搜索",
    "",
    `- 状态：${searchEnabled ? "已开启" : "未开启"}`,
    searchQueries.length > 0 ? `- 检索词：${searchQueries.join("；")}` : "- 检索词：未生成",
    "",
    "### 网页资料地址",
    "",
    urls.length > 0 ? urls.map((url) => `- ${url}`).join("\n") : "- 未填写",
    "",
    "### 本地文档路径",
    "",
    paths.length > 0 ? paths.map((path) => `- ${path}`).join("\n") : "- 未填写",
    "",
    "### 联网补充来源",
    "",
    searchResults.length > 0
      ? searchResults
        .slice(0, 5)
        .map((result) => `- ${result.title}｜${result.source}\n  ${result.url}`)
        .join("\n")
      : searchEnabled
        ? "- 本次未拿到可用的 AI 搜索结果"
        : "- 未开启 AI 搜索",
    failedSearchUrls.length > 0
      ? `\n### 联网抓取失败\n\n${failedSearchUrls.map((url) => `- ${url}`).join("\n")}`
      : "",
    noteLines.length > 0
      ? `\n### 生成备注\n\n${noteLines.map((note) => `- ${note}`).join("\n")}`
      : "",
  ].filter(Boolean).join("\n")
}

function splitSourceLines(value: string | undefined): string[] {
  return (value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function localDocumentContentMarkdown(input: CustomCharacterAuraGenerationInput): string {
  const imported = input.importedDocuments.length > 0
    ? `## 本地文档正文\n\n${input.importedDocuments.map((document) => `### ${document.path}\n\n${document.content}`).join("\n\n")}`
    : "## 本地文档正文\n\n未读取到本地文档正文。"
  const failed = input.failedDocuments.length > 0
    ? `\n\n## 本地文档读取失败\n\n${input.failedDocuments.map((path) => `- ${path}：读取失败`).join("\n")}`
    : ""
  return `${imported}${failed}`
}

function urlDocumentContentMarkdown(input: CustomCharacterAuraGenerationInput): string {
  const imported = input.importedUrls.length > 0
    ? `## 网页资料正文\n\n${input.importedUrls.map((document) => `### ${document.url}\n\n${document.content}`).join("\n\n")}`
    : "## 网页资料正文\n\n未读取到网页资料正文。"
  const failed = input.failedUrls.length > 0
    ? `\n\n## 网页资料读取失败\n\n${input.failedUrls.map((url) => `- ${url}：读取失败`).join("\n")}`
    : ""
  return `${imported}${failed}`
}

function searchDocumentContentMarkdown(input: CustomCharacterAuraGenerationInput): string {
  const imported = input.importedSearchDocuments.length > 0
    ? `## AI 搜索网页正文\n\n${input.importedSearchDocuments.map((document) => `### ${document.title}\n\n- 来源：${document.source}\n- 链接：${document.url}\n- 检索词：${document.query || "未记录"}\n- 摘要：${document.snippet || "无"}\n\n${document.content}`).join("\n\n")}`
    : `## AI 搜索网页正文\n\n${input.enableWebSearch ? "未读取到可用的 AI 搜索网页正文。" : "未开启 AI 搜索。"}`
  const failed = input.failedSearchUrls.length > 0
    ? `\n\n## AI 搜索网页读取失败\n\n${input.failedSearchUrls.map((url) => `- ${url}：读取失败`).join("\n")}`
    : ""
  return `${imported}${failed}`
}

function stageForResearchFile(fileName: CharacterAuraResearchFileName): AuraWorkflowStage {
  return AURA_WORKFLOW_STAGES.find((stage) => stage.fileName === fileName) ?? AURA_WORKFLOW_STAGES[0]
}

function customResearchMarkdown(aura: CharacterAura, input: CustomCharacterAuraGenerationInput, fileName: CharacterAuraResearchFileName): string {
  const base = buildAuraResearchStageFallback(stageForResearchFile(fileName), input, {})
  const localDocumentContent = localDocumentContentMarkdown(input)
  const urlDocumentContent = urlDocumentContentMarkdown(input)
  const searchDocumentContent = searchDocumentContentMarkdown(input)
  const generationNotes = generationNotesMarkdown(input.generationNotes, input.distillationFallbackNote)
  const content: Record<CharacterAuraResearchFileName, string> = {
    "01-writings.md": [
      base,
      customSourceIndexMarkdown(input),
      urlDocumentContent,
      localDocumentContent,
      searchDocumentContent,
      generationNotes,
    ].filter(Boolean).join("\n\n"),
    "02-conversations.md": [
      base,
      "## 已沉淀的灵魂摘要",
      "",
      aura.styleDescription,
      "",
      "## 表达特征补充",
      "",
      aura.expressionDna || aura.styleDescription,
      "",
      "## 资料证据线索",
      "",
      buildSourceEvidenceList(input),
    ].join("\n"),
    "03-expression-dna.md": [
      base,
      "",
      "## 当前灵魂字段映射",
      "",
      `- 表达特征：${aura.expressionDna || aura.styleDescription}`,
      `- 心智模型：${aura.mentalModel || aura.corpus}`,
      `- 诚实边界：${aura.honestyBoundaries || aura.boundaries}`,
    ].join("\n"),
    "04-external-views.md": [
      base,
      "",
      "## 当前外部视角摘要",
      "",
      aura.sourceNote,
      "",
      "## 反模式提醒",
      "",
      aura.valueAntiPatterns || aura.notes,
    ].join("\n"),
    "05-decisions.md": [
      base,
      "",
      "## 当前决策启发式",
      "",
      aura.decisionHeuristics || aura.behaviorRules,
      "",
      "## 当前心智模型",
      "",
      aura.mentalModel || aura.corpus,
    ].join("\n"),
    "06-timeline.md": [
      base,
      "",
      "## 当前资料摘要",
      "",
      aura.corpus || "待用户继续补充资料文本。",
      "",
      searchDocumentContent,
    ].filter(Boolean).join("\n"),
  }
  return content[fileName]
}

async function syncStoredCustomAuraFiles(aura: CharacterAura): Promise<void> {
  if (!aura.skillFolder) return
  await createDirectory(aura.skillFolder)
  await createDirectory(joinPath(aura.skillFolder, "references", "research"))
  const existingResearchFiles = await loadExistingResearchFiles(aura.skillFolder)
  await writeFileAtomic(joinPath(aura.skillFolder, "SKILL.md"), storedCustomSkillMarkdown(aura, existingResearchFiles))
  for (const file of CHARACTER_AURA_RESEARCH_FILES) {
    if (existingResearchFiles[file.fileName]?.trim()) continue
    await writeFileAtomic(joinPath(aura.skillFolder, "references", "research", file.fileName), storedCustomResearchMarkdown(aura, file.fileName))
  }
}

async function loadExistingResearchFiles(
  skillFolder: string,
): Promise<Partial<Record<CharacterAuraResearchFileName, string>>> {
  const files: Partial<Record<CharacterAuraResearchFileName, string>> = {}
  for (const file of CHARACTER_AURA_RESEARCH_FILES) {
    try {
      const content = await readFile(joinPath(skillFolder, "references", "research", file.fileName))
      if (content.trim()) files[file.fileName] = content
    } catch {
      // Keep edit flow resilient when some generated research files are missing.
    }
  }
  return files
}

function storedCustomSkillMarkdown(
  aura: CharacterAura,
  researchFiles: Partial<Record<CharacterAuraResearchFileName, string>> = {},
): string {
  const sourceIndex = customSourceIndexMarkdown(aura)
  const workflowSummary = researchFilesSummaryMarkdown(researchFiles)
  return `---
name: ${aura.name}
description: 自定义角色灵魂，基于用户维护的公开或已授权资料生成。
---

# ${aura.name} · 自定义人物灵魂操作系统

## 角色扮演规则

只能作为小说角色灵魂使用，不冒充真人，不覆盖人物小传，不替代大纲、正史规则和情节因果。

## 回答工作流

1. 先读取小说大纲、人物小传和当前章节目标。
2. 再参考本灵魂的表达方式、心智模型和边界。
3. 最后让角色行为服从当前剧情、认知状态和人物关系。

## 身份卡

- 名称：${aura.name}
- 分类：${aura.category ?? "自定义灵魂"}
- 来源说明：${aura.sourceNote}

## 资料导入设置

${sourceIndex}

## 生成工作流

${workflowStageIndexMarkdown()}

## 核心心智模型

${aura.mentalModel ?? aura.corpus}

## 决策启发式

${aura.decisionHeuristics ?? aura.behaviorRules}

## 表达特征

${aura.expressionDna ?? aura.styleDescription}

## 人物时间线

请重点参考 \`06-timeline.md\` 的时间线整理，再结合当前人物小传安排成长弧线。

## 价值观与反模式

${aura.valueAntiPatterns ?? aura.notes}

## 诚实边界

${aura.honestyBoundaries ?? aura.boundaries}

## 研究文件索引

${CHARACTER_AURA_RESEARCH_FILES.map((file) => `- 研究资料/${file.fileName}：${file.label}`).join("\n")}

${workflowSummary}

## 绑定到小说角色时的使用方式

绑定后只增强角色气质、语言倾向和判断方式，不得改写角色既有人设、阵营、记忆和剧情任务。

## 质量校验清单

- 不冒充真人或原作角色。
- 不照抄未授权文本。
- 不覆盖小说大纲和人物小传。
- 不把灵魂当作万能行为解释。
`
}

function storedCustomResearchMarkdown(aura: CharacterAura, fileName: CharacterAuraResearchFileName): string {
  const sourceIndex = customSourceIndexMarkdown(aura)
  const content: Record<CharacterAuraResearchFileName, string> = {
    "01-writings.md": [
      `# ${aura.name} - 公开资料`,
      "",
      "## 核心结论",
      `- 角色定位：${aura.category ?? "自定义灵魂"}。`,
      `- 气质说明：${aura.sourceNote || "待补充"}。`,
      `- 生成提示词：${aura.generationPrompt?.trim() || "未填写"}。`,
      "",
      "## 证据线索",
      aura.corpus || "待用户继续补充资料文本。",
      "",
      sourceIndex,
      "",
      "## 可写入小说的细节",
      `- 表达特征：${aura.expressionDna ?? aura.styleDescription}`,
      `- 心智模型：${aura.mentalModel ?? aura.corpus}`,
      "",
      "## 未确认点",
      "- 若要继续增强灵魂稳定度，建议补充更完整的公开经历、对话样本、评价和时间线资料。",
    ].join("\n"),
    "02-conversations.md": [
      `# ${aura.name} - 对话方式`,
      "",
      "## 说话节奏",
      aura.styleDescription || "待补充",
      "",
      "## 常用表达策略",
      aura.expressionDna ?? aura.styleDescription,
      "",
      "## 冲突中的说话方式",
      aura.decisionHeuristics ?? aura.behaviorRules,
      "",
      "## 示例句式",
      "- 写作时先给立场，再给理由，再根据关系强弱控制锋利度与停顿。",
    ].join("\n"),
    "03-expression-dna.md": [
      `# ${aura.name} - 表达特征`,
      "",
      "## 词汇偏好",
      aura.expressionDna ?? aura.styleDescription,
      "",
      "## 情绪显影",
      aura.styleDescription || "待补充",
      "",
      "## 叙事镜头感",
      aura.sourceNote || "待补充",
      "",
      "## 表达禁区",
      aura.honestyBoundaries ?? aura.boundaries,
    ].join("\n"),
    "04-external-views.md": [
      `# ${aura.name} - 外部评价`,
      "",
      "## 支持者视角",
      aura.sourceNote || "待补充",
      "",
      "## 对手视角",
      aura.valueAntiPatterns ?? aura.notes,
      "",
      "## 旁观者视角",
      aura.styleDescription || "待补充",
      "",
      "## 争议点",
      aura.valueAntiPatterns ?? aura.notes,
    ].join("\n"),
    "05-decisions.md": [
      `# ${aura.name} - 决策记录`,
      "",
      "## 核心优先级",
      aura.mentalModel ?? aura.corpus,
      "",
      "## 高压下的选择",
      aura.decisionHeuristics ?? aura.behaviorRules,
      "",
      "## 典型取舍",
      aura.valueAntiPatterns ?? aura.notes,
      "",
      "## 失败代价",
      aura.honestyBoundaries ?? aura.boundaries,
    ].join("\n"),
    "06-timeline.md": [
      `# ${aura.name} - 时间线`,
      "",
      "## 起点",
      aura.corpus || "待用户补充出身、早期处境和最初欲望。",
      "",
      "## 关键转折",
      aura.sourceNote || "待补充",
      "",
      "## 关系变化",
      aura.notes || aura.valueAntiPatterns || "待补充",
      "",
      "## 未来可延展线索",
      "- 后续可围绕未完成承诺、旧关系回收、立场变化和代价兑现继续补料。",
    ].join("\n"),
  }
  return content[fileName]
}

function storePath(projectPath: string): string {
  return `${normalizePath(projectPath)}/.qmai/character-aura.json`
}

const IGNORE_BINDABLE_CHARACTER_NAMES = new Set([
  "人物小传",
  "人物设定",
  "角色设定",
  "角色小传",
  "主要人物",
  "配角",
  "人物关系",
  "角色关系",
  "总大纲",
  "章节细纲",
])

function normalizeCharacterText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[，。、"'\u2018\u2019\u201c\u201d「」『』：:；;（）()\[\]【】《》<>！？!?,.·-]/g, "")
    .toLowerCase()
}

function stripFileExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "")
}

function extractPrimaryTitle(content: string, fallbackFileName: string): string {
  const frontmatterTitle = content.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim()
  if (frontmatterTitle) return frontmatterTitle
  const headingTitle = content.match(/^#\s+(.+)$/m)?.[1]?.trim()
  if (headingTitle) return headingTitle
  return stripFileExtension(fallbackFileName)
}

function flattenMarkdownNodes(nodes: { name: string; path: string; is_dir: boolean; children?: unknown[] }[]): { name: string; path: string }[] {
  const files: { name: string; path: string }[] = []
  for (const node of nodes) {
    if (node.is_dir && Array.isArray(node.children)) {
      files.push(...flattenMarkdownNodes(node.children as { name: string; path: string; is_dir: boolean; children?: unknown[] }[]))
      continue
    }
    if (!node.is_dir && node.name.toLowerCase().endsWith(".md")) {
      files.push({ name: node.name, path: normalizePath(node.path) })
    }
  }
  return files
}

function isCharacterOutlineFile(filePath: string, pageTitle: string, content: string): boolean {
  const normalizedPath = normalizePath(filePath)
  return (
    /人物|角色/.test(normalizedPath)
    || /人物|角色/.test(pageTitle)
    || /^outline_category:\s*characters\s*$/m.test(content)
  )
}

type OutlineCharacterSection = {
  level: number
  title: string
  body: string
}

const NON_CHARACTER_OUTLINE_TITLE_PATTERNS = [
  /总览$/,
  /整体状态$/,
  /关系$/,
  /线$/,
  /小队$/,
  /残部$/,
]

function isBindableCharacterOutlineSection(section: OutlineCharacterSection): boolean {
  const title = section.title.trim()
  if (!title) return false
  if (IGNORE_BINDABLE_CHARACTER_NAMES.has(title)) return false
  if (NON_CHARACTER_OUTLINE_TITLE_PATTERNS.some((pattern) => pattern.test(title))) return false
  if (/性格与群像定位/.test(section.body)) return false
  return true
}

function extractCharacterNamesFromOutline(content: string): string[] {
  const names = new Set<string>()
  const addName = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed || trimmed.length > 40) return
    if (IGNORE_BINDABLE_CHARACTER_NAMES.has(trimmed)) return
    names.add(trimmed)
  }

  const headingMatches = [...content.matchAll(/^(#{2,6})\s+(.+)$/gm)].map((match) => ({
    level: match[1].length,
    title: match[2].replace(/[：:].*$/, "").trim(),
    index: match.index ?? 0,
    rawLength: match[0].length,
  }))

  if (headingMatches.length === 0) return []

  const headingLevelCounts = new Map<number, number>()
  for (const match of headingMatches) {
    headingLevelCounts.set(match.level, (headingLevelCounts.get(match.level) ?? 0) + 1)
  }

  const primaryHeadingLevel =
    [2, 3, 4, 5, 6].find((level) => (headingLevelCounts.get(level) ?? 0) >= 2)
    ?? Math.min(...headingMatches.map((match) => match.level))

  const primarySections: OutlineCharacterSection[] = headingMatches
    .filter((match) => match.level === primaryHeadingLevel)
    .map((match, index, matches) => {
      const nextMatch = matches[index + 1]
      const bodyStart = match.index + match.rawLength
      const bodyEnd = nextMatch?.index ?? content.length
      return {
        level: match.level,
        title: match.title,
        body: content.slice(bodyStart, bodyEnd),
      }
    })

  for (const section of primarySections) {
    if (isBindableCharacterOutlineSection(section)) {
      addName(section.title)
    }
  }

  return [...names]
}
