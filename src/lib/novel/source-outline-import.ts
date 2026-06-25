import { createDirectory, fileExists, readFile, writeFile } from "@/commands/fs"
import { getFileName, getRelativePath, normalizePath } from "@/lib/path-utils"
import { makeSafeFileSlug } from "@/lib/wiki-filename"

export type SourceOutlineImportTarget =
  | "story-outline"
  | "chapter-outline"
  | "character-briefs"
  | "locations"
  | "organizations"
  | "power-system"
  | "foreshadowing-plan"

interface SourceOutlineImportConfig {
  id: SourceOutlineImportTarget
  title: string
  folderName: string
  outlineType?: "story-outline" | "chapter-outline" | "volume-outline"
  category: string
}

export const SOURCE_OUTLINE_IMPORT_TARGETS: SourceOutlineImportConfig[] = [
  { id: "story-outline", title: "总大纲", folderName: "总大纲", outlineType: "story-outline", category: "story" },
  { id: "chapter-outline", title: "章节细纲", folderName: "章节细纲", outlineType: "chapter-outline", category: "chapter" },
  { id: "character-briefs", title: "人物小传", folderName: "人物小传", category: "characters" },
  { id: "locations", title: "地点设定", folderName: "地点设定", category: "locations" },
  { id: "organizations", title: "势力设定", folderName: "势力设定", category: "organizations" },
  { id: "power-system", title: "能力体系", folderName: "能力体系", category: "power-system" },
  { id: "foreshadowing-plan", title: "伏笔计划", folderName: "伏笔计划", category: "foreshadowing" },
]

function getTargetConfig(target: SourceOutlineImportTarget): SourceOutlineImportConfig {
  const config = SOURCE_OUTLINE_IMPORT_TARGETS.find((item) => item.id === target)
  if (!config) throw new Error(`Unknown outline import target: ${target}`)
  return config
}

function yamlEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "")
}

async function getUniqueOutlinePath(dir: string, fileName: string): Promise<string> {
  const firstPath = `${dir}/${fileName}`
  if (!(await fileExists(firstPath))) return firstPath

  const extensionIndex = fileName.lastIndexOf(".")
  const stem = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName
  const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : ""
  for (let index = 2; index <= 99; index += 1) {
    const candidate = `${dir}/${stem}-${index}${extension}`
    if (!(await fileExists(candidate))) return candidate
  }

  return `${dir}/${stem}-${Date.now()}${extension}`
}

function buildSourceSection(sourcePath: string, relativeSourcePath: string, sourceContent: string): string {
  const sourceName = getFileName(sourcePath) || relativeSourcePath
  return [
    `## 来源：${sourceName}`,
    "",
    `> 原始来源：${relativeSourcePath}`,
    "",
    sourceContent.trim(),
    "",
  ].join("\n")
}

function buildOutlinePage(
  config: SourceOutlineImportConfig,
  pageTitle: string,
  relativeSourcePath: string,
  section: string,
): string {
  const frontmatter = [
    "---",
    "type: outline",
    `title: "${yamlEscape(pageTitle)}"`,
    ...(config.outlineType ? [`outline_type: ${config.outlineType}`] : []),
    `outline_category: ${config.category}`,
    `outline_folder: "${yamlEscape(config.folderName)}"`,
    `sources: ["${yamlEscape(relativeSourcePath)}"]`,
    "---",
    "",
    `# ${pageTitle}`,
    "",
  ]
  return `${frontmatter.join("\n")}${section}`
}

export async function addSourceToOutlineCategory(
  projectPath: string,
  sourcePath: string,
  target: SourceOutlineImportTarget,
): Promise<string> {
  const pp = normalizePath(projectPath)
  const normalizedSourcePath = normalizePath(sourcePath)
  const config = getTargetConfig(target)
  const outlinesDir = `${pp}/wiki/outlines`
  const targetDir = `${outlinesDir}/${config.folderName}`
  const relativeSourcePath = getRelativePath(normalizedSourcePath, pp)
  const sourceContent = await readFile(normalizedSourcePath)
  const sourceName = getFileName(normalizedSourcePath) || relativeSourcePath
  const pageTitle = stripExtension(sourceName)
  const outlinePath = await getUniqueOutlinePath(targetDir, `${makeSafeFileSlug(pageTitle)}.md`)
  const section = buildSourceSection(normalizedSourcePath, relativeSourcePath, sourceContent)

  await createDirectory(outlinesDir)
  await createDirectory(targetDir)
  await writeFile(outlinePath, buildOutlinePage(config, pageTitle, relativeSourcePath, section))
  return outlinePath
}
