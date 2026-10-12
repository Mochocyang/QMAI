import "@/components/uitest/ui-test-tools.css"
import { useEffect, useMemo, useState, type ComponentType } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { ArrowLeft, Library, Plus, Search, Star, Upload } from "lucide-react"
import { readFile } from "@/commands/fs"
import { confirmDiscardSkillLibraryDraft, useWikiStore } from "@/stores/wiki-store"
import { useFavoriteSkillStore } from "@/stores/favorite-skill-store"
import {
  createBlankProjectDeAiSkill,
  getAllDeAiSkills,
  loadDeAiSkillConfig,
  normalizeDeAiSkillConfig,
  saveDeAiSkillConfig,
  setDeAiSkillEnabled,
  type DeAiSkill,
  type DeAiSkillConfig,
} from "@/lib/novel/de-ai-skill-library"
import {
  createBlankWritingSkill,
  createSkillCategory,
  deleteSkillCategory,
  importSkillFromJson,
  importWritingSkill,
  loadUserSkillConfig,
  normalizeUserSkillConfig,
  renameSkillCategory,
  saveUserSkillConfig,
  setWritingSkillEnabled,
  type UserSkillConfig,
} from "@/lib/novel/user-skill-store"
import { SKILL_KIND_LABELS, skillDisplayName, type SkillKind, type UserSkill } from "@/lib/novel/skill-library"
import { createWritingStylePreset, loadWritingStyleStore, setEnabledWritingStyle, type WritingStylePreset } from "@/lib/novel/writing-style-store"
import { SkillLibraryView } from "./skill-library-view"
import { WritingSkillLibraryView } from "./writing-skill-library-view"
import { WritingStyleLibraryView } from "./writing-style-library-view"
import { FavoriteListView } from "./favorite-list-view"
import { PersonaSkillView } from "./persona-skill-view"
import { PersonaSkillEvolutionPanel } from "./persona-skill-evolution-panel"
import { StyleEvolutionPanel } from "./style-evolution-panel"

/**
 * 技能库 tab 的**唯一事实来源**：视图名 + 文案。
 *
 * ## 加一个 tab 时，哪些分派点**会**编译报错
 * 下列表按 `SkillLibraryTab` / `GalleryTab`（= 去掉「收藏」）建键，
 * 少一个键即 TS2741 / TS2739：
 *   `ACTIVE_TAB_BY_VIEW`、`TAB_DRAFT_KIND`、`TAB_ACTIONS`、
 *   `TAB_CATEGORY_AXIS`、`EMPTY_COPY`、`SKILL_EDITORS`，
 * 再加组件内的 `entriesByTab`（第 7 张）。
 * `SKILL_LIBRARY_VIEWS` 另把元素类型标成 `ActiveView`，所以
 * 「新 tab 的视图名不在 store 的 `activeView` 联合里」同样是编译错误。
 * ⚠️ 这是**列名**承诺，不是「本文件所有分派都受保护」：
 * 未受保护的分派点在文件末尾 `RESIDUAL GAPS` 一段逐条写明。
 *
 * ## 加一个**条目类型**（`entry.type`）时，哪些分派点**会**编译报错
 * 3 张 `Record<UnifiedSkillEntry["type"], …>`：
 *   `ENTRY_TYPE_LABELS`、`ENTRY_CAPABILITIES`、`ENTRY_TOGGLE_LABELS`；
 * 4 个穷尽 `switch`（`default` 里取 `never`）：
 *   `entryEnabled`、`entryFavoriteTarget`、`handleToggleEnabled`、`handleOpenEntry`；
 * 外加 `entrySourceLabel`（它的尾段要读 `entry.rawSkill`，而只有 `writing` /
 * `de-ai` 两种类型有这个字段 ⇒ 新类型不带 `rawSkill` 就报 TS2339）。
 *
 * ⚠️「8 处」不是照清单推的：临时往联合里塞第 4 种**不带** `rawSkill` 的类型，
 * 本文件实测报 **8** 处错（`npx tsc -p tsconfig.app.json --noEmit`），
 * 与上面逐项对应；把那个临时类型改成**带** `rawSkill` 则只剩 **7** 处
 * （少掉的正是 `entrySourceLabel` 那一处）。
 * 其余 `entry.type` 分支**没有**编译保护——见 `RESIDUAL GAPS`。
 */
const skillLibraryTabs = [
  { view: "skillLibrary" as const, label: "去AI味技能" },
  { view: "writingSkillLibrary" as const, label: "写作 Skill" },
  { view: "writingStyleLibrary" as const, label: "文风 skill" },
  // 合并说明：`main`（人物 Skill）的 tab，位置沿用它在 `main` 上「收藏之前」的相对次序。
  { view: "personaSkillLibrary" as const, label: "人物 Skill" },
  { view: "skillFavorites" as const, label: "收藏" },
]

type SkillLibraryTab = (typeof skillLibraryTabs)[number]["view"]
/**
 * 卡片画廊承载的 tab。
 *
 * 「收藏」走独立的 `FavoriteListView`，「人物 Skill」走独立的 `PersonaSkillView`
 * ——两者都**不是**卡片画廊，所以都必须排除在外：排除之后
 * `TAB_ACTIONS` / `TAB_CATEGORY_AXIS` / `EMPTY_COPY` / `SKILL_EDITORS` /
 * `entriesByTab` 这 5 张 `Record` 就不需要为一个「不经过画廊」的 tab 编造条目。
 */
type GalleryTab = Exclude<SkillLibraryTab, "skillFavorites" | "personaSkillLibrary">
type ActiveView = ReturnType<typeof useWikiStore.getState>["activeView"]

/**
 * activeView → 列表 tab 的**显式映射**。
 *
 * ⚠️ 不要改回 `activeView === "writingSkillLibrary" ? … : activeView === "skillFavorites" ? … : "skillLibrary"`
 * 那种二元三元链——那是本文件原先的形状，而给联合类型加第三个成员时
 * **每一处三元都仍然合法编译**（`"writingStyleLibrary" === "writingSkillLibrary"` 只是恒 false），
 * 于是全部静默落到 else 兜底分支，`npm run typecheck` 抓不到任何一处。
 * 换成 `Record` 之后，「加了 tab 没加映射」是编译错误。
 */
const ACTIVE_TAB_BY_VIEW: Record<SkillLibraryTab, SkillLibraryTab> = {
  skillLibrary: "skillLibrary",
  writingSkillLibrary: "writingSkillLibrary",
  writingStyleLibrary: "writingStyleLibrary",
  personaSkillLibrary: "personaSkillLibrary",
  skillFavorites: "skillFavorites",
}

/**
 * 草稿标记归属。显式映射，避免 `activeTab === "writingSkillLibrary" ? writing : skill`
 * 把「文风」静默归到写作 Skill 的脏标记上。
 */
const TAB_DRAFT_KIND: Record<SkillLibraryTab, "skill" | "writing" | "persona" | "none"> = {
  skillLibrary: "skill",
  writingSkillLibrary: "writing",
  // 文风库本批只读（没有编辑器也就没有草稿）；收藏列表同样没有草稿标记。
  writingStyleLibrary: "none",
  // 合并说明：`main` 的人物 Skill 有**自己的**脏标记
  // （`personaSkillLibraryDraftDirty`），既不与写作 Skill 共用、也不与去AI味共用。
  personaSkillLibrary: "persona",
  skillFavorites: "none",
}

/**
 * 头部动作区形态。显式映射：加 tab 忘了补 = 编译错误，
 * 而不是静默显示成「新建技能 / 导入」。
 */
const TAB_ACTIONS: Record<GalleryTab, "de-ai" | "writing" | "style" | "none"> = {
  skillLibrary: "de-ai",
  writingSkillLibrary: "writing",
  // 文风 skill 支持在技能库里手动新建（`createWritingStylePreset` 落盘到
  // `.qmai/writing-style.json`），所以这里给出「+ 新建文风」入口。
  writingStyleLibrary: "style",
}

/**
 * tab 的**分类维度**。`"writing"` = 该 tab 的条目按写作 Skill 的分类维度
 * 过滤，并显示分类 chips；`"none"` = 没有分类维度（不显示 chips、也不按分类过滤）。
 *
 * ⚠️「显示 chips」与「按分类过滤」必须由**同一张表**决定。改造前这是两处独立事实：
 * chips 由 `TABS_WITH_CATEGORY_CHIPS: ReadonlySet<GalleryTab>` 决定，过滤由
 * `activeTab === "writingSkillLibrary"` 硬编码决定。两处可以各自漂移，而且
 * `ReadonlySet` **不在 `Record` 的编译保护里** —— 把它清成空 Set 时
 * `typecheck` 仍 exit 0、测试仍全绿，只有写作 Skill 的分类 chips 静默消失。
 * 现在只有一张 `Record`：漏一个 tab 是编译错误，两件事不可能再分叉。
 */
