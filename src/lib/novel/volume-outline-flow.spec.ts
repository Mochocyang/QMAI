import { describe, expect, it } from "vitest"
import { parseOutlineSaveRequests, saveOutlineSaveRequests } from "./outline-save-request"
import { validateVolumeOutlineData, extractVolumeOutlineData } from "./volume-outline-template"

/**
 * 卷纲全流程验证（方案 B：系统套模板）：
 * AI 回复（MD + ```json volumeOutlineData + outlineSaveRequest）
 *   → 解析得到保存请求
 *   → htmlContent 是软件渲染出来的真正 HTML 折叠树（不是 json / markdown）
 *   → 校验数据完整
 *   → 保存落盘 .md + .html 两个文件
 */

const STAGES = ["起①", "起②", "起③", "承①", "承②", "承③", "转①", "转②", "合①", "合②"]
const MID = ["认知反转", "规则反转", "主体反转", "身份反转", "时间反转"]
const TWIST = ["规则反转", "身份反转", "认知反转", "主体反转", "代价反转"]

function buildStory(id: number) {
  return {
    id,
    range: `第 ${id * 12 - 11}–${id * 12} 章`,
    title: `故事${id}`,
    deliver: `交付人物${id}`,
    gift: `获得物${id}`,
    mid: MID[(id - 1) % MID.length],
    twist: TWIST[(id - 1) % TWIST.length],
    hook: `引线${id}`,
    climax: `小高潮${id}`,
    beats: "平升起紧落缓升紧顶缓顶悬",
    line: {
      main: `主线推进${id}`,
      sub: [{ n: `支线${id}`, v: "支线推进" }],
      daily: { v: "日常插曲", u: "藏了伏笔" },
    },
    st: STAGES.map((stage) => ({
      stage,
      who: "主角（主角）＋ 配角（引路）",
      use: "这一段要完成什么",
      p: ["条目1", "条目2", "条目3"],
    })),
  }
}

const VOLUME_MD = "# 卷纲-第01卷\n\n## 卷目标\n查明真相，以己骨换全城。\n\n## 故事1\n- 高潮：白骨自燃\n- 交付：陈守拙\n- 获得：火漆印章\n- 引线：第七次"

const ROLE_KEYS = ["引路", "主角", "阻力", "镜子", "代价", "预埋"]

function buildReply(storyCount = 10): string {
  const data = {
    volumeOutlineData: {
      title: "卷一 无我绝响",
      goal: "查明母亲失踪真相",
      stories: Array.from({ length: storyCount }, (_, i) => buildStory(i + 1)),
      position: {
        pitch: "卷定位",
        theme: "请叫我名字",
        narrative: "雨夜归来、旧村追杀",
        structure: "全卷用英雄之旅；单故事用 10 环节；逐章用 8 种情绪结构",
        chapters: "第 1–120 章",
        ending: "走向莲城深处",
      },
      roles: ROLE_KEYS.map((n) => ({ n, v: `${n}承担者` })),
      foreshadows: [{ v: "竹哨", seed: "故事一 起①", pay: "故事四 承②" }],
      cast: [{ n: "杨妙萍", role: "引路", stories: "1、4", u: "交付追查方向" }],
      escalation: Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        stake: `赌注${i + 1}`,
        lose: `代价${i + 1}`,
        rise: `抬升${i + 1}`,
      })),
      debts: [{ q: "杨小晚还活着吗", from: "故事三 合②", plan: "第二卷" }],
      rivals: [{ n: "白塔外站", moves: [{ id: 1, v: "派回收者上门" }, { id: 2, v: "启动封锁程序" }] }],
      growth: [{ n: "杨寒", gains: "092 烙印", state: "学会把愤怒换成情报" }],
      places: [{ n: "白塔旧院", kind: "地点", stories: "1、2", u: "编号手术第一现场" }],
    },
  }
  return [
    VOLUME_MD,
    "```json",
    JSON.stringify(data),
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
        content: VOLUME_MD,
      },
    }),
    "```",
  ].join("\n")
}

describe("卷纲全流程（系统套模板）", () => {
  it("解析后的 htmlContent 是真正的静态折叠树，不是 json/markdown", () => {
    const parsed = parseOutlineSaveRequests(buildReply())
    expect(parsed.errors).toEqual([])
    expect(parsed.requests).toHaveLength(1)
    const request = parsed.requests[0]

    expect(request.fileType).toBe("volume-outline")
    expect(request.content).toContain("# 卷纲-第01卷")
    // MD 正文不应混入 json 数据块的语言标记
    expect(request.content).not.toContain("volumeOutlineData")

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

  it("渲染出的 HTML 含 10 个故事 × 10 个环节", () => {
    const request = parseOutlineSaveRequests(buildReply()).requests[0]
    const html = request.htmlContent ?? ""
    expect((html.match(/class="story-wrap"/g) ?? []).length).toBe(10)
    expect((html.match(/作用：/g) ?? []).length).toBe(100)
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