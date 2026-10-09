import { describe, expect, it } from "vitest"
import { countChapterBodyWords } from "@/lib/chapter-word-count"
import {
  addWritingDelta,
  applyDeltaToDaily,
  applyWritingChange,
  decodeWritingSources,
  emptyProvenance,
  encodeWritingSources,
  emptyWritingDelta,
  netDailyChange,
  normalizeCountableText,
  rebaselineProvenance,
  writingTextHash,
  type WritingProvenance,
  type WritingSource,
} from "./writing-stats"

function markdown(body: string, options: { frontmatter?: boolean; title?: string } = {}): string {
  const { frontmatter = true, title = "第1章 试炼" } = options
  const head = frontmatter
    ? `---\ntype: chapter\nchapter_number: 1\n---\n\n`
    : ""
  return `${head}# ${title}\n\n${body}\n`
}

function provenanceOf(markdownText: string, source: WritingSource): WritingProvenance {
  return rebaselineProvenance(markdownText, source)
}

describe("normalizeCountableText", () => {
  it("与 countChapterBodyWords 完全同源（长度恒等，永不漂移）", () => {
    const samples = [
      markdown("他推开门。"),
      markdown(""),
      markdown("他推开门。", { frontmatter: false }),
      markdown("他推开门。", { title: "" }),
      "---\ntype: chapter\n---\n\n# 标题\n\n　全角空格　与 半角 空格\n\n第二段。\n",
      "没有 frontmatter 也没有标题的裸正文。\n",
      "# 只有标题\n",
      "",
    ]
    for (const sample of samples) {
      expect(normalizeCountableText(sample).length, JSON.stringify(sample)).toBe(
        countChapterBodyWords(sample),
      )
    }
  })

  it("丢 frontmatter、丢标题行、丢空白（含全角空格）", () => {
    const md = "---\ntype: chapter\n---\n\n# 标题\n\n他 推开　门。\n"
    expect(normalizeCountableText(md)).toBe("他推开门。")
  })
})

describe("encodeWritingSources / decodeWritingSources", () => {
  it("往返等价", () => {
    const cases: WritingSource[][] = [
      [],
      ["human"],
      ["human", "human", "ai", "ai", "ai", "unknown"],
      new Array<WritingSource>(5000).fill("ai"),
      ["ai", "human", "ai", "human"],
    ]
    for (const sources of cases) {
      const encoded = encodeWritingSources(sources)
      expect(decodeWritingSources(encoded, sources.length)).toEqual(sources)
    }
  })

  it("整段同源时游程编码极短（百万字不会撑爆 JSON）", () => {
    const sources = new Array<WritingSource>(1_000_000).fill("ai")
    expect(encodeWritingSources(sources)).toBe("a1000000")
  })

  it("长度对不上时返回 null，交由调用方重打基线而不是猜着对齐", () => {
    expect(decodeWritingSources("h3", 4)).toBeNull()
    expect(decodeWritingSources("h3", 2)).toBeNull()
    expect(decodeWritingSources("h3x", 3)).toBeNull()
    expect(decodeWritingSources("", 3)).toBeNull()
    expect(decodeWritingSources("h0", 0)).toBeNull()
    expect(decodeWritingSources("", 0)).toEqual([])
  })
})

describe("writingTextHash", () => {
  it("同文本同哈希、异文本异哈希", () => {
    expect(writingTextHash("斗气分九段")).toBe(writingTextHash("斗气分九段"))
    expect(writingTextHash("斗气分九段")).not.toBe(writingTextHash("斗气分八段"))
    expect(writingTextHash("")).toBe(writingTextHash(""))
  })
})

describe("applyWritingChange — 手动打字", () => {
  it("逐字敲入时，每个新字都记到手写", () => {
    const base = "他推开门。"
    let body = base
    let state = provenanceOf(markdown(body), "human")
    let human = 0

    for (const char of "外面下着雨，他站了很久。") {
      body += char
      const result = applyWritingChange(state, markdown(body), "human")
      state = result.provenance
      human += netDailyChange(result.delta).human
    }

    expect(state.text).toBe(`${base}外面下着雨，他站了很久。`)
    expect(state.sources.every((source) => source === "human")).toBe(true)
    expect(human).toBe("外面下着雨，他站了很久。".length)
  })

  it("在中间插入只算插入的那几个字", () => {
    const before = provenanceOf(markdown("他推开门。"), "human")
    const result = applyWritingChange(before, markdown("他慢慢推开门。"), "human")
    expect(netDailyChange(result.delta).human).toBe(2)
    expect(result.provenance.text).toBe("他慢慢推开门。")
  })

  it("改标题、动 frontmatter、加空行都不计入字数", () => {
    const before = provenanceOf(markdown("他推开门。"), "human")
    const renamed = "---\ntype: chapter\nchapter_number: 1\nstatus: draft\n---\n\n# 第1章 改名了\n\n他推开门。\n\n"
    const result = applyWritingChange(before, renamed, "human")
    expect(result.delta).toEqual(emptyWritingDelta())
    expect(result.provenance.text).toBe("他推开门。")
  })
})

