import { describe, expect, it } from "vitest"
import type { ContextPack } from "./context-engine"
import { buildScopedOutlineSubAgentContext } from "./outline-agent-context"

const pack: ContextPack = {
  task: "生成大纲",
  chapterGoal: "",
  outline: "主线大纲",
  recentChapterContents: [],
  recentSummaries: ["最近摘要"],
  previousChapterEnding: "",
  characterStates: "角色当前状态",
  soulDoc: "作品灵魂",
  characterAuras: "角色气质",
  storyFrameworkBinding: "",
  cognitionStates: "角色认知",
  foreshadowingStates: "伏笔状态",
  sectionBriefing: "",
  timeline: "故事时间线",
  relatedSettings: "完整世界设定",
  canonRules: "世界硬规则",
  writingStyle: "",
  searchResults: "",
  graphSearchResults: "",
  mustDo: "",
  mustAvoid: "",
  nextChapterAdvice: "",
  revisionDirectives: "",
}

describe("scoped outline sub-agent context", () => {
  it("角色 Agent 只获得人物和主线相关上下文", () => {
    const context = buildScopedOutlineSubAgentContext(pack, "character")

    expect(context).toContain("角色当前状态")
    expect(context).toContain("角色认知")
    expect(context).toContain("主线大纲")
    expect(context).not.toContain("完整世界设定")
  })

  it("设定 Agent 获得世界规则但不携带角色认知", () => {
    const context = buildScopedOutlineSubAgentContext(pack, "setting")

    expect(context).toContain("世界硬规则")
    expect(context).toContain("完整世界设定")
    expect(context).not.toContain("角色认知")
  })

  it("局部上下文受字符预算限制", () => {
    const context = buildScopedOutlineSubAgentContext({ ...pack, outline: "大纲".repeat(5000) }, "outline", 1200)
    expect(context.length).toBeLessThanOrEqual(1200)
  })
})
