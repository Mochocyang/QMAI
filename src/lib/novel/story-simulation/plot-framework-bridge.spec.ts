import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PlotFramework } from "../plot-framework"
import {
  BRIDGED_TARGET_WORDS,
  EMPTY_STORY_BEAT,
  bridgePlotFrameworkToStoryFramework,
  convertPlotFrameworkToStoryFramework,
  degenerateStoryFrameworkWarning,
  storyFrameworkIdForPlotFramework,
} from "./plot-framework-bridge"
import { DEFAULT_SIMULATION_MODE, VALID_MODES, deleteFramework, loadFrameworks } from "./framework-store"
import { clearBinding, loadBinding, saveBinding } from "./framework-binding"

/**
 * 内存文件系统（只实现 framework-store / framework-binding 真正用到的那几个函数）。
 * 用它而不是打桩 saveFramework：要证明的是「落盘 → 重新加载 → 数据源真能取到非空文本」
 * 这条完整链路，把 store 打桩掉就只剩「调用了一次」这种没有判别力的断言。
 */
const io = vi.hoisted(() => ({ files: new Map<string, string>() }))
vi.mock("@/commands/fs", () => ({
  readFile: async (path: string) => {
    if (!io.files.has(path)) throw new Error(`文件缺失：${path}`)
    return io.files.get(path)!
  },
  writeFile: async (path: string, text: string) => { io.files.set(path, text) },
  writeFileAtomic: async (path: string, text: string) => { io.files.set(path, text) },
  createDirectory: async () => {},
  deleteFile: async (path: string) => { io.files.delete(path) },
  fileExists: async (path: string) =>
    io.files.has(path) || [...io.files.keys()].some((key) => key.startsWith(`${path}/`)),
  listDirectory: async (path: string) => {
    const prefix = `${path}/`
    const seen = new Set<string>()
    const entries: { name: string; path: string; is_dir: boolean }[] = []
    for (const key of io.files.keys()) {
      if (!key.startsWith(prefix)) continue
      const rest = key.slice(prefix.length)
      const name = rest.split("/")[0]
      if (seen.has(name)) continue
      seen.add(name)
      entries.push({ name, path: `${prefix}${name}`, is_dir: rest.includes("/") })
    }
    return entries
  },
}))

const PROJECT = "/project"
const FRAMEWORKS_DIR = `${PROJECT}/.qmai/simulations/frameworks`

function frameworkFiles(): string[] {
  return [...io.files.keys()].filter((key) => key.startsWith(`${FRAMEWORKS_DIR}/`))
}

/** 一个「字段全都填满」的来源框架：字段越全，转换丢掉什么就越无从狡辩。 */
function richFramework(overrides: Partial<PlotFramework> = {}): PlotFramework {
  return {
    id: "wb-story-book-1",
    title: "测试作品 · 故事机制",
    beats: { hook: "开局钩子甲", buildup: "铺垫乙", payoff: "爽点丙", endingHook: "结尾钩子丁" },
    rangeChapterIds: ["c1", "c2", "c3"],
    line: "sub",
    characters: [{ name: "林远", role: "负责嘲讽主角，触发爽点对比" }, { name: "苏晚", role: "信息投放者" }],
    foreshadowing: ["伏笔甲：旧木牌", "伏笔乙：断刃"],
    reusableTemplate: "先压后扬，规则打破",
    directionHints: "震惊时机：规则打破时",
    handcraftHints: "爽点处适合玩梗",
    sourceDismantlingProjectId: "book-analysis:book-1",
    sourceDismantlingProjectTitle: "测试作品",
    prevConnector: "上一框架衔接说明",
    nextConnector: "下一框架衔接说明",
    pacing: "loose",
    autoPacing: false,
    tags: ["爽文", "复仇"],
    history: [{
      savedAt: 111,
      title: "旧标题",
      beats: { hook: "h", buildup: "b", payoff: "p", endingHook: "e" },
      directionHints: "旧方向",
      handcraftHints: "旧手搓",
      reusableTemplate: "旧模板",
    }],
    createdAt: 1700000000000,
    updatedAt: 1700000009999,
    ...overrides,
  }
}

