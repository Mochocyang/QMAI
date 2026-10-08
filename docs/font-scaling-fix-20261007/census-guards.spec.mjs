/**
 * census-computed-font.mjs 的「防虚假通过」防线测试。
 *
 * 背景：一个会错误报「通过」的验收工具比没有工具更危险 —— 它会让未修复的缺陷
 * 看起来已修复。独立审查实测复现了 7 条虚假通过路径，全部 exit 0 并打印
 * 「字号修复已达成」。本文件把每一条钉死为永久用例。
 *
 * 测试方式：构造 fixtures（最小但形状真实：含 census["100"] / census["150"]、
 * 每条含 fontSize / lineHeight / inSvg / svgFontSizeAttr / isMarker、键带
 * `<分区id>::` 前缀），写入系统临时目录，**真实调用 CLI**（spawnSync node），
 * 断言退出码。
 *
 * 断言两点，避免「因为别的原因失败」而假绿：
 *   1. 退出码非 0；
 *   2. 失败来自工具自己的、带前缀的受控失败行（`GUARD-FAIL` = 防线、
 *      `ARG-FAIL` = 参数、`FAIL` = 判据未通过），而不是崩溃、ENOENT、
 *      语法错误之类的偶然非 0。
 *
 * 另有 3 条**正向对照**（必须退出 0）：干净 fixtures、真 SVG 例外仍被允许、
 * 以及每条负向用例都建立在同一套 fixture 生成器上 —— 若生成器本身坏掉，
 * 正向对照会立刻变红。
 *
 * 用例之间不共享任何可变状态：每个用例独立构造 payload 与临时文件。
 */
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, describe, expect, it } from "vitest"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, "..", "..")
const TOOL = join(HERE, "census-computed-font.mjs")

/** 与工具内的 SETTINGS_SECTIONS 一致（11 个设置页分区）。 */
const SECTIONS = [
  "model", "novel", "network", "web-search", "interface", "user-memory",
  "maintenance", "data-management", "feedback", "contact-support", "changelog",
]

const TIMEOUT_MS = 120_000

const TMP_ROOT = mkdtempSync(join(tmpdir(), "qmai-census-guards-"))
afterAll(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true })
})

let seq = 0

/** 每个用例各自的临时文件（用例间不共享可变状态）。 */
function writeJson(payload) {
  const p = join(TMP_ROOT, `census-${Date.now()}-${seq++}.json`)
  writeFileSync(p, JSON.stringify(payload, null, 1), "utf8")
  return p
}

function px(n) {
  return `${Number(n.toFixed(4))}px`
}

/**
 * 构造形状真实的 census 桶。
 * 键 = `<分区id>::<DOM 路径>`，marker 条目再追加 `::marker`。
 * 字号 12/14/16px、行高 = 字号 × 1.5（整数或 .5，避免浮点噪声）。
 */
function buildBucket({
  sections = SECTIONS,
  fontSizeScale = 1,
  lineHeightScale = 1,
  keysPerSection = 3,
  markersPerSection = 1,
  mutate,
} = {}) {
  const out = {}
  for (const sec of sections) {
    for (let i = 0; i < keysPerSection; i++) {
      const base = 12 + 2 * i
      out[`${sec}::body:1>div:0>div:${i}`] = {
        fontSize: px(base * fontSizeScale),
        lineHeight: px(base * 1.5 * lineHeightScale),
        cls: `probe-${sec}-${i}`,
        text: `探针${i}`,
        inSvg: false,
        svgFontSizeAttr: false,
      }
    }
    for (let m = 0; m < markersPerSection; m++) {
      out[`${sec}::body:1>div:0>ul:${m}>li:0::marker`] = {
        fontSize: px(14 * fontSizeScale),
        lineHeight: px(21 * lineHeightScale),
        cls: "flex gap-2",
        text: "标记条目",
        inSvg: false,
        svgFontSizeAttr: false,
        isMarker: true,
      }
    }
  }
  if (mutate) mutate(out)
  return out
}

function fileOf(c100, c150) {
  return {
    capturedAt: "2026-10-07T00:00:00.000Z",
    scales: [100, 150],
    census: { 100: c100, 150: c150 },
  }
}

/** 一份干净、两侧键集一致、100% 等效、150% 全部 ×1.5 的 before/after 对。 */
function cleanPair() {
  return {
    before: fileOf(buildBucket(), buildBucket({ fontSizeScale: 1.5, lineHeightScale: 1.5 })),
    after: fileOf(buildBucket(), buildBucket({ fontSizeScale: 1.5, lineHeightScale: 1.5 })),
  }
}

