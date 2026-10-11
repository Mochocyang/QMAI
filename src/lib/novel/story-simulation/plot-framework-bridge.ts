/**
 * 拆书剧情框架（PlotFramework）→ 仿真故事框架（StoryFramework）桥接。
 *
 * 为什么需要这个文件：拆书的发布写的是 `.qmai/plot-frameworks/library.json`，
 * 而 AI 会话里被注入的 `storyFrameworkBinding` 读的是
 * `.qmai/simulations/frameworks/*.md`（storyFrameworkBindingDataSource
 * → loadFrameworks → buildBindingContext）。两者不互通，所以「故事 skill」
 * 发布完根本进不了提示词。发布时额外写一份到**已经被注入的那个存储**即可，
 * 不需要在上下文引擎/数据源里新增任何注入代码。
 *
 * 落盘必须走 `saveFramework`，不要手写 .md：framework-store 的解析要求
 * 「## 前提」「## 故事节点」与「### 节点 N 【阶段】 标题」的形状
 * （extractSection / parseNodeHeader），手写会静默解析出 0 个节点。
 */

import type { PlotFramework } from "../plot-framework"
import { DEFAULT_SIMULATION_MODE, saveFramework } from "./framework-store"
import type { StoryFramework, StoryNode } from "./types"

/**
 * 拆书 publisher 在四个故事维度标签全都匹配不上时用的占位句。
 *
 * 发布（workbench-publish 的 pick）与退化检测（degenerateStoryFrameworkWarning）
 * 共用这一个常量：改了一处另一处会跟着改，不会漂移成两句不同的「同一句占位话」。
 */
export const EMPTY_STORY_BEAT = "本次没有充分依据，不固定该环节；由目标故事实际情境决定。"

/**
 * 桥接框架的「目标字数」。
 *
 * PlotFramework 没有这个概念，只能新造。取故事仿真面板的默认值
 * （story-simulation-store 的 targetWords: 10000），保证桥接产物在那个
 * 面板里显示的字数不突兀。
 */
export const BRIDGED_TARGET_WORDS = 10000

/** 四段循环对应的节点阶段，顺序与 PlotFrameworkBeats 一致。 */
const PHASES: ReadonlyArray<StoryNode["phase"]> = ["起", "承", "转", "合"]

/**
 * 桥接框架的 id —— 由 PlotFramework.id **确定性派生**，不能是新造的时间戳/随机值。
 *
 * 三条已实读的因果（任一条不成立都会静默半失效）：
 *  1. 消费端 `storyFrameworkBindingDataSource` 用
 *     `frameworks.find((f) => f.id === binding.frameworkId)` 找框架，
 *     找不到就 `return ""` —— 对不上是**静默空串**，不抛错、不提示；
 *  2. `saveBinding` 存的是 `framework.id`，也就是用户点绑定时那个对象的 id；
 *  3. `saveFramework` 的落盘路径就是 `<id>.md` —— **id 即文件名**。
 * 所以随机 id 会让「重复发布」每次都多一个文件（loadFrameworks 列表无限膨胀，
 * 用户还可能绑到旧副本），确定 id 则被 writeFileAtomic 覆盖，发布是幂等的。
 *
 * 前缀 `plot-` 避免与原生创建的框架（story-framework-generator 的 `framework-<ts>`）撞名。
 *
 * 前缀之外的字符做**定宽百分号转义**，而不是一律替换成 `-`，两个理由：
 *  - `:` 在 Windows 上是非法文件名字符：`plot:x.md` 会被当成 NTFS 备用数据流，
 *    目录里出现的是 `plot`（没有 .md 后缀），loadFrameworks 的 `.md` 过滤直接跳过它，
 *    于是「发布成功」但永远读不回来；`/`、`\` 更会写到别的目录去。
 *  - 定宽转义是单射：换成 `-` 的话 "a:b" 与 "a?b" 会撞成同一个文件名、互相覆盖。
 *    （每个被转义字符编成 `%` + 6 位十六进制，6 位足以覆盖全部 Unicode 码点，
 *    而字面量 `%` 必然被转义，所以解码无歧义。）
 */
export function storyFrameworkIdForPlotFramework(plotFrameworkId: string): string {
  const escaped = plotFrameworkId
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, (ch) => {
      const codePoint = ch.codePointAt(0) ?? 0
      return `%${codePoint.toString(16).toUpperCase().padStart(6, "0")}`
    })
  return `plot-${escaped}`
}

/**
 * 节点标题的净化。
 *
 * 标题会被写成 `### 节点 N 【起】 <标题>` 的一行，而 framework-store 的
 * parseNodeHeader 取「最后一个 `】` 之后」当标题：标题里只要出现一个 `】`，
 * 重新加载时前面的正文就会被整段切掉（静默丢失，不是报错）。
 * 换行同理只保留第一行。所以这里折叠空白并把 `】` 换成半角 `]`。
 */
function nodeTitleText(text: string): string {
  return text.replace(/\s+/g, " ").replace(/】/g, "]").trim()
}

/**
 * 合成 premise。
 *
 * StoryFramework 的 `premise` 是唯一能安放「怎么用这个框架」这段散文的字段，
 * 于是把 PlotFramework 里没有结构化归属的三项（一句话可复用模板 / 方向指引 /
 * 作者手搓留白）连同来源拆文一起放进来，避免它们随转换无声消失。
 * 以 title 开头，保证 premise 恒非空（空串会被序列化成「（无前提）」再读回）。
 */