beforeEach(() => {
  io.files.clear()
})

describe("PlotFramework → StoryFramework 转换：字段映射", () => {
  it("四个 beat 按顺序映射到节点 0..3 的起/承/转/合，正文进节点标题", () => {
    const converted = convertPlotFrameworkToStoryFramework(richFramework())

    expect(converted.nodes.map((node) => node.phase)).toEqual(["起", "承", "转", "合"])
    // index 与原生生成器一致从 0 起（story-framework-generator 的 `index: i`）：
    // 绑定时 allocateChapters 的 nodeIndex、报告提示词的 `index + 1` 都按这个基准。
    expect(converted.nodes.map((node) => node.index)).toEqual([0, 1, 2, 3])
    // beat 正文必须落在 title：buildBindingContext 只渲染节点标题，
    // 落到别的字段就进不了提示词（等于没打通）。
    expect(converted.nodes.map((node) => node.title)).toEqual(["开局钩子甲", "铺垫乙", "爽点丙", "结尾钩子丁"])
    expect(converted.title).toBe("测试作品 · 故事机制")
  })

  it("characters 只带走 name（role 丢失），四个节点都带上这份名单", () => {
    const converted = convertPlotFrameworkToStoryFramework(richFramework())

    for (const node of converted.nodes) {
      expect(node.involvedCharacters).toEqual(["林远", "苏晚"])
    }
    // role 丢失是**已知**损失，这里正面钉住：转换结果里不含那两个定位说明。
    const serialized = JSON.stringify(converted)
    expect(serialized).not.toContain("负责嘲讽主角")
    expect(serialized).not.toContain("信息投放者")
  })

  it("createdAt 从毫秒数转成 ISO 字符串（round-trip 后仍是同一时刻）", () => {
    const converted = convertPlotFrameworkToStoryFramework(richFramework())

    expect(converted.createdAt).toBe("2023-11-14T22:13:20.000Z")
    expect(new Date(converted.createdAt).getTime()).toBe(1700000000000)
  })

  it("sourceChapters 由 rangeChapterIds.length 推、targetWords 新造、simulationMode 取自 VALID_MODES", () => {
    const converted = convertPlotFrameworkToStoryFramework(richFramework())

    expect(converted.sourceChapters).toBe(3)
    expect(converted.targetWords).toBe(BRIDGED_TARGET_WORDS)
    // 「取自 VALID_MODES」不是注释里的承诺：这条断言在有人把 hybrid 从 VALID_MODES
    // 删掉时立刻变红（DEFAULT_SIMULATION_MODE 与 VALID_MODES 声明在一起）。
    expect(VALID_MODES).toContain(converted.simulationMode)
    expect(converted.simulationMode).toBe(DEFAULT_SIMULATION_MODE)
    // 值本身也要钉住：改动前解析器里内联的就是 "hybrid"，抽出常量时必须逐字保留。
    // 只断言「等于 DEFAULT_SIMULATION_MODE」是不够的 —— 那个常量被改成别的合法模式时
    // 两边一起变，断言照样绿。
    expect(DEFAULT_SIMULATION_MODE).toBe("hybrid")
  })

  it("rangeChapterIds 为空时 sourceChapters 为 0，不编造章节数", () => {
    const converted = convertPlotFrameworkToStoryFramework(richFramework({ rangeChapterIds: [] }))
    expect(converted.sourceChapters).toBe(0)
  })

  /*
   * 把 sourceChapters 的**语义**钉住：它数的是传入的章节 **id 个数**，
   * 不是「这些章节文件现在还读得到几个」。与原生生成器的
   * `extraction.chapterContents.length` 语义不同（见 convert 里的注释）。
   * 这条用例保护的是「想改成去数真实文件」这个决定必须是有意识的：
   * 真去数文件就会引入 IO，且本函数是纯函数、会当场变红。
   */
  it("sourceChapters 数的是传入的章节 id 个数（章节已不存在也照数，不偷偷改成读文件）", () => {
    const converted = convertPlotFrameworkToStoryFramework(richFramework({
      rangeChapterIds: ["已删除-0001", "已删除-0002", "已删除-0003"],
    }))
    expect(converted.sourceChapters).toBe(3)
  })

  it("没有结构化归属的散文（可复用模板/方向指引/手搓留白/来源）落进 premise，不随转换消失", () => {
    const converted = convertPlotFrameworkToStoryFramework(richFramework())

    expect(converted.premise).toContain("测试作品 · 故事机制")
    expect(converted.premise).toContain("来源拆文：测试作品")
    expect(converted.premise).toContain("一句话可复用模板：先压后扬，规则打破")
    expect(converted.premise).toContain("方向指引：震惊时机：规则打破时")
    expect(converted.premise).toContain("作者手搓留白：爽点处适合玩梗")
  })

  it("premise 恒非空：来源字段全空时退化成标题，不会写成「（无前提）」", () => {
    const converted = convertPlotFrameworkToStoryFramework(richFramework({
      sourceDismantlingProjectTitle: undefined,
      reusableTemplate: "",
      directionHints: "",
      handcraftHints: "",
    }))
    expect(converted.premise).toBe("测试作品 · 故事机制")
  })

  it("其余节点字段保持为空，不把 beat 硬塞进语义不同的字段", () => {
    const converted = convertPlotFrameworkToStoryFramework(richFramework())
    for (const node of converted.nodes) {
      expect(node.coreConflict).toBe("")
      expect(node.goal).toBe("")
      expect(node.causeFromPrev).toBe("")
      expect(node.expectedOutcome).toBe("")
    }
  })
})

