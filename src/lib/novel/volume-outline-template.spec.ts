import { beforeEach, describe, expect, it, vi } from "vitest"
import type { FileNode } from "@/types/wiki"

/**
 * attachVolumeOutlineHtml 的入参形状，与生产函数的泛型约束保持一致：
 * 只有显式标注它，返回值的 T 才会带上可选的 htmlContent / structuredData。
 */
type OutlineHtmlRequest = {
  fileType: string
  content: string
  htmlContent?: string
  structuredData?: string
}

/**
 * @/commands/fs 的替身。显式标注签名（与生产实现一致：readFile / fileExists
 * 收 path，listDirectory 返回 FileNode[]），mockImplementation 的参数才有类型。
 */
const fsMock = {
  fileExists: vi.fn<(path: string) => Promise<boolean>>(async () => false),
  readFile: vi.fn<(path: string) => Promise<string>>(async () => ""),
  listDirectory: vi.fn<(path: string) => Promise<FileNode[]>>(async () => []),
  getExecutableDir: vi.fn<() => Promise<string>>(async () => "C:/App"),
  getResourceDir: vi.fn<() => Promise<string>>(async () => "C:/App/_up_"),
}

vi.mock("@/commands/fs", () => ({
  fileExists: (path: string) => fsMock.fileExists(path),
  readFile: (path: string) => fsMock.readFile(path),
  listDirectory: (path: string) => fsMock.listDirectory(path),
  getExecutableDir: () => fsMock.getExecutableDir(),
  getResourceDir: () => fsMock.getResourceDir(),
}))

import {
  attachVolumeOutlineHtml,
  buildVolumeSkeletonReference,
  checkBeats,
  extractVolumeOutlineData,
  getVolumeOutlineTemplate,
  getVolumeSkeletonReference,
  loadSavedVolumeOutlineDataList,
  primeVolumeSkeletonReference,
  normalizeVolumeOutlineData,
  primeVolumeOutlineTemplate,
  renderVolumeOutlineHtml,
  renderVolumeOutlineMarkdown,
  resetVolumeOutlineTemplateForTest,
  validateVolumeOutlineData,
  VOLUME_OUTLINE_TEMPLATE_READY,
  type VolumeOutlineData,
} from "./volume-outline-template"

const STAGES = ["起①", "起②", "起③", "承①", "承②", "承③", "转①", "转②", "合①", "合②"]

function buildStory(id: number) {
  return {
    id,
    range: `第 ${id * 12 - 11}–${id * 12} 章`,
    title: `故事${id}`,
    beats: "平升起紧落缓升紧顶缓顶悬",
    st: STAGES.map((stage) => ({
      stage,
      label: `${stage}的小标题`,
      who: "主角（主角）＋ 配角（引路）",
      p: ["条目1", "条目2", "条目3"],
    })),
  }
}

function buildData(storyCount = 10): VolumeOutlineData {
  return {
    title: "卷一 无我绝响",
    goal: "查明真相，以己骨换全城",
    stories: Array.from({ length: storyCount }, (_, i) => buildStory(i + 1)),
  }
}

const VALID_MD = "# 卷纲-第01卷\n\n## 卷目标\n大高潮"

