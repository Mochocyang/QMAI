import { describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const fs = require("node:fs/promises")
  const path = require("node:path")
  const os = require("node:os")

  const tempDir = path.join(os.tmpdir(), `refine-acceptance-${Date.now()}`)

  const fullPath = (p: string) => {
    const normalized = p.replace(/\\/g, "/")
    if (normalized.startsWith("/")) {
      return path.join(tempDir, normalized)
    }
    return path.join(tempDir, normalized)
  }

  const relPath = (p: string) => {
    const relative = path.relative(tempDir, p)
    return "/" + relative.replace(/\\/g, "/")
  }

  async function listDirRecursive(dir: string): Promise<any[]> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      const result = []
      for (const entry of entries) {
        const fullEntryPath = path.join(dir, entry.name)
        const relEntryPath = relPath(fullEntryPath)
        if (entry.isDirectory()) {
          const children = await listDirRecursive(fullEntryPath)
          result.push({
            name: entry.name,
            path: relEntryPath,
            is_dir: true,
            children,
          })
        } else {
          result.push({
            name: entry.name,
            path: relEntryPath,
            is_dir: false,
          })
        }
      }
      return result
    } catch {
      return []
    }
  }

  const realFs = {
    readFile: async (filePath: string) => {
      return fs.readFile(fullPath(filePath), "utf-8")
    },
    writeFile: async (filePath: string, contents: string) => {
      const fp = fullPath(filePath)
      await fs.mkdir(path.dirname(fp), { recursive: true })
      return fs.writeFile(fp, contents, "utf-8")
    },
    writeFileAtomic: async (filePath: string, contents: string) => {
      const fp = fullPath(filePath)
      await fs.mkdir(path.dirname(fp), { recursive: true })
      return fs.writeFile(fp, contents, "utf-8")
    },
    createDirectory: async (dirPath: string) => {
      await fs.mkdir(fullPath(dirPath), { recursive: true })
    },
    listDirectory: async (dirPath: string) => {
      return listDirRecursive(fullPath(dirPath))
    },
    fileExists: async (filePath: string) => {
      try {
        await fs.access(fullPath(filePath))
        return true
      } catch {
        return false
      }
    },
    deleteFile: async (_filePath: string) => {},
    copyFile: async (_source: string, _destination: string) => {},
    copyDirectory: async (_source: string, _destination: string) => [],
    preprocessFile: async (filePath: string) => {
      return fs.readFile(fullPath(filePath), "utf-8")
    },
    findRelatedWikiPages: async (_projectPath: string, _sourceName: string) => [],
    getFileModifiedTime: async (_filePath: string) => 0,
    getFileSize: async (_filePath: string) => 0,
    getFileMd5: async (_filePath: string) => "",
    readFileAsBase64: async (_filePath: string) => ({ base64: "", mimeType: "" }),
    createProject: async (name: string, p: string) => ({ id: "test", name, path: p }),
    openProject: async (name: string, p: string) => ({ id: "test", name, path: p }),
    openProjectFolder: async (_path: string) => {},
    openFileLocation: async (_path: string) => {},
    getExecutableDir: async () => tempDir,
    getResourceDir: async () => tempDir,
  }

  return { realFs, tempDir }
})

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/commands/fs", () => mocks.realFs)

import { generateOutlineRefinementFiles, hasOutlineForRefinement } from "@/lib/novel/outline-generation"
import { useWikiStore, type LlmConfig } from "@/stores/wiki-store"
import { createDirectory, readFile, writeFile } from "@/commands/fs"

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

describe("refine generation acceptance", () => {
  it("imports one outline and successfully writes six refinement files in one submit", async () => {
    useWikiStore.getState().setNovelMode(true)

    await createDirectory(OUTLINES_DIR)
    await writeFile(OUTLINE_PATH, IMPORTED_OUTLINE)

    const canRefine = await hasOutlineForRefinement(PROJECT_PATH)
    expect(canRefine).toBe(true)

    const result = await generateOutlineRefinementFiles(
      PROJECT_PATH,
      llmConfig,
      "请基于已有总纲，细化第一卷章节推进，并补全人物、组织、能力体系、伏笔与地点设定。",
    )

    expect(result.primaryPath).toBe(`${OUTLINES_DIR}/chapter-outlines.md`)
    expect(result.writtenPaths).toHaveLength(6)

    for (const p of result.writtenPaths) {
      const content = await readFile(p)
      expect(content.length).toBeGreaterThan(20)
      expect(content).toMatch(/^---\n/)
    }
  }, 60_000)
})