function buildPremise(framework: PlotFramework): string {
  const parts = [framework.title]
  if (framework.sourceDismantlingProjectTitle) {
    parts.push(`来源拆文：${framework.sourceDismantlingProjectTitle}`)
  }
  if (framework.reusableTemplate) parts.push(`一句话可复用模板：${framework.reusableTemplate}`)
  if (framework.directionHints) parts.push(`方向指引：${framework.directionHints}`)
  if (framework.handcraftHints) parts.push(`作者手搓留白：${framework.handcraftHints}`)
  return parts.join("\n")
}

/**
 * PlotFramework → StoryFramework（**纯函数、有损**）。
 *
 * 四个 beat 写进**节点标题**，这是被注入方式决定的：buildBindingContext
 * 只渲染 framework.title、目标章节数、以及「第X-Y章 → 【阶段】节点标题」，
 * 节点标题是唯一能把 beat 正文送进提示词的字段（写进 coreConflict 之类到不了）。
 * 其余节点字段留空：beat 是一整段环节描述，不是「核心冲突/目标」中的任何一项，
 * 硬塞进去会让模拟推演提示词把同一段话渲染两遍。
 * `index` 与原生生成器（story-framework-generator 的 `index: i`）一致，从 0 起。
 *
 * 有损字段（全部在单测里钉住）：characters[].role、foreshadowing、line、tags、
 * pacing、autoPacing、history、prevConnector/nextConnector、updatedAt。
 */
export function convertPlotFrameworkToStoryFramework(framework: PlotFramework): StoryFramework {
  const characterNames = framework.characters
    .map((character) => character.name.trim())
    .filter(Boolean)
  const beats = [
    framework.beats.hook,
    framework.beats.buildup,
    framework.beats.payoff,
    framework.beats.endingHook,
  ]
  const nodes: StoryNode[] = beats.map((beat, index) => ({
    index,
    phase: PHASES[index],
    title: nodeTitleText(beat),
    coreConflict: "",
    // 框架级角色没有框架级字段可放，而框架覆盖它自己的全部节点，故四个节点都带上。
    involvedCharacters: [...characterNames],
    goal: "",
    causeFromPrev: "",
    expectedOutcome: "",
  }))

  return {
    id: storyFrameworkIdForPlotFramework(framework.id),
    title: framework.title,
    premise: buildPremise(framework),
    targetWords: BRIDGED_TARGET_WORDS,
    simulationMode: DEFAULT_SIMULATION_MODE,
    sourceChapters: framework.rangeChapterIds.length,
    nodes,
    // normalizePlotFramework 已把 createdAt 钳成有限数字（NaN → now），
    // 因此这里不会抛 RangeError；非有限值宁可抛错也不要静默改成别的时间。
    createdAt: new Date(framework.createdAt).toISOString(),
  }
}

/**
 * 把拆书框架发布到「已经被注入」的那个存储：转换 + saveFramework。
 *
 * 两个发布方（workbench-publish 的版本确认、story-analysis-adapter 的旧提取路径）
 * 都必须调用它，只接一个等于只做一半。
 * 入参要用 upsertPlotFramework **归一化后的返回值**：id/createdAt 以盘上那份为准。
 * 不要在这里 saveBinding —— 绑定是无条件覆盖唯一活跃绑定的，等于劫持用户已有的仿真框架。
 */
export async function bridgePlotFrameworkToStoryFramework(
  projectPath: string,
  framework: PlotFramework,
): Promise<StoryFramework> {
  const converted = convertPlotFrameworkToStoryFramework(framework)
  await saveFramework(projectPath, converted)
  return converted
}

/**
 * 「结构合法、内容为空」判定。
 *
 * 拆书故事维度的标签是**提示词要求但未校验**的（workbench-adapter 让模型用
 * 「目标与阻力/信息投放/冲突升级/转折条件/兑现/后续悬念」，而 workbench-core
 * 只对 characters 强制 PERSONALITY_FIELDS）。模型跑偏时 workbench-publish 的
 * pick() 一个都匹配不上，四个 beat 全部退化成同一句 EMPTY_STORY_BEAT，
 * 而 normalizeBeats 照样放行 —— 于是用户可能绑定到一个「什么内容都没有」的框架。
 * 桥接把 beat 写进节点标题，所以「节点标题全同」就等于「注入 AI 的四个环节是同一句重复」。
 *
 * @returns null 表示内容正常；返回字符串是可直接展示给用户的提示。
 */
export function degenerateStoryFrameworkWarning(framework: StoryFramework): string | null {
  const titles = framework.nodes.map((node) => node.title.trim()).filter(Boolean)
  // 单节点框架不存在「四个环节退化」这回事，至少两个节点才判定。
  if (titles.length < 2 || titles.some((title) => title !== titles[0])) return null
  if (titles[0] === EMPTY_STORY_BEAT) {
    return "这个框架的四个环节都是同一句占位话（拆书的维度标签没有匹配上），绑定后注入 AI 的框架正文等于空。建议回拆书结果页重新生成，或换一个框架。"
  }
  return "这个框架各节点的内容完全相同，绑定后注入 AI 的正文是同一句重复，几乎没有指导作用。"
}
