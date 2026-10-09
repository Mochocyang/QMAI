/**
 * 为章节记忆提取准备「已建立的设定」。
 *
 * ## 为什么需要它
 *
 * 物品分类里有两类判断：
 * - **归属**（主角/配角/反派在用）——不先知道谁是主角/配角/反派就无从归类；
 * - **有无意义**——用户明确要求「对着前面已写的内容判断」，因为一件道具的意义
 *   是随剧情建立的（第 3 章的一把钥匙，第 30 章揭示是祖宅钥匙时才有意义）。
 *
 * 章节提取原本是「本章正文 → JSON」的一次性调用，模型看不到任何已建立内容，
 * 只能凭「贵不贵重」猜。这里把最小必要的两项喂进去：**角色定位名册**与**已埋设伏笔**。
 *
 * ## 为什么取这两项、且只从这些低成本来源取
 *
 * - 角色定位：`wiki/characters/角色-<定位>-<名>.md` 的**文件名**就带定位，
 *   列一次目录即可，**不用读任何角色文件正文**（那是几十次 I/O）。
 * - 已埋设伏笔：`loadForeshadowingTracker` 一次读盘，取描述即可 ——
 *   描述本身就是「什么还有待回收」，正是判断道具是否有意义最直接的参照。
 *
 * 全程 best-effort：任何一步失败都只丢掉那一项。提取是摄取链的关键路径，
 * 不能因为「锦上添花的分类提示」把整章摄取搞失败。
 */

import { listDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { CHARACTER_ROLE_TYPES } from "./character-multi-agent"
import { loadForeshadowingTracker } from "./foreshadowing-tracker"

/** 已建立设定的字符上限，避免把提取提示词撑大（提取预算很紧）。 */
const ESTABLISHED_CONTEXT_MAX_CHARS = 1_500

/** 最多列几个角色 / 几条伏笔，防止长篇里名册本身变成大段文本。 */
const MAX_ROSTER_ENTRIES = 40
const MAX_FORESHADOWING_ENTRIES = 20

export interface CharacterRoleEntry {
  name: string
  role: string
}

/**
 * 从角色文件名解析定位：`角色-主角-萧炎.md` → `{ role: "主角", name: "萧炎" }`。
 *
 * 用「以某个已知定位 + `-` 开头」来匹配而不是 `split("-")`：角色名里可能含 `-`
 * （sanitize 未必把它替换掉），按分隔符硬切会把名字截断。
 * 解析不出就返回 null —— 识别不了的条目宁可不进名册，也不要塞一个错定位给模型。
 */
export function parseCharacterRoleFileName(fileName: string): CharacterRoleEntry | null {
  if (!fileName.endsWith(".md")) return null
  const stem = fileName.slice(0, -".md".length)
  if (!stem.startsWith("角色-")) return null
  const rest = stem.slice("角色-".length)
  for (const role of CHARACTER_ROLE_TYPES) {
    if (rest.startsWith(`${role}-`)) {
      const name = rest.slice(role.length + 1).trim()
      return name ? { name, role } : null
    }
  }
  return null
}

/**
 * 构建提取用的「已建立设定」文本；没有可用内容时返回空串。
 */
export async function buildEstablishedContextForExtraction(
  projectPath: string,
): Promise<string> {
  const pp = normalizePath(projectPath)
  const blocks: string[] = []

  try {
    const nodes = await listDirectory(`${pp}/wiki/characters`)
    const roster = nodes
      .map((node) => parseCharacterRoleFileName(node.name))
      .filter((entry): entry is CharacterRoleEntry => entry !== null)
      .slice(0, MAX_ROSTER_ENTRIES)
    if (roster.length > 0) {
      blocks.push(
        `已建立的角色定位：${roster.map((entry) => `${entry.name}（${entry.role}）`).join("、")}`,
      )
    }
  } catch { /* 没有角色目录就是没有名册，不影响提取 */ }

  try {
    const store = await loadForeshadowingTracker(pp).catch(() => null)
    const active = (store?.items ?? [])
      .filter((item) => item.status !== "abandoned")
      .slice(0, MAX_FORESHADOWING_ENTRIES)
      .map((item) => item.description)
      .filter((description) => description.trim().length > 0)
    if (active.length > 0) {
      blocks.push(`尚未回收的伏笔：${active.join("；")}`)
    }
  } catch { /* 同理：伏笔读不到只是少一项参照 */ }

  if (blocks.length === 0) return ""

  const joined = blocks.join("\n")
  return joined.length <= ESTABLISHED_CONTEXT_MAX_CHARS
    ? joined
    : `${joined.slice(0, ESTABLISHED_CONTEXT_MAX_CHARS - 1)}…`
}
