/**
 * 计算样式普查 —— 字号修复的决定性验收测试。
 *
 * 为什么用"计算样式普查"而不是截图比对：
 *   截图会受抗锯齿、字体栅格化、动态内容影响，噪声可能掩盖真实差异；
 *   计算样式是确定性的，可逐元素精确比较，且能直接断言"缩放倍数"。
 *
 * 判据（两步，缺一不可）：
 *   1. 等效性：根字号 100% 时，改动前后的计算 fontSize / lineHeight 必须逐元素相同。
 *      依据：557 处 px→rem 换算中，所有 px 值均为 0.5 的整数倍，
 *      除以 16 得精确有限小数，故 100% 下计算值应与现状完全一致。
 *      若有差异 → 换算有误或漏改，必须修正。
 *   2. 生效性：根字号 150% 时，**所有**文本元素的计算 fontSize **与 lineHeight**
 *      都必须等于 100% 时数值的 1.5 倍（同一容差 1.5%）。
 *      - fontSize 未变 → 该处仍有绝对单位漏网；
 *      - lineHeight 未变 → 该处 px 行高漏改（557 处清单里有 11 处 `line-height`
 *        与 80 处 `font` 简写内嵌 px 行高，其中 12 处是 px/px 双值）。
 *      - lineHeight 为 `normal` 时跳过该项（normal 不与字号线性对应）。
 *      未达标者一律计入"未解释"并打印明细。**只看 fontSize 会放过整类行高漏改。**
 *
 * ⚠️ 已知覆盖盲区（如实登记，勿据此以为"已验证"）：
 *   任务 7 要改的 `src/components/uitest/ui-test-editor.css:239-240`
 *   （`li::marker{font-size:12px}` / `ol > li::marker{font-size:16px}`）
 *   **在本工具的浏览器可达路径下从不挂载**：实测 11 个分区里
 *   `.ui-test-editor-body` 命中数 = 0（点遍所有可达按钮后仍为 0；编辑器需要
 *   真实 exe 才能到达，不是本工具能解决的）。基线里 300 条 `::marker`
 *   **全部来自 changelog 的 li**（14px，rem，本来就会缩放），
 *   0 条 12px/16px。
 *   因此：**改那两行，本工具发现不了**。判据 2 全绿 ≠ 编辑器列表标记已验证。
 *   替代验证（由后续任务执行）：(a) 静态 CSS 校验脚本 —— 检查那几处引用同一
 *   字号变量、无残留 px 硬编码；(b) 真实 exe 中目视确认。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 虚假通过防线（防线的存在意义：**一个会错误报"通过"的验收工具比没有工具更危险**）
 * ─────────────────────────────────────────────────────────────────────────
 *   判据只在下列全部成立时才可能返回"通过"（任何一条不成立 → 退出码 1）：
 *     A 四个档位（before/after × 100%/150%）都必须是非空对象 —— 空档会让判据
 *       在 0 个元素上"通过"；
 *     B 分区覆盖 11/11（before 与 after 各自检查）—— 两侧同时缺一个分区时，
 *       键数与判据会完全自洽，只有这条能发现；
 *     C 四个档位的 `::marker` 条数都 > 0（基线 300 条）—— 为 0 说明 marker
 *       采集整体失效，全部 marker 条目会从判据 2 消失；
 *     D before 与 after 的 100% 档键集**逐一对应**（仅前有 = 元素消失，
 *       仅后有 = 判据看不见的新元素），且 after 的 100%/150% 档键集一致，
 *       after 每档键数不低于基线；
 *     E 缺 100%/150% 任一档配对的键数 `noPair` 必须为 0，参与比对元素数不得
 *       低于下限（默认 11 = 每分区一个，`--min-elements` 可调）；
 *     F 三组之和（正确缩放 + SVG 例外 + 未解释）必须等于 after 100% 档的
 *       **键总数**（不是"键总数 − 未参与数"，那种比法在什么都没比时恒成立）；
 *     G SVG 例外不得吞没全部参与元素，且**确有元素实现缩放**（scaled > 0）——
 *       否则"一个都不缩放 + 全部被豁免"也能通过；
 *     H 行高断言必须**真的运行过**（至少 1 个参与元素的 100% 档 lineHeight 是
 *       `<n>px`）。若全部是 `normal`，行高断言整类空转，px 行高漏改将完全不可见；
 *     I SVG 例外数不得超过配额 `--max-svg-exceptions`（**默认 0**，实测值：
 *       本机可达页面里带 `font-size` 呈现属性的 svg 图元实测 0 个）。要用例外
 *       必须在命令行上显式给配额 —— 一次可见的、刻意的声明；且配额本身有上限
 *       （参与数的 3%，下限 5），免得"把未缩放的大多数说成在图标里"；
 *     J 未解释 = 0。
 *   失败行统一带前缀：守卫失败 `✗ GUARD-FAIL [代号]`，参数错误 `✗ ARG-FAIL`，
 *   判据未通过 `✗ FAIL`。三种前缀都会被 `census-guards.spec.mjs` 断言，用来区分
 *   "受控失败"与"崩溃/环境问题导致的偶然非 0"。
 *   局限（不可回避）：census JSON 是**外部输入**，本工具无法鉴别其真伪。
 *   一份被手工伪造得自洽的 JSON（例如把全部元素都写成 ×1.5）仍能骗过任何
 *   比较器。防线针对的是"真实的采集缺口被静默原谅"，不是恶意伪造。
 *   缓解：判据 1 把 after 的 **100% 档**逐键钉在已提交的基线上（`fontSize` 与
 *   `lineHeight` 必须逐字相同），所以 100% 档不是自由数据；能自由伪造的只有
 *   150% 档与 `inSvg`/`svgFontSizeAttr`/`isMarker` 这类标记字段 —— 后者正是
 *   守卫 G/I 针对的对象。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 键的构成规则（**契约**，后续任务依赖它；改动此处等于让基线失效）
 * ─────────────────────────────────────────────────────────────────────────
 *   键 = `<分区id>::<DOM 路径>`；`::marker` 条目再追加 `::marker` 后缀。
 *
 *   - DOM 路径 = 标签名 + `:` + 同级索引，用 `>` 连接
 *     （例：`body:1>div:0>div:0>header:0>span:1`）。用路径而非 class，
 *     因为改动只涉及 CSS 值、不改 DOM 结构，路径稳定可比对。
 *   - 分区id = 采集该元素时**实际处于激活状态**的设置页分区
 *     （`[data-ui-page="settings"]` 上 `data-ui-settings-category` 的取值），
 *     而不是"请求点击"的分区：没点到就按实际到达的分区记账，不伪造。
 *
 *   为什么必须带分区前缀：11 个分区各有自己的 DOM 状态，**不同分区既可能在
 *   不同路径上放不同元素，也可能在同一路径上放不同元素**。若只以 DOM 路径为键
 *   再跨分区 `Object.assign` 合并，后访问的分区会覆盖先访问分区的元素，该元素
 *   对判据 1/2 **完全不可见**——历史上由此静默遮蔽记录（实测 **7 条记录**，
 *   其中 1 条是同一导航项「其他写作设置」的选中/未选中两种状态，故对应
 *   **至少 6 个不同元素**），其中包括一个未缩放的 px 元素（「重排模型」13px），
 *   即缺陷本身藏在盲区里。
 *   加分区前缀后"同路径、不同分区"永不碰撞，任何元素都不可能被静默覆盖。
 *
 *   这 7 条怎么测出来的（可复算）：旧键方案（无分区前缀）的基线是 git 提交
 *   `8724bef` 里的 `census-before.json`（923 键）。把当前基线 1113 个键按
 *   `::` 剥掉分区前缀得到 923 个路径，与旧基线**逐路径比对元素身份**
 *   （`cls`+`text`+`fontSize`）：其中 **7 条**在新基线里存在、而旧方案下该路径
 *   "存活"的是另一个身份 —— 那 7 条当时对判据不可见。其余为同元素幂等重采
 *   （含 300 条 `::marker`，旧方案未采集 marker）。
 *
 * 合并语义（两种情况分别怎么处理）
 *   1. **同一元素在多个分区重复出现**（公共外框、侧栏导航等）：那是同一元素被
 *      观察多次，在不同分区前缀下各记一份，值必然一致（同一元素的计算样式）。
 *      条目数因此大于"纯元素个数"（实测：每档 12 次快照 1140 条 → 1113 个键，
 *      见 `README.md`），但对"未解释必须为 0"的判据没有影响。
 *   2. **不同元素撞同一 DOM 路径**（跨分区）：键不同，二者都被保留、都被判据
 *      覆盖，不存在谁覆盖谁。
 *   唯一会重写同一个键的情形是"固定起始分区 + 该分区又在分区列表里"导致的
 *   重复访问（`model` 采集两遍）：两次采的是同一元素、值一致，属幂等重写。
 *   为杜绝残余的静默遮蔽，合并时会校验"同键重写是否换了元素身份"
 *   （cls/text 不同即视为换了元素）并打印警告，采集日志里也会给出每次
 *   「采集 N 条 / 新增 M 条」计数。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 已登记例外（**允许不缩放**，不算漏项）：
 *   SVG 内联 `fontSize="N"` 呈现属性 —— 无单位等同 px，画在固定 viewBox 的图标里
 *   （环形图百分比、16×16 品牌单字）。改 rem 会让字形溢出图标框。
 *   例外判定收紧为 **`inSvg: true` 且 `svgFontSizeAttr: true`**
 *   （采集时 `!!(el.closest("svg") && el.hasAttribute("font-size"))`）：
 *   只看"有 svg 祖先"会把任何嵌在图标外的未缩放元素都错放行。
 *   `inSvg` 保留供诊断显示，但**判定只用 `svgFontSizeAttr`**。
 *   ⚠️ `::marker` 采集条目（`isMarker: true`）**必须**缩放，不得算作例外。
 *   ⚠️ 本机可达页面实测 `<svg><text>` = 0 个（`provider-brand-icon` 因无提供方
 *   未渲染、`context-usage-ring` 在聊天页不可达），故"SVG 例外 = 0"是正常的；
 *   出现非 0 时工具会打印警告要求人工确认，但不会因此判失败。
 *
 * 覆盖面：进入设置页后依次点击**全部 11 个**子分区，并在每个分区各采集一次；
 *   每个分区的快照以 `<分区id>::` 前缀并入累积对象（见上"键的构成规则"）。
 *   子分区按钮用 `data-ui-settings-category-button="<id>"` 定位 —— 与界面语言无关。
 *
 * 伪元素：普通遍历读不到 `::marker` 的字号，故单独遍历
 *   `.ui-test-editor-body li, .ui-test-root li` 采集 `getComputedStyle(li, "::marker")`，
 *   键为 `分区id + "::" + DOM 路径 + "::marker"`。用 `--marker-selftest` 可单独验证该采集确实有效。
 *
 * 用法：
 *   node census-computed-font.mjs --out before.json         # 改动前采集
 *   node census-computed-font.mjs --out after.json          # 改动后采集
 *   node census-computed-font.mjs --scales 100,130,150 --out x.json  # 自定义根字号档位
 *   node census-computed-font.mjs --compare before.json after.json
 *   node census-computed-font.mjs --compare a.json b.json --min-elements 100
 *   node census-computed-font.mjs --compare a.json b.json --max-svg-exceptions 3
 *   node census-computed-font.mjs --marker-selftest         # 只验证 ::marker 采集可用
 *   防线测试：`npx vitest run docs/font-scaling-fix-20261007/census-guards.spec.mjs`
 */
