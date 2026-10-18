import { describe, expect, it } from "vitest"
import { parseOutlineSaveRequests, saveOutlineSaveRequests } from "./outline-save-request"
import { validateVolumeOutlineData, extractVolumeOutlineData } from "./volume-outline-template"

/**
 * 卷纲全流程验证（方案 B：系统套模板 · 精简版）：
 * AI 回复（```json volumeOutlineData + outlineSaveRequest，content 留空）
 *   → 软件用数据反推 MD、渲染 HTML 折叠树
 *   → 校验数据完整
 *   → 保存落盘 .md + .html + .json
 */

const STAGES = ["起①", "起②", "起③", "承①", "承②", "承③", "转①", "转②", "合①", "合②"]

function buildStory(id: number) {
  return {
    id,
    range: `第 ${id * 12 - 11}–${id * 12} 章`,
    title: `故事${id}`,
    beats: "平升起紧落缓升紧顶缓顶悬",
    st: STAGES.map((stage) => ({
      stage,
      label: `${stage}小标题`,
      who: "主角（主角）＋ 配角（引路）",
      p: ["条目1", "条目2", "条目3"],
    })),
  }
}

function buildReply(storyCount = 10): string {
  return [
    "```json",
    JSON.stringify({
      volumeOutlineData: {
        title: "卷一 无我绝响",
        goal: "查明母亲失踪真相",
        stories: Array.from({ length: storyCount }, (_, i) => buildStory(i + 1)),
      },
    }),
    "```",
    "```json",
    JSON.stringify({
      outlineSaveRequest: {
        targetFolder: "卷纲",
        fileName: "卷纲-第01卷.md",
        fileType: "volume-outline",
        writeMode: "create",
        referencedSkills: ["DagangSkill/juangangzhedieshu"],
        sourceIntent: "生成第01卷卷纲",
        // 新契约：正文由软件生成，模型不再重复写一遍
        content: "",
      },
    }),
    "```",
  ].join("\n")
}

describe("卷纲全流程（系统套模板 · 精简版）", () => {
  it("解析后的 htmlContent 是真正的静态折叠树，不是 json/markdown", () => {
    const parsed = parseOutlineSaveRequests(buildReply())
    expect(parsed.errors).toEqual([])
    expect(parsed.requests).toHaveLength(1)
    const request = parsed.requests[0]

    expect(request.fileType).toBe("volume-outline")
    const html = request.htmlContent ?? ""
    expect(html).toContain("<html")
    expect(html).toContain("<style")
    expect(html).toContain("<details")
    // 不依赖脚本（软件预览 iframe 的 CSP 会拦截内联脚本）
    expect(html).not.toContain("<script")
    // 不应是误抓的 json 文本
    expect(html.startsWith("json")).toBe(false)
    expect(html).not.toContain('"volumeOutlineData"')
  })

  it("模型不写 MD 时，正文由结构化数据生成", () => {
    const request = parseOutlineSaveRequests(buildReply()).requests[0]
    expect(request.content).toContain("# 卷一 无我绝响")
    expect(request.content).toContain("## 故事1：故事1")
    expect(request.content).toContain("### 起① 常态与破口 · 起①小标题")
    expect(request.content).not.toContain("volumeOutlineData")
    // 10 故事 × 10 环节 × 3 条
    expect((request.content.match(/^- 条目/gm) ?? []).length).toBe(300)
  })

  it("围栏外那句「已生成」不会被当成正文存下来", () => {
    const reply = buildReply().replace(
      "```json\n{\"volumeOutlineData\"",
      "好的，卷纲已生成。\n\n```json\n{\"volumeOutlineData\"",
    )
    const request = parseOutlineSaveRequests(reply).requests[0]
    expect(request.content).toContain("# 卷一 无我绝响")
    expect(request.content).not.toBe("好的，卷纲已生成。")
  })

  it("渲染出的 HTML 含 10 个故事 × 10 个环节，且全部展开", () => {
    const request = parseOutlineSaveRequests(buildReply()).requests[0]
    const html = request.htmlContent ?? ""
    expect((html.match(/class="story-wrap"/g) ?? []).length).toBe(10)
    expect((html.match(/<p class="txt">/g) ?? []).length).toBe(300)
    expect((html.match(/<details class="nd" open>/g) ?? []).length).toBe(110)
  })

  it("数据完整时校验通过", () => {
    const request = parseOutlineSaveRequests(buildReply()).requests[0]
    const data = extractVolumeOutlineData(buildReply())
    const result = validateVolumeOutlineData(data, request.content)
    expect(result.ok).toBe(true)
    expect(result.problems).toEqual([])
  })

  it("故事被截断（只有 5 个）时校验失败，可触发补全", () => {
    const reply = buildReply(5)
    const request = parseOutlineSaveRequests(reply).requests[0]
    const data = extractVolumeOutlineData(reply)
    const result = validateVolumeOutlineData(data, request.content)
    expect(result.ok).toBe(false)
    expect(result.problems.join("\n")).toContain("故事数量不足 10 个")
  })

  it("保存时同时落盘 .md、.html 与伴生 .json（供章纲交叉校验）", async () => {
    const written: string[] = []
    const parsed = parseOutlineSaveRequests(buildReply())
    expect(parsed.requests[0].structuredData).toBeTruthy()
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
      "卷纲-第01卷.md",
      "卷纲-第01卷.html",
      "卷纲-第01卷.json",
    ])
    expect(written).toEqual([
      "/root/卷纲/卷纲-第01卷.md",
      "/root/卷纲/卷纲-第01卷.html",
      "/root/卷纲/卷纲-第01卷.json",
    ])
  })
})
