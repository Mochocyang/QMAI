import { readFile, writeFileAtomic, fileExists, listDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import type { ClassificationConfig, RouteRule, LoadClassificationResult, DataSourceCategory, ClassificationVersionCheckResult } from "./types"
import { deserializeClassificationFromMarkdown, serializeClassificationToMarkdown, generateDefaultClassificationMarkdown } from "./markdown-serializer"
import { DEFAULT_CLASSIFICATION_CONFIG, hasDefaultRoute } from "./default-routes"

const CLASSIFICATION_DIR = "classification"
const CLASSIFICATION_FILENAME = "classification.md"

export async function loadClassificationConfig(
  projectPath: string,
  featureName?: string
): Promise<LoadClassificationResult> {
  const pp = normalizePath(projectPath)

  let projectConfig: ClassificationConfig | null = null
  let fallbackReason: string | undefined

  try {
    projectConfig = await loadProjectClassification(pp)
  } catch (e) {
    fallbackReason = `项目级 classification.md 加载失败：${e instanceof Error ? e.message : String(e)}`
  }

  if (!projectConfig) {
    return {
      config: DEFAULT_CLASSIFICATION_CONFIG,
      source: "default",
      fallbackReason,
      versionInfo: checkClassificationVersion(DEFAULT_CLASSIFICATION_CONFIG),
    }
  }

  if (!featureName) {
    return {
      config: projectConfig,
      source: "project",
      versionInfo: checkClassificationVersion(projectConfig),
    }
  }

  try {
    const featureConfig = await loadFeatureClassification(pp, featureName)
    if (featureConfig) {
      const merged = mergeRoutes(projectConfig.routes, featureConfig.routes)
      const mergedConfig = { ...projectConfig, routes: merged }
      return {
        config: mergedConfig,
        source: "project_with_feature",
        versionInfo: checkClassificationVersion(projectConfig),
      }
    }
  } catch (e) {
    fallbackReason = `分支级 classification 加载失败：${e instanceof Error ? e.message : String(e)}`
  }

  return {
    config: projectConfig,
    source: "project",
    fallbackReason,
    versionInfo: checkClassificationVersion(projectConfig),
  }
}

export async function loadProjectClassification(projectPath: string): Promise<ClassificationConfig | null> {
  const filePath = `${projectPath}/${CLASSIFICATION_DIR}/${CLASSIFICATION_FILENAME}`
  const exists = await fileExists(filePath)
  if (!exists) return null

  const content = await readFile(filePath)
  const config = deserializeClassificationFromMarkdown(content)
  if (!config) {
    throw new Error("classification.md 格式不正确，无法解析")
  }
  return config
}

export async function readProjectClassificationRaw(projectPath: string): Promise<string> {
  const pp = normalizePath(projectPath)
  const filePath = `${pp}/${CLASSIFICATION_DIR}/${CLASSIFICATION_FILENAME}`
  const exists = await fileExists(filePath)
  if (!exists) return ""
  return await readFile(filePath)
}

export async function loadFeatureClassification(
  projectPath: string,
  featureName: string
): Promise<ClassificationConfig | null> {
  const filePath = `${projectPath}/${CLASSIFICATION_DIR}/classification.${featureName}.md`
  const exists = await fileExists(filePath)
  if (!exists) return null

  const content = await readFile(filePath)
  const config = deserializeClassificationFromMarkdown(content)
  if (!config) {
    throw new Error(`classification.${featureName}.md 格式不正确，无法解析`)
  }
  return config
}

export function mergeRoutes(
  projectRoutes: RouteRule[],
  featureRoutes: RouteRule[]
): RouteRule[] {
  const projectMap = new Map(projectRoutes.map((r) => [r.intent, r]))
  const merged = new Map(projectMap)

  for (const featureRoute of featureRoutes) {
    const existing = projectMap.get(featureRoute.intent)

    if (!existing) {
      merged.set(featureRoute.intent, featureRoute)
      continue
    }

    const narrowedForbidden = Array.from(
      new Set([...existing.forbidden, ...featureRoute.forbidden])
    ) as DataSourceCategory[]

    const filteredOptional = existing.optional.filter(
      (cat) => !narrowedForbidden.includes(cat)
    )
    const featureOptionalFiltered = featureRoute.optional.filter(
      (cat) => !narrowedForbidden.includes(cat) && !filteredOptional.includes(cat)
    )

    merged.set(featureRoute.intent, {
      ...existing,
      forbidden: narrowedForbidden,
      optional: [...filteredOptional, ...featureOptionalFiltered],
    })
  }

  return Array.from(merged.values())
}

export async function initProjectClassification(projectPath: string): Promise<void> {
  const pp = normalizePath(projectPath)
  const dirPath = `${pp}/${CLASSIFICATION_DIR}`
  const filePath = `${dirPath}/${CLASSIFICATION_FILENAME}`

  const exists = await fileExists(filePath)
  if (exists) return

  const content = generateDefaultClassificationMarkdown()
  await writeFileAtomic(filePath, content)
}

export async function writeProjectClassification(
  projectPath: string,
  config: ClassificationConfig
): Promise<void> {
  const pp = normalizePath(projectPath)
  const dirPath = `${pp}/${CLASSIFICATION_DIR}`
  const filePath = `${dirPath}/${CLASSIFICATION_FILENAME}`

  const content = serializeClassificationToMarkdown(config)
  await writeFileAtomic(filePath, content)
}

export async function writeFeatureClassification(
  projectPath: string,
  featureName: string,
  config: ClassificationConfig
): Promise<void> {
  const pp = normalizePath(projectPath)
  const dirPath = `${pp}/${CLASSIFICATION_DIR}`
  const filePath = `${dirPath}/classification.${featureName}.md`

  const content = serializeClassificationToMarkdown(config)
  await writeFileAtomic(filePath, content)
}

export async function listFeatureClassifications(projectPath: string): Promise<string[]> {
  const pp = normalizePath(projectPath)
  const dirPath = `${pp}/${CLASSIFICATION_DIR}`

  try {
    const entries = await listDirectory(dirPath)
    const features: string[] = []

    for (const entry of entries) {
      const name = entry.name
      const match = name.match(/^classification\.([^.]+)\.md$/)
      if (match) {
        features.push(match[1])
      }
    }

    return features
  } catch {
    return []
  }
}

export function validateFeatureRoutes(
  projectRoutes: RouteRule[],
  featureRoutes: RouteRule[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const projectMap = new Map(projectRoutes.map((r) => [r.intent, r]))

  for (const featureRoute of featureRoutes) {
    const existing = projectMap.get(featureRoute.intent)
    if (!existing) continue

    for (const req of existing.required) {
      if (featureRoute.forbidden.includes(req)) {
        errors.push(
          `意图 ${featureRoute.intent}：分支级禁载不能包含项目级必载数据源 ${req}`
        )
      }
    }

    for (const req of featureRoute.required) {
      if (!existing.required.includes(req) && !existing.optional.includes(req)) {
        errors.push(
          `意图 ${featureRoute.intent}：分支级必载 ${req} 不在项目级必载或选载中`
        )
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

export function getRouteRule(
  config: ClassificationConfig,
  intent: string
): RouteRule | undefined {
  return config.routes.find((r) => r.intent === intent)
}

export function resolveRouteRule(
  config: ClassificationConfig,
  intent: string
): RouteRule {
  const rule = getRouteRule(config, intent)
  if (rule) return rule

  if (hasDefaultRoute(intent)) {
    const defaultConfig = DEFAULT_CLASSIFICATION_CONFIG
    const defaultRule = getRouteRule(defaultConfig, intent)
    if (defaultRule) return defaultRule
  }

  return {
    intent: intent as RouteRule["intent"],
    required: [],
    optional: [],
    forbidden: [],
  }
}

function compareSemanticVersions(a: string, b: string): number {
  const parseVersion = (v: string): number[] => {
    const parts = v.split(".").map((p) => parseInt(p, 10))
    return parts.length === 3 ? parts : [0, 0, 0]
  }

  const [aMajor, aMinor, aPatch] = parseVersion(a)
  const [bMajor, bMinor, bPatch] = parseVersion(b)

  if (aMajor !== bMajor) return aMajor - bMajor
  if (aMinor !== bMinor) return aMinor - bMinor
  return aPatch - bPatch
}

export function checkClassificationVersion(
  config: ClassificationConfig
): ClassificationVersionCheckResult {
  const currentVersion = config.version || "1.0.0"
  const latestVersion = DEFAULT_CLASSIFICATION_CONFIG.version || "1.0.0"

  const comparison = compareSemanticVersions(currentVersion, latestVersion)
  const upToDate = comparison >= 0
  const needsUpgrade = comparison < 0

  return {
    upToDate,
    currentVersion,
    latestVersion,
    needsUpgrade,
    canUpgrade: needsUpgrade,
  }
}

export function upgradeClassificationConfig(
  oldConfig: ClassificationConfig
): ClassificationConfig {
  const latestVersion = DEFAULT_CLASSIFICATION_CONFIG.version || "1.0.0"
  const existingIntents = new Set(oldConfig.routes.map((r) => r.intent))

  const newRoutes = [...oldConfig.routes]

  for (const defaultRoute of DEFAULT_CLASSIFICATION_CONFIG.routes) {
    if (!existingIntents.has(defaultRoute.intent)) {
      newRoutes.push({ ...defaultRoute })
    }
  }

  return {
    ...oldConfig,
    routes: newRoutes,
    version: latestVersion,
  }
}