import { createServer } from "node:http"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs"
import { join, extname, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const argv = process.argv.slice(2)
const argOf = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }

const DIST = join(process.cwd(), "dist")

/**
 * 设置页真实子分区 id —— 取自 `src/components/settings/settings-view.tsx`
 * 的 CATEGORIES（model/novel/network/web-search/interface/user-memory/
 * maintenance/data-management/feedback/contact-support/changelog）。
 * 用 id 定位而非中文标签，避免受界面语言影响。
 */
const SETTINGS_SECTIONS = [
  "model", "novel", "network", "web-search", "interface", "user-memory",
  "maintenance", "data-management", "feedback", "contact-support", "changelog",
]
/** 每个 scale 轮开始时先固定停在这个分区，保证各档位采集状态对称。 */
const SETTINGS_HOME_SECTION = "model"

/** 比较模式要求的两档（判据 1 锚定 100%、判据 2 锚定 150%）。 */
const REQUIRED_SCALES = ["100", "150"]
/** 参与元素下限：默认"每个分区至少一个"，可用 --min-elements 提高。 */
const DEFAULT_MIN_ELEMENTS = SETTINGS_SECTIONS.length
/**
 * SVG 例外配额，默认 **0** —— 这是实测值，不是保守猜测：
 * 本机可达页面里带 `font-size` 呈现属性的 svg 图元实测 0 个
 * （绝大多数 svg 是纯 path/几何，`provider-brand-icon` 因无提供方未渲染、
 * `context-usage-ring` 在聊天页不可达）。
 * 默认 0 使"把元素说成在图标里"这条绕过路径失效：要用例外就必须在命令行上
 * **显式**给出配额，那是一次可见的、刻意的声明，而不是数据里悄悄多出的字段。
 */
const DEFAULT_MAX_SVG_EXCEPTIONS = 0
/** 默认不允许任何新增元素（严格）。见 parseAllowNewElementsArg 的说明。 */
const DEFAULT_ALLOW_NEW_ELEMENTS = 0
/**
 * 配额上限：例外数不得超过参与元素的一个极小比例（且至少有 5 的绝对余量，
 * 免得小样本 fixtures 被卡死）。理由：已登记例外只可能是**零星的图标文字**，
 * 不可能占多数 —— 否则"把未缩放的大多数说成在图标里"就能绕过判据 2。
 * 若将来界面真的出现大量 SVG 文字，应提高这个常量并写明理由，而不是随手抬配额。
 */
const svgExceptionCap = (participating) => Math.max(5, Math.floor(participating * 0.03))
/** 允许 1.5% 误差（浏览器亚像素取整）。 */
const RATIO_TARGET = 1.5
const RATIO_TOLERANCE = 0.015
const ratioOk = (r) => Number.isFinite(r) && Math.abs(r - RATIO_TARGET) < RATIO_TOLERANCE

