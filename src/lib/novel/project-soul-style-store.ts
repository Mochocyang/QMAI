import { createDirectory, readFile, writeFileAtomic } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { readSoulDoc, writeSoulDoc } from "./soul-doc"

const PROJECT_SOUL_STYLE_STORE_FILENAME = "project-soul-styles.json"

export interface ProjectSoulStyle {
  id: string
  name: string
  content: string
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export interface ProjectSoulStyleStore {
  version: 1
  enabledStyleId: string | null
  styles: ProjectSoulStyle[]
}

function storePath(projectPath: string): string {
  return `${normalizePath(projectPath)}/.qmai/${PROJECT_SOUL_STYLE_STORE_FILENAME}`
}

function storeDir(projectPath: string): string {
  return `${normalizePath(projectPath)}/.qmai`
}

function makeId(): string {
  return `project-soul-style-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function createEmptyProjectSoulStyle(name = "新写作风格"): ProjectSoulStyle {
  const now = Date.now()
  return {
    id: makeId(),
    name,
    content: "",
    enabled: false,
    createdAt: now,
    updatedAt: now,
  }
}

function createDefaultStore(content = ""): ProjectSoulStyleStore {
  const style: ProjectSoulStyle = {
    ...createEmptyProjectSoulStyle("默认项目灵魂"),
    content,
    enabled: true,
  }
  return {
    version: 1,
    enabledStyleId: style.id,
    styles: [style],
  }
}

function normalizeProjectSoulStyleStore(input: Partial<ProjectSoulStyleStore> | null | undefined): ProjectSoulStyleStore {
  const rawStyles = Array.isArray(input?.styles) ? input.styles : []
  if (rawStyles.length === 0) return createDefaultStore("")

  const styles: ProjectSoulStyle[] = rawStyles.map((style, index) => {
    const now = Date.now()
    return {
      id: typeof style.id === "string" && style.id.trim() ? style.id : makeId(),
      name: typeof style.name === "string" && style.name.trim() ? style.name.trim() : `写作风格 ${index + 1}`,
      content: typeof style.content === "string" ? style.content : "",
      enabled: Boolean(style.enabled),
      createdAt: typeof style.createdAt === "number" ? style.createdAt : now,
      updatedAt: typeof style.updatedAt === "number" ? style.updatedAt : now,
    }
  })

  const requestedEnabledId = typeof input?.enabledStyleId === "string" ? input.enabledStyleId : null
  const enabledStyleId = styles.some((style) => style.id === requestedEnabledId)
    ? requestedEnabledId
    : styles.find((style) => style.enabled)?.id ?? styles[0]?.id ?? null

  return {
    version: 1,
    enabledStyleId,
    styles: styles.map((style) => ({
      ...style,
      enabled: style.id === enabledStyleId,
    })),
  }
}

export async function loadProjectSoulStyleStore(projectPath: string): Promise<ProjectSoulStyleStore> {
  try {
    const raw = await readFile(storePath(projectPath))
    return normalizeProjectSoulStyleStore(JSON.parse(raw) as Partial<ProjectSoulStyleStore>)
  } catch {
    const legacySoulDoc = await readSoulDoc(projectPath)
    return createDefaultStore(legacySoulDoc)
  }
}

export async function saveProjectSoulStyleStore(projectPath: string, store: ProjectSoulStyleStore): Promise<ProjectSoulStyleStore> {
  const normalized = normalizeProjectSoulStyleStore(store)
  await createDirectory(storeDir(projectPath))
  await writeFileAtomic(storePath(projectPath), JSON.stringify(normalized, null, 2))
  const enabledStyle = normalized.styles.find((style) => style.id === normalized.enabledStyleId)
  await writeSoulDoc(projectPath, enabledStyle?.content ?? "")
  return normalized
}