const TAB_CATEGORY_AXIS: Record<GalleryTab, "writing" | "none"> = {
  skillLibrary: "none",
  writingSkillLibrary: "writing",
  writingStyleLibrary: "none",
}

/** 各 tab 的空态文案。显式映射，避免二元三元把新 tab 说成「还没有去AI味技能」。 */
const EMPTY_COPY: Record<GalleryTab, string> = {
  skillLibrary: "还没有去AI味技能，点击右上角「新建技能」开始。",
  writingSkillLibrary: "还没有写作 Skill，点击右上角「新建 Skill」开始。",
  writingStyleLibrary: "还没有文风 skill。点右上角「+ 新建文风」手动建一条，或「去拆书库添加文风」从一部作品里提取。",
}

/**
 * tab → 编辑器分派。显式映射：新 tab 不会静默拿到**另一个库**的编辑器。
 *
 * ⚠️ 这一张表管的是「**哪个 tab** 用哪个编辑器」，**不**管「点开某个条目该去哪里」——
 * 后者是 `handleOpenEntry`。两者是**各自独立**的两道防线：
 * 文风 tab 的 `() => null` 与 `handleOpenEntry` 的 `style` 分支互相覆盖，
 * 所以**单独去掉任一道都不会渲染成别的库的编辑器**。
 * 这不是冗余代码，是两道各自成立的守卫；别把其中一道的注释说成另一道的功劳。
 *
 * ⚠️ 但「单独去掉 `handleOpenEntry` 那道」**今天已经不是一次静默编辑**：
 * 那道防线是穷尽 `switch`，删掉 `case "style"` 后文风条目掉进 `default`、
 * `entry` 被收窄成 `WritingStyleEntry` 而**不再是** `never`，于是这是**编译错误**
 * （`TS2322: … not assignable to type 'never'`）。
 * ⚠️ 注意它**只是编译期**防线，运行时**到不了那里**：文风条目的
 * `ENTRY_CAPABILITIES.style.openable === false`（见 `:261`），而 `SkillCard.activate`
 * 是 `capabilities.openable ? onOpen() : onSelect()`（`:604-607`）——
 * `handleOpenEntry` 唯一的入口就是 `onOpen`，所以它**从来不会**被文风条目调用，
 * 那个 `default: throw` 在运行时不可达。
 * ⇒ 因此说「运行时也会直接 `throw`」是**错的**（曾这样写过，已订正）；
 * 运行时唯一兜住这类守卫被拆的是本文件末尾那条**源码级断言**。
 * （改前它是二元 `if/else`，拆掉只会落得「一个空编辑器 + 一个写错的
 * `selectedSkillLibrarySkillId`」—— 那才是本注释原先描述的后果，
 * 现在只剩历史价值，别把它当成今天的行为。）
 */
const SKILL_EDITORS: Record<GalleryTab, ComponentType> = {
  skillLibrary: SkillLibraryView,
  writingSkillLibrary: WritingSkillLibraryView,
  // 文风 skill 有独立编辑器：名称 / 来源 / 硬约束 / 片段 / 整合文档 + 启用 / 删除。
  writingStyleLibrary: WritingStyleLibraryView,
}

/**
 * 本组件承认的视图名，从 `skillLibraryTabs` 推导（加 tab 自动跟着长）。
 * 元素类型标成 `ActiveView`：新 tab 的视图名若不在 store 的 `activeView`
 * 联合里，**这一行**就是编译错误，而不是等到运行时才发现切不过去。
 */
const SKILL_LIBRARY_VIEWS: readonly ActiveView[] = skillLibraryTabs.map((tab) => tab.view)

function isSkillLibraryTab(view: ActiveView): view is SkillLibraryTab {
  return SKILL_LIBRARY_VIEWS.some((candidate) => candidate === view)
}

/**
 * activeView → 列表 tab。
 *
 * 原先这里是 `(ACTIVE_TAB_BY_VIEW as Partial<Record<ActiveView, SkillLibraryTab>>)[activeView] ?? "skillLibrary"`：
 * 断言把「表里没有这个视图」这件事瞒过了编译器，`?? ` 再把任何陌生视图
 * 静默兜底成「去AI味技能」。今天唯一渲染本组件的是 `content-area.tsx:125-134`，
 * 它的 `switch` 只把 4 个技能库视图路由过来，所以兜底实际不可达——**但没有任何
 * 东西守着这个前提**：真到了 `activeView === "soul"` 之类的输入，用户会看到
 * 去AI味技能库，**带着可写的「新建技能 / 导入」按钮**。
 * 现在改成显式抛错：前提被打破时当场失败，不静默显示另一个库。
 */
export function resolveActiveTab(activeView: ActiveView): SkillLibraryTab {
  if (!isSkillLibraryTab(activeView)) {
    throw new Error(`技能库视图收到了非技能库的 activeView：${activeView}`)
  }
  return ACTIVE_TAB_BY_VIEW[activeView]
}

/**
 * 该 tab 当前有没有未保存的草稿。
 *
 * 合并说明：`persona`（`main` 的人物 Skill）是**第三个**独立的脏标记来源 ——
 * 人物页自己维护 `personaSkillLibraryDraftDirty`，不能借用写作 Skill 或去AI味
 * 的任何一支，否则「人物页有未保存改动」会被漏判成「没有草稿」而静默丢弃。
 */
function tabDraftDirty(
  draftKind: "skill" | "writing" | "persona" | "none",
  skillDirty: boolean,
  writingDirty: boolean,
  personaDirty: boolean,
): boolean {
  if (draftKind === "writing") return writingDirty
  if (draftKind === "skill") return skillDirty
  if (draftKind === "persona") return personaDirty
  return false
}

type UnifiedSkillCategory = "all" | "recent" | "uncategorized" | SkillKind

interface UnifiedSkillEntryBase {
  id: string
  /** 底层来源对象的 id（用于启用态、收藏、选择态）。 */
  sourceId: string
  name: string
  description: string
  content: string
  kinds: SkillKind[]
}

interface WritingSkillEntry extends UnifiedSkillEntryBase {
  type: "writing"
  rawSkill: UserSkill
}

interface DeAiSkillEntry extends UnifiedSkillEntryBase {
  type: "de-ai"
  rawSkill: DeAiSkill
}

/**
 * 文风条目是**引用**：只持有项目里那份预设本身。
 * `WritingStylePreset` 没有 tags / kind / categoryId / priority / description / content，
 * 所以这里**不假装**它是 `UserSkill`——这正是「引用而非复制」的类型层表达。
 */
interface WritingStyleEntry extends UnifiedSkillEntryBase {
  type: "style"
  rawStylePreset: WritingStylePreset
}

type UnifiedSkillEntry = WritingSkillEntry | DeAiSkillEntry | WritingStyleEntry

/**
 * 原先这里有一个 `isWritingSkillEntry(entry): entry is WritingSkillEntry` 谓词
 * （`return entry.type === "writing"`），在分类分支里 `list.filter(isWritingSkillEntry)`。
 * 它**已删除**，理由是可验证性：
 *   - 它在运行时一条都筛不掉 —— 写作轴的 tab 拿到的列表
 *     （`entriesByTab.writingSkillLibrary = writingEntries`）按构造就是纯写作条目；
 *   - 于是它的**真值没有任何行为测试能观察到**：把实现改成
 *     `entry.type !== "style"` 这样的谎话，typecheck 与全部用例照样绿。
 * 一个「谁也没法证伪、又筛不掉任何东西」的断言，只会让人以为它守住了什么。
 * 现在这个事实由**类型**承载：`writingSkillToEntry` 的返回类型是
 * `WritingSkillEntry`（见该函数处注释），所以分类分支可以直接用
 * `writingEntries`，不写谓词也拿得到 `rawSkill`——一旦投影不再保证
 * `type: "writing"`，那一行就是编译错误。
 */

/** 卡片类型徽章。显式映射，避免二元三元把新类型静默标成「去AI味」。 */
const ENTRY_TYPE_LABELS: Record<UnifiedSkillEntry["type"], string> = {
  writing: "写作",
  "de-ai": "去AI味",
  style: "文风",
}

