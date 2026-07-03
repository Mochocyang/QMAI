import { beforeEach, describe, expect, it, vi } from "vitest"
import { applyRouteRules, getCategoryFields, getAllCategories } from "./route-applier"
import {
  serializeClassificationToMarkdown,
  deserializeClassificationFromMarkdown,
  generateDefaultClassificationMarkdown,
} from "./markdown-serializer"
import {
  DEFAULT_CLASSIFICATION_CONFIG,
  DEFAULT_CLASSIFICATION_ROUTES,
  getDefaultRoute,
  hasDefaultRoute,
} from "./default-routes"
import {
  mergeRoutes,
  validateFeatureRoutes,
  checkClassificationVersion,
  upgradeClassificationConfig,
  resolveRouteRule,
  getRouteRule,
  readProjectClassificationRaw,
} from "./classification-loader"
import type { ClassificationConfig, RouteRule } from "./types"
import { ALL_DATA_SOURCE_CATEGORIES } from "./types"
import type { ContextPack } from "../context-engine"

const fsMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFileAtomic: vi.fn(),
  fileExists: vi.fn(),
  listDirectory: vi.fn(),
}))

vi.mock("@/commands/fs", () => fsMocks)

beforeEach(() => {
  vi.clearAllMocks()
})

describe("classification types", () => {
  it("ALL_DATA_SOURCE_CATEGORIES 包含所有 12 个分类", () => {
    expect(ALL_DATA_SOURCE_CATEGORIES.length).toBe(12)
    expect(ALL_DATA_SOURCE_CATEGORIES).toContain("outline")
    expect(ALL_DATA_SOURCE_CATEGORIES).toContain("soul")
    expect(ALL_DATA_SOURCE_CATEGORIES).toContain("memory")
    expect(ALL_DATA_SOURCE_CATEGORIES).toContain("graph")
  })
})

describe("default-routes", () => {
  it("包含 14 个默认路由规则", () => {
    expect(DEFAULT_CLASSIFICATION_ROUTES.length).toBe(14)
  })

  it("默认配置包含版本号", () => {
    expect(DEFAULT_CLASSIFICATION_CONFIG.version).toBe("1.0.0")
    expect(DEFAULT_CLASSIFICATION_CONFIG.routes.length).toBe(14)
  })

  it("getDefaultRoute 返回正确的路由", () => {
    const route = getDefaultRoute("write_chapter")
    expect(route).toBeDefined()
    expect(route?.intent).toBe("write_chapter")
    expect(route?.required).toContain("outline")
    expect(route?.required).toContain("soul")
  })

  it("getDefaultRoute 对不存在的意图返回 undefined", () => {
    expect(getDefaultRoute("nonexistent_intent")).toBeUndefined()
  })

  it("hasDefaultRoute 正确判断是否存在默认路由", () => {
    expect(hasDefaultRoute("write_chapter")).toBe(true)
    expect(hasDefaultRoute("general_chat")).toBe(true)
    expect(hasDefaultRoute("nonexistent")).toBe(false)
  })

  it("write_chapter 必载包含 outline, soul, character_states, foreshadowing", () => {
    const route = getDefaultRoute("write_chapter")!
    expect(route.required).toEqual(["outline", "soul", "character_states", "foreshadowing"])
  })

  it("general_chat 必载为空，所有都是选载", () => {
    const route = getDefaultRoute("general_chat")!
    expect(route.required).toEqual([])
    expect(route.forbidden).toEqual([])
    expect(route.optional.length).toBeGreaterThan(0)
  })
})

