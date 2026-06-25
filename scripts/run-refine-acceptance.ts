import { createDirectory, readFile, writeFile } from "@/commands/fs"
import { hasOutlineForRefinement, generateOutlineRefinementFiles } from "@/lib/novel/outline-generation"
import { useWikiStore, type LlmConfig } from "@/stores/wiki-store"

const PROJECT_PATH = "/acceptance-refine-project"
const OUTLINES_DIR = `${PROJECT_PATH}/wiki/outlines`
const OUTLINE_PATH = `${OUTLINES_DIR}/story-outline.md`

const IMPORTED_OUTLINE = [
  "---",
  "type: outline",
  'title: "导入示例总纲"',
  "---",
  "",
  "# 导入示例总纲",
  "",
  "## 故事核心",
  "- 主角因旧案回到故乡，卷入多方势力争夺。",
  "",
  "## 卷一目标",
  "- 查明第一起失踪案的真实动机。",
  "",
  "## 卷二目标",
  "- 揭示幕后组织与主角家族的关联。",
  "",
  "## 长线伏笔",
  "- 失踪名单中的同姓者身份。",
  "- 夜潮会账本缺页来源。",
  "",
].join("\n")

const llmConfig: LlmConfig = {
  provider: "custom",
  apiKey: "",
  model: "mock-refine-model",
  ollamaUrl: "http://127.0.0.1:11434",
  customEndpoint: "http://127.0.0.1:18080",
  maxContextSize: 131072,
  apiMode: "chat_completions",
  reasoning: { mode: "off" },
}

async function main() {
  console.log("[accept] start")
  useWikiStore.getState().setNovelMode(true)
  await createDirectory(OUTLINES_DIR)
  await writeFile(OUTLINE_PATH, IMPORTED_OUTLINE)
  console.log("[accept] outline imported:", OUTLINE_PATH)

  const canRefine = await hasOutlineForRefinement(PROJECT_PATH)
  console.log("[accept] hasOutlineForRefinement:", canRefine)
  if (!canRefine) {
    throw new Error("Outline import check failed: hasOutlineForRefinement=false")
  }

  console.log("[accept] submit refine generation ...")
  const result = await generateOutlineRefinementFiles(
    PROJECT_PATH,
    llmConfig,
    "请基于已有总纲，细化第一卷章节推进，并补全人物、组织、能力体系、伏笔与地点设定。",
  )
  console.log("[accept] refine generated:", result.writtenPaths.length)

  const written = await Promise.all(
    result.writtenPaths.map(async (path) => {
      const content = await readFile(path)
      const firstLine = content.split("\n").find((line) => line.trim().length > 0) ?? ""
      return { path, firstLine, length: content.length }
    }),
  )

  console.log(JSON.stringify({
    projectPath: PROJECT_PATH,
    importedOutline: OUTLINE_PATH,
    primaryPath: result.primaryPath,
    writtenCount: result.writtenPaths.length,
    written,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
})