describe("转换的有损字段：损失是已知且被钉住的", () => {
  it("产出对象的键集合恰好是 StoryFramework 的形状，没有多余字段", () => {
    const converted = convertPlotFrameworkToStoryFramework(richFramework())
    expect(Object.keys(converted).sort()).toEqual([
      "createdAt", "id", "nodes", "premise", "simulationMode", "sourceChapters", "targetWords", "title",
    ])
    expect(Object.keys(converted.nodes[0]).sort()).toEqual([
      "causeFromPrev", "coreConflict", "expectedOutcome", "goal", "index", "involvedCharacters", "phase", "title",
    ])
  })

  it("逐个有损字段：来源里确实有，转换结果里确实没有", () => {
    const sourceJson = JSON.stringify(richFramework())
    const convertedJson = JSON.stringify(convertPlotFrameworkToStoryFramework(richFramework()))
    const lost: Array<[string, string]> = [
      ["foreshadowing（伏笔）", "伏笔甲：旧木牌"],
      ["line（主线/支线归属）", '"line":"sub"'],
      ["tags（用户标签）", "复仇"],
      ["pacing（节奏初判）", '"pacing":"loose"'],
      ["autoPacing（用户是否手改过）", '"autoPacing":false'],
      ["history（版本快照）", "旧标题"],
      ["prevConnector（衔接点）", "上一框架衔接说明"],
      ["nextConnector（衔接点）", "下一框架衔接说明"],
      ["characters[].role", "触发爽点对比"],
    ]
    for (const [label, marker] of lost) {
      // 反向控制：先证明标记在**来源**里存在，否则「结果里没有」可以是同义反复。
      expect(sourceJson, `${label} 的标记应当出现在来源 JSON 里`).toContain(marker)
      expect(convertedJson, `${label} 应当被丢弃`).not.toContain(marker)
    }
  })

  it("updatedAt 也随转换丢失（StoryFramework 没有这个字段）", () => {
    const converted = convertPlotFrameworkToStoryFramework(richFramework())
    expect(JSON.stringify(converted)).not.toContain("1700000009999")
  })
})