function runTool(args) {
  const res = spawnSync(process.execPath, [TOOL, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
  })
  return {
    status: res.status,
    signal: res.signal,
    errorCode: res.error?.code ?? null,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    get output() {
      return `${this.stdout}\n${this.stderr}`
    },
  }
}

/** 真实调用 `--compare`。 */
function runCompare(before, after, extraArgs = []) {
  const b = writeJson(before)
  const a = writeJson(after)
  return runTool(["--compare", b, a, ...extraArgs])
}

/**
 * 断言"受控失败"，并**钉死是哪一个守卫代号**在报警。
 *
 * ── 为什么必须钉代号（对抗性审查 P1-①②）──
 * 原实现只要求输出里含 `GUARD-FAIL` 字样。可工具的 17 个代号都印
 * `GUARD-FAIL`，于是一个具体用例可以被**错误的守卫**满足：
 * 审查者实测把 `E/未参与` 整条禁用后，「缺陷3b（noPair 必须为 0）」
 * 仍然通过 —— 因为 `D3/档位键集不一致` 也在那个夹具上报警。
 * 更糟的是逐个禁用代号后实测：`D1 D2 E E2 E3 E4 F G J` 九个代号被禁用时，
 * 23 条用例**全绿**。也就是说这九个守卫可以被整个删掉而无人察觉
 * —— 其中 D1 是 `--allow-new-elements` 的唯一约束，J 能抓住 D 抓不到的
 * "内容被顶替"回归（实测），F 防"什么都没比时恒成立"。
 *
 * 所以这里要求调用方声明**预期代号**，并逐条断言它出现在输出里。
 * 不声明代号时退化为原来的宽松断言（仅用于 ARG-FAIL / 纯判据类用例）。
 */
function expectFailure(res, kind = "GUARD-FAIL", expectedCode = null) {
  const detail = `\n--- stdout ---\n${res.stdout}\n--- stderr ---\n${res.stderr}`
  expect(res.status, `必须非 0（受控失败）。${detail}`).not.toBe(0)
  expect(
    res.output.includes(kind),
    `失败必须来自工具的受控失败行（含 "${kind}"），否则可能是崩溃/环境问题导致的偶然非 0。${detail}`,
  ).toBe(true)
  if (expectedCode) {
    // 用 "代号/" 匹配，避免 D 误命中 D1/D2/D3
    expect(
      res.output.includes(`${expectedCode}/`),
      `本用例必须由守卫 ${expectedCode} 报警，但输出里没有 "${expectedCode}/"。` +
      `若该守卫被删除或短路，本断言会失败 —— 这正是它存在的意义（防止用例被别的守卫"顺带"满足）。${detail}`,
    ).toBe(true)
  }
}