/**
 * 条目能力表。显式映射：新类型不会静默继承别的类型的能力。
 * 文风 skill 现在可**启用**（写 `.qmai/writing-style.json` 的 `enabledStyleId`，
 * 单选）且可**打开编辑器**（改名称 / 来源 / 硬约束 / 片段 / 整合文档）；
 * 但**不可收藏**（收藏库只认 writing / de-ai 两种快照形状）。
 */
const ENTRY_CAPABILITIES: Record<UnifiedSkillEntry["type"], {
  favoritable: boolean
  toggleable: boolean
  openable: boolean
}> = {
  writing: { favoritable: true, toggleable: true, openable: true },
  "de-ai": { favoritable: true, toggleable: true, openable: true },
  style: { favoritable: false, toggleable: true, openable: true },
}

/** 启用勾选框文案。显式映射，避免二元三元把新类型写成「显示在调用入口」。 */
const ENTRY_TOGGLE_LABELS: Record<UnifiedSkillEntry["type"], string> = {
  writing: "参与 AI 会话",
  "de-ai": "显示在调用入口",
  style: "启用此文风",
}

/**
 * `writing-style-store.ts:32` 的 `interface WritingStyleStore` **没有 export**，
 * 引用不到类型名；而本批对那个文件是只读的（落盘格式与 `buildWritingStyleContext` 都冻结），
 * 不为一个类型名去动它，改用 `Awaited<ReturnType<…>>` 推导。
 */
type WritingStyleStore = Awaited<ReturnType<typeof loadWritingStyleStore>>

const EMPTY_WRITING_STYLE_STORE: WritingStyleStore = { version: 1, enabledStyleId: null, styles: [] }

/**
 * ⚠️ 三个投影函数的返回类型**必须**写成各自的精确类型（而不是 `UnifiedSkillEntry`）。
 * 这是「写作轴的列表里只有写作条目」这件事的**唯一**真值来源：
 * 写成宽类型，`filteredEntries` 里的分类分支立刻取不到 `rawSkill` 而编译报错；
 * 而靠一个 `isWritingSkillEntry` 谓词在运行时 filter 是**不可验证**的
 * ——写作轴的列表按构造就是纯写作条目，谓词一条都筛不掉，
 * 把实现改成谎话也没有任何行为测试能发现（该谓词已按此理由删除）。
 */
function deAiSkillToEntry(skill: DeAiSkill): DeAiSkillEntry {
  return {
    id: `de-ai:${skill.id}`,
    sourceId: skill.id,
    type: "de-ai",
    name: skill.name,
    description: skill.description,
    content: skill.content,
    kinds: ["rewrite", "style"],
    rawSkill: skill,
  }
}

function writingSkillToEntry(skill: UserSkill): WritingSkillEntry {
  return {
    id: `writing:${skill.id}`,
    sourceId: skill.id,
    type: "writing",
    name: skillDisplayName(skill),
    description: skill.description,
    content: skill.content,
    kinds: skill.kind,
    rawSkill: skill,
  }
}

/**
 * 把项目里的文风预设投影成技能库条目（引用式：只带 `rawStylePreset`）。
 * 预设**没有** description / content / kind / tags 字段：
 *  `description` 由来源作品如实拼出，`content` 只是把画像里可检索的文本拼起来供搜索用，
 *  `kinds` 留空（不把「风格」这个 SkillKind 硬塞给它）。
 */
function writingStylePresetToEntry(preset: WritingStylePreset): WritingStyleEntry {
  const profile = preset.profile
  const samples = Array.isArray(profile?.samples) ? profile.samples : []
  const content = [profile?.integratedDna, profile?.constitution, ...samples]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join("\n")
  return {
    id: `style:${preset.id}`,
    sourceId: preset.id,
    type: "style",
    name: preset.name?.trim() || "未命名文风",
    description: `来源作品《${preset.sourceBook?.trim() || "未知"}》的文风预设。`,
    content,
    kinds: [],
    rawStylePreset: preset,
  }
}

function entrySourceLabel(entry: UnifiedSkillEntry): string {
  if (entry.type === "style") return "引用"
  if (entry.type === "de-ai") {
    const source = entry.rawSkill.source
    if (source === "built-in") return "内置"
    if (source === "legacy") return "旧版"
    return "项目"
  }
  const source = entry.rawSkill.source
  if (source === "built-in") return "内置"
  if (source === "uploaded") return "上传"
  if (source === "linked") return "引用"
  return "项目"
}

/**
 * 搜索用文本。文风与角色灵魂条目没有 `rawSkill`，只能从自身字段取。
 * ⚠️ 这里的判断必须是「哪些类型**有** `rawSkill`」——写成
 * `entry.type !== "style"` 时，`soul`（以及任何后来新增的无 `rawSkill` 类型）
 * 会掉进这一支读 `entry.rawSkill` ⇒ `TS2339: Property 'rawSkill' does not exist`，
 * **编译不过**（实测：还原成那个谓词并保留 `soul` 类型，本文件报 1 处 TS2339）。
 *
 * ⚠️ 别把它读成「有类型系统兜底所以无所谓」：类型系统拦得住，是因为这里
 * **恰好**取了一个只有部分成员才有的字段。真正危险的写法是取一个所有成员都有的
 * 字段（比如 `entry.kinds`）—— 那种分支类型系统**不会**报错，只能靠人想清楚。
 * 换句话说：这一处修的是「写法误导 + 编译不过」，不是「防运行时崩溃」。
 */
function entrySearchValues(entry: UnifiedSkillEntry): string[] {
  const values = [entry.name, entry.description, entry.content]
  if (entry.type === "writing" || entry.type === "de-ai") values.push(entry.rawSkill.name)
  return values
}

function fileBaseName(path: string): string {
  return path.split(/[\\/]/).pop() || "未命名 Skill"
}

function stripSkillFileExtension(name: string): string {
  return name.replace(/\.(json|md|txt)$/i, "")
}

function parseSkillFrontmatter(content: string): { name?: string; description?: string; body: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/)
  if (!match) return { body: content }
  const yamlBlock = match[1]
  const nameMatch = yamlBlock.match(/^name:\s*(.+?)\s*$/m)
  const descMatch = yamlBlock.match(/^description:\s*(.+?)\s*$/m)
  return {
    name: nameMatch ? nameMatch[1].trim() : undefined,
    description: descMatch ? descMatch[1].trim() : undefined,
    body: content.slice(match[0].length),
  }
}

function importedDeAiSkillFromContent(path: string, content: string): DeAiSkill | null {
  const now = Date.now()
  const nameFromPath = stripSkillFileExtension(fileBaseName(path))
  if (/\.json$/i.test(path)) {
    try {
      const parsed = JSON.parse(content)
      if (!parsed || typeof parsed !== "object") return null
      const raw = parsed as Record<string, unknown>
      if (typeof raw.name !== "string" || !raw.name.trim()) return null
      if (typeof raw.content !== "string" || !raw.content.trim()) return null
      return {
        id: `project:${now}`,
        name: raw.name.trim(),
        description: typeof raw.description === "string" ? raw.description.trim() : "",
        templateId: typeof raw.templateId === "string" ? raw.templateId : "custom",
        content: raw.content.trim(),
        source: "project",
        createdAt: now,
        updatedAt: now,
      }
    } catch {
      return null
    }
  }

  const parsed = parseSkillFrontmatter(content)
  const body = parsed.body.trim()
  if (!body) return null
  return {
    id: `project:${now}`,
    name: parsed.name || nameFromPath || "未命名去AI味 Skill",
    description: parsed.description || "",
    templateId: "custom",
    content: body,
    source: "project",
    createdAt: now,
    updatedAt: now,
  }
}

