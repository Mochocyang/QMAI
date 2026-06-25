import { describe, expect, it, vi } from "vitest"
import { contextPackToPrompt, type ContextPack } from "./context-engine"

vi.mock("@/lib/http-adapter", () => ({
  httpProject: {},
  httpFs: {},
  httpClip: {},
  httpBackup: {},
  httpCli: {},
  httpSync: {},
  httpVector: {},
}))

const basePack: ContextPack = {
  task: "生成第2章正文",
  chapterGoal: "",
  outline: "",
  recentSummaries: [],
  previousChapterEnding: "",
  characterStates: "",
  soulDoc: "",
  characterAuras: "",
  cognitionStates: "",
  foreshadowingStates: "",
  timeline: "",
  relatedSettings: "",
  canonRules: "",
  writingStyle: "",
  searchResults: "",
  graphSearchResults: "",
  mustDo: "",
  mustAvoid: "",
  nextChapterAdvice: "",
  revisionDirectives: "",
  recentChapterContents: [],
}

describe("contextPackToPrompt", () => {
  it("将最近章节正文片段写入小说上下文包", () => {
    const prompt = contextPackToPrompt({
      ...basePack,
      recentChapterContents: [
        "## 第1章正文片段\n黑背心纹身大汉倒在雨里。",
      ],
    })

    expect(prompt).toContain("最近章节正文片段")
    expect(prompt).toContain("黑背心纹身大汉倒在雨里")
  })
})