describe("volume-outline-template（精简版：只留故事）", () => {
  beforeEach(() => {
    resetVolumeOutlineTemplateForTest()
  })

  it("模板文件加载成功且含全部占位符", () => {
    expect(VOLUME_OUTLINE_TEMPLATE_READY).toBe(true)
  })

  it("渲染出的 HTML 是静态折叠树：含 style、details，且不依赖脚本", () => {
    const html = renderVolumeOutlineHtml(buildData())
    expect(html).toContain("<html")
    expect(html).toContain("<style")
    expect(html).toContain('data-qmai-layout="editorial-v2"')
    expect(html).toContain("<details")
    // 关键：不再使用脚本（软件预览 iframe 的 CSP 会拦截内联脚本）
    expect(html).not.toContain("<script")
    expect(html).not.toContain("__VOLUME_")
  })

  it("10 个故事各渲染出一个故事级节点，且全部默认展开", () => {
    const html = renderVolumeOutlineHtml(buildData())
    expect((html.match(/class="story-wrap"/g) ?? []).length).toBe(10)
    // 1 个根节点都没有了：只有 10 故事 × (1 + 10 环节) = 110
    expect((html.match(/<details class="nd"/g) ?? []).length).toBe(110)
    // 每个 details 都带 open，用户打开就能读故事，不用逐个点
    expect((html.match(/<details class="nd" open>/g) ?? []).length).toBe(110)
    expect(html).not.toContain('<details class="nd">')
  })

  it("每环节渲染出人物行与 3 条具体内容", () => {
    const html = renderVolumeOutlineHtml(buildData())
    expect((html.match(/<div class="who">/g) ?? []).length).toBe(100)
    expect((html.match(/<p class="txt">条目1<\/p>/g) ?? []).length).toBe(100)
    expect((html.match(/<p class="txt">/g) ?? []).length).toBe(300)
  })

  it("每环节带章号定位标签，环节小标题与固定环节名一起显示", () => {
    const html = renderVolumeOutlineHtml(buildData())
    expect(html).toContain("第 1 章")
    expect(html).toContain("第 12 章")
    expect(html).toContain("常态与破口 · 起①的小标题")
  })

  it("不再渲染任何仪表盘 / 台账面板（这些内容曾被模型白写一遍）", () => {
    const html = renderVolumeOutlineHtml(buildData())
    for (const removed of [
      "卷级定位",
      "主题句",
      "叙事形态",
      "结构选用",
      "卷末落点",
      "整卷账本",
      "三层线配比",
      "期待感",
      "强度曲线",
      "反转类型分布",
      "支线推进矩阵",
      "引线闭环表",
      "节拍体检",
      "环节完整性矩阵",
      "伏笔追踪表",
      "人物出场表",
      "地点 / 组织索引",
      "悬念债务",
      "对手推进表",
      "人物成长与资源表",
      "大高潮分解",
    ]) {
      expect(html, `不应再出现「${removed}」`).not.toContain(removed)
    }
  })

  it("数据里即便还带着旧台账字段，也不会渲染出来", () => {
    const data = buildData() as VolumeOutlineData & Record<string, unknown>
    data.position = { pitch: "旧的卷定位" }
    data.escalation = [{ id: 1, stake: "赌注", lose: "代价", rise: "抬升" }]
    data.cast = [{ n: "杨妙萍", role: "引路", stories: "1", u: "交付方向" }]
    const html = renderVolumeOutlineHtml(data)
    expect(html).not.toContain("旧的卷定位")
    expect(html).not.toContain("杨妙萍")
  })

  it("用户自己的旧模板残留占位符会被清空，不漏到页面上", () => {
    const legacy = "<html><body>__VOLUME_TITLE__ __VOLUME_LEDGER__ __VOLUME_POSITION__ __VOLUME_TREE__</body></html>"
    const html = renderVolumeOutlineHtml(buildData(1), legacy)
    expect(html).not.toContain("__VOLUME_")
    expect(html).toContain("卷一 无我绝响")
  })

  it("空数据时给出可读提示而非空白", () => {
    const html = renderVolumeOutlineHtml({ title: "空卷", stories: [] })
    expect(html).toContain("未包含卷纲数据")
  })

  it("标题与目标注入正确且经过转义", () => {
    const html = renderVolumeOutlineHtml({
      title: "卷一 <script>alert(1)</script>",
      goal: "目标 & 代价",
      stories: [],
    })
    expect(html).toContain("&lt;script&gt;")
    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("目标 &amp; 代价")
  })

  it("锚点导航生成 10 个可跳转链接，故事节点带对应 id", () => {
    const html = renderVolumeOutlineHtml(buildData())
    expect((html.match(/class="navlink"/g) ?? []).length).toBe(10)
    for (let id = 1; id <= 10; id += 1) {
      expect(html).toContain(`id="story-${id}"`)
      expect(html).toContain(`href="#story-${id}"`)
    }
  })
})

