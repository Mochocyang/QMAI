import { describe, expect, it } from "vitest"
import {
  buildDismantlingCharacterPrompt,
  buildDismantlingDirectionPrompt,
  buildDismantlingHandcraftPrompt,
  buildDismantlingForeshadowingPrompt,
  buildFrameworkMergePrompt,
  extractCharactersFromStage,
  extractDirectionHintsFromStage,
  extractHandcraftHintsFromStage,
  extractForeshadowingFromStage,
  parseFrameworkMergeOutput,
} from "./dismantling-stages"
import { buildDismantlingCachePrefix } from "./dismantling"
import type { DismantlingChapter } from "./dismantling"

const chapters: DismantlingChapter[] = [
  { id: "ch-1", chapterNumber: 1, title: "第一章 觉醒", content: "男主转职双S震惊全场。", status: "done" },
]

describe("dismantling-stages 提示词共享前缀", () => {
  it("buildDismantlingCharacterPrompt 以 buildDismantlingCachePrefix 输出开头", () => {
    const prefix = buildDismantlingCachePrefix("全民转职", chapters)
    const prompt = buildDismantlingCharacterPrompt({ projectTitle: "全民转职", chapters })
    expect(prompt.startsWith(prefix)).toBe(true)
  })

  it("buildDismantlingDirectionPrompt 以 buildDismantlingCachePrefix 输出开头", () => {
    const prefix = buildDismantlingCachePrefix("全民转职", chapters)
    const prompt = buildDismantlingDirectionPrompt({ projectTitle: "全民转职", chapters })
    expect(prompt.startsWith(prefix)).toBe(true)
  })

  it("buildDismantlingHandcraftPrompt 以 buildDismantlingCachePrefix 输出开头", () => {
    const prefix = buildDismantlingCachePrefix("全民转职", chapters)
    const prompt = buildDismantlingHandcraftPrompt({ projectTitle: "全民转职", chapters })
    expect(prompt.startsWith(prefix)).toBe(true)
  })

  it("buildDismantlingForeshadowingPrompt 以 buildDismantlingCachePrefix 输出开头", () => {
    const prefix = buildDismantlingCachePrefix("全民转职", chapters)
    const prompt = buildDismantlingForeshadowingPrompt({ projectTitle: "全民转职", chapters })
    expect(prompt.startsWith(prefix)).toBe(true)
  })
})

describe("extractCharactersFromStage", () => {
  it("从 markdown 提取角色名和作用", () => {
    const raw = [
      "## 涉及角色与作用",
      "- 男主：金手指持有者，打破规则完成爽点",
      "- 女主：觉醒A级职业，衬托主角反差",
    ].join("\n")
    const chars = extractCharactersFromStage(raw)
    expect(chars).toEqual([
      { name: "男主", role: "金手指持有者，打破规则完成爽点" },
      { name: "女主", role: "觉醒A级职业，衬托主角反差" },
    ])
  })

  it("无角色段时返回空数组", () => {
    expect(extractCharactersFromStage("无关内容")).toEqual([])
  })
})

describe("extractDirectionHintsFromStage", () => {
  it("提取方向指引文本", () => {
    const raw = "## 方向指引\n震惊时机：规则打破时；装逼时机：对比衬托到位时"
    expect(extractDirectionHintsFromStage(raw)).toContain("震惊时机")
    expect(extractDirectionHintsFromStage(raw)).toContain("装逼时机")
  })

  it("无方向指引段时返回空字符串", () => {
    expect(extractDirectionHintsFromStage("无关内容")).toBe("")
  })
})

describe("extractHandcraftHintsFromStage", () => {
  it("提取作者发挥空间提示", () => {
    const raw = "## 作者发挥空间\n爽点处适合玩梗；铺垫处配角对话适合整活"
    expect(extractHandcraftHintsFromStage(raw)).toContain("玩梗")
  })

  it("无发挥空间段时返回空字符串", () => {
    expect(extractHandcraftHintsFromStage("无关内容")).toBe("")
  })
})