describe("route-applier", () => {
  const createFullPack = () => ({
    outline: "大纲内容",
    chapterGoal: "章节目标",
    recentSummaries: ["摘要1", "摘要2"],
    recentChapterContents: ["章节内容1"],
    previousChapterEnding: "上一章结尾",
    characterStates: "人物状态",
    characterAuras: [],
    cognitionStates: [],
    foreshadowingStates: "伏笔状态",
    timeline: "时间线",
    relatedSettings: "相关设定",
    canonRules: "正史规则",
    soulDoc: "作品灵魂",
    searchResults: [],
    graphSearchResults: [],
    nextChapterAdvice: "下一章建议",
    revisionDirectives: "修订指引",
    mustDo: "必做事项",
    mustAvoid: "必避事项",
  } as unknown as ContextPack)

  it("getAllCategories 返回所有分类", () => {
    const categories = getAllCategories()
    expect(categories.length).toBe(12)
    expect(categories).toContain("outline")
    expect(categories).toContain("soul")
  })

  it("getCategoryFields 返回正确的字段映射", () => {
    expect(getCategoryFields("outline")).toContain("outline")
    expect(getCategoryFields("outline")).toContain("chapterGoal")
    expect(getCategoryFields("soul")).toEqual(["soulDoc"])
    expect(getCategoryFields("nonexistent" as any)).toEqual([])
  })

  it("applyRouteRules 保留必载数据源", () => {
    const pack = createFullPack()
    const rule: RouteRule = {
      intent: "write_chapter",
      required: ["outline", "soul"],
      optional: [],
      forbidden: [],
    }

    const result = applyRouteRules(pack, rule)

    expect(result.keptSources).toContain("outline")
    expect(result.keptSources).toContain("soul")
    expect(result.pack.outline).toBe("大纲内容")
    expect(result.pack.soulDoc).toBe("作品灵魂")
  })

  it("applyRouteRules 清除禁载数据源", () => {
    const pack = createFullPack()
    const rule = {
      intent: "general_chat",
      required: [],
      optional: [],
      forbidden: ["memory", "graph"],
    } as RouteRule

    const result = applyRouteRules(pack, rule)

    expect(result.blockedSources).toContain("memory")
    expect(result.blockedSources).toContain("graph")
    expect(result.pack.searchResults).toEqual([])
    expect(result.pack.graphSearchResults).toEqual([])
  })

  it("applyRouteRules 保留选载数据源", () => {
    const pack = createFullPack()
    const rule = {
      intent: "general_chat",
      required: ["outline"],
      optional: ["soul", "memory"],
      forbidden: [],
    } as RouteRule

    const result = applyRouteRules(pack, rule)

    expect(result.keptSources).toContain("outline")
    expect(result.keptSources).toContain("soul")
    expect(result.keptSources).toContain("memory")
    expect(result.pack.soulDoc).toBe("作品灵魂")
  })

  it("applyRouteRules 未分类的数据源默认被阻止", () => {
    const pack = createFullPack()
    const rule = {
      intent: "general_chat",
      required: ["outline"],
      optional: [],
      forbidden: [],
    } as RouteRule

    const result = applyRouteRules(pack, rule)

    expect(result.blockedSources.length).toBeGreaterThan(0)
    expect(result.blockedSources).toContain("soul")
    expect(result.blockedSources).toContain("memory")
  })

  it("write_chapter 默认规则正确应用", () => {
    const pack = createFullPack()
    const rule = getDefaultRoute("write_chapter")!
    const result = applyRouteRules(pack, rule)

    expect(result.keptSources).toContain("outline")
    expect(result.keptSources).toContain("soul")
    expect(result.keptSources).toContain("character_states")
    expect(result.keptSources).toContain("foreshadowing")
    expect(result.blockedSources).toContain("revision")
  })
})

describe("markdown-serializer", () => {
  it("serializeClassificationToMarkdown 生成包含版本标记的 markdown", () => {
    const config: ClassificationConfig = {
      version: "1.0.0",
      routes: [
        {
          intent: "write_chapter",
          required: ["outline", "soul"],
          optional: ["memory"],
          forbidden: ["revision"],
        },
      ],
    }

    const markdown = serializeClassificationToMarkdown(config)

    expect(markdown).toContain("<!-- classification-version:1.0.0 -->")
    expect(markdown).toContain("<!-- AUTO-GENERATED-ROUTE:START -->")
    expect(markdown).toContain("<!-- AUTO-GENERATED-ROUTE:END -->")
    expect(markdown).toContain("write_chapter")
    expect(markdown).toContain("必载数据源")
    expect(markdown).toContain("选载数据源")
    expect(markdown).toContain("禁载数据源")
  })

  it("deserializeClassificationFromMarkdown 能正确解析路由意图", () => {
    const markdown = generateDefaultClassificationMarkdown()
    const parsed = deserializeClassificationFromMarkdown(markdown)

    expect(parsed).not.toBeNull()
    expect(parsed?.routes.length).toBeGreaterThan(0)

    const writeChapter = parsed?.routes.find((r) => r.intent === "write_chapter")
    expect(writeChapter).toBeDefined()
    expect(writeChapter?.required).toContain("outline")
    expect(writeChapter?.required).toContain("soul")
    expect(writeChapter?.required).toContain("character_states")
    expect(writeChapter?.required).toContain("foreshadowing")
    expect(writeChapter?.forbidden).toContain("revision")
  })

  it("默认配置往返序列化一致", () => {
    const markdown = generateDefaultClassificationMarkdown()
    const parsed = deserializeClassificationFromMarkdown(markdown)

    expect(parsed).not.toBeNull()
    expect(parsed?.routes.length).toBe(DEFAULT_CLASSIFICATION_ROUTES.length)
    expect(parsed?.version).toBe(DEFAULT_CLASSIFICATION_CONFIG.version)
  })

  it("空内容返回 null", () => {
    expect(deserializeClassificationFromMarkdown("")).toBeNull()
    expect(deserializeClassificationFromMarkdown("# 无路由标记")).toBeNull()
  })

  it("generateDefaultClassificationMarkdown 生成正确的默认配置", () => {
    const markdown = generateDefaultClassificationMarkdown()
    expect(markdown).toContain("意图路由配置")
    expect(markdown).toContain("classification-version:1.0.0")
  })
})