describe("卷纲 MD 由数据反推（模型不再重复写一遍）", () => {
  it("MD 里每章环节与条目都能在数据里找到", () => {
    const md = renderVolumeOutlineMarkdown(buildData(2))
    expect(md.startsWith("# 卷一 无我绝响")).toBe(true)
    expect(md).toContain("> 查明真相，以己骨换全城")
    expect(md).toContain("## 故事1：故事1")
    expect(md).toContain("- **章号范围：** 第 1–12 章")
    expect(md).toContain("### 起① 常态与破口 · 起①的小标题")
    expect(md).toContain("- **人物：** 主角（主角）＋ 配角（引路）")
    expect(md).toContain("- 条目3")
    // 2 个故事 × 10 环节 × 3 条
    expect((md.match(/^- 条目/gm) ?? []).length).toBe(60)
  })

  it("保存请求 content 为空时由数据补全 MD；已填的旧内容也被数据覆盖", () => {
    const reply = ["```json", JSON.stringify({ volumeOutlineData: buildData(1) }), "```"].join("\n")
    const empty: OutlineHtmlRequest = { fileType: "volume-outline", content: "" }
    expect(renderVolumeOutlineHtml(buildData(1))).toContain("故事1")
    expect(attachVolumeOutlineHtml(empty, reply).content).toContain("## 故事1：故事1")

    // 非空但有内容时：attach 本身不覆盖（覆盖发生在 parse 阶段），这里只断言不会被清空
    const filled: OutlineHtmlRequest = { fileType: "volume-outline", content: VALID_MD }
    expect(attachVolumeOutlineHtml(filled, reply).content).toBe(VALID_MD)
  })
})

describe("normalizeVolumeOutlineData", () => {
  it("只保留故事四件事：id / range / title / st（+可选 beats）", () => {
    const normalized = normalizeVolumeOutlineData(buildData(1))
    expect(normalized).not.toBeNull()
    const story = normalized!.stories[0]
    expect(Object.keys(story).sort()).toEqual(["beats", "id", "range", "st", "title"])
    expect(Object.keys(story.st[0]).sort()).toEqual(["label", "p", "stage", "who"])
  })

  it("环节标识写成 k 时按环节认下，不再报「缺少环节」", () => {
    const normalized = normalizeVolumeOutlineData({
      title: "卷一",
      stories: [{
        id: 1,
        range: "第 1–12 章",
        title: "故事一",
        st: STAGES.map((stage) => ({ k: stage, name: `${stage}小标题`, p: ["a", "b", "c"] })),
      }],
    })
    expect(normalized?.stories[0].st.map((item) => item.stage)).toEqual(STAGES)
    expect(normalized?.stories[0].st[0].label).toBe("起①小标题")
  })

  it("p 里的条目写成对象时也能取到内容，不静默丢弃", () => {
    const normalized = normalizeVolumeOutlineData({
      stories: [{
        id: 1,
        st: [{ stage: "起①", p: [{ v: "对象条目" }, "字符串条目"] }],
      }],
    })
    expect(normalized?.stories[0].st[0].p).toEqual(["对象条目", "字符串条目"])
  })

  it("12 章节拍写成数组时无损拼回字符串", () => {
    const normalized = normalizeVolumeOutlineData({
      stories: [{ id: 1, beats: ["平", "升", "起"], st: [] }],
    })
    expect(normalized?.stories[0].beats).toBe("平升起")
  })

  it("没有故事时返回 null", () => {
    expect(normalizeVolumeOutlineData({ title: "空" })).toBeNull()
    expect(normalizeVolumeOutlineData("不是对象")).toBeNull()
  })

  it("旧版台账字段仍能读入，供老项目的章纲交叉校验继续使用", () => {
    const normalized = normalizeVolumeOutlineData({
      ...buildData(1),
      cast: [{ n: "杨妙萍", role: "引路", stories: "1、4", u: "交付方向" }],
      rivals: [{ n: "白塔外站", moves: [{ id: 1, v: "派回收者上门" }] }],
      foreshadows: [{ v: "竹哨", seed: "故事一 起①", pay: "故事四 承②" }],
    })
    expect(normalized?.cast?.[0].n).toBe("杨妙萍")
    expect(normalized?.rivals?.[0].moves).toHaveLength(1)
    expect(normalized?.foreshadows?.[0].v).toBe("竹哨")
  })

  it("不再读 position / escalation / roles / places 等已删除字段", () => {
    const normalized = normalizeVolumeOutlineData({
      ...buildData(1),
      position: { pitch: "x" },
      escalation: [{ id: 1, stake: "x" }],
      roles: [{ n: "主角", v: "x" }],
      places: [{ n: "白塔", kind: "地点", stories: "1", u: "x" }],
    })
    expect(normalized).not.toBeNull()
    expect(normalized as unknown as Record<string, unknown>).not.toHaveProperty("position")
    expect(normalized as unknown as Record<string, unknown>).not.toHaveProperty("escalation")
  })
})