describe("applyWritingChange — 删除扣减", () => {
  it("删掉自己手写的字，从手写那一栏扣", () => {
    const before = provenanceOf(markdown("他推开门。外面下着雨。"), "human")
    const result = applyWritingChange(before, markdown("他推开门。"), "human")
    const net = netDailyChange(result.delta)
    expect(net.human).toBe(-"外面下着雨。".length)
    expect(net.ai).toBe(0)
  })

  it("删掉 AI 写的字，从 AI 那一栏扣，手写不受影响", () => {
    const before = provenanceOf(markdown("斗气分九段，萧炎曾跌为废物。"), "ai")
    const next = markdown("斗气分九段。")
    const result = applyWritingChange(before, next, "human")
    const net = netDailyChange(result.delta)
    expect(net.ai).toBe(-("斗气分九段，萧炎曾跌为废物。".length - "斗气分九段。".length))
    expect(net.human).toBe(0)
    expect(result.delta.aiAdded).toBe(0)
    expect(result.provenance.text).toBe("斗气分九段。")
  })

  it("同一段里手写与 AI 混排时，删除各扣各的（逐字符归属）", () => {
    // 先铺 AI 底稿，再由用户手写补一句
    const aiPart = "斗气分九段。"
    const humanPart = "他忽然笑了。"
    let state = provenanceOf(markdown(aiPart), "ai")
    state = applyWritingChange(state, markdown(`${aiPart}${humanPart}`), "human").provenance
    expect(state.text).toBe(`${aiPart}${humanPart}`)
    expect(state.sources).toEqual([
      ...new Array<WritingSource>(aiPart.length).fill("ai"),
      ...new Array<WritingSource>(humanPart.length).fill("human"),
    ])

    // 删掉 AI 的那半句：只扣 AI
    const dropAi = applyWritingChange(state, markdown(humanPart), "human")
    expect(netDailyChange(dropAi.delta).ai).toBe(-aiPart.length)
    expect(netDailyChange(dropAi.delta).human).toBe(0)

    // 删掉手写的那半句：只扣手写
    const dropHuman = applyWritingChange(state, markdown(aiPart), "human")
    expect(netDailyChange(dropHuman.delta).human).toBe(-humanPart.length)
    expect(netDailyChange(dropHuman.delta).ai).toBe(0)
  })

  it("删除来源不可知的文字时两栏都不扣（不假装知道）", () => {
    const before = provenanceOf(markdown("来路不明的一段。"), "unknown")
    const result = applyWritingChange(before, markdown(""), "human")
    const net = netDailyChange(result.delta)
    expect(net.human).toBe(0)
    expect(net.ai).toBe(0)
    expect(result.delta.unknownRemoved).toBe("来路不明的一段。".length)
  })

  it("清空整章等于把手写与 AI 都扣回 0", () => {
    let state = provenanceOf(markdown("甲乙"), "ai")
    state = applyWritingChange(state, markdown("甲乙丙丁"), "human").provenance
    const cleared = applyWritingChange(state, markdown(""), "human")
    const net = netDailyChange(cleared.delta)
    expect(net.ai).toBe(-2)
    expect(net.human).toBe(-2)
    expect(cleared.provenance.text).toBe("")
    expect(cleared.provenance.sources).toEqual([])
  })
})