function SkillLibraryActions({ activeTab, onAfterCreate }: { activeTab: GalleryTab; onAfterCreate: () => void }) {
  const project = useWikiStore((s) => s.project)
  const bumpDataVersion = useWikiStore((s) => s.bumpDataVersion)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const setSelectedSkillId = useWikiStore((s) => s.setSelectedSkillLibrarySkillId)
  const setSelectedWritingSkillId = useWikiStore((s) => s.setSelectedWritingSkillLibrarySkillId)
  const setSelectedWritingStyleLibraryStyleId = useWikiStore((s) => s.setSelectedWritingStyleLibraryStyleId)
  const [message, setMessage] = useState("")
  const [saving, setSaving] = useState(false)

  async function persistWritingConfig(nextConfig: UserSkillConfig, nextSkillId: string | null) {
    if (!project || saving) return false
    setSaving(true)
    try {
      await saveUserSkillConfig(project.path, nextConfig)
      if (nextSkillId) setSelectedWritingSkillId(nextSkillId)
      setActiveView("writingSkillLibrary")
      bumpDataVersion()
      setMessage("写作 Skill 已保存")
      return true
    } catch {
      setMessage("写作 Skill 保存失败")
      return false
    } finally {
      setSaving(false)
    }
  }

  async function persistDeAiConfig(nextConfig: DeAiSkillConfig, nextSkillId: string | null) {
    if (!project || saving) return false
    setSaving(true)
    try {
      await saveDeAiSkillConfig(project.path, nextConfig)
      setSelectedSkillId(nextSkillId)
      setActiveView("skillLibrary")
      bumpDataVersion()
      setMessage("去AI味技能已保存")
      return true
    } catch {
      setMessage("去AI味技能保存失败")
      return false
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateDeAiSkill() {
    if (!project || saving) return
    const config = await loadDeAiSkillConfig(project.path)
    const now = Date.now()
    const next = createBlankProjectDeAiSkill(config, now)
    if (await persistDeAiConfig(next, `project:${now}`)) onAfterCreate()
  }

  async function handleImportDeAiSkillFile() {
    if (!project || saving) return
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "去AI味 Skill 文件", extensions: ["json", "md", "txt"] }],
      })
      if (!selected || typeof selected !== "string") return
      const content = await readFile(selected)
      const imported = importedDeAiSkillFromContent(selected, content)
      if (!imported) {
        setMessage("导入失败：文件内容不是有效的去AI味 Skill")
        return
      }
      const config = await loadDeAiSkillConfig(project.path)
      const next = normalizeDeAiSkillConfig({
        ...config,
        defaultSkillId: imported.id,
        projectSkills: [imported, ...config.projectSkills],
      })
      if (await persistDeAiConfig(next, imported.id)) onAfterCreate()
    } catch {
      setMessage("导入去AI味 Skill 失败")
    }
  }

  async function handleCreateWritingSkill() {
    if (!project || saving) return
    const config = await loadUserSkillConfig(project.path)
    const next = createBlankWritingSkill(config)
    if (await persistWritingConfig(next, next.selectedSkillId)) onAfterCreate()
  }

  async function handleImportWritingSkill() {
    if (!project || saving) return
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Skill 文件", extensions: ["json", "md", "txt"] }],
      })
      if (!selected || typeof selected !== "string") return
      const content = await readFile(selected)
      const fileName = fileBaseName(selected)
      const config = await loadUserSkillConfig(project.path)
      const next = /\.json$/i.test(fileName)
        ? (() => {
            const imported = importSkillFromJson(content)
            if (!imported) return null
            return normalizeUserSkillConfig({
              ...config,
              selectedSkillId: imported.id,
              skills: [imported, ...config.skills],
            })
          })()
        : importWritingSkill(config, {
            name: fileName.replace(/\.(md|txt)$/i, ""),
            content,
          })

      if (!next) {
        setMessage("JSON 文件格式不正确，导入失败")
        return
      }
      if (await persistWritingConfig(next, next.selectedSkillId)) onAfterCreate()
    } catch {
      setMessage("导入失败")
    }
  }

  async function handleCreateWritingStyle() {
    if (!project || saving) return
    setSaving(true)
    try {
      // 直接创建一条默认名预设再进编辑器（jsdom 无 window.prompt，且避免双份创建逻辑）。
      const preset = await createWritingStylePreset(project.path, {
        name: "新建文风",
        constitution: "",
      })
      setSelectedWritingStyleLibraryStyleId(preset.id)
      setActiveView("writingStyleLibrary")
      bumpDataVersion()
      setMessage("文风已新建")
      onAfterCreate()
    } catch {
      setMessage("新建文风失败")
    } finally {
      setSaving(false)
    }
  }

  const buttonClass = "ui-test-skills-action"
  const disabled = !project || saving
  const actions = TAB_ACTIONS[activeTab]

  return (
    <div data-testid="skill-library-header-actions" className="ui-test-skills-actions">
      {actions === "de-ai" ? (
        <>
          <button type="button" onClick={() => void handleCreateDeAiSkill()} disabled={disabled} className={buttonClass}>
            <Plus /> 新建技能
          </button>
          <button type="button" onClick={() => void handleImportDeAiSkillFile()} disabled={disabled} className={buttonClass}>
            <Upload /> 导入
          </button>
        </>
      ) : null}
      {actions === "writing" ? (
        <>
          <button type="button" onClick={() => void handleCreateWritingSkill()} disabled={disabled} className={buttonClass}>
            <Plus /> 新建 Skill
          </button>
          <button type="button" onClick={() => void handleImportWritingSkill()} disabled={disabled} className={buttonClass}>
            <Upload /> 导入
          </button>
        </>
      ) : null}
      {actions === "style" ? (
        <>
          <button type="button" onClick={() => void handleCreateWritingStyle()} disabled={disabled} className={buttonClass}>
            <Plus /> 新建文风
          </button>
          {/*
           * 「去拆书库添加文风」。
           *
           * 文风的正经来源是**拆书库的文风提取**（拿一本真实作品跑出 9 维指标 + 风格宪法），
           * 而旁边的「新建文风」只能建一个空壳（`name: "新建文风"` + 空 constitution，
           * 见 `handleCreateWritingStyle`）。两个入口并排，用户才不会以为"新建"就是正路。
           *
           * ⚠️ 目标是**视图名** `bookAnalysis`，不是路由/URL —— 与
           * `ui-test-shell.tsx` 顶栏「拆书库」菜单项、以及
           * `book-analysis-activity-store.ts` 里的跳转用的是同一个字面量。
           * 改这里等于改那两处，别只改一半。
           */}
          <button
            type="button"
            data-testid="skill-library-goto-book-analysis"
            onClick={() => setActiveView("bookAnalysis")}
            /*
             * 只用 `!project`，**不带** `saving`：
             * 这是个纯导航按钮，和「新建」「导入」不一样 —— 它不写任何数据，
             * 没有理由在保存中把用户锁在原地。没项目时禁用（那会儿拆书库也是空的）。
             */
            disabled={!project}
            className={buttonClass}
          >
            <Library /> 去拆书库添加文风
          </button>
        </>
      ) : null}
      {message ? <span className="ui-test-skills-message">{message}</span> : null}
    </div>
  )
}

function SkillCard({
  entry,
  enabled,
  favorited,
  selected,
  badge,
  busy,
  onOpen,
  onSelect,
  onToggleEnabled,
  onToggleFavorite,
}: {
  entry: UnifiedSkillEntry
  enabled: boolean
  favorited: boolean
  selected: boolean
  badge?: string
  busy: boolean
  onOpen: () => void
  onSelect: () => void
  onToggleEnabled: (enabled: boolean) => void
  onToggleFavorite: () => void
}) {
  const capabilities = ENTRY_CAPABILITIES[entry.type]
  const kindLabels = entry.kinds.slice(0, 3).map((kind) => SKILL_KIND_LABELS[kind]).filter(Boolean)
  const activate = () => {
    if (capabilities.openable) onOpen()
    else onSelect()
  }
  return (
    <article
      data-testid={`unified-skill-entry-${entry.id}`}
      role="button"
      tabIndex={0}
      aria-pressed={capabilities.openable ? undefined : selected}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          activate()
        }
      }}
      className={`ui-test-skill-card${selected ? " is-selected" : ""}`}
    >
      <header className="ui-test-skill-card-head">
        <h3 className="ui-test-skill-card-name" title={entry.name}>{entry.name}</h3>
        {capabilities.favoritable ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onToggleFavorite()
            }}
            aria-label={favorited ? "取消收藏" : "收藏"}
            title={favorited ? "取消收藏" : "收藏"}
            className={`ui-test-skill-card-star${favorited ? " is-on" : ""}`}
          >
            <Star fill={favorited ? "currentColor" : "none"} />
          </button>
        ) : null}
      </header>
      <div className="ui-test-skill-card-badges">
        <span className="ui-test-skill-badge is-type">{ENTRY_TYPE_LABELS[entry.type]}</span>
        <span className="ui-test-skill-badge">{entrySourceLabel(entry)}</span>
        {entry.type === "style" && enabled ? (
          <span className="ui-test-skill-badge is-current">当前启用</span>
        ) : null}
        {badge ? <span className="ui-test-skill-badge">{badge}</span> : null}
      </div>
      <p className="ui-test-skill-card-desc">{entry.description || "未填写说明"}</p>
      {kindLabels.length > 0 ? (
        <div className="ui-test-skill-card-kinds">
          {kindLabels.map((label) => (
            <span key={label} className="ui-test-skill-kind">{label}</span>
          ))}
        </div>
      ) : null}
      <footer className="ui-test-skill-card-foot">
        {capabilities.toggleable ? (
          <label className="ui-test-skill-toggle" onClick={(event) => event.stopPropagation()}>
            <input
              type="checkbox"
              checked={enabled}
              disabled={busy}
              onChange={(event) => onToggleEnabled(event.target.checked)}
            />
            {ENTRY_TOGGLE_LABELS[entry.type]}
          </label>
        ) : (
          <span className="ui-test-skill-toggle">{selected ? "已选中" : "点击选中"}</span>
        )}
        {capabilities.openable ? <span className="ui-test-skill-card-open">编辑</span> : null}
      </footer>
    </article>
  )
}