describe("validateVolumeOutlineData", () => {
  it("完整数据校验通过，且 md 为空也算通过（正文由数据生成）", () => {
    expect(validateVolumeOutlineData(buildData(), VALID_MD).ok).toBe(true)
    expect(validateVolumeOutlineData(buildData(), "").ok).toBe(true)
  })

  it("不再因为缺少台账字段而失败", () => {
    const problems = validateVolumeOutlineData(buildData(), "").problems
    expect(problems).toEqual([])
  })

  it("故事不足 10 个时校验失败", () => {
    const result = validateVolumeOutlineData(buildData(9), "")
    expect(result.ok).toBe(false)
    expect(result.problems.join()).toContain("故事数量不足 10 个")
  })

  it("某故事环节不足 10 个时校验失败", () => {
    const data = buildData()
    data.stories[2].st = data.stories[2].st.slice(0, 8)
    const result = validateVolumeOutlineData(data, "")
    expect(result.ok).toBe(false)
    expect(result.problems.join()).toContain("环节不足 10 个")
  })

  it("缺环节标识时逐项报出", () => {
    const data = buildData()
    data.stories[0].st = data.stories[0].st.filter((stage) => stage.stage !== "合②")
    const result = validateVolumeOutlineData(data, "")
    expect(result.problems.join()).toContain("缺少环节「合②」")
  })

  it("环节内容不足 3 条时校验失败", () => {
    const data = buildData()
    data.stories[0].st[0].p = ["只有一条"]
    const result = validateVolumeOutlineData(data, "")
    expect(result.ok).toBe(false)
    expect(result.problems.join()).toContain("内容不足 3 条")
  })

  it("缺标题或章号范围时报出", () => {
    const data = buildData()
    data.stories[1].title = ""
    data.stories[1].range = ""
    const problems = validateVolumeOutlineData(data, "").problems.join()
    expect(problems).toContain("缺少故事标题")
    expect(problems).toContain("缺少章号范围")
  })

  it("数据为空时校验失败并提示", () => {
    const result = validateVolumeOutlineData(null, "")
    expect(result.ok).toBe(false)
    expect(result.problems[0]).toContain("未解析到卷纲结构化数据")
  })
})

describe("extractVolumeOutlineData", () => {
  it("从 AI 回复中提取 volumeOutlineData（json 围栏）", () => {
    const reply = [
      VALID_MD,
      "```json",
      JSON.stringify({ volumeOutlineData: buildData() }),
      "```",
    ].join("\n")
    const data = extractVolumeOutlineData(reply)
    expect(data).not.toBeNull()
    expect(data?.stories).toHaveLength(10)
    expect(data?.stories[0].st).toHaveLength(10)
  })

  it("回复中没有数据块时返回 null", () => {
    expect(extractVolumeOutlineData("只有一段普通正文")).toBeNull()
  })
})

