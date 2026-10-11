/**
 * 「舞台情景」会话持久化
 *
 * 将会话保存到项目的 .qmai/simulations/scenarios/{id}.json，
 * 便于后续回顾与继续。仿照 interview-store.ts 的实现。
 */

import {
  createDirectory,
  writeFileAtomic,
  listDirectory,
  deleteFile,
  readFile,
} from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import type { FileNode } from "@/types/wiki"
import type { ScenarioSession } from "./scenario-types"

const SCENARIOS_DIR = ".qmai/simulations/scenarios"

export function scenariosDir(projectPath: string): string {
  return `${normalizePath(projectPath)}/${SCENARIOS_DIR}`
}

function scenarioFilePath(projectPath: string, id: string): string {
  return `${scenariosDir(projectPath)}/${id}.json`
}

/**
 * 保存舞台情景会话。
 * @returns 会话 id
 */
export async function saveScenario(
  projectPath: string,
  session: ScenarioSession,
): Promise<string> {
  const dir = scenariosDir(projectPath)
  await createDirectory(dir)

  const payload: ScenarioSession = {
    ...session,
    updatedAt: new Date().toISOString(),
  }

  // 若已存在，保留原始 createdAt
  try {
    const existing = await readFile(scenarioFilePath(projectPath, session.id))
    const parsed = JSON.parse(existing) as ScenarioSession
    if (parsed?.createdAt) payload.createdAt = parsed.createdAt
  } catch {
    // 新文件，使用传入/当前时间
  }

  await writeFileAtomic(
    scenarioFilePath(projectPath, session.id),
    JSON.stringify(payload, null, 2),
  )
  return session.id
}

/**
 * 加载所有舞台情景会话，按 updatedAt 降序排列。
 */
export async function loadScenarios(
  projectPath: string,
): Promise<ScenarioSession[]> {
  const dir = scenariosDir(projectPath)
  let entries: FileNode[]
  try {
    entries = await listDirectory(dir)
  } catch {
    return []
  }

  const sessions: ScenarioSession[] = []
  for (const entry of entries) {
    if (entry.is_dir) continue
    if (!entry.name.toLowerCase().endsWith(".json")) continue
    try {
      const content = await readFile(entry.path)
      const parsed = JSON.parse(content) as ScenarioSession
      if (parsed && parsed.setup && Array.isArray(parsed.messages)) {
        sessions.push(parsed)
      }
    } catch {
      // 跳过无法读取的文件
    }
  }

  sessions.sort((a, b) => {
    if (a.updatedAt < b.updatedAt) return 1
    if (a.updatedAt > b.updatedAt) return -1
    return 0
  })
  return sessions
}

/** 删除指定舞台情景会话。 */
export async function deleteScenario(
  projectPath: string,
  id: string,
): Promise<void> {
  try {
    await deleteFile(scenarioFilePath(projectPath, id))
  } catch {
    // 文件可能不存在
  }
}