/**
 * 收藏目标：库名 + 要快照的原始技能。文风条目不参与收藏（返回 null）。
 *
 * ⚠️ 这里原先是 `entry.type === "writing" ? "writing" : "de-ai"` —— **二元分支**：
 * 任何**新条目类型**都会静默拿到 `de-ai:` 前缀、被当成去AI味技能收藏
 * （收藏库里落错库名，还会以错误的快照形状出现在「收藏」tab）。
 * 改成穷尽 `switch` 之后，加新类型而没在这里显式决定 = 编译错误。
 * 收藏**键**与收藏**快照**的库名出自同一个 switch，不可能再分叉。
 *
 * ⚠️ 导出**只为测试**（它本来就是模块级纯函数，抽出来免费）：spec 里用 `as never`
 * 造一个「第 4 种条目类型」的输入断言它**抛错**。这条用例是必需的 ——
 * 把 switch 退回二元 `if/else`（= 拆掉 `never` 守卫）对今天这 3 种类型是
 * **外延相等**的，全部既有行为用例照样绿（复核批实测 S1 存活），只有它能把
 * 那次编辑打红。没有它，「加类型必须先在这里显式决定」就只是一句注释。
 */
export function entryFavoriteTarget(
  entry: UnifiedSkillEntry,
): { library: "writing" | "de-ai"; skill: UserSkill | DeAiSkill } | null {
  switch (entry.type) {
    case "writing":
      return { library: "writing", skill: entry.rawSkill }
    case "de-ai":
      return { library: "de-ai", skill: entry.rawSkill }
    case "style":
      return null
    default: {
      const unhandled: never = entry
      throw new Error(`未知的技能条目类型：${String(unhandled)}`)
    }
  }
}

/** 收藏键。库名一律取自 `entryFavoriteTarget`，不另立一份判定。 */
function entryFavoriteKey(entry: UnifiedSkillEntry): string | null {
  const target = entryFavoriteTarget(entry)
  return target ? `${target.library}:${entry.sourceId}` : null
}

/**
 * 条目是否处于「启用」态。
 *
 * ⚠️ 原先最后一行是无条件的 `return writingConfig ? … : true`：任何**新条目类型**
 * 都会静默掉进写作 Skill 的判定里（拿 `writingConfig.disabledSkillIds` 去查一个
 * 不属于它的 id，结果恒为「启用」）。这条路只影响勾选态显示、不写文件，属低危；
 * 但仍然改成穷尽 `switch`：加新类型而没在这里显式决定 = 编译错误。
 *
 * 三份配置原先是从 `SkillGallery` 的闭包里捕获的；为了能像 `entryFavoriteTarget`
 * 一样被**行为**用例钉住，这里抽成模块级纯函数、配置从参数进来 —— 判定逐字未改，
 * 只是把「捕获」换成「显式传入」（这是让那条 `as never` 断言可写的**唯一**代价）。
 * 同 `entryFavoriteTarget`：把 switch 退回 `if/else` 对今天这 3 种类型外延相等、
 * 全部既有用例照样绿（复核批实测 S6 存活），只有 spec 里那条 `toThrow` 能打红它。
 */
export function entryEnabled(
  entry: UnifiedSkillEntry,
  configs: {
    styleStore: WritingStyleStore | null
    deAiConfig: DeAiSkillConfig | null
    writingConfig: UserSkillConfig | null
  },
): boolean {
  switch (entry.type) {
    case "style":
      return configs.styleStore?.enabledStyleId === entry.sourceId
    case "de-ai":
      return configs.deAiConfig ? !configs.deAiConfig.disabledSkillIds.includes(entry.sourceId) : true
    case "writing":
      return configs.writingConfig ? !configs.writingConfig.disabledSkillIds.includes(entry.sourceId) : true
    default: {
      const unhandled: never = entry
      throw new Error(`未知的技能条目类型：${String(unhandled)}`)
    }
  }
}

function entryExtraBadge(
  entry: UnifiedSkillEntry,
  writingConfig: UserSkillConfig | null,
): string | undefined {
  if (entry.type === "writing") {
    return writingConfig?.categories.find((cat) => cat.id === entry.rawSkill.categoryId)?.name
  }
  // 文风条目把来源作品摆在卡片上：它是一条「来自某本书的引用」。
  if (entry.type === "style") return `《${entry.rawStylePreset.sourceBook?.trim() || "未知"}》`
  return undefined
}