describe("classification-loader", () => {
  describe("mergeRoutes", () => {
    it("项目级没有的意图，分支级可以新增", () => {
      const projectRoutes: RouteRule[] = [
        { intent: "write_chapter", required: ["outline"], optional: [], forbidden: [] },
      ]
      const featureRoutes: RouteRule[] = [
        { intent: "lint_chapter", required: ["soul"], optional: [], forbidden: [] },
      ]

      const merged = mergeRoutes(projectRoutes, featureRoutes)

      expect(merged.length).toBe(2)
      expect(merged.find((r) => r.intent === "lint_chapter")).toBeDefined()
    })

    it("分支级禁载会追加到项目级禁载（收窄）", () => {
      const projectRoutes: RouteRule[] = [
        { intent: "write_chapter", required: ["outline"], optional: ["memory"], forbidden: ["revision"] },
      ]
      const featureRoutes: RouteRule[] = [
        { intent: "write_chapter", required: [], optional: [], forbidden: ["graph"] },
      ]

      const merged = mergeRoutes(projectRoutes, featureRoutes)
      const writeChapter = merged.find((r) => r.intent === "write_chapter")!

      expect(writeChapter.forbidden).toContain("revision")
      expect(writeChapter.forbidden).toContain("graph")
    })

    it("分支级选载不能包含项目级禁载的数据源", () => {
      const projectRoutes: RouteRule[] = [
        { intent: "write_chapter", required: ["outline"], optional: ["memory"], forbidden: ["graph"] },
      ]
      const featureRoutes: RouteRule[] = [
        { intent: "write_chapter", required: [], optional: ["graph", "soul"], forbidden: [] },
      ]

      const merged = mergeRoutes(projectRoutes, featureRoutes)
      const writeChapter = merged.find((r) => r.intent === "write_chapter")!

      expect(writeChapter.optional).not.toContain("graph")
      expect(writeChapter.optional).toContain("soul")
    })

    it("项目级必载始终保留", () => {
      const projectRoutes: RouteRule[] = [
        { intent: "write_chapter", required: ["outline", "soul"], optional: [], forbidden: [] },
      ]
      const featureRoutes: RouteRule[] = [
        { intent: "write_chapter", required: [], optional: [], forbidden: ["outline"] },
      ]

      const merged = mergeRoutes(projectRoutes, featureRoutes)
      const writeChapter = merged.find((r) => r.intent === "write_chapter")!

      expect(writeChapter.required).toContain("outline")
      expect(writeChapter.required).toContain("soul")
    })
  })

  describe("validateFeatureRoutes", () => {
    it("分支级禁载包含项目级必载时返回错误", () => {
      const projectRoutes: RouteRule[] = [
        { intent: "write_chapter", required: ["outline", "soul"], optional: [], forbidden: [] },
      ]
      const featureRoutes: RouteRule[] = [
        { intent: "write_chapter", required: [], optional: [], forbidden: ["outline"] },
      ]

      const result = validateFeatureRoutes(projectRoutes, featureRoutes)

      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors[0]).toContain("outline")
    })

    it("分支级必载不在项目级必载或选载中时返回错误", () => {
      const projectRoutes: RouteRule[] = [
        { intent: "write_chapter", required: ["outline"], optional: ["soul"], forbidden: [] },
      ]
      const featureRoutes: RouteRule[] = [
        { intent: "write_chapter", required: ["graph"], optional: [], forbidden: [] },
      ]

      const result = validateFeatureRoutes(projectRoutes, featureRoutes)

      expect(result.valid).toBe(false)
      expect(result.errors[0]).toContain("graph")
    })

    it("合法的分支路由通过验证", () => {
      const projectRoutes: RouteRule[] = [
        { intent: "write_chapter", required: ["outline"], optional: ["soul", "memory"], forbidden: [] },
      ]
      const featureRoutes: RouteRule[] = [
        { intent: "write_chapter", required: ["soul"], optional: [], forbidden: ["memory"] },
      ]

      const result = validateFeatureRoutes(projectRoutes, featureRoutes)

      expect(result.valid).toBe(true)
      expect(result.errors.length).toBe(0)
    })

    it("分支新增的意图总是通过验证", () => {
      const projectRoutes: RouteRule[] = [
        { intent: "write_chapter", required: ["outline"], optional: [], forbidden: [] },
      ]
      const featureRoutes: RouteRule[] = [
        { intent: "lint_chapter", required: ["soul"], optional: [], forbidden: [] },
      ]

      const result = validateFeatureRoutes(projectRoutes, featureRoutes)

      expect(result.valid).toBe(true)
    })
  })

  describe("checkClassificationVersion", () => {
    it("当前版本等于最新版本时为最新", () => {
      const result = checkClassificationVersion({
        routes: [],
        version: "1.0.0",
      })

      expect(result.upToDate).toBe(true)
      expect(result.needsUpgrade).toBe(false)
    })

    it("当前版本低于最新版本时需要升级", () => {
      const result = checkClassificationVersion({
        routes: [],
        version: "0.9.0",
      })

      expect(result.upToDate).toBe(false)
      expect(result.needsUpgrade).toBe(true)
      expect(result.canUpgrade).toBe(true)
    })

    it("没有版本号时默认为 1.0.0", () => {
      const result = checkClassificationVersion({
        routes: [],
      })

      expect(result.currentVersion).toBe("1.0.0")
    })
  })

  describe("upgradeClassificationConfig", () => {
    it("升级后版本号更新为最新", () => {
      const oldConfig: ClassificationConfig = {
        version: "0.9.0",
        routes: [{ intent: "write_chapter", required: [], optional: [], forbidden: [] }],
      }

      const upgraded = upgradeClassificationConfig(oldConfig)

      expect(upgraded.version).toBe("1.0.0")
    })

    it("升级会补充缺失的默认意图", () => {
      const oldConfig: ClassificationConfig = {
        version: "0.9.0",
        routes: [{ intent: "write_chapter", required: [], optional: [], forbidden: [] }],
      }

      const upgraded = upgradeClassificationConfig(oldConfig)

      expect(upgraded.routes.length).toBeGreaterThan(1)
      expect(upgraded.routes.find((r) => r.intent === "general_chat")).toBeDefined()
    })

    it("已有的路由配置保留不变", () => {
      const oldConfig: ClassificationConfig = {
        version: "0.9.0",
        routes: [
          {
            intent: "write_chapter",
            required: ["outline"],
            optional: ["soul"],
            forbidden: ["memory"],
          },
        ],
      }

      const upgraded = upgradeClassificationConfig(oldConfig)
      const writeChapter = upgraded.routes.find((r) => r.intent === "write_chapter")!

      expect(writeChapter.required).toEqual(["outline"])
      expect(writeChapter.optional).toEqual(["soul"])
      expect(writeChapter.forbidden).toEqual(["memory"])
    })
  })

  describe("readProjectClassificationRaw", () => {
    it("classification.md 存在时返回原始 markdown 内容", async () => {
      fsMocks.fileExists.mockResolvedValueOnce(true)
      fsMocks.readFile.mockResolvedValueOnce("# 原始配置\n")

      const content = await readProjectClassificationRaw("C:/novel")

      expect(fsMocks.fileExists).toHaveBeenCalledWith("C:/novel/classification/classification.md")
      expect(fsMocks.readFile).toHaveBeenCalledWith("C:/novel/classification/classification.md")
      expect(content).toBe("# 原始配置\n")
    })

    it("classification.md 不存在时返回空字符串", async () => {
      fsMocks.fileExists.mockResolvedValueOnce(false)

      const content = await readProjectClassificationRaw("C:/novel")

      expect(fsMocks.readFile).not.toHaveBeenCalled()
      expect(content).toBe("")
    })
  })

  describe("getRouteRule / resolveRouteRule", () => {
    it("getRouteRule 返回配置中存在的路由", () => {
      const config: ClassificationConfig = {
        routes: [{ intent: "write_chapter", required: ["outline"], optional: [], forbidden: [] }],
      }

      const rule = getRouteRule(config, "write_chapter")
      expect(rule).toBeDefined()
      expect(rule?.intent).toBe("write_chapter")
    })

    it("getRouteRule 对不存在的意图返回 undefined", () => {
      const config: ClassificationConfig = { routes: [] }
      expect(getRouteRule(config, "nonexistent")).toBeUndefined()
    })

    it("resolveRouteRule 对不存在的意图回退到默认路由", () => {
      const config: ClassificationConfig = { routes: [] }
      const rule = resolveRouteRule(config, "write_chapter")

      expect(rule.intent).toBe("write_chapter")
      expect(rule.required.length).toBeGreaterThan(0)
    })

    it("resolveRouteRule 对完全未知的意图返回空规则", () => {
      const config: ClassificationConfig = { routes: [] }
      const rule = resolveRouteRule(config, "completely_unknown")

      expect(rule.intent).toBe("completely_unknown")
      expect(rule.required).toEqual([])
      expect(rule.optional).toEqual([])
      expect(rule.forbidden).toEqual([])
    })
  })
})