describe("applyWritingChange — 替换与粘贴", () => {
  it("选中替换：只算真正换掉的字", () => {
    const before = provenanceOf(markdown("他慢慢推开门。"), "human")
    const result = applyWritingChange(before, markdown("他轻轻推开门。"), "human")
    const net = netDailyChange(result.delta)
    expect(net.human).toBe(0)
    expect(result.delta.humanAdded).toBe(2)
    expect(result.delta.humanRemoved).toBe(2)
  })

  it("把 AI 的一段换成完全不同的手写内容：AI 扣、手写加", () => {
    const before = provenanceOf(markdown("斗气分九段。"), "ai")
    const next = "甲乙丙丁戊己"
    const result = applyWritingChange(before, markdown(next), "human")
    const net = netDailyChange(result.delta)
    expect(net.ai).toBe(-"斗气分九段。".length)
    expect(net.human).toBe(next.length)
    expect(result.provenance.sources.every((s) => s === "human")).toBe(true)
  })

  it("替换时逐字符认清「没动过的字」：保留原归属、不计增减", () => {
    // 「气分」和「。」在替换前后是同一批字符，不该被算成删除+新增
    const before = provenanceOf(markdown("斗气分九段。"), "ai")
    const result = applyWritingChange(before, markdown("灵气分七层。"), "human")
    expect(result.delta.aiRemoved).toBe(3)   // 斗、九、段
    expect(result.delta.humanAdded).toBe(3)  // 灵、七、层
    expect(result.delta.aiAdded).toBe(0)
    expect(result.delta.humanRemoved).toBe(0)
    // 「气分」的归属被原样保留下来
    expect(result.provenance.sources).toEqual([
      "human", "ai", "ai", "human", "human", "ai",
    ])
  })

  it("整段粘贴 AI 产物时全部记到 AI", () => {
    const before = provenanceOf(markdown("开头。"), "human")
    const pasted = "斗气大陆，斗气分九段，萧炎曾是天才后跌为废物，三年后他重新站了起来。"
    const result = applyWritingChange(before, markdown(`开头。${pasted}`), "ai")
    expect(netDailyChange(result.delta).ai).toBe(pasted.length)
    expect(netDailyChange(result.delta).human).toBe(0)
    expect(result.provenance.sources.slice(0, 3)).toEqual(["human", "human", "human"])
    expect(result.provenance.sources.slice(3).every((s) => s === "ai")).toBe(true)
  })

  it("整章被 AI 重写（全量替换、无共同字）后归属全归 AI", () => {
    const original = "原本是我手写的一整段内容。"
    const before = provenanceOf(markdown(original), "human")
    const rewritten = "春夏秋冬风花雪月"
    const result = applyWritingChange(before, markdown(rewritten), "ai")
    expect(result.provenance.sources.every((s) => s === "ai")).toBe(true)
    expect(netDailyChange(result.delta).ai).toBe(rewritten.length)
    expect(netDailyChange(result.delta).human).toBe(-original.length)
  })

  it("AI 重写时逐字比较相同的字，只把真正换掉的字记成新增", () => {
    // 这是刻意行为：没被动过的字不算「新写出来的字」，所以 AI 改动幅度小的
    // 重写不会虚报大量 AI 字数。手写净额与 AI 净额相加恒等于字数变化量。
    const before = provenanceOf(markdown("他慢慢推开门，走进屋。"), "human")
    const rewritten = "他缓缓推开门，走进屋。"
    const result = applyWritingChange(before, markdown(rewritten), "ai")
    const net = netDailyChange(result.delta)
    expect(result.delta.aiAdded).toBe(2)
    expect(result.delta.humanRemoved).toBe(2)
    expect(net.ai).toBe(2)
    expect(net.human).toBe(-2)
    expect(net.ai + net.human).toBe(0)
    expect(result.provenance.text).toBe(rewritten)
  })

  it("超长替换走整段口径，不因为跳过字符 diff 而算错总量", () => {
    const before = provenanceOf(markdown("甲".repeat(5000)), "human")
    const result = applyWritingChange(before, markdown("乙".repeat(5000)), "ai")
    expect(result.delta.humanRemoved).toBe(5000)
    expect(result.delta.aiAdded).toBe(5000)
    expect(result.provenance.sources.length).toBe(5000)
  })
})

describe("applyWritingChange — 纯换序（章内移动文字）", () => {
  it("把一段拖到别处：总字数没变，就不该凭空产生手写字数", () => {
    // 这是回归：此前 diffChars 只会报「删了一整段又加了一整段」，
    // 用户一个键都没敲，手写却 +6、原归属还被削掉 6。
    const before = provenanceOf(markdown("他推开门。屋里很暗。他点起了灯。"), "human")
    const moved = "他点起了灯。他推开门。屋里很暗。"
    const result = applyWritingChange(before, markdown(moved), "human")
    const net = netDailyChange(result.delta)
    expect(net.human, "拖动段落不是「今天新写的字」").toBe(0)
    expect(net.ai).toBe(0)
    expect(result.provenance.text).toBe(moved)
    expect(result.provenance.sources.length).toBe(moved.length)
    // 归属集合原样保留（合计分毫不差）
    expect(result.provenance.sources.filter((s) => s === "human").length)
      .toBe(moved.length)
  })

  it("搬动 AI 写的一段，不会把 AI 那一栏削掉", () => {
    const aiPart = "斗气分九段。"
    const humanPart = "他推开门。"
    const before = provenanceOf(markdown(`${humanPart}${aiPart}树枝断了。`), "human")
    // 先把中间那段标成 AI
    const withAi = applyWritingChange(before, markdown(`${humanPart}${aiPart}树枝断了。`), "human")
    expect(withAi.provenance.sources.length).toBe(withAi.provenance.text.length)

    const mixed: WritingProvenance = {
      text: `${humanPart}${aiPart}${humanPart}`,
      sources: [
        ...new Array(humanPart.length).fill("human"),
        ...new Array(aiPart.length).fill("ai"),
        ...new Array(humanPart.length).fill("human"),
      ] as WritingSource[],
    }
    // 把 AI 那段搬到最前面（纯换序，字符一样）
    const moved = `${aiPart}${humanPart}${humanPart}`
    const result = applyWritingChange(mixed, markdown(moved), "human")
    const net = netDailyChange(result.delta)
    expect(net.ai, "搬位置不该扣掉 AI 的字数").toBe(0)
    expect(net.human, "搬位置不该算成手写").toBe(0)
    // 两栏合计与搬动前一致
    expect(result.provenance.sources.filter((s) => s === "ai").length).toBe(aiPart.length)
    expect(result.provenance.sources.filter((s) => s === "human").length)
      .toBe(humanPart.length * 2)
  })

  it("换序同时还有真实增删时，仍按真实增删记账", () => {
    // 多重集不同 → 不能被误判成换序
    const before = provenanceOf(markdown("他推开门。"), "human")
    const result = applyWritingChange(before, markdown("开门他推。了"), "human")
    const net = netDailyChange(result.delta)
    expect(net.human, "新增了一个「了」就该 +1").toBe(1)
  })
})