describe("extractForeshadowingFromStage", () => {
  it("提取伏笔列表", () => {
    const raw = "## 伏笔\n- 男主系统来源未明（埋设）\n- 新手副本难度未知（埋设）"
    const list = extractForeshadowingFromStage(raw)
    expect(list).toHaveLength(2)
    expect(list[0]).toContain("系统来源")
  })

  it("无伏笔段时返回空数组", () => {
    expect(extractForeshadowingFromStage("无关内容")).toEqual([])
  })
})

describe("buildFrameworkMergePrompt", () => {
  it("以共享前缀开头并包含各阶段输出", () => {
    const prefix = buildDismantlingCachePrefix("作品", chapters)
    const prompt = buildFrameworkMergePrompt({
      projectTitle: "作品",
      chapters,
      stageOutputs: {
        beats: "## 开局钩子\n钩子内容",
        characters: "## 涉及角色\n- 男主：主角",
        direction: "## 方向指引\n震惊时机",
        handcraft: "## 作者发挥空间\n玩梗",
        foreshadowing: "## 伏笔\n- 系统",
      },
    })
    expect(prompt.startsWith(prefix)).toBe(true)
    expect(prompt).toContain("钩子内容")
    expect(prompt).toContain("涉及角色")
    expect(prompt).toContain("方向指引")
    expect(prompt).toContain("作者发挥空间")
    expect(prompt).toContain("伏笔")
  })
})

describe("parseFrameworkMergeOutput", () => {
  it("解析合法 JSON 并返回结构化对象", () => {
    const json = JSON.stringify({
      title: "双S转职反差爽点",
      beats: { hook: "钩子", buildup: "铺垫", payoff: "爽点", endingHook: "结尾钩子" },
      characters: [{ name: "男主", role: "主角" }],
      foreshadowing: ["伏笔1"],
      line: "main",
      prevConnector: "无",
      nextConnector: "引出新手副本",
      reusableTemplate: "先压后扬",
      directionHints: "震惊时机",
      handcraftHints: "玩梗",
    })
    const result = parseFrameworkMergeOutput(json)
    expect(result.title).toBe("双S转职反差爽点")
    expect(result.beats.hook).toBe("钩子")
    expect(result.characters[0].name).toBe("男主")
    expect(result.line).toBe("main")
    expect(result.directionHints).toBe("震惊时机")
  })

  it("解析带 ```json 代码块标记的输出", () => {
    const json = "```json\n" + JSON.stringify({
      title: "测试",
      beats: { hook: "h", buildup: "b", payoff: "p", endingHook: "e" },
      characters: [],
      foreshadowing: [],
      line: "sub",
      reusableTemplate: "模板",
      directionHints: "方向",
      handcraftHints: "发挥",
    }) + "\n```"
    const result = parseFrameworkMergeOutput(json)
    expect(result.title).toBe("测试")
    expect(result.line).toBe("sub")
  })

  it("四段任一为空时抛错", () => {
    const json = JSON.stringify({
      title: "测试",
      beats: { hook: "", buildup: "b", payoff: "p", endingHook: "e" },
      characters: [],
      foreshadowing: [],
      line: "main",
      reusableTemplate: "模板",
      directionHints: "方向",
      handcraftHints: "发挥",
    })
    expect(() => parseFrameworkMergeOutput(json)).toThrow("四段")
  })

  it("directionHints 为空时抛错", () => {
    const json = JSON.stringify({
      title: "测试",
      beats: { hook: "h", buildup: "b", payoff: "p", endingHook: "e" },
      characters: [],
      foreshadowing: [],
      line: "main",
      reusableTemplate: "模板",
      directionHints: "",
      handcraftHints: "发挥",
    })
    expect(() => parseFrameworkMergeOutput(json)).toThrow("方向指引")
  })

  it("AI 返回 error 字段时抛错", () => {
    const json = JSON.stringify({ error: "四段不完整" })
    expect(() => parseFrameworkMergeOutput(json)).toThrow("四段不完整")
  })

  it("JSON 解析失败时抛错", () => {
    expect(() => parseFrameworkMergeOutput("不是JSON")).toThrow()
  })
})