describe("attachVolumeOutlineHtml", () => {
  const reply = () => ["正文", "```json", JSON.stringify({ volumeOutlineData: buildData() }), "```"].join("\n")

  it("给卷纲请求补上渲染后的静态 HTML", () => {
    const request: OutlineHtmlRequest = { fileType: "volume-outline", content: VALID_MD }
    const enriched = attachVolumeOutlineHtml(request, reply())
    expect(enriched.htmlContent).toContain("<html")
    expect(enriched.htmlContent).toContain("<details")
  })

  it("不处理非卷纲请求", () => {
    const request: OutlineHtmlRequest = { fileType: "chapter-outline", content: VALID_MD }
    expect(attachVolumeOutlineHtml(request, reply()).htmlContent).toBeUndefined()
  })

  it("不覆盖真正的 HTML 文档", () => {
    const existing = "<!DOCTYPE html><html><body>已有</body></html>"
    const request: OutlineHtmlRequest = { fileType: "volume-outline", content: VALID_MD, htmlContent: existing }
    expect(attachVolumeOutlineHtml(request, reply()).htmlContent).toBe(existing)
  })

  it("会把非 HTML 内容（误抓的 json）替换成渲染结果", () => {
    const request: OutlineHtmlRequest = {
      fileType: "volume-outline",
      content: VALID_MD,
      htmlContent: 'json {"volumeOutlineData":{"title":"误抓内容"}}',
    }
    const enriched = attachVolumeOutlineHtml(request, reply())
    expect(enriched.htmlContent).toContain("<html")
    expect(enriched.htmlContent).not.toContain("误抓内容")
  })

  it("无数据时清掉非 HTML 内容", () => {
    const request: OutlineHtmlRequest = { fileType: "volume-outline", content: VALID_MD, htmlContent: 'json {"foo":1}' }
    const enriched = attachVolumeOutlineHtml(request, "没有任何数据块的回复")
    expect(enriched.htmlContent).toBeUndefined()
  })

  it("同时带上结构化数据（供章纲交叉校验）", () => {
    const request: OutlineHtmlRequest = { fileType: "volume-outline", content: VALID_MD }
    const enriched = attachVolumeOutlineHtml(request, reply())
    expect(enriched.structuredData).toBeTruthy()
    const parsed = JSON.parse(enriched.structuredData ?? "{}") as { stories?: unknown[] }
    expect(parsed.stories).toHaveLength(10)
  })

  it("已有真 HTML 时仍补结构化数据、不覆盖 HTML", () => {
    const existing = "<!DOCTYPE html><html><body>已有</body></html>"
    const request: OutlineHtmlRequest = { fileType: "volume-outline", content: VALID_MD, htmlContent: existing }
    const enriched = attachVolumeOutlineHtml(request, reply())
    expect(enriched.htmlContent).toBe(existing)
    expect(enriched.structuredData).toBeTruthy()
  })
})