describe("applyWritingChange — 一致性不变量", () => {
  it("任何一次变更后，sources 长度恒等于 text 长度", () => {
    const steps = ["", "他", "他们", "他们走", "他们走进", "他", "他推开门。"]
    let state = emptyProvenance()
    for (const body of steps) {
      state = applyWritingChange(state, markdown(body), "human").provenance
      expect(state.sources.length).toBe(state.text.length)
    }
  })

  it("累计净增减恒等于「当前字数 − 起始字数」", () => {
    const start = markdown("初始的一段。")
    let state = provenanceOf(start, "human")
    let net = 0
    const edits = [
      markdown("初始的一段。加了几个字。"),
      markdown("初始的一段。"),
      markdown("换成了别的写法。"),
      markdown(""),
      markdown("从零重新开始写正文。"),
    ]
    for (const next of edits) {
      const result = applyWritingChange(state, next, "human")
      // unknown 的来源不参与净增减，这里全程 human/ai，所以净增减可完全对账
      net += netDailyChange(result.delta).human
      state = result.provenance
      expect(net).toBe(state.text.length - normalizeCountableText(start).length)
    }
  })

  it("账本长度错位时重打基线且不记数额（宁可少算也不造假）", () => {
    const broken: WritingProvenance = { text: "甲乙丙", sources: ["human"] }
    const result = applyWritingChange(broken, markdown("甲乙丙丁"), "human")
    expect(result.delta).toEqual(emptyWritingDelta())
    expect(result.provenance.sources).toEqual(["unknown", "unknown", "unknown", "unknown"])
  })

  it("文本没变时不产生任何增减", () => {
    const state = provenanceOf(markdown("他推开门。"), "human")
    const result = applyWritingChange(state, markdown("他推开门。"), "human")
    expect(result.delta).toEqual(emptyWritingDelta())
    expect(result.provenance).toBe(state)
  })
})

describe("日计数", () => {
  it("累加且不允许为负", () => {
    const day = { humanChars: 10, aiChars: 5 }
    expect(applyDeltaToDaily(day, { ...emptyWritingDelta(), humanAdded: 3 })).toEqual({
      humanChars: 13,
      aiChars: 5,
    })
    expect(applyDeltaToDaily(day, { ...emptyWritingDelta(), humanRemoved: 4 })).toEqual({
      humanChars: 6,
      aiChars: 5,
    })
    // 删掉的是昨天写的 AI 内容：今日 AI 已经是 0，扣不动就停在 0
    expect(applyDeltaToDaily({ humanChars: 0, aiChars: 0 }, {
      ...emptyWritingDelta(),
      aiRemoved: 100,
    })).toEqual({ humanChars: 0, aiChars: 0 })
  })

  it("一天里写写删删后等于净额", () => {
    let day = { humanChars: 0, aiChars: 0 }
    day = applyDeltaToDaily(day, { ...emptyWritingDelta(), humanAdded: 200 })
    day = applyDeltaToDaily(day, { ...emptyWritingDelta(), aiAdded: 1500 })
    day = applyDeltaToDaily(day, { ...emptyWritingDelta(), humanRemoved: 50 })
    expect(day).toEqual({ humanChars: 150, aiChars: 1500 })
  })
})

describe("addWritingDelta", () => {
  it("逐项相加", () => {
    const sum = addWritingDelta(
      { ...emptyWritingDelta(), humanAdded: 1, aiRemoved: 2 },
      { ...emptyWritingDelta(), humanAdded: 3, aiRemoved: 4 },
    )
    expect(sum.humanAdded).toBe(4)
    expect(sum.aiRemoved).toBe(6)
  })
})