function SkillGallery({ activeTab, onOpen }: { activeTab: GalleryTab; onOpen: (entry: UnifiedSkillEntry) => void }) {
  const project = useWikiStore((s) => s.project)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const bumpDataVersion = useWikiStore((s) => s.bumpDataVersion)
  const toggleFavorite = useFavoriteSkillStore((s) => s.toggleFavorite)
  // 必须订阅 favorites 本身：只订阅 isFavorited 函数时，收藏状态变化不会触发重渲染。
  const favorites = useFavoriteSkillStore((s) => s.favorites)
  const favoritedKeys = useMemo(
    () => new Set(favorites.map((favorite) => `${favorite.library}:${favorite.skillId}`)),
    [favorites],
  )
  const [writingConfig, setWritingConfig] = useState<UserSkillConfig | null>(null)
  const [deAiConfig, setDeAiConfig] = useState<DeAiSkillConfig | null>(null)
  const [styleStore, setStyleStore] = useState<WritingStyleStore | null>(null)
  const [selectedStyleId, setSelectedStyleId] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<UnifiedSkillCategory>("all")
  const [loadError, setLoadError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoadError("")
    Promise.all([loadUserSkillConfig(project?.path), loadDeAiSkillConfig(project?.path)])
      .then(([writing, deAi]) => {
        if (cancelled) return
        setWritingConfig(writing)
        setDeAiConfig(deAi)
      })
      .catch(() => {
        if (cancelled) return
        setWritingConfig(null)
        setDeAiConfig(null)
        setLoadError("技能库加载失败")
      })
    /*
     * 文风库走**单独**一条链，绝不并进上面那个 Promise.all：
     * 那个 catch 会把两份配置一起置 null 并显示「技能库加载失败」，
     * 一个来源的故障不该由另外两个来源承担。这里失败只影响文风 tab 自己。
     *
     * ⚠️ 已知限制（**本批不修**，如实记下，别读成已修）：
     * 文风读取失败时，用户看到的仍然是**空库**文案 —— 本组件**没有办法**区分
     * 「这一次读取失败了」和「这个项目还没提炼过文风」。原因是它下面的 loader
     * `loadWritingStyleStore` 把每一次失败（读不到文件、JSON 坏了……）都在内部
     * 吞掉，统一返回 `EMPTY_WRITING_STYLE_STORE` 那个形状，
     * **它的 promise 永远不会 reject**。所以本文件里任何「读取失败」专用文案
     * 或状态位都是**不可达**的：曾有一个 `styleLoadFailed` 想做这个区分，
     * 已按此理由删除（要真的区分，得先改那个 loader）。
     *
     * 这条缺陷在 **loader** 里，属**既有问题**、不在本组件范围内：
     * 它在 `src/lib/novel/writing-style-store.ts`，丁-1 刻意让那个文件零改动、
     * 丁-2 紧接着要重构它 —— 不在本组件里绕开它做第二次加载或猜错误类型。
     *
     * 下面这个 `.catch` 因此是**结构性防御**，不是「已经区分了读取失败」：
     * 今天它打不着（loader 从不 reject），但万一 loader 哪天改成会 reject，
     * 它保证这条链仍然只退化成空文风库，而不会把拒绝抛出去（未处理的 rejection）、
     * 也不会牵连另外两个库。别因为「今天打不着」把它删掉。
     *
     * 顺带：`loadWritingStyleStore(projectPath: string)` 不接受 undefined
     * （两个 Skill loader 接受 null/undefined，但它不接受），所以先判 project?.path。
     */
    const styleLoad = project?.path
      ? loadWritingStyleStore(project.path).catch(() => EMPTY_WRITING_STYLE_STORE)
      : Promise.resolve(EMPTY_WRITING_STYLE_STORE)
    styleLoad.then((store) => {
      if (!cancelled) setStyleStore(store)
    })
    return () => {
      cancelled = true
    }
  }, [dataVersion, project?.path])

  useEffect(() => {
    setCategory("all")
  }, [activeTab])

  const writingEntries = useMemo(
    () => (writingConfig?.skills ?? []).map(writingSkillToEntry),
    [writingConfig],
  )
  const deAiEntries = useMemo(
    () => (deAiConfig ? getAllDeAiSkills(deAiConfig).map(deAiSkillToEntry) : []),
    [deAiConfig],
  )
  const styleEntries = useMemo(
    () => (styleStore?.styles ?? []).map(writingStylePresetToEntry),
    [styleStore],
  )
  /**
   * tab → 条目列表的**显式映射**。
   * 原先 `activeTab === "writingSkillLibrary" ? writingEntries : deAiEntries`：
   * 加第三个成员后文风 tab 会显示**去AI味技能列表**，而 `tsc` 不报错。
   */
  const entriesByTab = useMemo<Record<GalleryTab, UnifiedSkillEntry[]>>(
    () => ({
      skillLibrary: deAiEntries,
      writingSkillLibrary: writingEntries,
      writingStyleLibrary: styleEntries,
    }),
    [writingEntries, deAiEntries, styleEntries],
  )

  const categoryChips = useMemo(() => {
    if (TAB_CATEGORY_AXIS[activeTab] !== "writing") return []
    const chips: { id: UnifiedSkillCategory; label: string }[] = [
      { id: "all", label: "全部" },
      { id: "recent", label: "最近使用" },
      { id: "uncategorized", label: "未分类" },
    ]
    for (const cat of writingConfig?.categories ?? []) {
      chips.push({ id: cat.id as UnifiedSkillCategory, label: cat.name })
    }
    return chips
  }, [activeTab, writingConfig])

  const filteredEntries = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    let list = entriesByTab[activeTab]
    if (TAB_CATEGORY_AXIS[activeTab] === "writing" && category !== "all") {
      /*
       * 分类只属于写作 Skill。直接取 `writingEntries`（精确类型 `WritingSkillEntry[]`），
       * 不从通用列表里 filter 一个谓词——理由见被删掉的 `isWritingSkillEntry` 处注释。
       *
       * ⚠️ 残余缺口（本文件末尾也记了一笔）：这里依赖 `TAB_CATEGORY_AXIS[activeTab]`
       * 与 `entriesByTab[activeTab]` **说的是同一个 tab 的同一份条目**
       * （写作轴 ⇒ `entriesByTab.writingSkillLibrary === writingEntries`）。
       * 这个不变式**没有**编译保护：把某个 tab 的轴改成 `"writing"` 而它的
       * `entriesByTab` 仍指向别的库，就会「不筛时显示 A 库、一按分类跳成写作条目」。
       * 今天只有 `writingSkillLibrary` 一个写作轴、且它的列表就是 `writingEntries`，
       * 所以不变式成立；代价仅是显示错乱（不写任何文件），故不为它加机构。
       */
      const scoped = writingEntries
      if (category === "recent") {
        list = [...scoped].sort((a, b) => (b.rawSkill.updatedAt ?? 0) - (a.rawSkill.updatedAt ?? 0))
      } else if (category === "uncategorized") {
        list = scoped.filter((entry) => !entry.rawSkill.categoryId)
      } else {
        list = scoped.filter((entry) => entry.rawSkill.categoryId === category)
      }
    }
    if (keyword) {
      list = list.filter((entry) =>
        entrySearchValues(entry).some((value) => value.toLowerCase().includes(keyword)),
      )
    }
    return list
  }, [activeTab, entriesByTab, category, query])

  const activeCategoryChip = categoryChips.find(
    (chip) => chip.id === category && chip.id !== "all" && chip.id !== "recent" && chip.id !== "uncategorized",
  )

  async function persistWritingConfig(next: UserSkillConfig) {
    if (!project || busy) return
    setBusy(true)
    try {
      await saveUserSkillConfig(project.path, next)
      setWritingConfig(next)
      bumpDataVersion()
    } catch {
      setLoadError("保存失败")
    } finally {
      setBusy(false)
    }
  }

  async function handleCreateCategory() {
    if (!project || !writingConfig || busy) return
    const name = window.prompt("新建分类名称")?.trim()
    if (!name) return
    await persistWritingConfig(createSkillCategory(writingConfig, name))
  }

  async function handleRenameCategory(categoryId: string, currentName: string) {
    if (!project || !writingConfig || busy) return
    const name = window.prompt("重命名分类", currentName)?.trim()
    if (!name || name === currentName) return
    await persistWritingConfig(renameSkillCategory(writingConfig, categoryId, name))
  }

  async function handleDeleteCategory(categoryId: string, name: string) {
    if (!project || !writingConfig || busy) return
    if (!window.confirm(`确定删除分类「${name}」吗？分类下的 Skill 将变为未分类。`)) return
    setCategory("all")
    await persistWritingConfig(deleteSkillCategory(writingConfig, categoryId))
  }

  async function handleToggleEnabled(entry: UnifiedSkillEntry, enabled: boolean) {
    if (!project || busy) return
    setBusy(true)
    try {
      /*
       * 按类型**显式**分派，不用 `if (writing) … else …`：
       * 那个 else 会把**任何新类型**静默当成去AI味，进而去写
       * `de-ai-skills.json`——**写错另一个库的文件**，本文件里后果最重的一条路。
       * 文风 skill 的勾选**只**写 `.qmai/writing-style.json` 的 `enabledStyleId`（单选启用）。
       *
       * 这个 switch 有**两道**编译保护，别只看到一道：
       *  (a) 加新条目类型而没补 case ⇒ `default` 里的 `entry` 不是 `never`，报错；
       *  (b) 删掉 `case "style"` ⇒ 文风条目掉进 `default`，`entry` 被收窄成
       *      `WritingStyleEntry`（同样不是 `never`），一样报错。
       * 行为侧由 `unified-skill-library-view.spec.tsx` 的
       * 「勾选…只写对应那个库的 json」两条用例钉住。
       */
      switch (entry.type) {
        case "de-ai": {
          if (!deAiConfig) return
          const next = setDeAiSkillEnabled(deAiConfig, entry.sourceId, enabled)
          await saveDeAiSkillConfig(project.path, next)
          setDeAiConfig(next)
          bumpDataVersion()
          break
        }
        case "writing": {
          if (!writingConfig) return
          const next = setWritingSkillEnabled(writingConfig, entry.sourceId, enabled)
          await saveUserSkillConfig(project.path, next)
          setWritingConfig(next)
          bumpDataVersion()
          break
        }
        case "style": {
          // 文风 skill：单选启用 —— 只写 `.qmai/writing-style.json` 的 `enabledStyleId`。
          const next = await setEnabledWritingStyle(project.path, enabled ? entry.sourceId : null)
          setStyleStore(next)
          bumpDataVersion()
          break
        }
        default: {
          /*
           * 穷尽性检查：`switch (entry.type)` 已穷尽时 `entry` 本身被收窄成 `never`，
           * 所以取的是 `entry` 而不是 `entry.type`。
           * 将来新增条目类型而这里没补 case，本行就是**编译错误**。
           */
          const unhandled: never = entry
          throw new Error(`未知的技能条目类型：${String(unhandled)}`)
        }
      }
    } catch {
      setLoadError("保存失败")
    } finally {
      setBusy(false)
    }
  }

  /*
   * ⚠️ 这里**故意**没有「读取失败」专用文案：本组件区分不了读取故障与空库
   * （原因与本批的裁决见 `styleLoad` 处注释）。曾有一个 `styleLoadFailed` 三元，
   * 那个分支**不可达**，已连同状态位一起删除 —— 别以「对用户更友好」为由加回来，
   * 除非先让 loader 把「读取失败」和「空库」区分开。
   */
  const emptyCopy = EMPTY_COPY[activeTab]

  return (
    <div className="ui-test-skills-gallery">
      <div className="ui-test-skills-toolbar">
        <label className="ui-test-skills-search">
          <Search />
          <input
            data-testid="unified-skill-search-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索技能名称、说明或规则"
          />
        </label>
        {categoryChips.length > 0 ? (
          <div className="ui-test-skills-chips">
            {categoryChips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                aria-pressed={category === chip.id}
                onClick={() => setCategory(chip.id)}
                className={`ui-test-skills-chip${category === chip.id ? " is-active" : ""}`}
              >
                {chip.label}
              </button>
            ))}
            <button
              type="button"
              className="ui-test-skills-chip is-add"
              onClick={() => void handleCreateCategory()}
              disabled={!writingConfig || busy}
            >
              + 新建分类
            </button>
            {activeCategoryChip ? (
              <>
                <button
                  type="button"
                  className="ui-test-skills-chip is-ghost"
                  onClick={() => void handleRenameCategory(activeCategoryChip.id, activeCategoryChip.label)}
                >
                  重命名
                </button>
                <button
                  type="button"
                  className="ui-test-skills-chip is-ghost is-danger"
                  onClick={() => void handleDeleteCategory(activeCategoryChip.id, activeCategoryChip.label)}
                >
                  删除
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {loadError ? <div className="ui-test-skills-error">{loadError}</div> : null}

      {filteredEntries.length === 0 && !loadError ? (
        <div className="ui-test-skills-empty">{query.trim() ? "没有匹配的技能。" : emptyCopy}</div>
      ) : (
        <div className="ui-test-skills-grid">
          {filteredEntries.map((entry) => {
            const favoriteKey = entryFavoriteKey(entry)
            return (
              <SkillCard
                key={entry.id}
                entry={entry}
                enabled={entryEnabled(entry, { styleStore, deAiConfig, writingConfig })}
                favorited={favoriteKey !== null && favoritedKeys.has(favoriteKey)}
                selected={entry.type === "style" && selectedStyleId === entry.sourceId}
                badge={entryExtraBadge(entry, writingConfig)}
                busy={busy}
                onOpen={() => onOpen(entry)}
                onSelect={() => {
                  // 文风条目是引用：选中只改本组件的本地状态，**不落盘、不写项目设置**。
                  if (entry.type === "style") setSelectedStyleId(entry.sourceId)
                }}
                onToggleEnabled={(enabled) => void handleToggleEnabled(entry, enabled)}
                onToggleFavorite={() => {
                  const target = entryFavoriteTarget(entry)
                  if (!target) return
                  void toggleFavorite({
                    library: target.library,
                    skill: target.skill,
                    originProjectPath: project?.path,
                  })
                }}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * 内容区分派。
 *
 * 先用 `if` 把「收藏」与「人物 Skill」两个**非画廊** tab 收窄掉，
 * 于是下面的 `SKILL_EDITORS[activeTab]` 拿到的是 `GalleryTab`——不需要 `as` 断言，
 * 也就不会把「新 tab 漏了编辑器」这件事藏进一个宽类型里。
 *
 * 合并说明：`personaSkillLibrary` 在这里渲染 `main` 的 `PersonaSkillView`，
 * 且**不看 `editing`** —— 人物页是整块独立视图（自己管自己的编辑态），
 * 与「收藏」同档；它也不进 `SKILL_EDITORS`（那张表只服务画廊 tab）。
 */
function SkillLibraryContent({
  activeTab,
  editing,
  onOpen,
  onBack,
}: {
  activeTab: SkillLibraryTab
  editing: boolean
  onOpen: (entry: UnifiedSkillEntry) => void
  onBack: () => void
}) {
  if (activeTab === "skillFavorites") return <FavoriteListView />
  if (activeTab === "personaSkillLibrary")
    return (
      <>
        {/*
         * 人物 Skill tab 顶部的自进化开关面板，同文风 tab 的 StyleEvolutionPanel：
         * 「一块说明 + 一个开关」，挂在列表之上、不进 SKILL_EDITORS。
         */}
        <PersonaSkillEvolutionPanel />
        <PersonaSkillView />
      </>
    )
  const Editor = SKILL_EDITORS[activeTab]
  if (!editing) {
    /*
     * 「文风 skill」tab 额外挂一块自进化开关面板。
     *
     * ⚠️ 它**不是**画廊条目、也不进 `SKILL_EDITORS`：面板是「一块说明 + 一个开关」，
     * 不随 `editing` 切换，也没有可编辑的草稿形态。塞进编辑器表会让 `editing`
     * 为 false 时它整个不渲染 —— 而它恰恰是用户平时最需要看到的那块。
     *
     * 合并说明：这块来自 main 的文风自进化工作；本分支重写了本文件的 tab 结构
     * （文风改成完整编辑器、删掉「角色灵魂」tab），合并时按用户要求保留面板。
     */
    return (
      <>
        {activeTab === "writingStyleLibrary" ? <StyleEvolutionPanel /> : null}
        <SkillGallery activeTab={activeTab} onOpen={onOpen} />
      </>
    )
  }
  return (
    <div className="ui-test-skills-editor">
      <button type="button" className="ui-test-skills-back" onClick={onBack}>
        <ArrowLeft /> 返回技能库
      </button>
      <Editor />
    </div>
  )
}

export function UnifiedSkillLibraryView() {
  const activeView = useWikiStore((s) => s.activeView)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const setSelectedSkillId = useWikiStore((s) => s.setSelectedSkillLibrarySkillId)
  const setSelectedWritingSkillId = useWikiStore((s) => s.setSelectedWritingSkillLibrarySkillId)
  const setSelectedWritingStyleLibraryStyleId = useWikiStore((s) => s.setSelectedWritingStyleLibraryStyleId)
  const skillDraftDirty = useWikiStore((s) => s.skillLibraryDraftDirty)
  const writingDraftDirty = useWikiStore((s) => s.writingSkillLibraryDraftDirty)
  const setSkillDraftDirty = useWikiStore((s) => s.setSkillLibraryDraftDirty)
  const setWritingDraftDirty = useWikiStore((s) => s.setWritingSkillLibraryDraftDirty)
  const personaDraftDirty = useWikiStore((s) => s.personaSkillLibraryDraftDirty)
  const setPersonaDraftDirty = useWikiStore((s) => s.setPersonaSkillLibraryDraftDirty)

  const [editing, setEditing] = useState(false)

  /*
   * 合并说明：采用本分支的 `resolveActiveTab`（显式 Record 映射，加 tab 漏映射
   * 是编译错误），而不是 `main` 那串二元三元链 —— 后者给联合类型加成员时
   * 每处三元都仍合法编译、静默落到 else。`main` 的 `personaSkillLibrary`
   * 已并入该 Record 与 `skillLibraryTabs`，行为不变。
   */
  const activeTab = resolveActiveTab(activeView)
  const draftKind = TAB_DRAFT_KIND[activeTab]

  useEffect(() => {
    setEditing(false)
  }, [activeView])

  function handleBackToList() {
    const dirty = tabDraftDirty(draftKind, skillDraftDirty, writingDraftDirty, personaDraftDirty)
    if (dirty) {
      if (!confirmDiscardSkillLibraryDraft()) return
      if (draftKind === "writing") setWritingDraftDirty(false)
      else if (draftKind === "skill") setSkillDraftDirty(false)
      // 合并说明：`main` 的人物 Skill 有自己的脏标记，清的时候不能落下它。
      else if (draftKind === "persona") setPersonaDraftDirty(false)
    }
    setEditing(false)
  }

  /**
   * 点开一个条目：把「选中态该写哪个库」与「要不要进编辑器」一次决定清楚。
   *
   * ⚠️ 这里原先写作：
   *    `if (entry.type === "style") return` // 否则会渲染成**另一个库**的编辑器
   * ——**这句是错的**（实测：单独去掉该行后不会渲染别的库的编辑器）。真实后果是：
   * `else` 分支把文风条目按去AI味处理，把 `preset:cool` 这种**不属于该库的 id**
   * 写进 `selectedSkillLibrarySkillId`，而 `SKILL_EDITORS.writingStyleLibrary = () => null`
   * 让编辑器区渲染成**空白死胡同**。两个守卫（本分支与那张表）是**各自独立**的
   * 两道防线，所以单独拆掉任何一道都只退化、不致命 —— 但两道都会把
   * 选中态写脏，那才是真正要防的。
   *
   * 现在改成穷尽 `switch`：新条目类型必须先在这里**显式**决定去哪儿，
   * 删掉 `case "style"` 也会因为 `default` 里拿不到 `never` 而编译报错。
   */
  function handleOpenEntry(entry: UnifiedSkillEntry) {
    switch (entry.type) {
      case "writing":
        setSelectedWritingSkillId(entry.sourceId)
        setEditing(true)
        return
      case "de-ai":
        setSelectedSkillId(entry.sourceId)
        setEditing(true)
        return
      case "style":
        // 文风 skill：选中对应预设并进入编辑器（名称 / 来源 / 硬约束 / 片段 / 整合文档）。
        setSelectedWritingStyleLibraryStyleId(entry.sourceId)
        setEditing(true)
        return
      default: {
        const unhandled: never = entry
        throw new Error(`未知的技能条目类型：${String(unhandled)}`)
      }
    }
  }

  return (
    <div
      data-ui-page="skills"
      data-ui-state={activeView}
      data-testid="unified-skill-library-view"
      className="ui-test-skills-page"
    >
      <header data-ui="skills-tabs">
        <div className="ui-test-skills-heading-row">
          <div className="ui-test-skills-heading-copy">
            <h1>技能库</h1>
            <p>管理写作 Skill、去AI味技能与人物 Skill，点开卡片即可编辑。</p>
          </div>
          {!editing && activeTab !== "skillFavorites" && activeTab !== "personaSkillLibrary" ? (
            <SkillLibraryActions activeTab={activeTab} onAfterCreate={() => setEditing(true)} />
          ) : null}
        </div>
        <nav className="ui-test-skills-tab-row" aria-label="技能分类">
          {skillLibraryTabs.map((tab) => (
            <button
              key={tab.view}
              type="button"
              aria-pressed={activeTab === tab.view}
              onClick={() => {
                if (tab.view === activeView) {
                  handleBackToList()
                  return
                }
                setActiveView(tab.view)
              }}
              className={`ui-test-skills-tab${activeTab === tab.view ? " is-active" : ""}`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      <div data-ui="skills-content">
        <SkillLibraryContent
          activeTab={activeTab}
          editing={editing}
          onOpen={handleOpenEntry}
          onBack={handleBackToList}
        />
      </div>
    </div>
  )
}

/* ============================================================================
 * RESIDUAL GAPS —— 本文件里**没有**编译保护的 `entry.type` 分派
 * ============================================================================
 *
 * 写这一段是因为「加了 tab 忘了补表就是编译错误」这句话很容易被读成
 * 「本文件所有分派都受保护」。事实不是：`entry.type` 上的分派点里受保护的
 * 只有 **8** 处 —— 3 张 `Record` 表 + 4 个穷尽 `switch` + `entrySourceLabel`
 * （清单与实测方式见文件顶部注释）。下面这些点对**新条目类型**是静默的。
 * 逐条写明后果，读完能判断风险，不会把一句概括当成保证：
 *
 * 1. `entryExtraBadge`：**分支式**，不是 `Record`。**下一个**新类型会落在最后的
 *    `return undefined`，卡片上少一个额外徽章。**故意不守**——缺徽章是安全默认值，
 *    为它加一个 `switch` 只是把同样的样板再抄一遍，不减少任何风险。
 *    ⚠️ 别把这条读成「`entryExtraBadge` 加类型时什么都不用想」：它还要读
 *    `writingConfig` 这类额外入参，加类型时是**需要**人来判断的，只是判断错了不红。
 * 2. `entrySearchValues`：**分支式**，写成「枚举有 `rawSkill` 的类型」
 *    （`writing` / `de-ai`），所以新类型默认**不**进这一支 = 安全默认值（搜索少一个
 *    关键词，不会崩）。⚠️ 它原先写成 `entry.type !== "style"`，那形状下新增的
 *    无 `rawSkill` 类型会掉进去读 `undefined.name`，**搜索时运行时崩溃**——已在丁-4 改掉。
 * 3. `entrySourceLabel`：分支式 `if` 链（`style` / `de-ai` 各有显式分支），
 *    但**它是受保护的**——它的最后一段要读 `entry.rawSkill`，而 `rawSkill` 只在
 *    `writing` / `de-ai` 两种类型上 ⇒ 新类型若不带 `rawSkill` 就是
 *    `TS2339: Property 'rawSkill' does not exist on type '… | NewEntry'`。
 *    （实测：临时往联合里塞第 4 种不带 `rawSkill` 的类型，本文件报 **8** 处错，
 *    其中一处正是这一行；把那个类型改成带 `rawSkill` 就只剩 7 处。所以它
 *    **不**属于「静默」。）
 * 4. 卡片上的三个呈现分支：`selected`（`entry.type === "style" && …`）、
 *    `onSelect`（同前，新类型是 no-op）、以及「当前启用」徽章（同前）。
 *    新类型一律恒 `false` / no-op —— 显示层退化，无副作用。
 * 5. `filteredEntries` 里「写作轴 ⇒ `entriesByTab[activeTab] === writingEntries`」
 *    这个不变式（见该处注释）：轴与列表是两张表，改了一张没改另一张不会报错，
 *    后果是该 tab 的分类筛选会跳到写作条目上。只影响显示，不写文件。
 * 6. ⚠️ 四个穷尽 `switch` 的 `never` 守卫**只在该 switch 存在时**才成立：
 *    「把 switch 退回二元 `if/else`」这个动作本身**就等于拆掉守卫**，而对
 *    **今天这 3 种类型**它是**外延相等**的 —— 全部行为用例照样绿
 *    （复核批实测 S1 / S6 存活）。这是本文件保护机制最脆弱的一处。
 *    现在它**不再静默**，两道新证据分别盖住两类站点：
 *      - `entryFavoriteTarget` / `entryEnabled` 已抽成**模块级纯函数并导出**，
 *        由 spec 里 `as never` 造第 4 种类型的 `toThrow` 用例钉住；
 *      - `handleToggleEnabled` / `handleOpenEntry` 是**闭包**（依赖 project /
 *        busy / 选中态），jsdom 里造不出第 4 种类型，所以**那两个 `case` 本身**
 *        在运行时不可达，只能由一条**源码级**用例兜底：`const unhandled: never = entry`
 *        **紧跟** `throw new Error(` 这个**构造**在本文件里必须**恰好 4 处**
 *        （数字就是顶部注释承诺的穷尽 switch 数；将来真加第 5 个
 *        穷尽 switch，请连顶部注释一起改）。
 *        ⚠️ 别去 grep `const unhandled: never = entry` 这串字面量来数：
 *        它在文件里出现 **5** 次（4 个构造 + 这条注释自己）。用例断的是**构造**。
 *        ⚠️ 「那两个 case 不可达」**不**等于「没有行为证据」：真正决定它们会不会
 *        被走到的是**能力标志**，而能力标志**有**行为钉 ——
 *        把 `ENTRY_CAPABILITIES.style.toggleable` 改成 `false`（或把 `.openable`
 *        改回 `false`）都会有用例红（走的是卡片上的勾选框 / `.ui-test-skill-card-open`
 *        那条路）。所以这里是「守卫本身只能源码级兜底」，不是「这整块没人管」。
 *    这**不是**说守卫已经不可能被删 —— 改源码当然删得掉，只是删了会有用例红。
 *
 * **有后果的两条路**已经全部受保护，但**证据形式不同**，别搞混：
 *   - 写错库的文件 → `handleToggleEnabled` 的穷尽 `switch`（**编译期**）
 *     ＋「勾选…只写对应那个库的 json」用例（**真行为**，断真实写入路径）；
 *   - 路由错库的编辑器与选中态 → `handleOpenEntry` 的穷尽 `switch`（**编译期**）
 *     ＋ `handleOpenEntry` 的 `case "style"` 由行为用例钉住：点开一张文风卡片
 *     会进编辑器、并把 `selectedWritingStyleLibraryStyleId` 写成该预设 id
 *     （见 `unified-skill-library-view.spec.tsx` 的「文风条目是引用」用例）。
 * 若将来往 `UnifiedSkillEntry` 加第 4 种类型，上面 1/2/3 需要**人工**复查。
 * ========================================================================== */