describe("卷纲骨架参考（章纲对齐用）", () => {
  it("loadSavedVolumeOutlineDataList 读取卷纲目录下的伴生 .json", async () => {
    fsMock.listDirectory.mockResolvedValue([
      { name: "第一卷.json", path: "E:/Novel/wiki/outlines/卷纲/第一卷.json", is_dir: false },
      { name: "说明.md", path: "E:/Novel/wiki/outlines/卷纲/说明.md", is_dir: false },
      { name: "坏文件.json", path: "E:/Novel/wiki/outlines/卷纲/坏文件.json", is_dir: false },
    ])
    fsMock.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith("坏文件.json")) return "{ 不是合法 JSON"
      return JSON.stringify(buildData())
    })

    const list = await loadSavedVolumeOutlineDataList("E:/Novel")

    expect(list).toHaveLength(1)
    expect(list[0].stories).toHaveLength(10)
  })

  it("卷纲目录不存在时静默返回空数组", async () => {
    fsMock.listDirectory.mockRejectedValue(new Error("ENOENT"))
    expect(await loadSavedVolumeOutlineDataList("E:/Novel")).toEqual([])
    expect(await loadSavedVolumeOutlineDataList("")).toEqual([])
  })

  it("buildVolumeSkeletonReference 列出每卷每故事的真骨架", () => {
    const text = buildVolumeSkeletonReference([buildData(2)])
    expect(text).toContain("【卷纲真骨架（必须原样使用）】")
    expect(text).toContain("故事1")
    expect(text).toContain("第 1–12 章")
    expect(text).toContain("平升起紧落缓升紧顶缓顶悬")
    expect(text).toContain("禁止改写、拼接或自创")
  })

  it("故事没写 beats 时不硬塞「未填」节拍", () => {
    const data = buildData(1)
    delete data.stories[0].beats
    const text = buildVolumeSkeletonReference([data])
    expect(text).toContain("章号区间：第 1–12 章")
    expect(text).not.toContain("节拍：")
  })

  it("没有卷纲数据时骨架参考退回「从卷纲 MD 逐字抄写」", () => {
    const text = buildVolumeSkeletonReference([])
    expect(text).toContain("还没有可用的卷纲结构化数据")
    expect(text).toContain("逐字抄写")
  })

  it("primeVolumeSkeletonReference 预加载骨架文本供同步提示词使用", async () => {
    fsMock.listDirectory.mockResolvedValue([
      { name: "第一卷.json", path: "E:/Novel/wiki/outlines/卷纲/第一卷.json", is_dir: false },
    ])
    fsMock.readFile.mockResolvedValue(JSON.stringify(buildData(2)))

    await primeVolumeSkeletonReference("E:/Novel")
    expect(getVolumeSkeletonReference()).toContain("故事2")

    // 项目为空或读取失败时清空缓存，提示词退回抄写说明
    await primeVolumeSkeletonReference(null)
    expect(getVolumeSkeletonReference()).toBe("")

    fsMock.listDirectory.mockRejectedValue(new Error("ENOENT"))
    await primeVolumeSkeletonReference("E:/Novel")
    expect(getVolumeSkeletonReference()).toBe("")
  })
})

describe("checkBeats（章纲仍然用它校验逐章节拍）", () => {
  it("合规序列没有问题", () => {
    expect(checkBeats("平升起紧落缓升紧顶缓顶悬")).toEqual([])
  })

  it("连续 3 章同拍、顶后未落、悬不在末章都能识别", () => {
    expect(checkBeats("平平平升起紧落缓升紧顶悬").join()).toContain("连续 3 章")
    expect(checkBeats("平升起紧落缓升紧顶顶悬").join()).toContain("后接")
    expect(checkBeats("平悬起紧落缓升紧顶缓顶").join()).toContain("只能落在末章")
  })
})

