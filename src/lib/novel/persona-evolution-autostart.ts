/**
 * 首个角色建档时自动开启「人物 Skill 自进化」。
 *
 * 用户口径：新生成的角色「自动进入人物小传，并且开启了自动进化的功能」。
 * 但这里不能简单把 enabled 写成 true —— 那会覆盖用户的手动选择。
 *
 * 判定只有两条：
 * 1. 项目还没有进化状态文件 → 这是第一次建档，按用户意愿开启；
 * 2. 文件存在且 enabled === true → 已经开着，什么都不做。
 * 其余情况（文件在、但 enabled === false）一律视为「用户关掉过」，尊重用户。
 *
 * 为什么单独一个模块而不塞进 sync：sync 里还负责投影和引用，逻辑已经够满；
 * 这条规则只有一处判断，但要长期被 review，独立出来更好读也更好测。
 *
 * ⚠️ 不能用「读出来的 enabled 是否为 false」来判断：loadPersonaSkillEvolutionState
 * 把「文件不存在」「JSON 损坏」「读取失败」统统退化成默认的 enabled:false，
 * 三者无法区分。要分辨「从没启用过」和「用户明确关掉过」，只能看文件在不在。
 */
import { fileExists } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import {
  loadPersonaSkillEvolutionState,
  savePersonaSkillEvolutionState,
} from "./persona-skill-evolution-store"

/** 与 persona-skill-evolution-store 的私有 storePath 保持同一落点。 */
function evolutionStorePath(projectPath: string): string {
  return `${normalizePath(projectPath)}/.qmai/persona-skill-evolution.json`
}

export async function enablePersonaEvolutionOnFirstBuild(projectPath: string): Promise<boolean> {
  let existed = false
  try {
    existed = await fileExists(evolutionStorePath(projectPath))
  } catch {
    // 连「在不在」都问不出来时保守处理：当作已存在，不去碰用户的设置。
    existed = true
  }

  // 已经有状态文件：无论开着还是关着，都不动它。用户关过就是关过。
  if (existed) {
    const state = await loadPersonaSkillEvolutionState(projectPath)
    return state.enabled
  }

  await savePersonaSkillEvolutionState(projectPath, {
    version: 1,
    enabled: true,
    rounds: [],
    processedAt: {},
    lastOpenDate: "",
    lastAttemptedOn: "",
    openDayCount: 0,
    nextThreshold: 3,
    lastAnalyzedOn: null,
  })
  return true
}
