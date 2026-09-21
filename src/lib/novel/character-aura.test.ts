import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  createDirectory: vi.fn(),
  listDirectory: vi.fn(),
  readFile: vi.fn(),
  writeFileAtomic: vi.fn(),
}))

vi.mock("@/lib/has-usable-llm", () => ({
  hasUsableLlm: vi.fn(() => false),
}))

vi.mock("@/lib/llm-client", () => ({
  streamChat: vi.fn(),
}))

vi.mock("@/lib/search", () => ({
  searchWiki: vi.fn(),
}))

vi.mock("@/lib/tauri-fetch", () => ({
  getHttpFetch: vi.fn(),
}))

vi.mock("@/lib/web-search", () => ({
  webSearch: vi.fn(),
}))

vi.mock("@/stores/wiki-store", () => ({
  useWikiStore: {
    getState: () => ({
      llmConfig: {
        provider: "openai",
        apiKey: "",
        model: "",
        ollamaUrl: "",
        customEndpoint: "",
        maxContextSize: 128000,
      },
      providerConfigs: {},
      aiChatModel: "",
      novelConfig: { defaultLlmModel: "" },
    }),
  },
}))

import { listDirectory, readFile } from "@/commands/fs"
import { listBindableNovelCharacters } from "./character-aura"

const mockListDirectory = vi.mocked(listDirectory)
const mockReadFile = vi.mocked(readFile)

beforeEach(() => {
  vi.restoreAllMocks()
  mockListDirectory.mockReset()
  mockReadFile.mockReset()
})

describe("character-aura", () => {
  it("listBindableNovelCharacters 只返回人物名，不混入人物小传里的字段标题", async () => {
    const projectPath = "E:/Novel"
    const outlinePath = `${projectPath}/wiki/outlines/人物小传/百姓与弟子队.md`

    mockListDirectory.mockImplementation(async (path: string) => {
      if (path === `${projectPath}/wiki/entities`) {
        throw new Error("no entities yet")
      }
      if (path === `${projectPath}/wiki/outlines`) {
        return [
          {
            name: "人物小传",
            path: `${projectPath}/wiki/outlines/人物小传`,
            is_dir: true,
            children: [
              {
                name: "百姓与弟子队.md",
                path: outlinePath,
                is_dir: false,
              },
            ],
          },
        ]
      }
      throw new Error(`unexpected path: ${path}`)
    })

    mockReadFile.mockImplementation(async (path: string) => {
      if (path !== outlinePath) {
        throw new Error(`unexpected read: ${path}`)
      }
      return [
        "---",
        'type: outline',
        'title: "百姓与弟子队"',
        "outline_category: characters",
        "---",
        "",
        "# 百姓与弟子队",
        "",
        "## 张小凡",
        "### 背景",
        "- 出身背景：草庙村少年",
        "- 定位：主角",
        "### 本质",
        "- 核心道具：烧火棍",
        "",
        "## 碧瑶",
        "### 背景",
        "- 出身背景：鬼王宗宗主之女",
        "- 初登场阶段：滴血洞",
        "",
      ].join("\n")
    })

    const names = await listBindableNovelCharacters(projectPath)

    expect(names).toHaveLength(2)
    expect(names).toEqual(expect.arrayContaining(["张小凡", "碧瑶"]))
    expect(names).not.toEqual(expect.arrayContaining(["百姓与弟子队", "背景", "本质", "出身背景", "定位", "核心道具", "初登场阶段"]))
  })

  it("listBindableNovelCharacters 会排除关系线和群像集合标题，只保留可绑定的人物角色", async () => {
    const projectPath = "E:/Novel"
    const outlinePath = `${projectPath}/wiki/outlines/人物小传/人物小传.md`

    mockListDirectory.mockImplementation(async (path: string) => {
      if (path === `${projectPath}/wiki/entities`) {
        throw new Error("no entities yet")
      }
      if (path === `${projectPath}/wiki/outlines`) {
        return [
          {
            name: "人物小传",
            path: `${projectPath}/wiki/outlines/人物小传`,
            is_dir: true,
            children: [
              {
                name: "人物小传.md",
                path: outlinePath,
                is_dir: false,
              },
            ],
          },
        ]
      }
      throw new Error(`unexpected path: ${path}`)
    })

    mockReadFile.mockImplementation(async (path: string) => {
      if (path !== outlinePath) {
        throw new Error(`unexpected read: ${path}`)
      }
      return [
        "---",
        'type: outline',
        'title: "人物小传"',
        "outline_category: characters",
        "---",
        "",
        "# 人物小传",
        "",
        "## 陈玄",
        "### 基本信息",
        "- **身份**：青云宗核心弟子；觊觎杨小晴者；宗门期反派配角。",
        "### 性格小传",
        "陈玄骄傲、自负、占有欲强。",
        "### 人物弧线",
        "核心天才 → 觊觎玄阴之体 → 被杨栋反制。",
        "",
        "## 赵无极一脉残部",
        "### 基本信息",
        "- **身份**：守拙峰幸存弟子与青云宗残部。",
        "- **整体定位**：杨栋创立潜龙盟的基础班底之一。",
        "### 性格与群像定位",
        "这一群体经历宗门覆灭，既有恐惧、迷茫，也有复仇心。",
        "",
        "## 魔教七杀堂小队",
        "### 基本信息",
        "- **身份**：魔教八部或下属战斗单位之一；陨魔古殿阶段敌方小队。",
        "- **整体定位**：推动叶瑶牺牲的重要敌方压力。",
        "### 性格与群像定位",
        "七杀堂成员行事狠辣、配合熟练。",
        "",
        "# 人物关系总览",
        "",
        "## 核心家庭线",
        "- **杨栋 ↔ 杨小晴**：兄妹主线。",
        "",
        "## 敌对压迫线",
        "- **陈玄 → 杨栋**：宗门天才阶层压迫。",
        "",
      ].join("\n")
    })

    const names = await listBindableNovelCharacters(projectPath)

    expect(names).toEqual(expect.arrayContaining(["陈玄"]))
    expect(names).not.toEqual(expect.arrayContaining(["赵无极一脉残部", "魔教七杀堂小队", "核心家庭线", "敌对压迫线"]))
  })
})
