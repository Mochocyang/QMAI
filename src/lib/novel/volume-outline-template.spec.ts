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
  extractVolumeOutlineData,
  getVolumeOutlineTemplate,
  getVolumeSkeletonReference,
  loadSavedVolumeOutlineDataList,
  primeVolumeSkeletonReference,
  normalizeVolumeOutlineData,
  primeVolumeOutlineTemplate,
  renderVolumeOutlineHtml,
  resetVolumeOutlineTemplateForTest,
  validateVolumeOutlineData,
  VOLUME_OUTLINE_TEMPLATE_READY,
  type VolumeOutlineData,
} from "./volume-outline-template"

const STAGES = ["起①", "起②", "起③", "承①", "承②", "承③", "转①", "转②", "合①", "合②"]

function buildStory(id: number, mid = "认知反转", twist = "规则反转") {
  return {
    id,
    range: `第 ${id * 12 - 11}–${id * 12} 章`,
    title: `故事${id}`,
    deliver: "交付人物",
    gift: `物件${id}`,
    mid,
    twist,
    hook: `引线${id}`,
    climax: "小高潮",
    beats: "平升起紧落缓升紧顶缓顶悬",
    line: {
      main: "主线推进",
      sub: [{ n: "支线名", v: "支线推进" }],
      daily: { v: "日常插曲", u: "藏了一个伏笔" },
    },
    st: STAGES.map((stage) => ({
      stage,
      who: "主角（主角）＋ 配角（引路）",
      use: "这一段要完成什么",
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

const ROLE_KEYS = ["引路", "主角", "阻力", "镜子", "代价", "预埋"]

/** 加上全部跨故事台账字段的完整数据（校验应当通过）。 */
function buildFullData(): VolumeOutlineData {
  return {
    ...buildData(),
    position: {
      pitch: "卷定位一句话",
      theme: "主题句",
      narrative: "叙事形态",
      structure: "全卷用英雄之旅；单故事用 10 环节；逐章用 8 种情绪结构",
      chapters: "第 1–120 章",
      ending: "卷末落点",
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
  }
}

describe("volume-outline-template", () => {
  it("模板文件加载成功且含全部占位符", () => {
    expect(VOLUME_OUTLINE_TEMPLATE_READY).toBe(true)
  })

  it("渲染出的 HTML 是静态折叠树：含 style、details，且不依赖脚本", () => {
    const html = renderVolumeOutlineHtml(buildData())
    expect(html).toContain("<html")
    expect(html).toContain("<style")
    expect(html).toContain("#B8551D")
    expect(html).toContain("<details")
    // 关键：不再使用脚本（软件预览 iframe 的 CSP 会拦截内联脚本）
    expect(html).not.toContain("<script")
    expect(html).not.toContain("__VOLUME_")
  })

  it("10 个故事各渲染出一个故事级 details 节点", () => {
    const html = renderVolumeOutlineHtml(buildData())
    const storyWraps = (html.match(/class="story-wrap"/g) ?? []).length
    expect(storyWraps).toBe(10)
  })

  it("每故事渲染出线/拍 + 10 个环节（共 12 个子节点）", () => {
    const html = renderVolumeOutlineHtml(buildData())
    // 1 根 + 10 故事 + 10×(线 + 拍 + 10 环节) = 1 + 10 + 120 = 131
    const details = (html.match(/<details class="nd"/g) ?? []).length
    expect(details).toBe(131)
  })

  it("每环节渲染出人物作用行与 3 条条目", () => {
    const html = renderVolumeOutlineHtml(buildData())
    expect((html.match(/作用：/g) ?? []).length).toBe(100)
    // 只数折叠树叶子行里的条目，避免把面板表格里的引用也算进来
    expect((html.match(/<div class="txt">条目1<\/div>/g) ?? []).length).toBe(100)
  })

  it("12 章节拍渲染为节拍标签", () => {
    const html = renderVolumeOutlineHtml(buildData())
    // 折叠树里 12 拍 / 故事，节拍体检面板再逐故事复现一遍
    expect((html.match(/class="bt"/g) ?? []).length).toBe(240)
    // 「第N章」只出现在折叠树的节拍行里
    expect((html.match(/<b>第\d+章<\/b>/g) ?? []).length).toBe(120)
  })

  it("卷级定位卡渲染六项定位，并提供卷级功能位总览", () => {
    const data = buildData()
    data.position = {
      pitch: "用姑姑之死把编号压过姓名的恶钉进读者心里",
      theme: "请叫我名字",
      narrative: "雨夜归来、旧村追杀",
      structure: "全卷用英雄之旅；单故事用 10 环节；逐章用 8 情绪结构",
      chapters: "第 1–120 章",
      ending: "走向莲城深处的实验网络",
    }
    data.roles = [
      { n: "引路", v: "杨妙萍（残魂）" },
      { n: "主角", v: "杨寒" },
    ]
    const html = renderVolumeOutlineHtml(data)
    expect(html).toContain("卷级定位")
    expect(html).toContain("主题句")
    expect(html).toContain("请叫我名字")
    expect(html).toContain("结构选用")
    expect(html).toContain("卷级人物功能位总览")
    expect(html).toContain('class="role role-lead"')
    expect(html).toContain("杨妙萍（残魂）")
  })

  it("缺少 position / roles 时给出可见提示", () => {
    const html = renderVolumeOutlineHtml(buildData())
    expect(html).toContain("本次未生成卷级定位")
    expect(html).toContain("本次未生成卷级功能位总览")
  })

  it("锚点导航生成 10 个可跳转链接，故事节点带对应 id", () => {
    const html = renderVolumeOutlineHtml(buildData())
    expect((html.match(/class="navlink"/g) ?? []).length).toBe(10)
    expect(html).toContain('href="#story-7"')
    expect(html).toContain('id="story-7"')
  })

  it("整卷账本按故事章号范围汇总章数、字数与大高潮位置", () => {
    const html = renderVolumeOutlineHtml(buildData())
    expect(html).toContain("整卷账本")
    expect(html).toContain("<b>120</b> 章")
    expect(html).toContain("约 30.0 万字")
    expect(html).toContain("10 个")
    expect(html).toContain("第 109–120 章（合①–合②）")
  })

  it("三层线配比核对日常是否有可落的节拍", () => {
    const html = renderVolumeOutlineHtml(buildData())
    expect(html).toContain("三层线配比")
    expect(html).toContain("主线 60% · 支线 25% · 日常 15%")
    expect(html).toContain("10/10 个故事都含 平/落/缓/悬 拍")
  })

  it("期待感强度曲线用静态 SVG 绘制，并标出峰值", () => {
    const html = renderVolumeOutlineHtml(buildData())
    expect(html).toContain("期待感强度曲线")
    expect(html).toContain("<svg")
    expect(html).toContain("<polyline")
    // 12 拍里 2 个「顶」× 10 个故事
    expect((html.match(/class="cp"/g) ?? []).length).toBe(20)
    expect(html).toContain("峰值（顶）20 次")
  })

  it("节拍体检能识别连续 3 章同拍、顶后未落、悬不在末章", () => {
    const data = buildData()
    data.stories[0].beats = "平平平升起落缓升紧顶悬顶"
    data.stories[1].beats = "平升起紧落缓升紧顶悬悬悬"
    data.stories[2].beats = "平升起紧落缓悬升紧顶落缓"
    const html = renderVolumeOutlineHtml(data)
    expect(html).toContain("第 1–3 章连续 3 章同为「平」")
    expect(html).toContain("应接 落 / 缓")
    expect(html).toContain("悬只能落在末章")
    expect(html).toContain("合规 7/10 个故事")
  })

  it("环节完整性矩阵按 ●/○/· 标记齐全、条目不足与缺失", () => {
    const data = buildData()
    data.stories[0].st[2].p = ["只有一条"]
    data.stories[0].st.splice(7, 1)
    const html = renderVolumeOutlineHtml(data)
    expect(html).toContain("环节完整性矩阵")
    expect((html.match(/class="cell-ok"/g) ?? []).length).toBe(98)
    expect((html.match(/class="cell-part"/g) ?? []).length).toBe(1)
    expect((html.match(/class="cell-miss"/g) ?? []).length).toBe(1)
  })

  it("大高潮分解、代价阶梯、悬念债务、对手推进、成长、地点索引按数据渲染", () => {
    const data = buildData()
    data.escalation = [{ id: 1, stake: "一个人的命", lose: "姑姑肉身", rise: "从复仇者变成追链者" }]
    data.debts = [{ q: "杨小晚还活着吗", from: "故事三 合②", plan: "第二卷 起②" }]
    data.rivals = [{ n: "白塔外站", moves: [{ id: 1, v: "派回收者上门" }, { id: 2, v: "启动封锁程序" }] }]
    data.growth = [{ n: "杨寒", gains: "092 烙印 → 记忆方体", state: "学会把愤怒换成情报" }]
    data.places = [{ n: "白塔旧院", kind: "地点", stories: "1、2", u: "编号手术第一现场" }]
    const html = renderVolumeOutlineHtml(data)
    expect(html).toContain("大高潮分解 · 代价阶梯")
    expect(html).toContain("从复仇者变成追链者")
    expect(html).toContain("悬念债务表")
    expect(html).toContain("杨小晚还活着吗")
    expect(html).toContain("对手推进表")
    expect(html).toContain("出手 2 次")
    expect(html).toContain("故事2：启动封锁程序")
    expect(html).toContain("人物成长与资源表")
    expect(html).toContain("092 烙印 → 记忆方体")
    expect(html).toContain("地点 / 组织索引")
    expect(html).toContain("编号手术第一现场")
  })

  it("缺少新版台账字段时逐个给出可见提示", () => {
    const html = renderVolumeOutlineHtml(buildData())
    expect(html).toContain("本次未生成大高潮分解与代价阶梯")
    expect(html).toContain("本次未生成悬念债务表")
    expect(html).toContain("本次未生成对手推进表")
    expect(html).toContain("本次未生成人物成长与资源表")
    expect(html).toContain("本次未生成地点 / 组织索引")
  })

  it("每个环节渲染出章号定位标签（12 章固定映射）", () => {
    const html = renderVolumeOutlineHtml(buildData())
    expect((html.match(/class="tag chap"/g) ?? []).length).toBe(100)
    expect(html).toContain("第 4–5 章")
    expect(html).toContain("第 11–12 章")
  })

  it("环节带 pay 时渲染期待兑现标签", () => {
    const data = buildData()
    expect((renderVolumeOutlineHtml(data).match(/class="tag pay"/g) ?? []).length).toBe(0)
    data.stories[0].st[0].pay = "承②"
    const html = renderVolumeOutlineHtml(data)
    expect(html).toContain("兑现 · 承②")
    expect((html.match(/class="tag pay"/g) ?? []).length).toBe(1)
  })

  it("反转类型分布面板统计覆盖、次数与重复情况", () => {
    const html = renderVolumeOutlineHtml(buildData())
    expect(html).toContain("反转类型分布")
    expect(html).toContain("覆盖 2/7 类")
    expect((html.match(/class="chip rev/g) ?? []).length).toBe(7)
    expect((html.match(/class="chip rev zero"/g) ?? []).length).toBe(5)
    expect(html).toContain("认知反转 ×10")
  })

  it("支线推进矩阵汇总每条支线在 10 个故事里的推进", () => {
    const html = renderVolumeOutlineHtml(buildData())
    expect(html).toContain("支线推进矩阵")
    expect(html).toContain("1 条支线 × 10 个故事")
    expect((html.match(/<td class="on"/g) ?? []).length).toBe(10)
    expect((html.match(/class="nd pnd"/g) ?? []).length).toBe(1)
    expect(html).toContain("故事3《故事3》：支线推进")
  })

  it("没有支线数据时支线面板给出提示", () => {
    const data = buildData()
    data.stories.forEach((story) => {
      story.line.sub = []
    })
    expect(renderVolumeOutlineHtml(data)).toContain("本次未生成支线数据")
  })

  it("引线闭环表把故事N引线与故事N+1起①破口接起来", () => {
    const html = renderVolumeOutlineHtml(buildData())
    expect(html).toContain("引线闭环表")
    expect(html).toContain("下一故事起①破口")
    expect(html).toContain("下一卷 起①")
    expect((html.match(/>下一卷 起①</g) ?? []).length).toBe(1)
  })

  it("故事带 link 时引线闭环表优先显示承接说明", () => {
    const data = buildData()
    data.stories[0].link = "故事二起①从她口中的罗医生接着查"
    const html = renderVolumeOutlineHtml(data)
    expect(html).toContain("故事二起①从她口中的罗医生接着查")
    expect((html.match(/>承接说明</g) ?? []).length).toBe(1)
  })

  it("缺少 foreshadows / cast 时给出可见提示", () => {
    const html = renderVolumeOutlineHtml(buildData())
    expect(html).toContain("本次未生成伏笔追踪")
    expect(html).toContain("本次未生成人物出场表")
  })

  it("有 foreshadows / cast 时渲染表格与闭环状态", () => {
    const data = buildData()
    data.foreshadows = [
      { v: "竹哨", seed: "故事一 起①", pay: "故事四 承②" },
      { v: "编号痕迹", seed: "故事二 起②", pay: "" },
    ]
    data.cast = [{ n: "杨妙萍", role: "引路", stories: "1、4", u: "交付追查方向" }]
    const html = renderVolumeOutlineHtml(data)
    expect(html).toContain("2 条 · 已闭环 1 条")
    expect(html).toContain("已闭环")
    expect(html).toContain("未闭环")
    expect(html).toContain("人物出场表")
    expect(html).toContain('class="role role-lead"')
    expect(html).toContain("<b>2</b> 条伏笔")
  })

  it("normalizeVolumeOutlineData 解析 pay / link / foreshadows / cast", () => {
    const normalized = normalizeVolumeOutlineData({
      stories: [{ id: 1, title: "故事一", link: "接法", st: [{ stage: "起①", pay: "合①", p: ["a", "b", "c"] }] }],
      foreshadows: [{ v: "竹哨", seed: "故事一 起①", pay: "故事四 承②" }],
      cast: [{ n: "杨妙萍", role: "引路", stories: "1、4", u: "交付追查方向" }],
    })
    expect(normalized?.stories[0].link).toBe("接法")
    expect(normalized?.stories[0].st[0].pay).toBe("合①")
    expect(normalized?.foreshadows).toHaveLength(1)
    expect(normalized?.cast?.[0].n).toBe("杨妙萍")
  })

  it("normalizeVolumeOutlineData 解析 position / roles / escalation / debts / rivals / growth / places", () => {
    const normalized = normalizeVolumeOutlineData({
      stories: [{ id: 1, title: "故事一" }],
      position: { pitch: "卷定位", theme: "主题句", structure: "全卷用英雄之旅" },
      roles: [{ n: "引路", v: "杨妙萍" }],
      escalation: [{ stake: "一个人的命", lose: "姑姑肉身", rise: "变成追链者" }],
      debts: [{ q: "小晚还活着吗", from: "故事三 合②", plan: "第二卷" }],
      rivals: [{ n: "白塔外站", moves: [{ v: "派回收者上门" }] }],
      growth: [{ n: "杨寒", gains: "092 烙印", state: "学会克制" }],
      places: [{ n: "白塔旧院", kind: "地点", stories: "1、2", u: "第一现场" }],
    })
    expect(normalized?.position?.theme).toBe("主题句")
    expect(normalized?.position?.chapters).toBe("")
    expect(normalized?.roles?.[0].n).toBe("引路")
    expect(normalized?.escalation?.[0]).toEqual({ id: 1, stake: "一个人的命", lose: "姑姑肉身", rise: "变成追链者" })
    expect(normalized?.debts?.[0].q).toBe("小晚还活着吗")
    expect(normalized?.rivals?.[0].moves[0]).toEqual({ id: 1, v: "派回收者上门" })
    expect(normalized?.growth?.[0].gains).toBe("092 烙印")
    expect(normalized?.places?.[0].kind).toBe("地点")
  })

  it("没有 foreshadows / cast 时不写入空数组字段", () => {
    const normalized = normalizeVolumeOutlineData({ stories: [{ id: 1, title: "故事一" }] })
    expect(normalized?.foreshadows).toBeUndefined()
    expect(normalized?.cast).toBeUndefined()
    expect(normalized?.position).toBeUndefined()
    expect(normalized?.escalation).toBeUndefined()
    expect(normalized?.places).toBeUndefined()
  })

  it("标题与目标注入正确且经过转义", () => {
    const data = buildData()
    data.title = '卷一 <危险> "引号" $&'
    const html = renderVolumeOutlineHtml(data)
    expect(html).toContain("&lt;危险&gt;")
    expect(html).toContain("&quot;引号&quot;")
    expect(html).toContain("$&amp;")
    expect(html).not.toContain("<危险>")
  })

  it("空数据时给出可读提示而非空白", () => {
    const html = renderVolumeOutlineHtml({ title: "卷纲", goal: "", stories: [] })
    expect(html).toContain("stories 为空")
  })

  it("完整数据（含全部台账字段）校验通过", () => {
    const result = validateVolumeOutlineData(buildFullData(), VALID_MD)
    expect(result.ok).toBe(true)
    expect(result.problems).toEqual([])
  })

  /*
   * 回归：模型把环节标识写成 k（而不是 stage）时，环节内容不得被丢掉。
   *
   * 实测故障（2026-10-09）：模型产出的 10 个故事 × 10 个环节用的是
   *   { "k": "起①", "name": "沐浴昏死", "p": [...], "pay": "…" }
   * 旧解析器只读 stage，整批环节被静默丢成空串，校验器于是报
   * 「第 N 个故事缺少环节 起①…合②」—— 10 故事 × (10 环节 + 1 条环节不足)
   * = 110 项假警报，用户看到「卷纲内容仍不完整（138 项）」。
   * 内容其实一条不少，是解析器没认。
   */
  it("环节标识写成 k 时按环节认下，不再报「缺少环节」", () => {
    const raw = {
      title: "卷一",
      goal: "目标",
      stories: Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        title: `故事${i + 1}`,
        range: `第 ${i * 12 + 1}–${i * 12 + 12} 章`,
        deliver: "交付人物",
        gift: "获得物",
        mid: "认知反转",
        twist: "规则反转",
        hook: "引线",
        climax: "小高潮",
        beats: "平升起紧落缓升紧顶缓顶悬",
        line: { main: "主线", sub: [], daily: { v: "日常", u: "伏笔" } },
        st: STAGES.map((stage) => ({
          k: stage,
          name: `${stage}的小标题`,
          who: "主角（主角）",
          use: "完成什么",
          p: ["条目1", "条目2", "条目3"],
          pay: "合①",
        })),
      })),
    }

    const data = normalizeVolumeOutlineData(raw)
    expect(data).not.toBeNull()
    expect(data!.stories[0].st.map((stage) => stage.stage)).toEqual(STAGES)

    const problems = validateVolumeOutlineData(data, VALID_MD).problems.join("\n")
    expect(problems).not.toContain("缺少环节")
    expect(problems).not.toContain("环节不足 10 个")
  })

  it("环节别名同时保留模型写的环节小标题，并渲染出来", () => {
    const raw = {
      stories: [{
        id: 1,
        title: "故事一",
        st: [{ k: "起①", name: "沐浴昏死", p: ["条目1", "条目2", "条目3"] }],
      }],
    }
    const data = normalizeVolumeOutlineData(raw)
    expect(data!.stories[0].st[0].stage).toBe("起①")
    expect(data!.stories[0].st[0].label).toBe("沐浴昏死")

    const html = renderVolumeOutlineHtml(data!, "<html>__VOLUME_TREE__</html>")
    // 固定环节名与模型小标题并存，内容不能再被丢掉
    expect(html).toContain("常态与破口")
    expect(html).toContain("沐浴昏死")
  })

  it("12 章节拍写成数组时无损拼回字符串（不再报缺少 beats）", () => {
    const beats = ["平", "升", "起", "紧", "落", "缓", "升", "紧", "顶", "缓", "顶", "悬"]
    const data = normalizeVolumeOutlineData({
      stories: [{
        id: 1,
        title: "故事一",
        beats,
        st: [{ stage: "起①", p: ["a", "b", "c"] }],
      }],
    })
    expect(data!.stories[0].beats).toBe("平升起紧落缓升紧顶缓顶悬")
    expect(validateVolumeOutlineData(data, VALID_MD).problems.join("\n")).not.toContain("缺少字段 beats")
  })

  it("非字符串、非数组的 beats（数字/对象）仍如实报缺失，不伪造内容", () => {
    const data = normalizeVolumeOutlineData({
      stories: [{ id: 1, title: "故事一", beats: 12, st: [{ stage: "起①", p: ["a", "b", "c"] }] }],
    })
    expect(data!.stories[0].beats).toBe("")
    expect(validateVolumeOutlineData(data, VALID_MD).problems.join("\n")).toContain("缺少字段 beats")
  })

  /*
   * 回归：模型把反转类型写在环节上（承③ reversal / 转① reversal），
   * 而不是 story 级 mid/twist —— 实测载荷 10/10 个故事都是这样。
   * 旧解析器只读 story 级字段，于是折叠树里「承③ · 」「转① · 」标签空着、
   * 「反转类型分布」显示「未填」、反转覆盖数被少算。内容在输出里，不能再丢。
   */
  it("反转类型只写在承③/转① 环节上时，无损回填 story 级 mid/twist", () => {
    const data = normalizeVolumeOutlineData({
      stories: [{
        id: 1,
        title: "故事一",
        st: [
          { k: "承③", name: "稻草变枷锁", reversal: "认知反转", p: ["a", "b", "c"] },
          { k: "转①", name: "旧识上门", reversal: "身份反转", p: ["a", "b", "c"] },
        ],
      }],
    })
    expect(data!.stories[0].mid).toBe("认知反转")
    expect(data!.stories[0].twist).toBe("身份反转")

    const html = renderVolumeOutlineHtml(data!, "<html>__VOLUME_TREE__</html>")
    expect(html).toContain("承③ · 认知反转")
    expect(html).toContain("转① · 身份反转")
    expect(html).not.toContain("承③ · <")
  })

  it("story 级 mid/twist 已给出时优先采用，不被环节上的值覆盖", () => {
    const data = normalizeVolumeOutlineData({
      stories: [{
        id: 1,
        title: "故事一",
        mid: "力量反转",
        twist: "立场反转",
        st: [
          { k: "承③", reversal: "认知反转", p: ["a", "b", "c"] },
          { k: "转①", reversal: "身份反转", p: ["a", "b", "c"] },
        ],
      }],
    })
    expect(data!.stories[0].mid).toBe("力量反转")
    expect(data!.stories[0].twist).toBe("立场反转")
  })

  it("环节上没有反转类型时不编造，mid/twist 保持为空", () => {
    const data = normalizeVolumeOutlineData({
      stories: [{ id: 1, title: "故事一", st: [{ k: "起①", p: ["a", "b", "c"] }] }],
    })
    expect(data!.stories[0].mid).toBe("")
    expect(data!.stories[0].twist).toBe("")
    // 承③/转① 用了相同反转类型才该报警；缺字段不该被「回填」成假内容
    expect(validateVolumeOutlineData(data, VALID_MD).problems.join("\n")).not.toContain("相同反转类型")
  })

  it("台账字段全缺时逐项报出，可触发一次 AI 补全", () => {
    const result = validateVolumeOutlineData(buildData(), VALID_MD)
    expect(result.ok).toBe(false)
    const text = result.problems.join("\n")
    expect(text).toContain("卷级定位（position）缺少字段：pitch / theme / narrative / structure / chapters / ending")
    expect(text).toContain("卷级功能位总览（roles）缺少：引路 / 主角 / 阻力 / 镜子 / 代价 / 预埋")
    expect(text).toContain("代价阶梯（escalation）不足 10 条（当前 0 条）")
    expect(text).toContain("缺少悬念债务表（debts）")
    expect(text).toContain("缺少对手推进表（rivals）")
    expect(text).toContain("缺少人物成长与资源表（growth）")
    expect(text).toContain("缺少地点 / 组织索引（places）")
    expect(text).toContain("缺少伏笔追踪表（foreshadows）")
    expect(text).toContain("缺少人物出场表（cast）")
  })

  it("代价阶梯不足 10 条时校验失败", () => {
    const data = buildFullData()
    data.escalation = (data.escalation ?? []).slice(0, 9)
    const result = validateVolumeOutlineData(data, VALID_MD)
    expect(result.ok).toBe(false)
    expect(result.problems.join("\n")).toContain("不足 10 条（当前 9 条）")
  })

  it("卷级功能位不全、对手出手过少、卷级定位缺字段时校验失败", () => {
    const data = buildFullData()
    data.position = { ...data.position!, narrative: "" }
    data.roles = [{ n: "引路", v: "杨妙萍" }]
    data.rivals = [{ n: "白塔外站", moves: [{ id: 1, v: "只出手一次" }] }]
    const result = validateVolumeOutlineData(data, VALID_MD)
    expect(result.ok).toBe(false)
    const text = result.problems.join("\n")
    expect(text).toContain("卷级定位（position）缺少字段：narrative")
    expect(text).toContain("卷级功能位总览（roles）缺少：主角 / 阻力 / 镜子 / 代价 / 预埋")
    expect(text).toContain("白塔外站 的出手少于 2 次")
  })

  it("故事不足 10 个时校验失败", () => {
    const result = validateVolumeOutlineData(buildData(5), VALID_MD)
    expect(result.ok).toBe(false)
    expect(result.problems.join("\n")).toContain("故事数量不足 10 个")
  })

  it("某故事环节不足 10 个时校验失败", () => {
    const data = buildData()
    data.stories[3].st = data.stories[3].st.slice(0, 6)
    const result = validateVolumeOutlineData(data, VALID_MD)
    expect(result.ok).toBe(false)
    expect(result.problems.join("\n")).toContain("环节不足 10 个")
  })

  it("环节条目不足 3 条时校验失败", () => {
    const data = buildData()
    data.stories[0].st[2].p = ["只有一条"]
    const result = validateVolumeOutlineData(data, VALID_MD)
    expect(result.ok).toBe(false)
    expect(result.problems.join("\n")).toContain("条目不足 3 条")
  })

  it("承③ 与 转① 相同时校验失败", () => {
    const data = buildData()
    data.stories[6] = buildStory(7, "认知反转", "认知反转")
    const result = validateVolumeOutlineData(data, VALID_MD)
    expect(result.ok).toBe(false)
    expect(result.problems.join("\n")).toContain("使用了相同反转类型")
  })

  it("MD 为空时校验失败", () => {
    const result = validateVolumeOutlineData(buildData(), "")
    expect(result.ok).toBe(false)
    expect(result.problems.join("\n")).toContain("MD 正文为空")
  })

  it("数据为空时校验失败并提示", () => {
    const result = validateVolumeOutlineData(null, VALID_MD)
    expect(result.ok).toBe(false)
    expect(result.problems.join("\n")).toContain("未解析到卷纲结构化数据")
  })

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

  it("normalizeVolumeOutlineData 容错缺失字段", () => {
    const normalized = normalizeVolumeOutlineData({ stories: [{ id: 1, title: "故事一" }] })
    expect(normalized).not.toBeNull()
    expect(normalized?.stories[0].range).toBe("")
    expect(normalized?.stories[0].st).toEqual([])
  })

  it("attachVolumeOutlineHtml 给卷纲请求补上渲染后的静态 HTML", () => {
    const reply = ["正文", "```json", JSON.stringify({ volumeOutlineData: buildData() }), "```"].join("\n")
    const request: OutlineHtmlRequest = { fileType: "volume-outline", content: VALID_MD }
    const enriched = attachVolumeOutlineHtml(request, reply)
    expect(enriched.htmlContent).toContain("<html")
    expect(enriched.htmlContent).toContain("<details")
  })

  it("attachVolumeOutlineHtml 不处理非卷纲请求", () => {
    const reply = ["正文", "```json", JSON.stringify({ volumeOutlineData: buildData() }), "```"].join("\n")
    const request: OutlineHtmlRequest = { fileType: "chapter-outline", content: VALID_MD }
    expect(attachVolumeOutlineHtml(request, reply).htmlContent).toBeUndefined()
  })

  it("attachVolumeOutlineHtml 不覆盖真正的 HTML 文档", () => {
    const reply = ["正文", "```json", JSON.stringify({ volumeOutlineData: buildData() }), "```"].join("\n")
    const existing = "<!DOCTYPE html><html><body>已有</body></html>"
    const request: OutlineHtmlRequest = { fileType: "volume-outline", content: VALID_MD, htmlContent: existing }
    expect(attachVolumeOutlineHtml(request, reply).htmlContent).toBe(existing)
  })

  it("attachVolumeOutlineHtml 会把非 HTML 内容（误抓的 json）替换成渲染结果", () => {
    const reply = ["正文", "```json", JSON.stringify({ volumeOutlineData: buildData() }), "```"].join("\n")
    const request: OutlineHtmlRequest = {
      fileType: "volume-outline",
      content: VALID_MD,
      htmlContent: 'json {"volumeOutlineData":{"title":"误抓内容"}}',
    }
    const enriched = attachVolumeOutlineHtml(request, reply)
    expect(enriched.htmlContent).toContain("<html")
    expect(enriched.htmlContent).not.toContain("误抓内容")
  })

  it("attachVolumeOutlineHtml 无数据时清掉非 HTML 内容", () => {
    const request: OutlineHtmlRequest = { fileType: "volume-outline", content: VALID_MD, htmlContent: 'json {"foo":1}' }
    const enriched = attachVolumeOutlineHtml(request, "没有任何数据块的回复")
    expect(enriched.htmlContent).toBeUndefined()
  })

  it("attachVolumeOutlineHtml 同时带上结构化数据（供章纲交叉校验）", () => {
    const reply = ["正文", "```json", JSON.stringify({ volumeOutlineData: buildData() }), "```"].join("\n")
    const request: OutlineHtmlRequest = { fileType: "volume-outline", content: VALID_MD }
    const enriched = attachVolumeOutlineHtml(request, reply)
    expect(enriched.structuredData).toBeTruthy()
    const parsed = JSON.parse(enriched.structuredData ?? "{}") as { stories?: unknown[] }
    expect(parsed.stories).toHaveLength(10)
  })

  it("已有真 HTML 时仍补结构化数据、不覆盖 HTML", () => {
    const reply = ["正文", "```json", JSON.stringify({ volumeOutlineData: buildData() }), "```"].join("\n")
    const existing = "<!DOCTYPE html><html><body>已有</body></html>"
    const request: OutlineHtmlRequest = { fileType: "volume-outline", content: VALID_MD, htmlContent: existing }
    const enriched = attachVolumeOutlineHtml(request, reply)
    expect(enriched.htmlContent).toBe(existing)
    expect(enriched.structuredData).toBeTruthy()
  })

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

describe("volume-outline-template 运行时加载", () => {
  const CUSTOM_TEMPLATE = [
    "<!DOCTYPE html><html><head><style>.custom{}</style></head><body>",
    "<h1>__VOLUME_TITLE__</h1><div>__VOLUME_GOAL__</div><div>__VOLUME_CHIPS__</div>",
    "<section>__VOLUME_POSITION__ __VOLUME_LEDGER__ __VOLUME_REVERSALS__ __VOLUME_SIDELINES__ __VOLUME_HOOKS__</section>",
    "<section>__VOLUME_ESCALATION__ __VOLUME_RIVALS__ __VOLUME_FORESHADOWS__ __VOLUME_CAST__ __VOLUME_PACING__</section>",
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
    expect(getVolumeOutlineTemplate()).toContain("#B8551D")
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
    expect(getVolumeOutlineTemplate()).toContain("#B8551D")
  })

  it("覆盖模板缺少占位符时忽略并回退内置", async () => {
    fsMock.fileExists.mockResolvedValue(true)
    fsMock.readFile.mockResolvedValue("<html>no placeholder</html>")

    await primeVolumeOutlineTemplate("E:/Novel")

    expect(getVolumeOutlineTemplate()).toContain("#B8551D")
  })

  it("运行目录探测抛错时不影响回退", async () => {
    fsMock.getExecutableDir.mockRejectedValue(new Error("no exe dir"))
    fsMock.getResourceDir.mockRejectedValue(new Error("no resource dir"))

    await primeVolumeOutlineTemplate("E:/Novel")

    expect(getVolumeOutlineTemplate()).toContain("#B8551D")
  })
})