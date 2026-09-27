import { describe, expect, it } from "vitest"
import { parseOutlineSaveRequests, saveOutlineSaveRequests } from "./outline-save-request"
import { extractChapterOutlineData, validateChapterOutlineData } from "./chapter-outline-template"

/**
 * 章纲全流程验证（方案 B：系统套模板）：
 * AI 回复（MD + ```json chapterOutlineData + outlineSaveRequest）
 *   → 解析得到保存请求
 *   → htmlContent 是软件渲染出来的真正 HTML 卡片流（不是 json / markdown）
 *   → 校验数据自洽
 *   → 保存落盘 .md + .html 两个文件
 */

const STAGES = ["起①", "起②", "起③", "承①", "承①", "承②", "承②", "承③", "承③", "转①", "转②", "合②"]
const BEATS = "平升起紧落缓升紧顶缓顶悬"

function buildChapter(n: number) {
  return {
    n,
    title: `第${n}章标题`,
    stage: STAGES[n - 1],
    beat: BEATS[n - 1],
    expect: "好奇",
    time: `第 ${n} 日`,
    place: `地点${n}`,
    seedFores: n === 1 ? "竹哨" : "",
    payFores: n === 5 ? "竹哨" : "",
    info: { attr: "冲突章", mood: "紧张", words: "约 2500 字", goal: `第${n}章目标` },
    carry: { hook: "承接钩子", left: "遗留问题", heroState: "主角状态", castState: "角色状态", fores: "伏笔", expect: "承接期待" },
    position: { main: "主线承接", advance: "主线推进", charArc: "人物变化", relation: "关系变化", whyRead: "追读目的", newExpect: "新期待" },
    digest: "浓缩剧情一句话",
    events: Array.from({ length: 6 }, (_, i) => ({
      what: `事件${i + 1}`, cause: "起因", action: "行动", result: "结果", use: "作用",
    })),
    keywords: { scene: "场景", mood: "情绪", props: "道具", relation: "关系", sell: "爽点" },
    conditions: { enter: "入场", trigger: "触发", interact: "互动", result: "结果" },
    fourBeat: { open: "开篇", clash: "冲突", burst: "爆点", close: "收尾" },
    moodCurve: [
      { node: "开局", state: "暖", trigger: "触发", feel: "感受" },
      { node: "中段", state: "冷", trigger: "触发", feel: "感受" },
      { node: "峰值", state: "紧", trigger: "触发", feel: "感受" },
      { node: "结尾", state: "落", trigger: "触发", feel: "感受" },
    ],
    sell: { first: "看点", main: "爽点", build: "铺垫", release: "释放", react: "反应", after: "新期待", fit: "一致" },
    expand: [{ info: "信息", how: "扩写", skill: "对话", effect: "情绪" }],
    visual: { env: "环境", micro: "微细节", hint: "暗线", replace: "替代", memory: "记忆点" },
    foreshadow: {
      payFrom: "来源", payHow: "回收方式", payLevel: "部分回收",
      seedNew: "新伏笔", seedAt: "位置", seedUse: "用途",
      hookType: "悬念", readerAsk: "读者会问", nextMust: "下章回应",
    },
    castChanges: [{ who: "杨寒", role: "主角", inState: "入场", outState: "结束", relation: "关系" }],
    worldUpdate: { setting: "设定", place: "地点", faction: "势力", item: "道具", writeBack: "写回" },
    rules: { must: "必须写", forbid: "禁止写", secret: "不能泄露", pace: "节奏", style: "文风", sellPoint: "卖点" },
    handover: { nextStart: "下章承接", nextSolve: "下章解决", nextDelay: "可延迟", nextMood: "情绪", nextHook: "钩子" },
    checks: [
      "三行内入戏",
      "有明确变化",
      "事件链有因果",
      "有核心记忆点",
      "有动作微细节",
      "有爽点",
      "回收旧信息",
      "埋新信息",
      "有追读钩子",
      "已写明下一章交接",
    ],
  }
}