/** 输出里出现的全部守卫代号（形如 `E3/参与下限`）。 */
function guardCodesIn(res) {
  const codes = new Set()
  for (const m of res.output.matchAll(/GUARD-FAIL\s*\[([A-Z0-9]+)\//g)) codes.add(m[1])
  return [...codes].sort()
}

/**
 * 断言"只有指定代号在报警"（**隔离性**，对抗性审查 P1-②）。
 *
 * `expectFailure(res, ..., "E3")` 只证明"E3 出现了"，不证明"没有别的守卫也在报警"。
 * 当夹具同时违反多条不变量时，用例名字里写的那个原因可能**根本不是**它失败的原因
 * —— 名字于是夸大了它所证明的东西。本函数把"仅此一条"也钉死。
 */
function expectOnlyFailure(res, code) {
  expectFailure(res, "GUARD-FAIL", code)
  const codes = guardCodesIn(res)
  expect(
    codes,
    `本用例声称隔离地验证守卫 ${code}，但实际报警的代号是 [${codes.join(", ")}] —— `
    + `夹具同时违反了别的不变量，故它证明不了 ${code} 单独有效。`
    + `请把夹具收敛到只违反这一条。\n--- stdout ---\n${res.stdout}\n--- stderr ---\n${res.stderr}`,
  ).toEqual([code])
}

function expectPass(res) {
  const detail = `\n--- stdout ---\n${res.stdout}\n--- stderr ---\n${res.stderr}`
  expect(res.status, `必须退出 0（正向对照）。${detail}`).toBe(0)
}

/** 每个用例都给足时间：参数解析若失效，采集模式会真的去启动浏览器。 */
const guardIt = (name, fn) => it(name, fn, TIMEOUT_MS)

/**
 * 一份**真正不同**的 before/after 对：before 在 150% 档不缩放（即缺陷状态），
 * after 已修（150% 全部 ×1.5）。
 *
 * 为什么不能拿 cleanPair() 当"真修复"用：cleanPair() 的 before 与 after
 * **内容完全相同**，所以那其实是自比较 —— 用它断言"真修复必须宣告达成"
 * 会得到反直觉的失败（工具正确地把措辞收窄了，而断言期望它不收窄）。
 */
function fixedPair() {
  return {
    before: fileOf(buildBucket(), buildBucket()),
    after: fileOf(buildBucket(), buildBucket({ fontSizeScale: 1.5, lineHeightScale: 1.5 })),
  }
}

/**
 * 只取结论行（含 `→`）。
 *
 * 断言"结论怎么说"必须只看结论行：工具的解释性文字里会**引用**被否定的结论
 * （自比较提示原文就写着「它不构成「字号修复已达成」的证据」），
 * 于是对整个输出做 `not.toContain("字号修复已达成")` 会被自己的免责声明误伤
 * —— 这是本文件第一版真实踩到的坑。
 */
function conclusionsOf(out) {
  return out.split(/\r?\n/).filter((l) => l.includes("→"))
}

describe("census-computed-font.mjs 防虚假通过防线", () => {
  /* ── 正向对照：先证明生成器与工具在正常输入上确实能通过 ── */

  guardIt("[对照] 干净 fixtures（两侧键集一致、100% 等效、150% 全部 ×1.5）→ 退出 0", () => {
    const { before, after } = cleanPair()
    expectPass(runCompare(before, after))
  })

  /*
   * ── 自比较不得冒充"修复已达成"（对抗性审查 P2-②）──
   *
   * 自比较（同一份数据同时充当"改动前"与"改动后"）**是**受支持的用法：
   * implementation-plan.html 用它做采集与判定的确定性自检（"judge-1 self-compare = 0"）。
   * 但它证明不了"修复达成" —— 判据 1 的语义是"改动前有缺陷、改动后没有"，
   * 两边一样时只在证明"A 等于 A"。实测它曾打印
   * 「字号修复已达成：既无回归，又真实生效」并退出 0。
   *
   * 故这里钉三点：①退出码仍为 0（确定性自检不能被破坏）；
   * ②结论行**不得**宣称"修复已达成"；③真修复通过时**必须**仍然宣告达成
   * （防止措辞收窄变成全局行为，把真结论也一起收掉）。
   */

  guardIt("[自比较] 同一文件自比较 → 退出 0，但结论不得宣称「修复已达成」", () => {
    const { before } = cleanPair()
    const p = writeJson(before)
    const res = runTool(["--compare", p, p])
    expectPass(res)
    expect(res.output, "必须明确提示这是自比较模式").toContain("自比较模式")
    const lines = conclusionsOf(res.output)
    expect(lines.length, "应恰好有一条结论行").toBe(1)
    expect(lines[0], "自比较的结论不得宣称修复已达成").not.toContain("字号修复已达成")
    expect(lines[0], "自比较的结论应说明它证明的是确定性").toContain("确定性")
  })

  guardIt("[自比较] 路径不同但内容相同的复制件 → 也必须被识别为自比较", () => {
    // `cp before.json before-copy.json` 之后路径不同、内容相同，拿它当"改动后"
    // 照样是自比较。只比路径的实现会在这里漏判，于是又印出"修复已达成"。
    const { before } = cleanPair()
    const src = writeJson(before)
    const copy = join(TMP_ROOT, `copy-${Date.now()}.json`)
    writeFileSync(copy, readFileSync(src))
    const res = runTool(["--compare", src, copy])
    expectPass(res)
    expect(res.output, "内容相同即应判为自比较，不能只比路径").toContain("自比较模式")
    expect(conclusionsOf(res.output)[0], "复制件自比较不得宣称修复已达成").not.toContain("字号修复已达成")
  })

  guardIt("[反向] 真正不同的 before/after → 必须确实给出「修复已达成」结论", () => {
    const { before, after } = fixedPair()
    const res = runCompare(before, after)
    expectPass(res)
    expect(res.output, "真修复不得被误判成自比较").not.toContain("自比较模式")
    expect(conclusionsOf(res.output)[0], "真修复通过时必须宣告达成").toContain("字号修复已达成")
  })

  guardIt("[对照] 真 SVG 例外（inSvg && svgFontSizeAttr，未缩放）+ 显式配额 → 退出 0", () => {
    const { before } = cleanPair()
    const a100 = buildBucket()
    const a150 = buildBucket({ fontSizeScale: 1.5, lineHeightScale: 1.5 })
    // SVG <text> 带 font-size 呈现属性：不缩放是已登记的正确行为。
    // 例外判定读的是 100% 档的记录，故标记必须写在 a100 上（a150 保持同值 = 不缩放）。
    let n = 0
    for (const k of Object.keys(a100)) {
      if (!k.startsWith("changelog::") || k.endsWith("::marker")) continue
      a100[k] = { ...a100[k], inSvg: true, svgFontSizeAttr: true }
      a150[k] = { ...a100[k] }
      n++
    }
    // 例外配额默认 0（因为实测本机可达页面 svg 图元为 0 个）；
    // 要用例外必须**显式**给出配额 —— 这本身就是一次可见的、刻意的声明。
    expectPass(runCompare(before, fileOf(a100, a150), ["--max-svg-exceptions", String(n)]))
  })

  guardIt("[对照反面] 同样的真 SVG 例外，但不给配额 → 非 0（例外必须显式声明）", () => {
    const { before } = cleanPair()
    const a100 = buildBucket()
    const a150 = buildBucket({ fontSizeScale: 1.5, lineHeightScale: 1.5 })
    for (const k of Object.keys(a100)) {
      if (!k.startsWith("changelog::") || k.endsWith("::marker")) continue
      a100[k] = { ...a100[k], inSvg: true, svgFontSizeAttr: true }
      a150[k] = { ...a100[k] }
    }
    expectFailure(runCompare(before, fileOf(a100, a150)), "GUARD-FAIL", "I")
  })

  /* ── 缺陷 1：判据 2 无「参与元素下限」── */

  guardIt("缺陷1：after 的 150% 档为 {} → 非 0（不得在 0 个元素上判通过）", () => {
    const { before, after } = cleanPair()
    after.census["150"] = {}
    expectFailure(runCompare(before, after), "GUARD-FAIL", "A")
  })

  /*
   * ── 参与下限（E3）：必须**隔离**地证明 ──
   *
   * 原用例名「缺陷1b：after 的 150% 档键数低于下限（--min-elements）→ 非 0」
   * 夸大了它所证明的东西（对抗性审查 P1-②）：它的夹具把键裁到只剩前 12 个、
   * 同时裁掉 100% 与 150% 两档，于是**掉分区（D3）与键集不一致（B/D2/F）也一起被违反**，
   * 且两档都被裁 —— 而名字只说"150% 档键数低于下限"。
   * 于是它只证明"这个夹具会失败且输出里有 E3"，证明不了"是参与下限抓住的"。
   *
   * 下面拆成两条，各司其职：
   *   1b  **隔离**验证 E3：干净夹具（分区齐全、键集一致、无 noPair）+ 把下限抬到
   *       参与数之上 —— 此时**只有**参与下限这一条不变量被违反。用 expectOnlyFailure
   *       断言"仅 E3 报警"。
   *   1b' 保留原来那个多不变量夹具，但名字改成它真正证明的事。
   */

  guardIt("守卫 E3（隔离）：干净夹具 + 下限高于参与数 → **仅** E3 报警", () => {
    const { before, after } = cleanPair()
    // cleanPair = 11 分区 ×（3 个普通 + 1 个 marker）= 44 个键；下限取 45 即"只差一个"。
    // 分区齐全、键集一致、配对齐全 ⇒ 除参与数外没有任何不变量被违反。
    const participants = Object.keys(after.census["100"]).length
    expectOnlyFailure(runCompare(before, after, ["--min-elements", String(participants + 1)]), "E3")
  })

  guardIt("缺陷1b'：键被裁到 12 个（同时掉分区、键集不一致、两档都被裁）→ 输出含 E3", () => {
    const { before, after } = cleanPair()
    // 注意：本夹具**同时**违反多条不变量，故它只证明"E3 出现在失败输出里"，
    // 不证明"是参与下限抓住的"。隔离验证见上一条（守卫 E3（隔离））。
    const keep = Object.keys(after.census["100"]).slice(0, 12)
    const pick = (o) => Object.fromEntries(keep.filter((k) => k in o).map((k) => [k, o[k]]))
    after.census["100"] = pick(after.census["100"])
    after.census["150"] = pick(after.census["150"])
    expectFailure(runCompare(before, after, ["--min-elements", "100"]), "GUARD-FAIL", "E3")
  })

  guardIt("缺陷1c：before 的 150% 档为 {} → 非 0（两侧档位都必须是非空对象）", () => {
    const { before, after } = cleanPair()
    before.census["150"] = {}
    expectFailure(runCompare(before, after), "GUARD-FAIL", "A")
  })

  /* ── 缺陷 2/3：局部或整体丢采集 ── */

  guardIt("缺陷3：after 的 150% 档丢掉 changelog 分区 → 非 0", () => {
    const { before, after } = cleanPair()
    after.census["150"] = buildBucket({
      sections: SECTIONS.filter((s) => s !== "changelog"),
      fontSizeScale: 1.5,
      lineHeightScale: 1.5,
    })
    expectFailure(runCompare(before, after), "GUARD-FAIL", "D3")
  })

  guardIt("缺陷3b：after 的 150% 档只缺一个键 → 非 0（noPair 必须为 0）", () => {
    const { before, after } = cleanPair()
    const victim = Object.keys(after.census["150"])[0]
    delete after.census["150"][victim]
    expectFailure(runCompare(before, after), "GUARD-FAIL", "E")
  })

  guardIt("缺陷3c：after 的 150% 档多出一个键 → 非 0（两档键集必须一致）", () => {
    const { before, after } = cleanPair()
    after.census["150"]["changelog::body:1>div:0>div:99"] = {
      fontSize: "18px", lineHeight: "27px", cls: "x", text: "伪造", inSvg: false, svgFontSizeAttr: false,
    }
    expectFailure(runCompare(before, after), "GUARD-FAIL", "D3")
  })

  /* ── 缺陷 4：整分区覆盖缺失（两侧同时缺，键数与判据自洽）── */

  guardIt("缺陷4：before/after 同时缺 changelog 分区 → 非 0（分区必须 11/11）", () => {
    const sectionIds = SECTIONS.filter((s) => s !== "changelog")
    const before = fileOf(
      buildBucket({ sections: sectionIds }),
      buildBucket({ sections: sectionIds, fontSizeScale: 1.5, lineHeightScale: 1.5 }),
    )
    const after = fileOf(
      buildBucket({ sections: sectionIds }),
      buildBucket({ sections: sectionIds, fontSizeScale: 1.5, lineHeightScale: 1.5 }),
    )
    expectFailure(runCompare(before, after), "GUARD-FAIL", "B")
  })

  guardIt("缺陷4b：::marker 条数为 0（前后两档都没有）→ 非 0", () => {
    const before = fileOf(
      buildBucket({ markersPerSection: 0 }),
      buildBucket({ markersPerSection: 0, fontSizeScale: 1.5, lineHeightScale: 1.5 }),
    )
    const after = fileOf(
      buildBucket({ markersPerSection: 0 }),
      buildBucket({ markersPerSection: 0, fontSizeScale: 1.5, lineHeightScale: 1.5 }),
    )
    expectFailure(runCompare(before, after), "GUARD-FAIL", "C")
  })

  /* ── 缺陷 5：判据 1 空转 ── */

  guardIt("缺陷5：before 的 100% 档为 {} → 非 0（判据 1 不得在空集上通过）", () => {
    const { before, after } = cleanPair()
    before.census["100"] = {}
    expectFailure(runCompare(before, after), "GUARD-FAIL", "A")
  })

  guardIt("缺陷5b：after 的 100% 档为 {} → 非 0（四个档位都必须非空）", () => {
    const { before, after } = cleanPair()
    after.census["100"] = {}
    expectFailure(runCompare(before, after), "GUARD-FAIL", "A")
  })

  guardIt("缺陷6b：四个档位的 lineHeight 全为 normal → 非 0（行高断言不得静默空转）", () => {
    const normal = (b) => {
      for (const k of Object.keys(b)) b[k] = { ...b[k], lineHeight: "normal" }
      return b
    }
    // 全部 lineHeight 变成不可判定（normal）→ 行高断言一次都没运行。
    // 若只是"跳过不可判定项"，这里会误报通过：字号 ×1.5、行高整类无人检查。
    const before = fileOf(normal(buildBucket()), normal(buildBucket({ fontSizeScale: 1.5 })))
    const after = fileOf(normal(buildBucket()), normal(buildBucket({ fontSizeScale: 1.5 })))
    expectFailure(runCompare(before, after), "GUARD-FAIL", "H")
  })

  guardIt("额外：靠「全部豁免」制造通过（连 marker 也伪造成 SVG 例外）→ 非 0", () => {
    const { before } = cleanPair()
    const a100 = buildBucket()
    const a150 = buildBucket({ fontSizeScale: 1.5, lineHeightScale: 1.5 })
    // 攻击：让"没有任何元素缩放"看起来仍合法。
    // 键名后缀 ::marker 保留（否则守卫 C 会先拦下），但把 isMarker 字段去掉，
    // 于是 marker 也能被归入 SVG 例外 → 三分类变成 (0 正确缩放 / 全部例外 / 0 未解释)。
    // 防线：判据 2 要求"确有元素实现缩放"，且例外不得吞没全部参与元素。
    for (const k of Object.keys(a100)) {
      const bare = { ...a100[k], inSvg: true, svgFontSizeAttr: true }
      delete bare.isMarker
      a100[k] = bare
      a150[k] = { ...bare }
    }
    expectFailure(runCompare(before, fileOf(a100, a150)), "GUARD-FAIL", "G")
  })

  guardIt("额外：豁免「几乎全部」元素、只缩放 1 个 → 非 0（例外必须有配额）", () => {
    const { before } = cleanPair()
    const a100 = buildBucket()
    const a150 = buildBucket({ fontSizeScale: 1.5, lineHeightScale: 1.5 })
    const keys = Object.keys(a100)
    // 只留最后 1 个元素真正缩放（scaled=1，满足 scaled>0），
    // 其余全部伪造成"真 SVG 例外"（svgException < participating，躲过守卫 G）。
    // 这正是基线实测的相反情形（实测 SVG 图元 0 个），防线：例外配额默认 0。
    for (const k of keys.slice(0, -1)) {
      if (k.endsWith("::marker")) continue
      a100[k] = { ...a100[k], inSvg: true, svgFontSizeAttr: true }
      a150[k] = { ...a100[k] }
    }
    expectFailure(runCompare(before, fileOf(a100, a150)), "GUARD-FAIL", "I")
  })

  guardIt("额外：把「未缩放的大多数」说成 SVG 例外并把配额抬到该数量 → 非 0（配额有上限）", () => {
    const { before } = cleanPair()
    const a100 = buildBucket()
    const a150 = buildBucket({ fontSizeScale: 1.5, lineHeightScale: 1.5 })
    // 攻击：占多数的元素被伪造成例外，然后**按需抬高配额**让守卫 I 也失效。
    // 防线：配额本身有上限（默认 0，且不得超过参与数的一个极小比例）——
    // 已登记例外只可能是零星的图标文字，不可能占多数。
    let n = 0
    for (const k of Object.keys(a100)) {
      if (k.endsWith("::marker")) continue
      a100[k] = { ...a100[k], inSvg: true, svgFontSizeAttr: true }
      a150[k] = { ...a100[k] }
      n++
    }
    expectFailure(runCompare(before, fileOf(a100, a150), ["--max-svg-exceptions", String(n)]), "GUARD-FAIL", "I0")
  })

  /* ── 缺陷 6：判据 2 只看 fontSize，lineHeight 无覆盖 ── */

  guardIt("缺陷6：所有 fontSize ×1.5 但 lineHeight 保持 100% 原值 → 非 0", () => {
    const { before } = cleanPair()
    const after = fileOf(
      buildBucket(),
      buildBucket({ fontSizeScale: 1.5, lineHeightScale: 1 }), // 行高未换算 = px 残留
    )
    // 该缺陷由**判据 2**（行高断言）检出，而非防线；统一由 `✗ FAIL` 受控失败行标记
    expectFailure(runCompare(before, after), "FAIL")
  })

  /* ── 缺陷 7：SVG 例外过宽 ── */

  guardIt("缺陷7：把未缩放元素全标 inSvg=true（但不带 font-size 属性标记）→ 非 0", () => {
    const { before } = cleanPair()
    const a100 = buildBucket()
    const a150 = buildBucket({ fontSizeScale: 1.5, lineHeightScale: 1.5 })
    for (const k of Object.keys(a100)) {
      if (!k.startsWith("changelog::") || k.endsWith("::marker")) continue
      // 未缩放（150% 档保持 100% 值）+ 只伪造 inSvg，不带 svgFontSizeAttr
      a100[k] = { ...a100[k], inSvg: true }
      a150[k] = { ...a100[k] }
    }
    // 该伪造由**判据 2**（例外判定要求 svgFontSizeAttr）检出，而非防线
    expectFailure(runCompare(before, fileOf(a100, a150)), "FAIL")
  })

  /* ── 缺陷 8：键集不一致（after 多出键 = 判据看不见的元素）── */

  guardIt("缺陷8：after 的 100%/150% 档多出一个键 → 非 0（键集必须逐一对应）", () => {
    const before = fileOf(buildBucket(), buildBucket({ fontSizeScale: 1.5, lineHeightScale: 1.5 }))
    const a100 = buildBucket()
    const a150 = buildBucket({ fontSizeScale: 1.5, lineHeightScale: 1.5 })
    const extra = {
      fontSize: px(12), lineHeight: px(18), cls: "ghost", text: "幽灵", inSvg: false, svgFontSizeAttr: false,
    }
    a100["model::body:1>div:0>div:99"] = extra
    a150["model::body:1>div:0>div:99"] = { ...extra, fontSize: px(18), lineHeight: px(27) }
    expectFailure(runCompare(before, fileOf(a100, a150)), "GUARD-FAIL", "D")
  })

  /* ── 附带的参数解析缺陷 ── */

  guardIt("参数：--scales 100,abc（含非数字 token，compare 模式）→ 非 0", () => {
    const { before, after } = cleanPair()
    expectFailure(runCompare(before, after, ["--scales", "100,abc"]), "ARG-FAIL")
  })

  guardIt("参数：--scales 100,abc（采集模式）→ 非 0，且不得产生输出文件（解析必须在启动浏览器前失败）", () => {
    const out = join(TMP_ROOT, `should-not-exist-${seq++}.json`)
    const res = runTool(["--scales", "100,abc", "--out", out])
    expectFailure(res, "ARG-FAIL")
    expect(existsSync(out), "参数非法时不得进入采集、不得写出 census 文件").toBe(false)
  })

  guardIt("参数：--scales 后面紧跟另一个 flag（--out）→ 非 0 且给出清晰错误", () => {
    const res = runTool(["--scales", "--out", join(TMP_ROOT, `nope-${seq++}.json`)])
    expectFailure(res, "ARG-FAIL")
  })

  /* ─────────────────────────────────────────────────────────────────────────
   * 补齐「无覆盖守卫」的直接用例（对抗性审查 P1-①）
   *
   * 审查者逐个禁用 17 个守卫代号后实测：D1 D2 E E2 E3 E4 F G J 九个被禁用时，
   * 上述 23 条用例**全绿** —— 也就是说这九个可以被整条删掉而无人察觉。
   * 下面为其中没有专属用例的代号各补一条，夹具经实测确认**只由目标代号**（或至少
   * 明确包含目标代号）触发，并逐条断言该代号真的出现在输出里。
   * ───────────────────────────────────────────────────────────────────────── */

  guardIt("守卫 D1：新增元素放行后仍未按 1.5 倍缩放 → 非 0（--allow-new-elements 的唯一约束）", () => {
    const { before } = cleanPair()
    const a100 = buildBucket()
    const a150 = buildBucket({ fontSizeScale: 1.5, lineHeightScale: 1.5 })
    // 新增一个 before 里没有的键，且它在 150% 档**没**缩放。
    // 这是 `--allow-new-elements` 打开的唯一风险：有人用"放行额度"
    // 把新增界面的未缩放问题一并放过去。D1 是这条路上唯一的闸门。
    const ghost = "model::body:1>div:0>div:998"
    a100[ghost] = { fontSize: px(14), lineHeight: px(21), cls: "new-row", text: "新增行", inSvg: false, svgFontSizeAttr: false }
    a150[ghost] = { fontSize: px(14), lineHeight: px(21), cls: "new-row", text: "新增行", inSvg: false, svgFontSizeAttr: false }
    expectFailure(runCompare(before, fileOf(a100, a150), ["--allow-new-elements", "1"]), "GUARD-FAIL", "D1")
  })

  guardIt("守卫 D2：after 每档键数低于基线 → 非 0（局部丢采集）", () => {
    // before 每分区 4 个键、after 只有 3 个。丢的是"同一位置上少了一个元素"：
    // after 内部两档键集自洽，故 D3 不响；只有 D2 单独看"键数是否低于基线"。
    // 注意必须让 **before** 多一个键 —— 我第一版误把 after 建成 3 个而 before
    // 也是默认的 3 个，两边相等，D2 根本不会响（是本用例的代号断言把它抓出来的）。
    const before = fileOf(
      buildBucket({ keysPerSection: 4 }),
      buildBucket({ keysPerSection: 4, fontSizeScale: 1.5, lineHeightScale: 1.5 }),
    )
    const after = fileOf(
      buildBucket({ keysPerSection: 3 }),
      buildBucket({ keysPerSection: 3, fontSizeScale: 1.5, lineHeightScale: 1.5 }),
    )
    expectFailure(runCompare(before, after), "GUARD-FAIL", "D2")
  })

  guardIt("守卫 E2：after 两档键集不相交（参与数 0）→ 非 0", () => {
    /*
     * ⚠️ 注意：**不能**用"after 的 150% 档为 {}"来触发 E2。
     * 实测那样只会得到 `A/空档位` + 一句「档位不完整，无法比较」然后收尾，
     * E2 根本走不到。必须让 150% 档**非空但与 100% 档完全不相交**，
     * 才会得到 participating = 0 且不触发 A 的早退。
     * 这个细节本身就是一次教训：守卫写在空档位检查之后时，
     * 用"空对象"去测它会得到一个永远为假的结论。
     */
    const { before } = cleanPair()
    const disjoint = {}
    for (const sec of SECTIONS) {
      disjoint[`${sec}::body:9>section:0`] = {
        fontSize: px(21), lineHeight: px(31.5), cls: "elsewhere", text: "别处", inSvg: false, svgFontSizeAttr: false,
      }
    }
    expectFailure(runCompare(before, fileOf(buildBucket(), disjoint)), "GUARD-FAIL", "E2")
  })

  guardIt("守卫 E4：fontSize 不是 <n>px 数值（不可判定）→ 非 0（不得静默跳过）", () => {
    // 采集若因故把 fontSize 写成 "1rem" / "normal" / 空串，判据 2 的数值比较
    // 会**无法判定**。若这种条目被静默跳过，一整类元素就此消失；
    // E4 要求它们必须被显式报出来。
    const weird = (b) => {
      for (const k of Object.keys(b)) {
        if (!k.startsWith("model::") || k.endsWith("::marker")) continue
        b[k] = { ...b[k], fontSize: "1rem" }
      }
      return b
    }
    const before = fileOf(weird(buildBucket()), weird(buildBucket({ fontSizeScale: 1.5 })))
    const after = fileOf(weird(buildBucket()), weird(buildBucket({ fontSizeScale: 1.5 })))
    expectFailure(runCompare(before, after), "GUARD-FAIL", "E4")
  })

  guardIt("守卫 J：内容指纹丢失（路径仍在但内容被顶替）→ 非 0", () => {
    /*
     * 这一条补的是守卫 D 的盲区：插入一行后，后面那行的 DOM 索引整体后移，
     * 旧路径被新内容顶替 —— 既不新增也不消失，路径键看不出任何异常。
     * 实测在真实项目里发生过（插入「正文字体」行顶掉了「界面字号」行的旧路径，
     * 两行字号恰好都是 14px，判据 1 的数值比较完全看不出换了内容）。
     * 这里把 after 某个键的**文字**改掉（字号行高都不变），模拟"内容被顶替"。
     */
    const { before } = cleanPair()
    const a100 = buildBucket({ mutate: (o) => { o["model::body:1>div:0>div:0"].text = "被顶替的内容" } })
    const a150 = buildBucket({ fontSizeScale: 1.5, lineHeightScale: 1.5, mutate: (o) => { o["model::body:1>div:0>div:0"].text = "被顶替的内容" } })
    expectFailure(runCompare(before, fileOf(a100, a150)), "GUARD-FAIL", "J")
  })

  guardIt("守卫 F：三组之和 ≠ 键总数（有元素被算丢/算重）→ 非 0", () => {
    /*
     * F 防的是"三分类自洽性"：正确缩放 + 例外 + 未解释 必须等于键总数。
     * 若不等，说明有元素在分类时丢了或重了，此时"未解释 0"毫无意义。
     *
     * 触发方式：让 after 的 150% 档少一个键 → 该键 noPair，不参与三分类，
     * 于是 triageSum (= scaled + 例外 + 未解释) 比 keysA 少 1。
     * 我第一版用"150% 档多出一个键"去触发，结果只得到 D3 ——
     * 因为多出来的键不在 keysA（keysA 取自 after 的 100% 档）里，
     * 根本不影响三分类的和。方向搞反了，是代号断言抓出来的。
     */
    const { before, after } = cleanPair()
    const victim = Object.keys(after.census["150"])[0]
    delete after.census["150"][victim]
    expectFailure(runCompare(before, after), "GUARD-FAIL", "F")
  })

  guardIt("守卫 E：存在缺 100%/150% 配对（noPair > 0）→ 非 0", () => {
    // 「缺陷3b」名义上测的就是这条，但它同时被 D3 满足（实测禁用 E 后仍通过）。
    // 这里显式断言 E 出现，把它真正钉住。
    const { before, after } = cleanPair()
    const victim = Object.keys(after.census["150"])[0]
    delete after.census["150"][victim]
    expectFailure(runCompare(before, after), "GUARD-FAIL", "E")
  })

  guardIt("守卫 E3：参与数低于下限（--min-elements）→ 非 0", () => {
    // 与「缺陷1b」同一个意图，但显式断言 E3，避免被 B/D2/J 顺带满足。
    const { before, after } = cleanPair()
    const keep = Object.keys(after.census["100"]).slice(0, 12)
    const pick = (o) => Object.fromEntries(keep.filter((k) => k in o).map((k) => [k, o[k]]))
    after.census["100"] = pick(after.census["100"])
    after.census["150"] = pick(after.census["150"])
    expectFailure(runCompare(before, after, ["--min-elements", "100"]), "GUARD-FAIL", "E3")
  })

  guardIt("守卫 G：SVG 例外覆盖全部参与元素（一个都没缩放）→ 非 0", () => {
    // 与「额外：靠全部豁免制造通过」同一意图，显式断言 G（那条同时被 I 满足）。
    const { before } = cleanPair()
    const a100 = buildBucket()
    const a150 = buildBucket({ fontSizeScale: 1.5, lineHeightScale: 1.5 })
    for (const k of Object.keys(a100)) {
      const bare = { ...a100[k], inSvg: true, svgFontSizeAttr: true }
      delete bare.isMarker
      a100[k] = bare
      a150[k] = { ...bare }
    }
    expectFailure(runCompare(before, fileOf(a100, a150)), "GUARD-FAIL", "G")
  })
})