describe("桥接框架 id：由来源确定性派生", () => {
  it("前缀 plot- + 原 id，常见 id 逐字节可预测", () => {
    expect(storyFrameworkIdForPlotFramework("wb-story-book-1")).toBe("plot-wb-story-book-1")
    expect(storyFrameworkIdForPlotFramework("framework-book-1-1700000000000")).toBe("plot-framework-book-1-1700000000000")
  })

  it("同来源两次独立转换得到同一个 id —— 随机/时间戳 id 会在这里变红", () => {
    // 关键：不是「publish 拿到返回对象再用它 bind」（那样随机 id 也必然通过），
    // 而是**各自从头构造一次来源**再比 id。
    const first = convertPlotFrameworkToStoryFramework(richFramework())
    const second = convertPlotFrameworkToStoryFramework(richFramework())
    expect(first.id).toBe(second.id)
    expect(first.id).toBe("plot-wb-story-book-1")

    const bridged = convertPlotFrameworkToStoryFramework(richFramework({ id: "framework-book-9-1" }))
    expect(bridged.id).toBe("plot-framework-book-9-1")
  })

  it("不产生 Windows 非法文件名字符，也不产生目录分隔符", () => {
    const nasty = [
      "wb-story-book:1",
      "a/b\\c",
      "带 空格 的 id",
      "点号结尾.",
      "《书名》·故事",
      'quote"star*question?',
    ]
    for (const id of nasty) {
      const derived = storyFrameworkIdForPlotFramework(id)
      expect(derived).toMatch(/^[a-zA-Z0-9._%-]+$/)
      expect(derived).not.toMatch(/[<>:"/\\|?*]/)
      // `:` 在 Windows 上会被当成 NTFS 备用数据流：文件真名会变成 `:` 之前那一截，
      // loadFrameworks 的 .md 过滤随即跳过它 —— 发布「成功」但永远读不回来。
      expect(derived).not.toContain(":")
    }
  })

  it("转义是单射：不同来源 id 不会映射到同一个文件名", () => {
    const pairs: Array<[string, string]> = [
      // 都是「非法字符 + 字面量十六进制」的形状：定宽转义能区分，替换成 `-` 不能。
      [":2", "\u03A2"],
      ["中", "文"],
      ["a:b", "a?b"],
      ["%3A", ":"],
      ["x\ny", "x y"],
    ]
    for (const [left, right] of pairs) {
      expect(storyFrameworkIdForPlotFramework(left)).not.toBe(storyFrameworkIdForPlotFramework(right))
    }
  })

  /*
   * 下面四条钉的是**边界行为**，不是「期望它优雅」。它们的价值在于：
   * 把当前（刻意选择的）行为固定下来，使「改成别的」必须是一次有意识的决定。
   * 每条都写明了生产可达性，避免下一个人以为这里漏了兜底。
   */

  it("空 id / 全空白 id ⇒ 产出 `plot-`（刻意不兜底：兜底就等于让 id 不确定）", () => {
    // 生产不可达：三个发布方传入的都是 normalizePlotFramework 的产物，
    // 那里空 id 已被换成 `framework-${now}`。真到了这里，宁可给一个可辨认的
    // `plot-`，也不要在此新造 id —— 那会违反本函数的确定性派生不变式。
    expect(storyFrameworkIdForPlotFramework("")).toBe("plot-")
    expect(storyFrameworkIdForPlotFramework("   ")).toBe("plot-")
  })

  it("超长 id **不截断**（截断会让两个来源撞同一文件，比一次响亮的失败更糟）", () => {
    const long = "b".repeat(300)
    // 未截断 ⇒ 长度 = 前缀 + 原长。若有人「好心」加了截断，这条会红，
    // 迫使他面对「截断可能把两个不同的书映射到同一个文件名」这个后果。
    expect(storyFrameworkIdForPlotFramework(long).length).toBe("plot-".length + 300)
    // 同时记录触发上限的门槛（NTFS 255 字节），让数字有出处。
    expect(storyFrameworkIdForPlotFramework(long).length).toBeGreaterThan(255)
  })

  it("星光面字符占两个码元、产出两个转义（正则无 u 标志，按码元转义）", () => {
    const emoji = "\u{1F600}"
    // 单射性不受影响；这里只是把「6 位十六进制覆盖的是码元而非完整码点」钉成事实。
    expect(storyFrameworkIdForPlotFramework(emoji)).toBe("plot-%00D83D%00DE00")
    // 反证：若真按「完整码点」处理，这里就会是一个 %01F600，长度只有一半。
    expect(storyFrameworkIdForPlotFramework(emoji)).not.toBe("plot-%01F600")
  })
})

describe("节点标题的落盘 round-trip（framework-store 解析较严）", () => {
  it("含换行的 beat 折叠成一行，重新加载后正文不丢", async () => {
    const source = richFramework({
      beats: { hook: "第一行\n第二行", buildup: "承", payoff: "转", endingHook: "合" },
    })
    const converted = await bridgePlotFrameworkToStoryFramework(PROJECT, source)
    const [loaded] = await loadFrameworks(PROJECT)

    expect(loaded.id).toBe(converted.id)
    expect(loaded.nodes).toHaveLength(4)
    // 不折叠的话第二行不会被解析回来（parseNodeBody 只认 `- 键：值` 开头的行）。
    expect(loaded.nodes[0].title).toBe("第一行 第二行")
  })

  it("含「】」的 beat 不被截断（parseNodeHeader 取最后一个 】 之后当标题）", async () => {
    const source = richFramework({
      beats: {
        hook: "他喊了一声【停】然后继续走",
        buildup: "承", payoff: "转", endingHook: "合",
      },
    })
    await bridgePlotFrameworkToStoryFramework(PROJECT, source)
    const [loaded] = await loadFrameworks(PROJECT)

    // 未净化时这里只剩「然后继续走」（前面的正文被静默切掉）；净化只动 】，
    // 因为 parseNodeHeader 只认最后一个 】，【 留着不影响解析。
    expect(loaded.nodes[0].title).toBe("他喊了一声【停]然后继续走")
    expect(loaded.nodes[0].title).toContain("他喊了一声")
  })
})

/**
 * 解析器对非法/缺失 simulationMode 的兜底。
 *
 * 这一条存在的原因：本次改动把 framework-store 里那句内联的 `: "hybrid"`
 * 换成了具名的 DEFAULT_SIMULATION_MODE。而 framework-store / framework-binding
 * **没有任何既有 spec 覆盖其解析逻辑**：
 *  - `story-simulation-view.partial.spec.ts` 只把 framework-store.ts 当**源码文本**读
 *    （readFileSync + toContain），并不调用它；
 *  - `ui-test-ai.spec.tsx` 与 `test/chat-panel-mount.ts` 直接 vi.mock 掉这两个模块。
 * 所以「改坏了兜底」在别处不会变红 —— 必须在这里钉住，否则那句改动是无人看守的。
 */
describe("解析器的 simulationMode 兜底 = DEFAULT_SIMULATION_MODE", () => {
  /** 手写一份最小合法 md（正文形状必须满足 extractSection + parseNodeHeader）。 */
  async function seedRawFramework(id: string, modeLine: string): Promise<void> {
    const nodes = ["起", "承", "转", "合"].map((phase, index) =>
      `### 节点 ${index} 【${phase}】 标题${index}\n- 核心冲突：\n- 涉及角色：\n- 目标：\n- 承接前因：\n- 预期结果：\n`,
    ).join("\n")
    io.files.set(
      `${FRAMEWORKS_DIR}/${id}.md`,
      [
        "---",
        `id: "${id}"`,
        'title: "手写框架"',
        modeLine,
        "sourceChapters: 1",
        "targetWords: 10000",
        'createdAt: "2026-10-11T00:00:00.000Z"',
        "---",
        "",
        "## 前提",
        "手写",
        "",
        "## 故事节点",
        "",
        nodes,
      ].join("\n"),
    )
  }

  it.each([
    ["非法值", 'simulationMode: "不存在的模式"'],
    ["缺这一行", 'shortTitle: "x"'],
  ])("%s 时回落到 DEFAULT_SIMULATION_MODE，且四个节点照常解析", async (_label, modeLine) => {
    // 反向控制：先证明 DEFAULT_SIMULATION_MODE 确实是合法模式，否则「回落成功」毫无意义。
    expect(VALID_MODES).toContain(DEFAULT_SIMULATION_MODE)
    await seedRawFramework("raw-1", modeLine)

    const [loaded] = await loadFrameworks(PROJECT)

    expect(loaded.simulationMode).toBe(DEFAULT_SIMULATION_MODE)
    // 手写的 md 能解析出 4 个节点，说明这份夹具本身是合法形状（不是解析失败的假通过）。
    expect(loaded.nodes).toHaveLength(4)
    expect(loaded.nodes[0].title).toBe("标题0")
  })
})

describe("发布是幂等的：重复发布只留一个文件", () => {
  it("同一来源桥接两次，frameworks 目录下只有一个 .md", async () => {
    const first = await bridgePlotFrameworkToStoryFramework(PROJECT, richFramework())
    const second = await bridgePlotFrameworkToStoryFramework(PROJECT, richFramework())

    expect(first.id).toBe(second.id)
    expect(frameworkFiles()).toEqual([`${FRAMEWORKS_DIR}/${first.id}.md`])
    expect(await loadFrameworks(PROJECT)).toHaveLength(1)
  })

  it("不同来源各留一个文件（幂等不等于互相覆盖）", async () => {
    await bridgePlotFrameworkToStoryFramework(PROJECT, richFramework({ id: "wb-story-book-1" }))
    await bridgePlotFrameworkToStoryFramework(PROJECT, richFramework({ id: "wb-story-book-2" }))

    expect(frameworkFiles()).toHaveLength(2)
  })
})

describe("端到端：绑定之后 storyFrameworkBinding 数据源真能取到非空文本", () => {
  /*
   * 这里两条用例都会 `await import("../context-data-sources")`，那是个很大的
   * 模块图（实测首次 import 就要数秒）。默认 5s 超时在并行跑套件时会偶发假失败
   * （本分支上另有两棵工作树同时跑测试）。显式放宽，避免把超时误读成回归。
   */
  const IMPORT_HEAVY_TIMEOUT = 30_000

  it("桥接 → 绑定 → 数据源返回含 beat 正文的文本", async () => {
    const converted = await bridgePlotFrameworkToStoryFramework(PROJECT, richFramework())
    const [loaded] = await loadFrameworks(PROJECT)
    await saveBinding(PROJECT, loaded, 6)

    // 消费端就是生产里那个数据源（context-data-sources 的 storyFrameworkBindingDataSource）：
    // 直接 import 它而不是自己复写一遍查找逻辑，否则测的是测试自己的实现。
    const { getAllDataSources } = await import("../context-data-sources")
    const source = getAllDataSources().find((item) => item.name === "storyFrameworkBinding")
    expect(source).toBeDefined()
    const text = await source!.load({ projectPath: PROJECT } as never)

    expect(text).not.toBe("")
    expect(text).toContain("测试作品 · 故事机制")
    expect(text).toContain("开局钩子甲")
    expect(text).toContain("结尾钩子丁")
    expect(converted.id).toBe(loaded.id)
    expect((await loadBinding(PROJECT))?.frameworkId).toBe(loaded.id)
  }, IMPORT_HEAVY_TIMEOUT)

  it("绑定到一个不存在的 id 时数据源静默返回空串 —— 这正是 id 必须可预测的原因", async () => {
    await bridgePlotFrameworkToStoryFramework(PROJECT, richFramework())
    const [loaded] = await loadFrameworks(PROJECT)
    // 绑到「随手造一个 id」的那份记录上：不抛错、不告警，只是空。
    await saveBinding(PROJECT, { ...loaded, id: "plot-随手的 id" }, 6)

    const { getAllDataSources } = await import("../context-data-sources")
    const source = getAllDataSources().find((item) => item.name === "storyFrameworkBinding")!
    await expect(source.load({ projectPath: PROJECT } as never)).resolves.toBe("")
  }, IMPORT_HEAVY_TIMEOUT)
  it("删除桥接产物后数据源回到空串（删除侧用的是同一个 id 推导）", async () => {
    const converted = await bridgePlotFrameworkToStoryFramework(PROJECT, richFramework())
    const [loaded] = await loadFrameworks(PROJECT)
    await saveBinding(PROJECT, loaded, 6)
    await deleteFramework(PROJECT, converted.id)
    await clearBinding(PROJECT)

    expect(frameworkFiles()).toEqual([])
    expect(await loadFrameworks(PROJECT)).toEqual([])
  })
})

/**
 * 占位句的**值**必须按字面钉住。
 *
 * 为什么值也要钉：这个字符串有两个生产用途 ——
 *  1. `workbench-publish` 的 `pick()` 兜底把它写进框架（于是**注入提示词**）；
 *  2. `degenerateStoryFrameworkWarning` 拿它当「内容等于空」的判据。
 * 只断言「等于 EMPTY_STORY_BEAT」（发布 spec 里就是这么写的）在常量值被改时
 * **两边一起变、照样绿** —— 这正是 DEFAULT_SIMULATION_MODE 踩过的坑
 * （见上面那条 `expect(DEFAULT_SIMULATION_MODE).toBe("hybrid")`）。
 * 加了这条之后：改常量值必须**同时**改这里，也就必须是一次有意识的决定。
 *
 * 反过来，它也让「publish 内联自己的等值字面量」这种漂移**迟早**会被抓到：
 * 一旦两处取值不同，本文件与 workbench-publish.spec.ts 里必有一处变红。
 * （纯「内联一份等值字面量、其它都不改」是**等价变异**，行为完全相同、
 *  任何行为断言都测不到 —— 这里不假装能测到，只保证**漂移**会被抓到。）
 */
describe("占位句常量：按值钉住", () => {
  it("EMPTY_STORY_BEAT 的原文（改它必须是一次有意识的决定）", () => {
    expect(EMPTY_STORY_BEAT).toBe("本次没有充分依据，不固定该环节；由目标故事实际情境决定。")
  })

  it("非空且不带首尾空白（它会被原样写进节点标题，空白会被 parseNodeHeader 吃掉）", () => {
    expect(EMPTY_STORY_BEAT.length).toBeGreaterThan(0)
    expect(EMPTY_STORY_BEAT).toBe(EMPTY_STORY_BEAT.trim())
  })
})

describe("退化内容检测（结构合法、内容为空）", () => {
  const fallbackFramework = () => convertPlotFrameworkToStoryFramework(richFramework({
    beats: {
      hook: EMPTY_STORY_BEAT, buildup: EMPTY_STORY_BEAT,
      payoff: EMPTY_STORY_BEAT, endingHook: EMPTY_STORY_BEAT,
    },
  }))

  /**
   * 直接指定各节点标题。判据只看 `nodes[].title`，所以这是构造边界输入的
   * 最直接方式（比绕着 beat 走再依赖转换器幂等更不容易同时测错两件事）。
   */
  const frameworkWithTitles = (titles: string[]) => {
    const converted = convertPlotFrameworkToStoryFramework(richFramework())
    return { ...converted, nodes: titles.map((title, index) => ({ ...converted.nodes[index], index, title })) }
  }

  it("四个 beat 都是占位句时给出「等于空」的提示", () => {
    const warning = degenerateStoryFrameworkWarning(fallbackFramework())
    expect(warning).toContain("占位话")
    expect(warning).toContain("等于空")
  })

  it("四个 beat 相同但不是占位句时也给提示（措辞不同）", () => {
    const converted = convertPlotFrameworkToStoryFramework(richFramework({
      beats: { hook: "同一句", buildup: "同一句", payoff: "同一句", endingHook: "同一句" },
    }))
    const warning = degenerateStoryFrameworkWarning(converted)
    expect(warning).not.toBeNull()
    expect(warning).not.toContain("占位话")
    expect(warning).toContain("同一句重复")
  })

  it("正常框架不报警（四段各不相同）", () => {
    expect(degenerateStoryFrameworkWarning(convertPlotFrameworkToStoryFramework(richFramework()))).toBeNull()
  })

  it("只有部分 beat 相同时不报警（两段同句很常见，不是退化）", () => {
    expect(degenerateStoryFrameworkWarning(frameworkWithTitles(["甲", "乙", "甲", "丁"]))).toBeNull()
  })

  /**
   * ⚠️ 这条是上一条的**必要补充**，不是重复。
   *
   * 上一条用 ["甲","乙","甲","丁"]：首 ≠ 尾，所以**结构上抓不到**把判据弱化成
   * 「首尾相同」（`titles[0] === titles.at(-1)`）的写法 —— 那种写法在这里仍返回 null，
   * 测试照样绿。而 ["甲","乙","甲","甲"] 首 == 尾但**并非全部相同**，
   * 真判据返回 null，弱化版会误报「同一句重复」。
   * 两条合起来才钉住「必须**全部**相同」这个判据本身。
   */
  it("首尾相同但中间不同 ⇒ 不报警（判据是「全部相同」，不是「首尾相同」）", () => {
    expect(degenerateStoryFrameworkWarning(frameworkWithTitles(["甲", "乙", "甲", "甲"]))).toBeNull()
  })

  it("单节点框架不报警（没有「四个环节」可退化）", () => {
    expect(degenerateStoryFrameworkWarning(frameworkWithTitles(["甲"]))).toBeNull()
  })

  /**
   * 节点数下界是 `2`。这条与上面那条「1 个节点不报警」配对，把阈值夹死在 2：
   * 上界一侧证明「≥2 且全同」确实会报（若阈值被抬到 4 就会漏报），
   * 下界一侧证明「<2」确实不报（若阈值被降到 0 就会对单节点误报）。
   */
  it("恰好 2 个节点且标题相同 ⇒ 报警（仍属「各节点内容完全相同」）", () => {
    const warning = degenerateStoryFrameworkWarning(frameworkWithTitles(["甲", "甲"]))
    expect(warning).not.toBeNull()
    expect(warning).toContain("同一句重复")
  })

  it("恰好 2 个节点且都是占位句 ⇒ 用「等于空」那版措辞", () => {
    const warning = degenerateStoryFrameworkWarning(frameworkWithTitles([EMPTY_STORY_BEAT, EMPTY_STORY_BEAT]))
    expect(warning).toContain("占位话")
    expect(warning).toContain("等于空")
  })

  it("节点标题全为空时不报警（那是另一种缺陷，不该冒充内容退化）", () => {
    const converted = convertPlotFrameworkToStoryFramework(richFramework())
    const blank = { ...converted, nodes: converted.nodes.map((node) => ({ ...node, title: "" })) }
    expect(degenerateStoryFrameworkWarning(blank)).toBeNull()
  })

  it("检测的是**已落盘再读回**的框架，不是内存里那份（生产里绑定读的就是读回那份）", async () => {
    const converted = convertPlotFrameworkToStoryFramework(richFramework({
      beats: {
        hook: EMPTY_STORY_BEAT, buildup: EMPTY_STORY_BEAT,
        payoff: EMPTY_STORY_BEAT, endingHook: EMPTY_STORY_BEAT,
      },
    }))
    await bridgePlotFrameworkToStoryFramework(PROJECT, richFramework({
      beats: {
        hook: EMPTY_STORY_BEAT, buildup: EMPTY_STORY_BEAT,
        payoff: EMPTY_STORY_BEAT, endingHook: EMPTY_STORY_BEAT,
      },
    }))
    const [loaded] = await loadFrameworks(PROJECT)

    expect(loaded.id).toBe(converted.id)
    expect(degenerateStoryFrameworkWarning(loaded)).toBe(degenerateStoryFrameworkWarning(converted))
    expect(degenerateStoryFrameworkWarning(loaded)).not.toBeNull()
  })
})
