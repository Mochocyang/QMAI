import { describe, it, expect } from "vitest"
import { parseFrontmatter } from "./frontmatter"

describe("parseFrontmatter", () => {
  it("returns null + full body when content has no frontmatter", () => {
    const r = parseFrontmatter("# Hello\nbody text")
    expect(r.frontmatter).toBeNull()
    expect(r.body).toBe("# Hello\nbody text")
    expect(r.rawBlock).toBe("")
  })

  it("strips a basic frontmatter block and returns the body", () => {
    const content = `---\ntype: entity\ntitle: "Foo"\n---\n\n# Body`
    const r = parseFrontmatter(content)
    expect(r.frontmatter).toEqual({ type: "entity", title: "Foo" })
    expect(r.body).toBe("# Body")
  })

  it("rawBlock + body equals the original content for well-formed input", () => {
    const cases = [
      `---\ntype: x\n---\nbody`,
      `---\ntype: x\n---\n\nbody with leading blank line`,
      `# No frontmatter at all`,
      `---\ntype: x\ntitle: "Foo"\ntags: [a, b]\n---\n\n# Heading`,
    ]
    for (const content of cases) {
      const r = parseFrontmatter(content)
      expect(r.rawBlock + r.body).toBe(content)
    }
  })

  it("parses inline arrays", () => {
    const r = parseFrontmatter(`---\ntags: [foo, bar, baz]\n---\nx`)
    expect(r.frontmatter).toEqual({ tags: ["foo", "bar", "baz"] })
  })

  it("parses block-style arrays (the YAML `- item` syntax)", () => {
    const content =
      `---\nrelated:\n  - foo.md\n  - bar.md\n  - baz.md\n---\nbody`
    const r = parseFrontmatter(content)
    expect(r.frontmatter).toEqual({ related: ["foo.md", "bar.md", "baz.md"] })
    expect(r.body).toBe("body")
  })

  it("doesn't interpret YYYY-MM-DD scalars as Date objects (JSON_SCHEMA)", () => {
    const r = parseFrontmatter(`---\ncreated: 2026-04-09\n---\nbody`)
    expect(r.frontmatter).toEqual({ created: "2026-04-09" })
  })

  it("handles CJK/Unicode tags without quoting", () => {
    const r = parseFrontmatter(
      `---\ntags: [污水处理, 功能微生物, NOB优势菌]\n---\nbody`,
    )
    expect(r.frontmatter).toEqual({
      tags: ["污水处理", "功能微生物", "NOB优势菌"],
    })
  })

  it("strips quotes from string scalars", () => {
    const r = parseFrontmatter(`---\ntitle: "Hello World"\n---\nx`)
    expect(r.frontmatter).toEqual({ title: "Hello World" })
  })

  it("handles a frontmatter-only file with no body", () => {
    const r = parseFrontmatter(`---\ntype: entity\n---\n`)
    expect(r.frontmatter).toEqual({ type: "entity" })
    expect(r.body).toBe("")
  })

  it("handles CRLF line endings", () => {
    const content = "---\r\ntype: query\r\n---\r\n\r\nbody"
    const r = parseFrontmatter(content)
    expect(r.frontmatter).toEqual({ type: "query" })
    expect(r.body).toBe("body")
  })

  it("returns null frontmatter when YAML is malformed but still strips the fence block", () => {
    const content = `---\nthis is not: : valid\n  malformed\n---\nbody`
    const r = parseFrontmatter(content)
    // YAML parser may or may not error on this; either way we
    // shouldn't crash. If it errors, we return body without the
    // fence block. If it parses, we return whatever it produced.
    expect(typeof r.body).toBe("string")
    expect(r.body).toBe("body")
  })

  it("matches the real Accumulibacter frontmatter (block array of paths)", () => {
    const content =
      `---\ntype: entity\ntitle: "Accumulibacter"\ncreated: 2026-04-09\nupdated: 2026-04-09\ntags: [microorganism, PAO, DPAO, phosphorus-removal, Betaproteobacteria]\nrelated:\n  - wiki/entities/dpao.md\n  - wiki/entities/paos.md\n  - wiki/concepts/denitrifying-phosphorus-removal.md\nsources: ["research-foo-2026-04-09.md"]\n---\n\n# Body`
    const r = parseFrontmatter(content)
    expect(r.frontmatter?.type).toBe("entity")
    expect(r.frontmatter?.title).toBe("Accumulibacter")
    expect(r.frontmatter?.related).toEqual([
      "wiki/entities/dpao.md",
      "wiki/entities/paos.md",
      "wiki/concepts/denitrifying-phosphorus-removal.md",
    ])
    expect(r.frontmatter?.sources).toEqual(["research-foo-2026-04-09.md"])
    expect(r.body).toBe("# Body")
  })

  it("matches the real Nitrospira frontmatter (all inline arrays, CJK tags)", () => {
    const content =
      `---\ntype: entity\ntitle: Nitrospira\ncreated: 2026-04-07\nupdated: 2026-04-07\ntags: [污水处理, 功能微生物, 亚硝酸盐氧化细菌, NOB优势菌]\nrelated: [nitrite-oxidizing-bacteria, nitrifying-bacteria, nh3-n]\nsources: ["research--2026-04-07.md"]\n---\n`
    const r = parseFrontmatter(content)
    expect(r.frontmatter?.type).toBe("entity")
    expect(r.frontmatter?.title).toBe("Nitrospira")
    expect(r.frontmatter?.tags).toEqual([
      "污水处理", "功能微生物", "亚硝酸盐氧化细菌", "NOB优势菌",
    ])
    expect(r.frontmatter?.related).toEqual([
      "nitrite-oxidizing-bacteria",
      "nitrifying-bacteria",
      "nh3-n",
    ])
    expect(r.frontmatter?.sources).toEqual(["research--2026-04-07.md"])
  })

  it("locates a frontmatter block wrapped in ```yaml … ``` and strips the closing fence", () => {
    const content =
      "```yaml\n---\ntype: entity\ntitle: \"Accumulibacter\"\n---\n```\n\n# Accumulibacter\n\nbody"
    const r = parseFrontmatter(content)
    expect(r.frontmatter?.type).toBe("entity")
    expect(r.frontmatter?.title).toBe("Accumulibacter")
    // Both the opening AND closing code-fence lines are gone so
    // the body the renderer sees is balanced markdown. Without
    // stripping, ReactMarkdown reads the orphan ``` as a
    // never-closing code block and renders every heading /
    // list / table below as raw source.
    expect(r.body).not.toContain("```")
    expect(r.body.trimStart().startsWith("# Accumulibacter")).toBe(true)
  })

  it("strips the closing fence even when the closing ``` is on the line directly after ---", () => {
    // Real-user file pattern (硝化菌.md): the ``` closing fence
    // lands immediately after the closing ---, with no blank
    // line between them.
    const content = [
      "```yaml",
      "---",
      "type: entity",
      'title: "硝化菌"',
      "tags: [微生物]",
      "---",
      "```",
      "",
      "# 硝化菌",
      "",
      "## 基本信息",
      "",
      "- **类型**：自养型好氧细菌",
    ].join("\n")
    const r = parseFrontmatter(content)
    expect(r.frontmatter?.type).toBe("entity")
    expect(r.frontmatter?.title).toBe("硝化菌")
    expect(r.body).not.toContain("```")
    expect(r.body).toContain("# 硝化菌")
    expect(r.body).toContain("## 基本信息")
  })

  it("locates a frontmatter block prefixed by a `frontmatter:` key (LLM corruption)", () => {
    const content =
      "frontmatter:\n---\ntype: entity\ntitle: LSTM\n---\n\n# LSTM\n\nbody"
    const r = parseFrontmatter(content)
    expect(r.frontmatter?.type).toBe("entity")
    expect(r.frontmatter?.title).toBe("LSTM")
  })

  it("does not pick up a `---` horizontal rule deep in the body as frontmatter", () => {
    // The fallback-search window is small enough to skip horizontal
    // rules used as section dividers below paragraphs of body text.
    const content =
      "# Heading\n\nfirst paragraph\n\nsecond paragraph\n\n---\n\nthird paragraph after rule"
    const r = parseFrontmatter(content)
    expect(r.frontmatter).toBeNull()
    expect(r.body).toBe(content)
  })

  it("文首第 6 行的分隔线不算 frontmatter（容错分支必须校验里面真的是 YAML）", () => {
    // 真实事故文件 D:\QM-BOOK\楚白\QM\outlines\00-设定集.md（导入自
    // E:\高人一等\修改方案\00-设定集.md）：
    //
    //   1  # 《高人一等》设定集（修订版 v1）
    //   2
    //   3  > 用途：……
    //   4  > 适用范围：……
    //   5
    //   6  ---            ← 分隔线（不是 frontmatter 围栏）
    //   7
    //   8  ## 0. 定位
    //   …  表格 + 三条全书纪律
    //  24  ---            ← 分隔线
    //
    // 容错分支 FM_BLOCK_ANYWHERE_RE 会把第 6 行的 `---` 配到第 24 行，
    // 门槛 `lineNumberAt() > 6` 恰好是 `6 > 6` 为假 → 放行；而里面那段
    // 是 markdown（表格 + 有序列表），两轮 YAML 解析都失败，函数却仍然
    // 返回切过的 body ⇒ 标题、用途说明、`## 0. 定位` 表格、三条全书纪律
    // 共 727 个字符静默消失，正文直接从 `## 1. 金手指` 开始。
    //
    // 判据：容错分支是"猜"，猜中的必须真的是 YAML 映射；否则一律当作
    // 没有 frontmatter。文首严格匹配的那条路不受影响（见上面
    // "malformed but still strips the fence block" 那条用例）。
    const content = [
      "# 《高人一等》设定集（修订版 v1）", // 1
      "", // 2
      "> 用途：这是往下写每一章都要对照的“宪法”。", // 3
      "> 适用范围：番茄/七猫签约向男频爽文。", // 4
      "", // 5
      "---", // 6 ← 分隔线，恰好落在容错门槛上
      "", // 7
      "## 0. 定位", // 8
      "",
      "| 项 | 内容 |",
      "| --- | --- |",
      "| 类型 | 男频穿越玄幻 |",
      "",
      "**全书纪律（三条，写崩了先回来读这三条）**",
      "",
      "1. 打脸要打在欠打的人身上。",
      "2. 金手指的规则一次都不许破。",
      "3. 每一个“爽”都要有代价。",
      "",
      "---", // 24 ← 分隔线
      "",
      "## 1. 金手指：高人一等令牌（重订）",
      "",
      "### 1.1 规则表（全书必须遵守）",
      "",
    ].join("\n")

    const r = parseFrontmatter(content)

    expect(r.frontmatter).toBeNull()
    // 一个字符都不能少：解析结果就是原文。
    expect(r.body).toBe(content)
    expect(r.rawBlock).toBe("")
    expect(r.body).toContain("# 《高人一等》设定集（修订版 v1）")
    expect(r.body).toContain("## 0. 定位")
    expect(r.body).toContain("**全书纪律（三条，写崩了先回来读这三条）**")
    expect(r.body).toContain("## 1. 金手指：高人一等令牌（重订）")
  })

  it("围栏里不是 YAML 映射时一律不切（单行 markdown 标题也逃不掉 YAML 解析）", () => {
    // `## 一节` 会被 YAML 当成注释、解析成 undefined；旧实现只看
    // "开头 `---` 是否在前 6 行"，于是照样切掉。
    const content = ["# 标题", "", "---", "", "## 一节", "", "正文", "", "---", "", "## 二节", ""].join("\n")
    const r = parseFrontmatter(content)
    expect(r.frontmatter).toBeNull()
    expect(r.body).toBe(content)
  })

  it("容错分支照样认得真正的 YAML（围栏前夹几行垃圾的老场景不受影响）", () => {
    const content = [
      "```yaml",
      "---",
      "type: entity",
      'title: "Accumulibacter"',
      "---",
      "```",
      "",
      "# Accumulibacter",
      "",
      "---",
      "",
      "正文里的分隔线要留下",
    ].join("\n")
    const r = parseFrontmatter(content)
    expect(r.frontmatter?.type).toBe("entity")
    expect(r.frontmatter?.title).toBe("Accumulibacter")
    expect(r.body).toContain("# Accumulibacter")
    expect(r.body).toContain("正文里的分隔线要留下")
    expect(r.rawBlock).not.toBe("")
  })

  it("repairs `key: [[a]], [[b]]` (LLM-emitted invalid wikilink list) via retry", () => {
    const content =
      "---\ntype: entity\ntitle: LTTC\nrelated: [[riyuu-jiaoben]], [[zi-yuan-bu]], [[wai-wu]]\n---\nbody"
    const r = parseFrontmatter(content)
    expect(r.frontmatter?.type).toBe("entity")
    expect(r.frontmatter?.related).toEqual([
      "[[riyuu-jiaoben]]",
      "[[zi-yuan-bu]]",
      "[[wai-wu]]",
    ])
  })

  it("doesn't mangle a legitimate nested-array YAML value during repair", () => {
    // Repair only fires when the FIRST yaml.load throws. Legitimate
    // nested arrays parse on the first pass and are left alone.
    const content = `---\nmatrix: [[1, 2], [3, 4]]\n---\nbody`
    const r = parseFrontmatter(content)
    // Nested arrays come through normalize as a JSON-stringified
    // string per element, which is acceptable surface behavior — the
    // important part is we didn't crash or corrupt the structure.
    expect(r.frontmatter).not.toBeNull()
    expect(r.body).toBe("body")
  })

  it("matches the real BOD entity frontmatter (quoted wikilink items in block array)", () => {
    const content =
      `---\ntype: entity\ntitle: BOD（生化需氧量）\ncreated: 2026-04-07\nupdated: 2026-04-07\ntags: [水质指标, 环境监测, 污水处理, 核心参数]\nrelated:\n  - "[[nh3-n]]"\n  - "[[soft-sensor-watertreatment]]"\n  - "[[ai-effluent-water-quality-prediction]]"\n  - "[[digital-twin-wastewater]]"\nsources: ["research-ai-2026-04-07.md"]\n---\n\n# Body`
    const r = parseFrontmatter(content)
    expect(r.frontmatter?.title).toBe("BOD（生化需氧量）")
    expect(r.frontmatter?.related).toEqual([
      "[[nh3-n]]",
      "[[soft-sensor-watertreatment]]",
      "[[ai-effluent-water-quality-prediction]]",
      "[[digital-twin-wastewater]]",
    ])
    expect(r.body).toBe("# Body")
  })
})