/**
 * 解析 `<n>px` 形式的计算值；返回 null 表示"不可判定"（normal / auto / 空串），
 * 与 0 严格区分 —— 把不可判定误当"未缩放"或"未参与"都是伪结论。
 */
const parsePx = (v) => {
  if (typeof v !== "string") return null
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(v.trim())
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

const isFilledObject = (v) =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0

const sectionOfKey = (k) => String(k).split("::")[0]

/**
 * 根字号档位：可用 --scales 覆盖。
 * ⚠️ 原先 `.map(Number).filter(非有限或 ≤0)` 会把 `--scales 100,abc` **静默变成 [100]**，
 * 也会把 `--scales --out x.json`（flag 当值）变成空数组后含糊报"解析结果为空"。
 * 现在：任何非法 token 都是明确的 ARG-FAIL。
 */
function parseScalesArg(raw) {
  if (raw === undefined) return { scales: [100, 150] }
  const trimmed = raw.trim()
  if (trimmed === "") return { error: `--scales 取值为空（收到 ${JSON.stringify(raw)}），请提供如 --scales 100,150` }
  if (trimmed.startsWith("--")) return { error: `--scales 后缺少取值：读到的是另一个 flag ${JSON.stringify(raw)}，请提供如 --scales 100,150` }
  const tokens = trimmed.split(",").map((s) => s.trim())
  const bad = tokens.filter((t) => t === "" || !Number.isFinite(Number(t)) || Number(t) <= 0)
  if (bad.length) return { error: `--scales 含非法档位 ${JSON.stringify(bad)}（收到 ${JSON.stringify(raw)}）：每一项都必须是正数，如 --scales 100,150` }
  const scales = tokens.map(Number)
  if (new Set(scales.map(String)).size !== scales.length) {
    return { error: `--scales 有重复档位（收到 ${JSON.stringify(raw)}）：重复档位会互相覆盖，请去掉重复` }
  }
  return { scales }
}

/** 参与元素下限（正整数）。默认 = 分区数（每分区至少一个元素参与判据 2）。 */
function parseMinElementsArg(raw) {
  if (raw === undefined) return { value: DEFAULT_MIN_ELEMENTS }
  const trimmed = raw.trim()
  if (trimmed.startsWith("--") || trimmed === "") return { error: `--min-elements 需要正整数取值，读到的却是 ${JSON.stringify(raw)}` }
  const n = Number(trimmed)
  if (!Number.isInteger(n) || n <= 0) return { error: `--min-elements 必须是正整数（收到 ${JSON.stringify(raw)}）` }
  return { value: n }
}

/**
 * `--out` 取值：必须是文件路径。`--out` 后面紧跟另一个 flag（例如
 * `--out --scales 100`）原先会被当成文件名或默认值，属"flag 当值"的静默错误。
 */
function parseOutArg(raw) {
  if (raw === undefined) return {}
  const trimmed = raw.trim()
  if (trimmed === "" || trimmed.startsWith("--")) {
    return { error: `--out 需要文件路径取值，读到的却是 ${JSON.stringify(raw)}` }
  }
  return { value: trimmed }
}

/** SVG 例外配额（非负整数）。默认 0，见 DEFAULT_MAX_SVG_EXCEPTIONS。 */
function parseMaxSvgExceptionsArg(raw) {
  if (raw === undefined) return { value: DEFAULT_MAX_SVG_EXCEPTIONS }
  const trimmed = raw.trim()
  if (trimmed.startsWith("--") || trimmed === "") return { error: `--max-svg-exceptions 需要非负整数取值，读到的却是 ${JSON.stringify(raw)}` }
  const n = Number(trimmed)
  if (!Number.isInteger(n) || n < 0) return { error: `--max-svg-exceptions 必须是非负整数（收到 ${JSON.stringify(raw)}）` }
  return { value: n }
}

/**
 * 允许的新增元素数（非负整数）。默认 0（严格）。
 *
 * 为什么需要这个开关：键是「分区::DOM 路径」，而**新增一个同级元素会让
 * 其后所有同级元素的路径整体平移**。产品继续演进（如本任务新增「正文字号」
 * 设置行）时，路径键必然增长，这不是回归。
 * 但盲放行同样危险，故此处设计为：
 *   · **消失一律失败**（元素不见可能是渲染失败，绝不能靠开关绕过）
 *   · 新增必须显式放行且**逐个打印**（cls / 字号 / 文字），不允许静默通过
 *   · 另加守卫 J 按**内容指纹**（cls+文字+字号+行高）核查 before 的每个条目
 *     在 after 中是否仍有对应 —— 这条专门补上"路径平移"造成的盲区：
 *     删掉 A 又在 A 的位置插入 B 时，路径键看不出任何异常。
 */
function parseAllowNewElementsArg(raw) {
  if (raw === undefined) return { value: DEFAULT_ALLOW_NEW_ELEMENTS }
  const trimmed = raw.trim()
  if (trimmed.startsWith("--") || trimmed === "") return { error: `--allow-new-elements 需要非负整数取值，读到的却是 ${JSON.stringify(raw)}` }
  const n = Number(trimmed)
  if (!Number.isInteger(n) || n < 0) return { error: `--allow-new-elements 必须是非负整数（收到 ${JSON.stringify(raw)}）` }
  return { value: n }
}

const scalesParsed = parseScalesArg(argOf("--scales"))
const minElementsParsed = parseMinElementsArg(argOf("--min-elements"))
const outParsed = parseOutArg(argOf("--out"))
const maxSvgParsed = parseMaxSvgExceptionsArg(argOf("--max-svg-exceptions"))
const allowNewParsed = parseAllowNewElementsArg(argOf("--allow-new-elements"))
const CENSUS_SCALES = scalesParsed.scales ?? []
const ARG_ERRORS = [scalesParsed.error, minElementsParsed.error, outParsed.error, maxSvgParsed.error, allowNewParsed.error].filter(Boolean)
const MIN_ELEMENTS = minElementsParsed.value ?? DEFAULT_MIN_ELEMENTS
const MAX_SVG_EXCEPTIONS = maxSvgParsed.value ?? DEFAULT_MAX_SVG_EXCEPTIONS
const ALLOW_NEW_ELEMENTS = allowNewParsed.value ?? DEFAULT_ALLOW_NEW_ELEMENTS
const OUT_FILE = outParsed.value ?? "census.json"

/* ─────────── 比较模式 ─────────── */

/**
 * 比较两个 census 文件，判定两条判据 + 全部虚假通过防线。
 *
 * @returns {number} 进程退出码（0 = 只有全部判据与防线都成立时才可能）
 */
/**
 * 两份输入是否其实是**同一份数据**。
 *
 * 不只看路径：`cp after.json after-copy.json` 之后路径不同但内容相同，
 * 拿它当「改动后」照样是自比较。故同时比归一化绝对路径与内容哈希。
 * 读不到文件时返回 false —— 让下游的读取错误去报它自己的 ARG-FAIL，
 * 不在这里把"读不到"误报成"同一份"。
 */
function sameInput(pathA, pathB) {
  let absA, absB
  try { absA = resolve(pathA); absB = resolve(pathB) } catch { return false }
  // Windows 下路径大小写不敏感
  if (absA.toLowerCase() === absB.toLowerCase()) return true
  try {
    const a = readFileSync(pathA)
    const b = readFileSync(pathB)
    return createHash("sha256").update(a).digest("hex") === createHash("sha256").update(b).digest("hex")
  } catch { return false }
}

function compareCensus(beforePath, afterPath, { minElements, maxSvgExceptions, selfCompare = false }) {
  const failures = []
  const fail = (code, msg) => {
    failures.push(code)
    console.error(`  ✗ GUARD-FAIL [${code}] ${msg}`)
  }
  const argFail = (msg) => {
    failures.push("ARG")
    console.error(`  ✗ ARG-FAIL ${msg}`)
  }
  const readCensus = (label, p) => {
    let raw
    try { raw = readFileSync(p, "utf8") } catch (e) { argFail(`无法读取 ${label} 文件 ${p}：${e.message}`); return null }
    try { return JSON.parse(raw) } catch (e) { argFail(`${label} 文件不是合法 JSON（${p}）：${e.message}`); return null }
  }

  const before = readCensus("before", beforePath)
  const after = readCensus("after", afterPath)
  if (!before || !after) return 1

  console.log("  ══ 比较：改动前 vs 改动后 ══\n")

  /* ── 守卫 A：四个档位必须都是非空对象（空档 = 在 0 个元素上"通过"） ── */
  const buckets = {}
  for (const [side, file] of [["before", before], ["after", after]]) {
    for (const scale of REQUIRED_SCALES) {
      const val = file?.census?.[scale]
      const n = isFilledObject(val) ? Object.keys(val).length : 0
      if (n === 0) {
        fail("A/空档位", `${side} 的 ${scale}% 档缺失或为空对象（scales=${JSON.stringify(file?.scales)}）：判据会在 0 个元素上"通过"，属伪结论；--compare 需要 100% 与 150% 两档且都非空`)
      } else {
        console.log(`  ${side} ${scale}% 档: ${n} 个键`)
        buckets[`${side}${scale}`] = val
      }
    }
  }
  if (failures.length) {
    console.error("  ✗ 档位不完整，无法比较（判据必须建立在非空数据上）")
    return 1
  }

  const b100 = buckets.before100, b150 = buckets.before150
  const a100 = buckets.after100, a150 = buckets.after150
  const keysB = Object.keys(b100), keysB150 = Object.keys(b150)
  const keysA = Object.keys(a100), keysA150 = Object.keys(a150)
  const setA = new Set(keysA), setB = new Set(keysB), setA150 = new Set(keysA150)

  /* ── 守卫 B：分区覆盖必须 11/11（before 与 after 各自） ── */
  for (const [side, keys] of [["before", keysB], ["after", keysA]]) {
    const have = new Set(keys.map(sectionOfKey))
    const missed = SETTINGS_SECTIONS.filter((s) => !have.has(s))
    if (missed.length) {
      fail("B/分区覆盖", `${side} 的 100% 档只覆盖 ${SETTINGS_SECTIONS.length - missed.length}/${SETTINGS_SECTIONS.length} 个分区，缺: ${missed.join(", ")}（两侧同时缺一个分区时键数与判据完全自洽，只有这条能发现）`)
    } else {
      const unknown = [...have].filter((s) => !SETTINGS_SECTIONS.includes(s))
      console.log(`  分区覆盖 ${side} 100%: 已到达 ${SETTINGS_SECTIONS.length}/${SETTINGS_SECTIONS.length} 个分区`
        + (unknown.length ? `（另有未知前缀 ${unknown.length} 个: ${unknown.slice(0, 3).join(", ")}）` : ""))
    }
  }

  /* ── 守卫 C：::marker 采集不得整体失效（基线 300 条） ── */
  const markerCount = {}
  for (const [side, scale, keys] of [
    ["before", "100", keysB], ["before", "150", keysB150],
    ["after", "100", keysA], ["after", "150", keysA150],
  ]) {
    const n = keys.filter((k) => k.endsWith("::marker")).length
    markerCount[`${side}${scale}`] = n
    if (n === 0) {
      fail("C/marker缺失", `${side} 的 ${scale}% 档 ::marker 条数为 0（基线 300 条）：marker 采集整体失效，全部 ::marker 条目会从判据 2 消失`)
    }
  }
  console.log(`  ::marker 条数: before 100%=${markerCount.before100} 150%=${markerCount.before150}`
    + `；after 100%=${markerCount.after100} 150%=${markerCount.after150}`)

  /* ── 守卫 D：键集必须逐一对应（新增/消失的键对判据不可见）
         消失一律失败；新增必须显式放行且逐个打印。见 parseAllowNewElementsArg。 ── */
  const missing = keysB.filter((k) => !setA.has(k))
  const added = keysA.filter((k) => !setB.has(k))
  if (missing.length) {
    fail("D/元素消失", `仅改动前有 ${missing.length} 个键（示例 ${missing.slice(0, 3).join(" | ")}）。元素凭空消失可能是渲染失败或条件渲染变化，**任何情况下都必须排查**，不接受放行`)
  }
  if (added.length > ALLOW_NEW_ELEMENTS) {
    fail("D/新增超出放行额度", `仅改动后有 ${added.length} 个键，超过 --allow-new-elements ${ALLOW_NEW_ELEMENTS}。`
      + `新增元素确实可能来自新增的界面（不是回归），但必须显式放行；请先核对清单再提高额度。`
      + `示例 ${added.slice(0, 3).join(" | ")}`)
  }
  if (added.length) {
    console.log("")
    console.log(`  ── 已放行的新增元素（${added.length} 个，额度 ${ALLOW_NEW_ELEMENTS}）—— 请逐条人工核对 ──`)
    for (const k of added) {
      const v = a100[k]
      console.log(`    + [${v.cls || "(无class)"}] ${v.fontSize}/${v.lineHeight} ${JSON.stringify((v.text ?? "").slice(0, 26))}`)
    }
    const addedUnscaled = added.filter((k) => {
      const y100 = a100[k], y150 = a150[k]
      if (!y100 || !y150) return false
      const base = parsePx(y100.fontSize)
      const big = parsePx(y150.fontSize)
      if (base === null || big === null || base === 0) return false
      return Math.abs(big / base - 1.5) > 0.02
    })
    if (addedUnscaled.length) {
      fail("D1/新增元素未缩放", `${addedUnscaled.length} 个新增元素在 150% 档未按 1.5 倍缩放（示例 ${addedUnscaled.slice(0, 3).join(" | ")}）—— 新增的界面也必须跟随界面字号`)
    } else {
      console.log(`    已核验：${added.length} 个新增元素在 150% 档均按 1.5 倍缩放`)
    }
  }

  /*
   * ── 守卫 J：按**内容指纹**核查 before 的每个条目在 after 中是否仍有对应 ──
   *
   * 补的是守卫 D 的盲区：键是「分区::DOM 路径」，删掉 A 又在 A 的位置插入 B，
   * 路径键看不出任何异常（既不新增也不消失）。实测已遇到路径平移：
   * 插入「正文字体」行后，「界面字号」那一行的 DOM 索引整体后移，
   * 其旧路径被新行的 label 顶替 —— 两个 label 字号恰好都是 14px，
   * 于是判据 1 的数值比较**完全看不出**这里换了内容。
   * 本守卫用「文字 + 字号 + 行高」的多重集覆盖比对，能把"内容被顶替"揪出来。
   *
   * 指纹**不含 class 名**：任务 2 的机械换算会把 Tailwind 的 arbitrary class
   * 从 `text-[10px]` 合法地改成 `text-[0.625rem]`（实测侧边栏 11 处全变），
   * 那是已提交且已 A/B 验证的改动，与"元素是否还在"无关；
   * 而 class 承载的字号信息已由 fontSize/lineHeight 两个计算值覆盖 ——
   * 用户看到的是文字与字形，不是 class 名。
   */
  const fingerprint = (v) => `${v.text ?? ""}\u0000${v.fontSize}\u0000${v.lineHeight}`
  const afterFingerprints = new Map()
  for (const k of keysA) {
    const f = fingerprint(a100[k])
    afterFingerprints.set(f, (afterFingerprints.get(f) ?? 0) + 1)
  }
  const lostContent = []
  for (const k of keysB) {
    const f = fingerprint(b100[k])
    const n = afterFingerprints.get(f) ?? 0
    if (n > 0) afterFingerprints.set(f, n - 1)
    else lostContent.push({ key: k, before: b100[k] })
  }
  if (lostContent.length) {
    const samePath = lostContent.filter((x) => setA.has(x.key))
    fail("J/内容指纹丢失", `改动前有 ${lostContent.length} 个「元素内容」（文字+字号+行高）在改动后找不到对应`
      + (samePath.length ? `；其中 ${samePath.length} 个**路径仍在但内容已被顶替**（守卫 D 看不到这类问题）` : "")
      + `。示例：` + lostContent.slice(0, 3).map((x) => `[${x.before.cls || "无class"}] ${JSON.stringify((x.before.text ?? "").slice(0, 18))} ${x.before.fontSize}/${x.before.lineHeight} @ ${x.key.slice(-40)}`).join(" | "))
  } else {
    console.log(`  守卫 J（内容指纹覆盖）: 改动前 ${keysB.length} 个元素内容在改动后全部找到对应 ✓`)
  }

  if (keysA.length < keysB.length) {
    fail("D2/键数不足", `after 100% 档键数 ${keysA.length} < 基线(before) ${keysB.length}：after 每档键数不低于基线，否则是局部丢采集`)
  }
  const onlyInA150 = keysA150.filter((k) => !setA.has(k))
  const missingInA150 = keysA.filter((k) => !setA150.has(k))
  if (onlyInA150.length || missingInA150.length) {
    fail("D3/档位键集不一致", `after 的 100% 与 150% 档键集必须一致：150% 独有 ${onlyInA150.length}（示例 ${onlyInA150.slice(0, 3).join(" | ") || "—"}），150% 缺失 ${missingInA150.length}（示例 ${missingInA150.slice(0, 3).join(" | ") || "—"}）`)
  }

  /* ── 判据 1：100% 等效性 ── */
  const diff100 = []
  for (const k of keysB) {
    if (!setA.has(k)) continue
    const x = b100[k], y = a100[k]
    if (x.fontSize !== y.fontSize || x.lineHeight !== y.lineHeight) {
      diff100.push({ key: k, before: x, after: y })
    }
  }

  console.log("\n  判据 1：100% 字号下计算样式等效性")
  console.log(`    元素数 改动前=${keysB.length} 改动后=${keysA.length}`)
  console.log(`    仅改动前有: ${missing.length}${missing.length ? "  ← 元素消失，需排查" : ""}`)
  console.log(`    仅改动后有: ${added.length}${added.length ? "  ← 新增元素" : ""}`)
  console.log(`    fontSize/lineHeight 不同: ${diff100.length}`)
  if (diff100.length) {
    console.log(`      前 12 条差异：`)
    for (const d of diff100.slice(0, 12)) {
      console.log(`        ${d.key}`)
      console.log(`          前: ${d.before.fontSize} / lh ${d.before.lineHeight}`)
      console.log(`          后: ${d.after.fontSize} / lh ${d.after.lineHeight}`)
    }
  }
  /*
   * 判据 1 的通过条件。注意 `added` 用的是**额度**而不是「必须为 0」：
   * 键是 DOM 路径，新增界面元素会让键集合法增长（本次 4 个来自新增的
   * 「正文字体 / 正文字号」设置行）。新增元素没有"改动前"值可比，
   * 谈不上"视觉回归"；它们的正确性由另外两条保证 ——
   *   · 判据 2（新增元素在 150% 档必须按 1.5 倍缩放）+ 守卫 D1 复核
   *   · 守卫 J（改动前的内容一个都不能少，含路径被顶替的情况）
   * 而**消失**永远不允许（missing 必须为 0，且不受额度影响）。
   */
  const judge1 = diff100.length === 0
    && missing.length === 0 && added.length <= ALLOW_NEW_ELEMENTS
    && keysB.length > 0 && keysA.length > 0

  /* ── 判据 2：150% 生效性（fontSize 与 lineHeight 双断言，三分类） ── */
  const svgException = []
  const unexplained = []
  const noPairKeys = []
  const unjudgeable = []
  let scaled = 0
  let noPair = 0
  let markerPairs = 0
  let lhJudged = 0
  let lhSkipped = 0
  for (const k of keysA) {
    const at100 = a100[k], at150 = a150[k]
    if (at100 === undefined || at150 === undefined) { noPair++; noPairKeys.push(k); continue }
    if (at100.isMarker === true) markerPairs++

    const baseFs = parsePx(at100.fontSize)
    const bigFs = parsePx(at150.fontSize)
    if (baseFs === null || bigFs === null || baseFs === 0) {
      // 计算出的 fontSize 不是 `<n>px`（或为 0）→ 这一项无法判定。
      // 既不算"未参与"，也不算"通过"：单列出来，非空即失败。
      unjudgeable.push({ key: k, at100: at100.fontSize, at150: at150.fontSize })
      continue
    }
    const fsRatio = bigFs / baseFs
    const fsOk = ratioOk(fsRatio)

    // lineHeight 断言：仅当 100% 档是 px 数值时才要求线性（normal 等跳过）。
    // 跳过项要计数：若"一个都没判"（全 normal），说明行高断言整类空转，必须失败。
    const baseLh = parsePx(at100.lineHeight)
    let lhRatio = null
    let lhOk = true
    if (baseLh !== null && baseLh !== 0) {
      lhJudged++
      const bigLh = parsePx(at150.lineHeight)
      if (bigLh === null) lhOk = false
      else { lhRatio = bigLh / baseLh; lhOk = ratioOk(lhRatio) }
    } else {
      lhSkipped++
    }

    if (fsOk && lhOk) { scaled++; continue }

    const failed = !fsOk && !lhOk ? "fontSize+lineHeight" : !fsOk ? "fontSize" : "lineHeight"
    const rec = {
      key: k, failed,
      at100: at100.fontSize, at150: at150.fontSize,
      fsRatio: fsRatio.toFixed(3),
      lh100: at100.lineHeight, lh150: at150.lineHeight,
      lhRatio: lhRatio === null ? null : lhRatio.toFixed(3),
      cls: at100.cls, text: at100.text,
    }
    // SVG 图标几何是已登记例外；例外判定收紧为"确实带 font-size 呈现属性且在 svg 内"；
    // `::marker` 条目必须缩放，优先判定，不得算例外。
    if (at100.inSvg === true && at100.svgFontSizeAttr === true && at100.isMarker !== true) svgException.push(rec)
    else unexplained.push(rec)
  }

  console.log(`\n  判据 2：150% 字号下缩放生效性（期望 fontSize 与 lineHeight 全部 = 1.5 倍）`)
  console.log(`    正确缩放: ${scaled}`)
  console.log(`    SVG 例外（已登记，不要求缩放）: ${svgException.length}`)
  if (svgException.length) {
    console.log(`      ⚠️ 例外非 0，请人工确认确实都是带 font-size 呈现属性的 SVG 图元（判定条件: inSvg && svgFontSizeAttr）`)
    for (const d of svgException.slice(0, 5)) {
      console.log(`        ${d.at100} → ${d.at150} (×${d.fsRatio})  ${JSON.stringify(d.text || "")}  .${(d.cls || "").slice(0, 50)}`)
    }
  }
  console.log(`    未解释（真正漏项）: ${unexplained.length}`)
  if (unexplained.length) {
    console.log(`      前 20 条（键=分区id::DOM路径）:`)
    for (const d of unexplained.slice(0, 20)) {
      console.log(`        [${d.failed}] ${d.at100} → ${d.at150} (fontSize ×${d.fsRatio})`
        + ` / lineHeight ${d.lh100} → ${d.lh150}${d.lhRatio === null ? "" : ` (×${d.lhRatio})`}`
        + `  text=${JSON.stringify(d.text || "")}  .${(d.cls || "").slice(0, 40)}`)
      console.log(`            ${d.key}`)
    }
    if (unexplained.length > 20) console.log(`        …（其余 ${unexplained.length - 20} 条见 JSON 中的 100%/150% 档对比）`)
  }
  console.log(`    （其中 ::marker 条目: ${markerPairs}${markerPairs === 0 ? " ← 本页未采集到 marker，采集能力见 --marker-selftest" : ""}）`)

  /* ── 守卫 E：参与度（不能靠"跳过"来制造通过） ── */
  const participating = keysA.length - noPair
  console.log(`\n  参与度自检`)
  console.log(`    参与比对元素 = ${participating}（= after 100% 档键数 ${keysA.length} − 缺 150% 档配对的 ${noPair}）`)
  console.log(`    参与下限（--min-elements）= ${minElements}`)
  if (noPair > 0) {
    fail("E/未参与", `有 ${noPair} 个键缺少 100%/150% 任一档的配对，未参与判据 2（noPair 必须为 0）：示例 ${noPairKeys.slice(0, 5).join(" | ")}`)
  }
  if (participating === 0) {
    fail("E2/零参与", `参与比对元素为 0：判据 2 在 0 个元素上"通过"属伪结论`)
  } else if (participating < minElements) {
    fail("E3/参与下限", `参与比对元素 ${participating} < 下限 ${minElements}：采集明显不完整（可用 --min-elements 调整下限）`)
  }
  if (unjudgeable.length > 0) {
    fail("E4/无法判定", `有 ${unjudgeable.length} 个键的 fontSize 不是 <n>px 数值（不可判定，不算通过）：示例 ${unjudgeable.slice(0, 3).map((u) => `${u.key}=${JSON.stringify(u.at100)}`).join(" | ")}`)
  }

  /* ── 守卫 F：三组之和必须等于 after 100% 档的真实键总数 ── */
  const triageSum = scaled + svgException.length + unexplained.length
  console.log(`    三组之和 = ${triageSum}；after 100% 档键总数 = ${keysA.length}；未参与 = ${noPair}`)
  if (triageSum !== keysA.length) {
    fail("F/计数自检", `三组之和 ${triageSum} ≠ 键总数 ${keysA.length}（差 ${keysA.length - triageSum}）：有元素被算丢或算重，判据 2 的三分类不可信`)
  }
  /* ── 守卫 G：不得靠"全部豁免"制造通过 ── */
  if (svgException.length >= participating && participating > 0) {
    fail("G/例外吞没", `SVG 例外 ${svgException.length} 已覆盖全部 ${participating} 个参与元素：一个都不缩放却零未解释，属伪结论。已登记例外只覆盖 SVG 内联 font-size 图元（实测本机可达页面为 0 个），不可能吞掉全部文本元素`)
  }

  /* ── 守卫 H：行高断言必须真的运行过 ── */
  console.log(`    行高断言覆盖 = ${lhJudged}（100% 档为 px 数值）／跳过 ${lhSkipped}（normal 等不与字号线性对应）`)
  if (lhJudged === 0 && participating > 0) {
    fail("H/行高空转", `${participating} 个参与元素的 lineHeight 全部不可判定（非 <n>px）：行高断言一次都没运行，而 px 行高漏改（清单里 11 处 line-height + 80 处 font 简写）会因此完全不可见`)
  }

  /* ── 守卫 I：SVG 例外必须有配额（默认 0，实测值），且配额本身有上限 ── */
  const cap = svgExceptionCap(participating)
  console.log(`    SVG 例外配额（--max-svg-exceptions）= ${maxSvgExceptions}；上限 ${cap}（参与数的 3%，下限 5）`)
  if (maxSvgExceptions > cap) {
    fail("I0/配额越界", `--max-svg-exceptions ${maxSvgExceptions} 超过上限 ${cap}：已登记例外只可能是零星的图标文字，不可能占多数`)
  }
  if (svgException.length > maxSvgExceptions) {
    fail("I/例外超额", `SVG 例外 ${svgException.length} 超过配额 ${maxSvgExceptions}：已登记例外在本机可达页面上实测为 0 个，任何例外都必须显式提高配额（--max-svg-exceptions N）才能成立`)
  }
  // 判据 2 还要求**确有元素实现了缩放**：否则"全部未缩放 + 全部被豁免"也能通过
  const judge2 = unexplained.length === 0 && scaled > 0 && svgException.length < participating

  console.log(`\n  ══ 结论 ══`)
  console.log(`    判据 1（100% 等效，无视觉回归）: ${judge1 ? "通过" : "未通过"}`)
  console.log(`    判据 2（150% 全部缩放：fontSize 与 lineHeight，已排除登记例外）: ${judge2 ? "通过" : "未通过"}`)
  if (failures.length) {
    console.error(`  ✗ 防虚假通过防线未通过 ${failures.length} 项: ${failures.join(", ")}`)
    console.error(`    任何一项失败都不得判"通过" —— 错误报"通过"比没有工具更危险`)
  }
  const ok = judge1 && judge2 && failures.length === 0
  if (!ok) {
    // 统一的受控失败行：既覆盖判据未通过，也覆盖防线未通过。
    // 测试用它区分"受控失败"与"崩溃/环境问题导致的偶然非 0"。
    const failedJudges = []
    if (!judge1) failedJudges.push("判据1(100%等效)")
    if (!judge2) failedJudges.push(`判据2(150%缩放,未解释${unexplained.length})`)
    console.error(`  ✗ FAIL 未达成: ${[...failedJudges, ...failures].join(", ")}`)
  }
  console.log(`    → ${ok
    ? (selfCompare
      // 自比较下不得宣称"修复已达成"：两边相同证明不了任何改动
      ? "采集与判定确定性已确认（自比较）。**此结果不构成「修复已达成」的证据**"
      : "字号修复已达成：既无回归，又真实生效")
    : "尚未达成，需继续修（含防虚假通过防线）"}`)
  return ok ? 0 : 1
}

/* ─────────── 模式分派 ─────────── */
if (ARG_ERRORS.length) {
  for (const e of ARG_ERRORS) console.error(`  ✗ ARG-FAIL ${e}`)
  process.exitCode = 1
} else if (argv.includes("--compare")) {
  const i = argv.indexOf("--compare")
  const beforePath = argv[i + 1]
  const afterPath = argv[i + 2]
  if (!beforePath || !afterPath || beforePath.startsWith("--") || afterPath.startsWith("--")) {
    console.error(`  ✗ ARG-FAIL 用法: --compare <before.json> <after.json>（收到 ${JSON.stringify(argv.slice(i))}）`)
    process.exitCode = 1
  } else {
    /*
     * 自比较：同一份数据同时充当「改动前」与「改动后」。
     *
     * 这**是**受支持的用法 —— `implementation-plan.html` 用它做采集与判定的确定性自检
     * （「judge-1 self-compare = 0」），故不能拒绝。
     *
     * 但它**不能**支持「修复已达成」这个结论：判据 1 的语义是「改动前有缺陷、改动后没有」，
     * 两边完全一样时它只在证明「A 等于 A」。实测该用法曾打印
     * 「字号修复已达成：既无回归，又真实生效」。
     * 故这里不拦退出码，只把结论措辞缩到它真正证明的范围。
     */
    const selfCompare = sameInput(beforePath, afterPath)
    if (selfCompare) {
      console.log(`  ⓘ 自比较模式：前后两份是同一份数据`)
      console.log(`     本模式校验的是「采集与判定是否确定性可复现」。`)
      console.log(`     **它不构成「字号修复已达成」的证据** —— 两边相同只能证明「A 等于 A」。`)
      console.log(`     要证明修复达成，请用两个真正不同的采集结果（before 含缺陷、after 已修）。\n`)
    }
    process.exitCode = compareCensus(beforePath, afterPath, {
      minElements: MIN_ELEMENTS,
      maxSvgExceptions: MAX_SVG_EXCEPTIONS,
      selfCompare,
    })
  }
} else {
  /* ─────────── 采集模式 ─────────── */
  if (!existsSync(join(DIST, "index.html"))) {
    console.error("  dist/index.html 不存在，请先构建")
    process.exit(1)
  }
  if (CENSUS_SCALES.length === 0) {
    console.error(`  --scales 解析结果为空（收到: ${JSON.stringify(argOf("--scales"))}），请提供如 --scales 100,150`)
    process.exit(1)
  }

  const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" }
  const server = createServer((req, res) => {
    let p = decodeURIComponent((req.url ?? "/").split("?")[0])
    if (p === "/") p = "/index.html"
    const f = join(DIST, p)
    if (!f.startsWith(DIST) || !existsSync(f) || statSync(f).isDirectory()) return res.writeHead(404).end("nf")
    res.writeHead(200, { "content-type": MIME[extname(f)] ?? "application/octet-stream" })
    res.end(readFileSync(f))
  })
  const port = await new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)))

  const mod = await import(pathToFileURL(join(process.env.APPDATA, "npm/node_modules/playwright/index.js")).href)
  const browser = await (mod.chromium ?? mod.default.chromium).launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" })
  await page.waitForTimeout(2500)

  // 打开设置页 —— 它是"外观与界面"控件所在页，且浏览器中可到达
  await page.evaluate(() => {
    for (const el of document.querySelectorAll(".ui-test-root button, .ui-test-root a")) {
      if ((el.getAttribute("aria-label") || "") === "设置") { el.click(); return }
    }
  })
  await page.waitForTimeout(1500)

  /** 采集当前 DOM 中所有可见文本元素的计算字号/行高，键为 DOM 路径。 */
  const censusOnce = () => page.evaluate(() => {
    const out = {}
    const path = (el) => {
      const parts = []
      let cur = el
      while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
        const parent = cur.parentElement
        const idx = parent ? [...parent.children].indexOf(cur) : 0
        parts.unshift(`${cur.tagName.toLowerCase()}:${idx}`)
        cur = parent
      }
      return parts.join(">")
    }
    for (const el of document.querySelectorAll("*")) {
      const ownText = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join("")
      if (!ownText) continue
      const cs = getComputedStyle(el)
      if (cs.display === "none" || cs.visibility === "hidden") continue
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) continue
      out[path(el)] = {
        fontSize: cs.fontSize,
        lineHeight: cs.lineHeight,
        cls: (el.className || "").toString().slice(0, 70),
        text: ownText.slice(0, 20),
        // 诊断用：元素有 svg 祖先
        inSvg: !!(el.closest && el.closest("svg")),
        // **例外判定的唯一依据**：确实带 `font-size` 呈现属性（SVG 的 fontSize="N"
        // 在 DOM 里就是 `font-size` 属性）且在 svg 内。只标 inSvg 不足以算例外 ——
        // 否则把任意未缩放元素说成"在图标里"就能绕过判据 2。
        svgFontSizeAttr: !!(el.closest && el.closest("svg") && el.hasAttribute("font-size")),
      }
    }
    // 伪元素 ::marker：普通遍历读不到它的字号，单独采集
    // （后续要改 ui-test-editor.css 的 li::marker 12px / ol>li::marker 16px；
    //   注意本工具浏览器可达路径下 .ui-test-editor-body 从不挂载，见文件头"已知覆盖盲区"）
    for (const li of document.querySelectorAll(".ui-test-editor-body li, .ui-test-root li")) {
      const marker = getComputedStyle(li, "::marker")
      if (!marker || marker.fontSize === "") continue
      out[path(li) + "::marker"] = {
        fontSize: marker.fontSize,
        lineHeight: marker.lineHeight,
        cls: (li.className || "").toString().slice(0, 70),
        text: (li.textContent || "").trim().slice(0, 20),
        inSvg: false,
        svgFontSizeAttr: false,
        isMarker: true,
      }
    }
    return out
  })

  /**
   * 点击设置页子分区（用 data-ui-settings-category-button 定位，与界面语言无关）。
   * 返回真实到达的分区 id 与按钮标签 —— 没点到就如实返回 null，不伪造。
   */
  const openSection = async (id) => {
    const clicked = await page.evaluate((sectionId) => {
      const btn = document.querySelector(`[data-ui-settings-category-button="${sectionId}"]`)
      if (!btn) return false
      btn.click()
      return true
    }, id)
    await page.waitForTimeout(700)
    const landed = await page.evaluate(() => {
      const active = document.querySelector('[data-ui-page="settings"]')?.getAttribute("data-ui-settings-category") ?? null
      const btn = active ? document.querySelector(`[data-ui-settings-category-button="${active}"]`) : null
      const label = (btn?.textContent || "").trim().replace(/\s+/g, " ")
      return { id: active, label }
    })
    return { requested: id, clicked, landed: landed.id, label: landed.label }
  }

  /**
   * 一个 scale 档位的完整采集：先回固定分区，再逐个分区采集。
   *
   * 每个分区的快照以 `<分区id>::` 前缀并入累积对象（见文件头"键的构成规则"）。
   * 分区前缀用的是**实际到达**的分区（landed），不是请求点击的分区。
   *
   * `reached` 只收 **11 个分区各一次**的结果；起始分区单独放在 `home` 里。
   * （早先把 home 也塞进 reached，于是"到达分区数"打印成 `12/11`：分母是
   * 11 个分区、分子却是 12 次访问，数字自相矛盾。）
   *
   * 合并时若同一个键被重写，会校验两次记录是否同一元素（cls/text 一致）。
   * 正常只应发生一次（起始分区 model 与列表首项 model 重复访问，同一元素、
   * 值一致的幂等重写）；一旦出现"同键不同元素"，即说明有元素可能被遮蔽，
   * 必须当作错误上报而不是沉默通过。
   */
  const censusAllSections = async () => {
    const merged = {}
    const reached = []
    const passes = []
    const shadowed = []
    const mergeSnapshot = (sectionId, snap) => {
      const entries = Object.entries(snap)
      let added = 0
      for (const [path, rec] of entries) {
        const key = `${sectionId}::${path}`
        const prev = merged[key]
        if (prev === undefined) {
          added++
        } else if (prev.cls !== rec.cls || prev.text !== rec.text) {
          // 同键重写且元素身份不同 —— 理论上不该发生（同分区同一路径即同一元素），
          // 出现即意味着状态在两次采集之间变了，如实记录并报警。
          shadowed.push({ key, prev: { cls: prev.cls, text: prev.text }, next: { cls: rec.cls, text: rec.text } })
        }
        merged[key] = rec
      }
      passes.push({ sectionId, captured: entries.length, added })
    }
    const home = await openSection(SETTINGS_HOME_SECTION)
    mergeSnapshot(home.landed ?? home.requested, await censusOnce())
    for (const id of SETTINGS_SECTIONS) {
      const r = await openSection(id)
      mergeSnapshot(r.landed ?? r.requested, await censusOnce())
      reached.push(r)
    }
    return { merged, reached, home, passes, shadowed }
  }

  /* ── ::marker 采集能力自检：临时插入 li 与规则，确认读数确实随之变化 ── */
  const markerSelftest = async () => {
    const probe = await page.evaluate(() => {
      const root = document.querySelector(".ui-test-root") || document.body
      const host = document.createElement("ul")
      host.id = "__marker_probe_host__"
      const li = document.createElement("li")
      li.id = "__marker_probe_li__"
      li.textContent = "marker探针"
      host.appendChild(li)
      root.appendChild(host)
      const read = () => {
        const ms = getComputedStyle(li, "::marker")
        return { fontSize: ms ? ms.fontSize : null, lineHeight: ms ? ms.lineHeight : null }
      }
      const inherited = read()
      const st = document.createElement("style")
      st.id = "__marker_probe_style__"
      st.textContent = "li::marker { font-size: 12px; }"
      document.head.appendChild(st)
      const rule12 = read()
      st.textContent = "li::marker { font-size: 16px; }"
      const rule16 = read()
      st.remove()
      host.remove()
      return {
        inherited, rule12, rule16,
        appendedTo: root.className || root.tagName.toLowerCase(),
        cleaned: !document.getElementById("__marker_probe_host__") && !document.getElementById("__marker_probe_style__"),
      }
    })
    const ok = probe.rule12.fontSize === "12px" && probe.rule16.fontSize === "16px" && probe.cleaned
    console.log("  ══ ::marker 采集能力自检 ══")
    console.log(`    临时节点挂载到: ${probe.appendedTo}`)
    console.log(`    未加规则（继承 li）: fontSize=${JSON.stringify(probe.inherited.fontSize)} lineHeight=${JSON.stringify(probe.inherited.lineHeight)}`)
    console.log(`    加 li::marker{font-size:12px}: fontSize=${JSON.stringify(probe.rule12.fontSize)}`)
    console.log(`    改 li::marker{font-size:16px}: fontSize=${JSON.stringify(probe.rule16.fontSize)}`)
    console.log(`    临时节点/规则已清理: ${probe.cleaned}`)
    console.log(`    → ${ok ? "有效：能读到 ::marker 字号，且读数随规则改变（可区分 12px / 16px）" : "【无效】getComputedStyle(li, \"::marker\").fontSize 不可用，marker 采集必须换方法（改从 CSS 文本静态校验）"}`)
    if (!ok) process.exitCode = 1
  }

  if (argv.includes("--marker-selftest")) {
    await markerSelftest()
    await browser.close()
    server.close()
  } else {
    const census = {}
    for (const s of CENSUS_SCALES) {
      await page.evaluate((p) => { document.documentElement.style.fontSize = p + "%" }, s)
      await page.waitForTimeout(600)
      const { merged, reached, home, passes, shadowed } = await censusAllSections()
      census[String(s)] = merged
      const keys = Object.keys(merged)
      const markerKeys = keys.filter((k) => k.endsWith("::marker"))
      // `reached` 恰好是 11 个分区各一次（起始分区另计），故分母分子一致
      const okReached = reached.filter((r) => r.landed === r.requested)
      const missed = reached.filter((r) => r.landed !== r.requested)
      const capturedTotal = passes.reduce((n, p) => n + p.captured, 0)
      console.log(`  采集 ${s}%: ${keys.length} 个键（其中 ::marker ${markerKeys.length} 条）`)
      console.log(`    快照合计 ${capturedTotal} 条 → 去重后 ${keys.length} 个键`
        + `（重复=${capturedTotal - keys.length}：同一元素被多个分区/重复访问各记一份，键不冲突）`)
      console.log(`    分区前缀（首个为起始分区 ${SETTINGS_HOME_SECTION}，与列表首项重复）: ${passes.map((p) => `${p.sectionId}[${p.captured}→+${p.added}]`).join(" ")}`)
      if (shadowed.length) {
        console.log(`    ⚠️ 同键换成不同元素 ${shadowed.length} 处 —— 有元素可能被遮蔽，需排查:`)
        for (const d of shadowed.slice(0, 10)) console.log(`        ${d.key}  前=${JSON.stringify(d.prev)}  后=${JSON.stringify(d.next)}`)
      } else {
        console.log(`    同键重写且元素身份不同: 0（无静默遮蔽）`)
      }
      console.log(`    起始分区: ${home.requested}→${home.landed}${home.label ? `(${home.label})` : ""}${home.landed === home.requested ? "" : " ⚠️ 起始分区未按请求到达"}`)
      console.log(`    实际到达分区（已到达 ${okReached.length}/${SETTINGS_SECTIONS.length} 个分区）: ${okReached.map((r) => `${r.requested}${r.label ? `(${r.label})` : ""}`).join(", ")}`)
      if (missed.length) {
        console.log(`    ⚠️ 未到达: ${missed.map((r) => `${r.requested}(clicked=${r.clicked}, landed=${r.landed})`).join(", ")}`)
      }
    }

    await browser.close()
    server.close()

    const payload = {
      capturedAt: new Date().toISOString(),
      scales: CENSUS_SCALES,
      census,
    }
    const out = OUT_FILE
    writeFileSync(out, JSON.stringify(payload, null, 1), "utf8")
    console.log(`\n  已写入 ${out}`)
  }
}