const CHAPTER_MD = [
  "# 章纲-第01–12章：雨夜无我",
  "",
  "## 第1章 第1章标题",
  "",
  "- 核心事件：竹哨声与雨声混在一起",
  "- 本章目标：把编号第一次变成伤人的词",
  "- 章尾钩子：记忆断裂",
].join("\n")

function buildReply(chapterCount = 12): string {
  const data = {
    chapterOutlineData: {
      title: "故事一 雨夜无我 · 章纲",
      // 骨架固定声明 12 章，用于验证「AI 少写章」时能被校验抓出
      story: { index: 1, name: "雨夜无我", range: "第 1–12 章", beats: BEATS },
      words: 12 * 2500,
      chapters: Array.from({ length: chapterCount }, (_, i) => buildChapter(i + 1)),
    },
  }
  return [
    CHAPTER_MD,
    "```json",
    JSON.stringify(data),
    "```",
    "```json",
    JSON.stringify({
      outlineSaveRequest: {
        targetFolder: "章纲",
        fileName: "章纲-第01–12章.md",
        fileType: "chapter-outline",
        writeMode: "create",
        referencedSkills: ["ZhanggangSkill/zhanggangjiegouhua"],
        sourceIntent: "生成故事一 雨夜无我 的章纲",
        content: CHAPTER_MD,
      },
    }),
    "```",
  ].join("\n")
}

describe("章纲全流程（系统套模板）", () => {
  it("解析后的 htmlContent 是真正的静态卡片流，不是 json/markdown", () => {
    const parsed = parseOutlineSaveRequests(buildReply())
    expect(parsed.errors).toEqual([])
    expect(parsed.requests).toHaveLength(1)
    const request = parsed.requests[0]

    expect(request.fileType).toBe("chapter-outline")
    expect(request.content).toContain("# 章纲-第01–12章")
    expect(request.content).not.toContain("chapterOutlineData")

    const html = request.htmlContent ?? ""
    expect(html).toContain("<html")
    expect(html).toContain("<style")
    expect(html).toContain("<details")
    expect(html).not.toContain("<script")
    expect(html.startsWith("json")).toBe(false)
    expect(html).not.toContain('"chapterOutlineData"')
  })

  it("渲染出的 HTML 含 12 张章节卡 × 17 节", () => {
    const request = parseOutlineSaveRequests(buildReply()).requests[0]
    const html = request.htmlContent ?? ""
    expect((html.match(/class="cc"/g) ?? []).length).toBe(12)
    expect((html.match(/class="csec"/g) ?? []).length).toBe(204)
  })

  it("数据自洽时校验通过", () => {
    const request = parseOutlineSaveRequests(buildReply()).requests[0]
    const data = extractChapterOutlineData(buildReply())
    const result = validateChapterOutlineData(data)
    expect(result.ok).toBe(true)
    expect(result.problems).toEqual([])
    expect(request.fileType).toBe("chapter-outline")
  })

  it("章节被截断（只有 3 章）时校验失败，可触发补全", () => {
    const reply = buildReply(3)
    const data = extractChapterOutlineData(reply)
    const result = validateChapterOutlineData(data)
    expect(result.ok).toBe(false)
    expect(result.problems.join("\n")).toContain("章节数与故事骨架不一致")
  })

  it("保存时同时落盘 .md 与 .html", async () => {
    const written: string[] = []
    const parsed = parseOutlineSaveRequests(buildReply())
    const result = await saveOutlineSaveRequests({
      outlineRoot: "/root",
      confirmed: true,
      formats: { md: true, html: true },
      requests: parsed.requests,
      createDirectory: async () => {},
      fileExists: async () => false,
      writeFile: async (path: string) => { written.push(path) },
    })

    expect(result.saved.map((item) => item.fileName)).toEqual([
      "章纲-第01–12章.md",
      "章纲-第01–12章.html",
    ])
    expect(written).toEqual(["/root/章纲/章纲-第01–12章.md", "/root/章纲/章纲-第01–12章.html"])
  })
})