describe("volume-outline-template 运行时加载", () => {
  const CUSTOM_TEMPLATE = [
    "<!DOCTYPE html><html><head><style>.custom{}</style></head><body>",
    "<h1>__VOLUME_TITLE__</h1><div>__VOLUME_GOAL__</div><div>__VOLUME_CHIPS__</div>",
    "__VOLUME_NAV__",
    "<main>__VOLUME_TREE__</main>",
    "</body></html>",
  ].join("")

  beforeEach(() => {
    resetVolumeOutlineTemplateForTest()
    fsMock.fileExists.mockReset().mockResolvedValue(false)
    fsMock.readFile.mockReset().mockResolvedValue("")
    fsMock.getExecutableDir.mockReset().mockResolvedValue("C:/App")
    fsMock.getResourceDir.mockReset().mockResolvedValue("C:/App/_up_")
  })

  it("默认使用内置模板", () => {
    expect(getVolumeOutlineTemplate()).toContain('data-qmai-layout="editorial-v2"')
  })

  it("项目目录存在覆盖模板时优先使用", async () => {
    fsMock.fileExists.mockImplementation(async (path: string) =>
      path.endsWith(".qmai/卷纲模板.html"))
    fsMock.readFile.mockResolvedValue(CUSTOM_TEMPLATE)

    await primeVolumeOutlineTemplate("E:/Novel")

    expect(getVolumeOutlineTemplate()).toBe(CUSTOM_TEMPLATE)
    expect(renderVolumeOutlineHtml(buildData())).toContain(".custom{}")
  })

  it("项目无覆盖时回退到程序 skills 目录", async () => {
    fsMock.fileExists.mockImplementation(async (path: string) =>
      path.includes("C:/App/skills/SkillHub/DagangSkill/juangangzhedieshu/template.html"))
    fsMock.readFile.mockResolvedValue(CUSTOM_TEMPLATE)

    await primeVolumeOutlineTemplate("E:/Novel")

    expect(getVolumeOutlineTemplate()).toBe(CUSTOM_TEMPLATE)
  })

  it("项目与程序目录都没有时回退内置模板", async () => {
    await primeVolumeOutlineTemplate("E:/Novel")
    expect(getVolumeOutlineTemplate()).toContain('data-qmai-layout="editorial-v2"')
  })

  it("覆盖模板缺少占位符时忽略并回退内置", async () => {
    fsMock.fileExists.mockResolvedValue(true)
    fsMock.readFile.mockResolvedValue("<html>no placeholder</html>")

    await primeVolumeOutlineTemplate("E:/Novel")

    expect(getVolumeOutlineTemplate()).toContain('data-qmai-layout="editorial-v2"')
  })

  it("运行目录探测抛错时不影响回退", async () => {
    fsMock.getExecutableDir.mockRejectedValue(new Error("no exe dir"))
    fsMock.getResourceDir.mockRejectedValue(new Error("no resource dir"))

    await primeVolumeOutlineTemplate("E:/Novel")

    expect(getVolumeOutlineTemplate()).toContain('data-qmai-layout="editorial-v2"')
  })
})

/**
 * 卷纲数据 → Markdown 反推的落盘质量。
 *
 * 模型不再写卷纲正文，用户拿到的 .md 完全由这里生成，所以它必须：
 * 一个字段不丢、不夹带 JSON 符号、没有内容的空环节不要留一个空标题。
 */
describe("卷纲数据 → Markdown 反推", () => {
  it("标题、目标、故事骨架与环节内容全都在", () => {
    const text = renderVolumeOutlineMarkdown(buildData(2))
    expect(text).toContain("# 卷一 无我绝响")
    expect(text).toContain("> 查明真相，以己骨换全城")
    expect(text).toContain("## 故事1：故事1")
    expect(text).toContain("- **章号范围：** 第 1–12 章")
    expect(text).toContain("- **章情节拍：** 平升起紧落缓升紧顶缓顶悬")
    expect(text).toContain("- **人物：** 主角（主角）＋ 配角（引路）")
    expect(text).toContain("- 条目1")
    // 逐字段核对
    const haystack = text.replace(/\\\|/g, "|")
    const walk = (value: unknown): string[] => {
      if (typeof value === "string") return value.trim() ? [value.trim()] : []
      if (Array.isArray(value)) return value.flatMap(walk)
      if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap(walk)
      return []
    }
    expect(walk(buildData(2)).filter((item) => !haystack.includes(item))).toEqual([])
  })

  it("没有内容的环节不留空标题，也没有「未定」占位", () => {
    const data = buildData(1)
    data.stories[0].st = [{ stage: "起①", label: "", who: "", p: [] }]
    const text = renderVolumeOutlineMarkdown(data)
    expect(text).not.toContain("### 起①")
    expect(text).not.toContain("未定")
    expect(text).not.toMatch(/\n\n\n/)
  })

  it("不夹带任何 JSON 符号", () => {
    const text = renderVolumeOutlineMarkdown(buildData(1))
    expect(text).not.toMatch(/[{}]/)
    expect(text).not.toContain("```")
    expect(text).not.toMatch(/"\s*:/)
    expect(text).not.toContain('"st"')
    expect(text).not.toContain("volumeOutlineData")
  })
})
