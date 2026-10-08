/**
 * 字体捆绑许可核验器 / Font bundle license verifier
 *
 * ── 它回答的唯一问题 ──
 * 不是「这款字体能否免费使用」，也不是「能否免费商用」，而是更严的那一条：
 * **「许可证是否明确授权把字体文件本身再分发、并打包进第三方商业产品的安装程序？」**
 *
 * 这三个问题在中文字体领域经常被混为一谈，而混为一谈的后果是把侵权风险写进安装包。
 * 已确证落入此陷阱的字体：**MiSans（小米）** 与 **阿里巴巴普惠体** —— 两者都对外宣传
 * 「免费商用」，但授权动词只有 download / install / use，没有任何再分发/嵌入授权。
 * 厂商宣传「免费商用」时，指的是「你用字体做出来的作品可以商用」，不是「字体文件可以随便传」。
 *
 * ── 为什么要写成脚本而不是一张表态表 ──
 * 1. **许可会变**。厂商昨天说「免费商用」，今天把条款改成「仅限个人非商用」——
 *    静态文档发现不了，脚本每次重跑都能发现，并把原文 SHA-256 记下来做变更告警。
 * 2. **「我读过许可」不可复核**。脚本把原文抓下来、把判定依据逐行打出来，
 *    任何人都能逐字核对，而不是相信一句结论。
 * 3. **判定依据要机械可查**。OFL 类：是否含 OFL-1.1 全文；是否声明保留字体名
 *    （RFN 决定子集化/改名时是否必须改名）。专有类：脚本**不代替判定**，
 *    只把与再分发有关的原文全部摆出来供人工逐字阅读。
 *
 * ── 三个「许可原文会骗人」的陷阱（脚本会自动检出并报警）──
 * ① `huawei-fonts/HarmonyOS-Sans` 的**仓库根 LICENSE = GPL-3.0**（那是仓库 npm 包装脚本的
 *    许可）。字体真正的许可是官方 ZIP 内 `HarmonyOS_Sans_SC/LICENSE.txt`。
 *    只看根 LICENSE 会把它**误判成 GPL-3.0 而误拒**；反过来若因为"根许可是 GPL 但字体不是"
 *    就放心，又会漏掉它「不得修改（含子集化）」这条比 OFL 更严格的义务。
 * ② `welai/glow-sans` 的**仓库根 LICENSE = MIT**（构建代码），字体本身是 OFL-1.1。
 *    只看根 LICENSE 会**漏掉 OFL 的随附许可文本义务**。
 * ③ **OFL 样板文字不是 RFN 声明**。OFL 正文里有一句
 *    `"Reserved Font Name" refers to any names specified as such after the copyright statement(s).`
 *    —— 这是一句**定义**，出现在**每一份** OFL 里。把它当成声明，
 *    会让「未声明保留字体名」的字体被误报成「有保留字体名」。
 *    故本脚本只在 OFL 正文**之前**的版权区里找 RFN 声明。
 *
 * ── 网络环境说明 ──
 * 本机 `web_search` / `web_fetch` 工具不可用（401/404 与"非公网 IP"解析），统一用 curl.exe。
 * 每个候选项都配了**离线证据回落**（`.font-research/evidence/`），
 * 故网络抖动不会产生假 UNVERIFIED。
 *
 * 用法：
 *   node docs/font-license-verification/verify-bundle-licenses.mjs --selftest   # 只验解析器
 *   node docs/font-license-verification/verify-bundle-licenses.mjs
 *   node docs/font-license-verification/verify-bundle-licenses.mjs --json docs/font-license-verification/license-verification.json
 *
 * 退出码：0 = 全部候选均已核实（"可捆绑"与"已判定的拒绝项"都算已核实）；
 *         1 = 存在 UNVERIFIED（一律按不可捆绑处理）；2 = 脚本自身故障（网络全断 / 解析器自检不过）。
 */
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, "..", "..")
const EVIDENCE = join(REPO_ROOT, ".font-research", "evidence")
mkdirSync(HERE, { recursive: true })

const AS_SELFTEST = process.argv.includes("--selftest")
const JSON_OUT = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null

const EV = (n) => `LIC__${n}`   // 证据文件名简写

/**
 * 候选字体表。
 *
 * `kind`：
 *   "ofl"         —— 预期 SIL OFL 1.1，自动校验全文 + 版权行 + 保留字体名
 *   "proprietary" —— 专有许可，脚本**不代替判定**，只摆原文供人工逐字核对
 * `verdict`：仅在**已人工判定过**时填写（"YES"/"NO"）。
 * `trapNote`：该仓库根 LICENSE 与字体许可不同源时填写，脚本会实测并报警。
 * `cachedEvidence`：离线回落证据（网络不可用时使用，保证不会假 UNVERIFIED）。
 */
const CANDIDATES = [
  /* ───── OFL 系：本次核验的主力候选 ───── */
  { id: "lxgw-wenkai", name: "霞鹜文楷 LXGW WenKai", kind: "ofl",
    licenseUrl: "https://raw.githubusercontent.com/lxgw/LxgwWenKai/HEAD/OFL.txt",
    repoLicenseUrl: "https://raw.githubusercontent.com/lxgw/LxgwWenKai/HEAD/LICENSE",
    cachedEvidence: "LIC__lxgw__LxgwWenKai__OFL.txt.txt",
    note: "用户点名要的「霞」。正文楷体首选。" },
  { id: "lxgw-wenkai-gb", name: "霞鹜文楷 GB", kind: "ofl",
    licenseUrl: "https://raw.githubusercontent.com/lxgw/LxgwWenkaiGB/HEAD/OFL.txt",
    cachedEvidence: "LIC__lxgw__LxgwWenkaiGB__OFL.txt.txt" },
  { id: "lxgw-wenkai-screen", name: "霞鹜文楷屏幕阅读版", kind: "ofl",
    licenseUrl: "https://raw.githubusercontent.com/lxgw/LxgwWenKai-Screen/HEAD/OFL.txt",
    cachedEvidence: "LIC__lxgw__LxgwWenKai-Screen__OFL.txt.txt",
    note: "屏幕优化版，笔画更清晰，适合长文阅读界面。" },
  { id: "lxgw-wenkai-tc", name: "霞鹜文楷 TC（繁体）", kind: "ofl",
    licenseUrl: "https://raw.githubusercontent.com/lxgw/LxgwWenKaiTC/HEAD/OFL.txt",
    cachedEvidence: "LIC__lxgw__LxgwWenKaiTC__OFL.txt.txt" },
  { id: "zhuque-fangsong", name: "朱雀仿宋 Zhuque Fangsong", kind: "ofl",
    licenseUrl: "https://raw.githubusercontent.com/TrionesType/zhuque/HEAD/LICENSE.txt",
    cachedEvidence: "LIC__TrionesType__zhuque__LICENSE.txt.txt",
    note: "用户点名要的「文」（仿宋一路）。体积最小（5.5 MB），正文首选。" },
  { id: "wenjin-mincho", name: "文津宋体 WenJinMincho", kind: "ofl",
    licenseUrl: "https://raw.githubusercontent.com/takushun-wu/WenJinMincho/HEAD/LICENSE.md",
    cachedEvidence: "LIC__takushun-wu__WenJinMincho__LICENSE.md.txt",
    note: "大字符集宋体，冷僻字覆盖好。其 RFN 用 <span> 包裹多语言字体名，是本脚本遇到的第 4 种格式。" },
  { id: "superhan", name: "SuperHan", kind: "ofl",
    licenseUrl: "https://raw.githubusercontent.com/takushun-wu/SuperHan/HEAD/LICENSE",
    cachedEvidence: "superhan_license.txt",
    note: "此前尽调报告标为「LICENSE 原文未抓到，须补抓」，**本次已补齐**：确为 OFL-1.1，RFN = SuperHan。其 RFN 写法是**裸词**（无引号无尖括号），是本脚本遇到的第 3 种格式。" },
  { id: "chillkai", name: "寒蝉正楷体 ChillKai", kind: "ofl",
    licenseUrl: "https://raw.githubusercontent.com/Warren2060/ChillKai/HEAD/LICENSE",
    cachedEvidence: "LIC__Warren2060__ChillKai__LICENSE.txt",
    note: "用户点名要的「楷」。注意仓库名大小写：仓库 `ChillKai`，release 路径是 `Chillkai`。" },
  { id: "chillround", name: "寒蝉全圆体 ChillRound", kind: "ofl",
    licenseUrl: "https://raw.githubusercontent.com/Warren2060/ChillRound/HEAD/LICENSE",
    cachedEvidence: "LIC__Warren2060__ChillRound__LICENSE.txt",
    note: "版权行用 `©` 而非 `Copyright`，且 RFN 是**空格分隔**的两个引号名 —— 是本脚本遇到的第 2 种格式。" },
  { id: "yozai", name: "悠哉字体 Yozai", kind: "ofl",
    licenseUrl: "https://raw.githubusercontent.com/lxgw/yozai-font/HEAD/OFL.txt",
    cachedEvidence: "LIC__lxgw__yozai-font__OFL.txt.txt" },
  { id: "iansui", name: "芫荽 Iansui", kind: "ofl",
    licenseUrl: "https://raw.githubusercontent.com/ButTaiwan/iansui/HEAD/OFL.txt",
    cachedEvidence: "LIC__ButTaiwan__iansui__OFL.txt.txt" },
  { id: "smiley-sans", name: "得意黑 Smiley Sans", kind: "ofl",
    licenseUrl: "https://raw.githubusercontent.com/atelier-anchor/smiley-sans/HEAD/LICENSE",
    cachedEvidence: "LIC__atelier-anchor__smiley-sans__LICENSE.txt",
    note: "RFN 用**尖括号** `<Smiley> and <得意黑>` —— 是本脚本遇到的第 5 种格式。" },
  { id: "sarasa-gothic", name: "更纱黑体 Sarasa Gothic", kind: "ofl",
    licenseUrl: "https://raw.githubusercontent.com/be5invis/Sarasa-Gothic/HEAD/LICENSE",
    cachedEvidence: "LIC__be5invis__sarasa-gothic__LICENSE.txt",
    note: "标题写作 `SIL Open Font License v1.1`（无 Version 字样），与标准写法不同 —— 是本脚本遇到的第 6 种格式。" },
  { id: "glow-sans", name: "未来荧黑 Glow Sans（字体为 OFL）", kind: "ofl",
    licenseUrl: "https://raw.githubusercontent.com/welai/glow-sans/HEAD/OFL.txt",
    repoLicenseUrl: "https://raw.githubusercontent.com/welai/glow-sans/HEAD/LICENSE",
    cachedEvidence: "glow-sans_OFL.txt",
    trapNote: "仓库根 LICENSE 是 MIT（构建代码），字体本身才是 OFL-1.1。只看根 LICENSE 会漏掉 OFL 的随附许可文本义务。" },
  { id: "source-han-sans", name: "思源黑体 Source Han Sans", kind: "ofl",
    licenseUrl: "https://raw.githubusercontent.com/adobe-fonts/source-han-sans/HEAD/LICENSE.txt",
    cachedEvidence: "LIC__adobe-fonts__source-han-sans__LICENSE.txt.txt",
    note: "RFN 声明**跨两行**（`with Reserved Font\\nName 'Source'`），不做空白归一化就完全匹配不到。" },
  { id: "source-han-serif", name: "思源宋体 Source Han Serif", kind: "ofl",
    licenseUrl: "https://raw.githubusercontent.com/adobe-fonts/source-han-serif/HEAD/LICENSE.txt",
    cachedEvidence: "LIC__adobe-fonts__source-han-serif__LICENSE.txt.txt" },
  { id: "noto-sans-cjk", name: "Noto Sans CJK（noto-cjk/Sans）", kind: "ofl",
    licenseUrl: "https://raw.githubusercontent.com/notofonts/noto-cjk/HEAD/Sans/LICENSE",
    note: "该 LICENSE 是**纯 OFL 文本、不含版权行**（Noto CJK 版权信息在字体元数据内）。许可仍在，但版权行须另行记录。" },
  { id: "noto-serif-cjk", name: "Noto Serif CJK（noto-cjk/Serif）", kind: "ofl",
    licenseUrl: "https://raw.githubusercontent.com/notofonts/noto-cjk/HEAD/Serif/LICENSE" },
  { id: "noto-sans-sc-gf", name: "Noto Sans SC（Google Fonts 发布版）", kind: "ofl",
    licenseUrl: "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/OFL.txt",
    cachedEvidence: "GF_OFL_notosanssc.txt" },
  { id: "maple-mono", name: "Maple Mono", kind: "ofl",
    licenseUrl: "https://raw.githubusercontent.com/subframe7536/maple-font/variable/OFL.txt",
    cachedEvidence: "LIC__subframe7536__maple-font__OFL.txt.txt" },
  { id: "chiron-hei-hk", name: "昭源黑体 Chiron Hei HK", kind: "ofl",
    licenseUrl: "https://raw.githubusercontent.com/chiron-fonts/chiron-hei-hk/HEAD/LICENSE.md",
    cachedEvidence: "LIC__chiron-fonts__chiron-hei-hk__LICENSE.md.txt",
    note: "⚠️ 该项目**没有任何 release 资产**，只能从源码构建 —— 不可确定性下载，暂不进捆绑清单。" },
  { id: "douyin-sans", name: "抖音美好体 Douyin Sans", kind: "ofl",
    licenseUrl: null, cachedEvidence: "gh_bytedance_DouyinSans_OFL.txt",
    note: "字节跳动开源，OFL-1.1。" },

  /* ───── 专有但明确允许捆绑 ───── */
  { id: "harmonyos-sans", name: "鸿蒙黑体 HarmonyOS Sans SC", kind: "proprietary", verdict: "YES",
    licenseUrl: null, cachedEvidence: "HarmonyOSSans_SC_LICENSE_utf8.txt",
    repoLicenseUrl: "https://raw.githubusercontent.com/huawei-fonts/HarmonyOS-Sans/HEAD/LICENSE",
    trapNote: "仓库根 LICENSE 是 **GPL-3.0**（仓库 npm 包装脚本的许可），**不是字体许可**。字体真正的许可是官方 ZIP 内 `HarmonyOS_Sans_SC/LICENSE.txt`。把字体误判为 GPL-3.0 会误拒；只读根 LICENSE 又会漏掉它「不得修改（含子集化）」的义务。",
    note: "用户点名要的「鸿蒙黑体」。授权动词逐字为 `use, copy, merge, embed, bundle, redistribute and/or sell unmodified copies of HarmonyOS Sans Fonts with any software except for fonts software` —— 明确允许随任意软件（字体软件本身除外）嵌入/捆绑/再分发。**硬性条件**：①显著注明使用了 HarmonyOS Sans；②不得作任何修改（故**不得子集化/格式转换/改名**）；③不得单独作为字体产品再分发；④保留版权声明与协议全文。许可为 non-transferable 且 **revocable（可撤销）**，属持续性风险，须法务登记。" },

  /* ───── 已判定的拒绝项：列出来是为了让「拒绝」也有可复核的原文 ───── */
  { id: "misans", name: "MiSans（小米）", kind: "proprietary", verdict: "NO",
    licenseUrl: "https://hyperos.mi.com/font-download/MiSans%E5%AD%97%E4%BD%93%E7%9F%A5%E8%AF%86%E4%BA%A7%E6%9D%83%E8%AE%B8%E5%8F%AF%E5%8D%8F%E8%AE%AE.pdf",
    cachedEvidence: "MiSans_license.txt",
    note: "**用户点名要的「小米」，但结论是不可捆绑。** 授权动词只有「安装、使用 / install and use」；条件 3) 禁止「**单独**将 MiSans 字体…进一步分发或售卖 / nor shall you redistribute or sell them」，豁免仅覆盖「用字体创作的作品」。**须注意歧义**：条件 1) 又要求「您应在**软件中**特别注明使用了 MiSans 字体」，暗示「软件内使用」被预期；条件 3) 的「单独」二字也可读作「仅禁止脱离软件单独分发」。故本项性质应表述为**「有歧义的灰区，未取得小米书面确认前不得捆绑」**，而非「明文禁止」。工程结论不变（不捆绑）。" },
  { id: "puhuiti", name: "阿里巴巴普惠体 Alibaba PuHuiTi 3.0", kind: "proprietary", verdict: "NO",
    licenseUrl: "https://www.yuque.com/yiguang-wkqc2/hgpff0/nus9wiinq4aeiegy",
    cachedEvidence: "yuqueapi_1733765915.txt",
    // 语雀页面是验证码墙，必须要求"真正的授权动词"出现，否则回落离线证据（见 looksLikeLicense）
    requireText: /下载、安装和使用|download, install and use/i,
    note: "**用户点名要的「阿里巴巴普惠体」，但结论是不可捆绑。** 授权仅 `download, install and use the downloaded Alibaba Font`（中：「可以下载、安装和使用」）；第 4 条是兜底禁止：`Without prior written permission by Alibaba, User shall not: ... 3) sell, lease, loan, transfer Alibaba Font, or take any other action not permitted by Alibaba`。**没有任何再分发/嵌入/打包授权**。与 MiSans 不同，这里**没有**「在软件中注明」这类暗示软件内使用的条款，故比 MiSans 更明确地不可捆绑。" },
]

/* ─────────────────────────── 工具函数 ─────────────────────────── */

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex").toUpperCase()

/** curl 抓取（本机 web_fetch 不可用）。带 2 次重试，避免瞬时失败产生假 UNVERIFIED。 */
function fetchText(url, { timeoutSec = 30, attempts = 2 } = {}) {
  if (!url) return { status: 0, body: "", binary: false }
  let last = { status: 0, body: "", binary: false }
  for (let i = 0; i < attempts; i++) {
    const r = spawnSync("curl.exe", [
      "-sL", "--max-time", String(timeoutSec), "--retry", "2", "--retry-delay", "1",
      "-A", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "-w", "\n__HTTP_STATUS__%{http_code}",
      url,
    ], { encoding: "utf8", maxBuffer: 96 * 1024 * 1024 })
    if (r.error) { last = { status: 0, body: "", binary: false, error: String(r.error.message ?? r.error) }; continue }
    const out = r.stdout ?? ""
    const m = /__HTTP_STATUS__(\d{3})\s*$/.exec(out)
    const status = m ? Number(m[1]) : 0
    const body = out.replace(/\n?__HTTP_STATUS__\d{3}\s*$/, "")
    // PDF 等二进制用魔数识别 —— 上一版把 MiSans 的 PDF 当文本解读，抓出一堆无关字节
    const binary = body.startsWith("%PDF") || /\u0000/.test(body)
    last = { status, body, binary }
    if (status === 200 && !binary && body.length > 200) return last
  }
  return last
}

/**
 * OFL 正文起始标志。要同时认三种真实写法：
 *   `SIL OPEN FONT LICENSE Version 1.1`（标准 / LXGW / Noto）
 *   `SIL Open Font License, Version 1.1`（Sarasa 第 6 行）
 *   `SIL Open Font License v1.1`         （Sarasa 第 14 行标题）
 * 只认标准写法的后果：Sarasa 被判「未找到 OFL 全文」而误拒。
 */
const OFL_BODY_RE = /SIL Open Font License,?\s*(?:Version\s*)?v?1\.1/i

/**
 * 抓回来的东西**是不是许可文本**。
 *
 * ⚠️ 第四个真实陷阱（由结果审计抓到）：**HTTP 200 不等于拿到了许可**。
 * 语雀的普惠体页面返回 200、45 KB，但内容是**验证码墙 + JS 配置**，
 * 里面既没有「下载、安装和使用」也没有任何授权动词 —— 全是
 * `captchaConfig` / `%22renderMode%22%3A%22embed%22` 这类乱码。
 * 上一版只看「200 且长度 > 200」就把它当许可原文，于是拒绝项打出的"判定依据"
 * 是一堆验证码配置 —— 结论虽然对，但**读者无法逐字核对**，等于没有依据。
 * 故必须加内容闸门：不像许可就回落到离线证据。
 */
const LICENSE_HINT_RE = /license|copyright|permission is hereby|all rights reserved|许可|授权|版权/i

function looksLikeLicense(text, requireText) {
  if (!text || text.length < 200) return false
  // 验证码墙 / SPA 外壳特征：出现即拒绝，回落到离线证据
  if (/captchaConfig|captchaAppKey|publicFrameProtectionEnabled/i.test(text)) return false

  const strong =
    OFL_BODY_RE.test(text) ||
    /permission is hereby granted/i.test(text) ||
    /下载、安装和使用|download, install and use/i.test(text)
  // 没有强特征时，至少要有许可/版权类词汇
  if (!strong && !LICENSE_HINT_RE.test(text)) return false

  // 逐字特征（如普惠体必须出现「下载、安装和使用」）
  if (requireText && !requireText.test(text)) return false
  return true
}

/** 去掉 HTML 标签，但保留标签内的文字（文津宋体用 <span> 包字体名）。 */
const stripTags = (s) => s.replace(/<[^>]*>/g, "").trim()

/** RFN token 是否像一个真正的字体名。 */
function isNameLike(t) {
  if (!t || t.length > 40) return false
  if (/[;<>]/.test(t)) return false
  if (/[=]/.test(t)) return false                                    // HTML 属性残留
  if (/\bmay\b|\bshall\b|\bprovided\b|\bModified Versions\b/i.test(t)) return false
  if (/^(is|are|and|the|with)$/i.test(t)) return false
  return true
}

/**
 * 从 OFL 文本解析版权行与保留字体名。
 *
 * ── 六种真实 RFN 格式（全部由 --selftest 钉住）──
 *   ① 逗号分隔引号名   `'霞鹜', '霞鶩', '落霞孤鹜', '落霞孤鶩' and 'LXGW'`   （LXGW）
 *   ② 空格分隔引号名   `'ChillRoundF' 'ChillRoundM'`                        （ChillRound）
 *   ③ 裸词             `SuperHan`                                           （SuperHan）
 *   ④ <span> 包裹      `'<span lang="zh-Hans">文津宋体</span>'`             （文津宋体）
 *   ⑤ 尖括号           `<Smiley> and <得意黑>`                              （得意黑）
 *   ⑥ 跨行             `with Reserved Font\nName 'Source'`                  （思源黑体）
 *
 * ── 三个真实踩到的陷阱 ──
 * 1. **不能贪婪匹配到句末**。LXGW 的第二处 "Reserved Font Names" 是 ADDITIONAL PERMISSION
 *    段，到很远处才有句号；贪婪匹配会把半页正文当字体名（上一版实测抓出 6 个"名字"，
 *    其中一个 130 多字符）。改为非贪婪 + 在首个 `. ` 处截断。
 * 2. **版权行必须取 OFL 正文之前那一行**。ChillRound 的正文里有
 *    `"Font Software" refers to the set of files released by the Copyright`，
 *    在全文里搜第一个含 "Copyright" 的行会命中这句 OFL 样板文字。
 * 3. **OFL 样板里的 "Reserved Font Name" 定义不算声明**。每一份 OFL 正文都有
 *    `"Reserved Font Name" refers to any names specified as such after the copyright statement(s).`
 *    只在正文之前的版权区里找声明，才能正确区分「未声明」与「有声明」。
 */
export function parseOfl(text) {
  // ⑥ 空白归一化 —— 否则思源黑体跨行的 RFN 声明完全匹配不到
  const flat = text.replace(/\s+/g, " ")

  const bodyStart = flat.search(OFL_BODY_RE)
  const header = bodyStart > 0 ? flat.slice(0, bodyStart) : flat

  // 版权行：认 Copyright / © / (c)，在正文之前找
  let copyrightLine = header.match(/(?:Copyright|©|\(c\))[^.]{0,190}/i)?.[0]?.trim() ?? null
  if (!copyrightLine) {
    copyrightLine = flat.split(/(?<=\.)\s+/)
      .find((l) => /(?:Copyright|©|\(c\))/i.test(l) && !/refers to the set of files|SIL Open Font/i.test(l))
      ?.trim() ?? null
  }

  // RFN 声明：**只在正文之前的版权区**里找（陷阱 ③）
  const rfn = []
  let declared = false
  for (const m of header.matchAll(/Reserved Font Names?\s+(?:are\s+|is\s+)?(.{0,320}?)(?:\.\s|\.$|$)/gi)) {
    const seg = m[1].trim()
    if (!seg) continue
    declared = true

    // ⑤ 尖括号名（排除 HTML 属性）
    for (const q of seg.matchAll(/<([^<>]{1,60})>/g)) {
      const t = q[1].trim()
      if (!t.includes("=") && !t.startsWith("/") && isNameLike(t)) rfn.push(t)
    }
    // ④ 先去标签，再取引号名
    const noTags = seg.replace(/<[^>]*>/g, "")
    for (const q of noTags.matchAll(/['"“”‘’]([^'"“”‘’]{1,60})['"“”‘’]/g)) {
      const t = q[1].trim()
      if (isNameLike(t)) rfn.push(t)
    }
    // ③ 裸词 —— 仅当①②都没提到任何名字时才用，否则会把 and / is a trademark 当名字
    if (rfn.length === 0) {
      for (const piece of seg.split(/,\s*|\s+and\s+/)) {
        const t = piece.replace(/^['"“”‘’\s]+|['"“”‘’\s.]+$/g, "").trim()
        if (isNameLike(t)) rfn.push(t)
      }
    }
  }

  return {
    copyrightLine,
    reservedFontNames: [...new Set(rfn.map((s) => s.replace(/\.+$/, "").trim()).filter(Boolean))],
    hasOflBody: OFL_BODY_RE.test(flat),
    hasRfnDeclaration: declared,
  }
}

/* ─────────────────────────── 解析器自检 ─────────────────────────── */

/**
 * 自检用 8 段**真实**许可片段（不是人造的）。
 * 这是本脚本可信度的根：尺子不准，量出来的"可捆绑"就没有意义。
 */
const SELFTEST_CASES = [
  { label: "① LXGW 逗号分隔引号名 + ADDITIONAL PERMISSION 诱惑",
    text: `Copyright 2021-2026 LXGW (https://github.com/lxgw/LxgwWenKai), with Reserved Font Name '霞鹜', '霞鶩', '落霞孤鹜', '落霞孤鶩' and 'LXGW'. [ADDITIONAL PERMISSION] The Reserved Font Names '霞鹜', '霞鶩', '落霞孤鹜', '落霞孤鶩' and 'LXGW' may continue to be used in Modified Versions recompiled from the Original Version, without modifications to the font source code; or in Modified Versions subsetted or converted to other formats (e.g., WOFF/WOFF2) solely for web font delivery, provided such Modified Versions are not made available as installable desktop fonts (e.g., on mainstream platforms like Google Fonts, or third-party non-commercial platforms recognized by the author @lxgw; other web font platforms please contact the author @lxgw for confirmation).

SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
DEFINITIONS
"Reserved Font Name" refers to any names specified as such after the copyright statement(s).`,
    expectNames: ["霞鹜", "霞鶩", "落霞孤鹜", "落霞孤鶩", "LXGW"],
    expectCopyright: /LXGW/, expectOfl: true, expectDeclared: true },

  { label: "② ChillRound 空格分隔引号名 + `©` 版权行",
    text: `© 2023 ChillType, with Reserved Font Name 'ChillRoundF' 'ChillRoundM'.

This Font Software is licensed under the SIL Open Font License, Version 1.1.
SIL Open Font License v1.1
DEFINITIONS
"Font Software" refers to the set of files released by the Copyright holder(s) under this license.
"Reserved Font Name" refers to any names specified as such after the copyright statement(s).`,
    expectNames: ["ChillRoundF", "ChillRoundM"],
    expectCopyright: /ChillType/, expectOfl: true, expectDeclared: true },

  { label: "③ SuperHan 裸词名（无引号无尖括号）",
    text: `Copyright (c) 2024, Takushun Wu (takushun-wu@outlook.com),
with Reserved Font Name SuperHan.

SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
"Reserved Font Name" refers to any names specified as such after the copyright statement(s).`,
    expectNames: ["SuperHan"], expectCopyright: /Takushun Wu/, expectOfl: true, expectDeclared: true },

  { label: "④ 文津宋体 <span> 包裹多语言名（含 HTML 属性诱惑）",
    text: `Copyright (c) 2024-2026, Takushun Wu (https://github.com/takushun-wu/),
with Reserved Font Name 'WenJin Mincho', '<span lang="zh-Hans">文津宋体</span>', '<span lang="zh-Hant">文津宋體</span>', '<span lang="ja">文津明朝</span>', '<span lang="ko">문진(文津) 명조</span>'.

SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
"Reserved Font Name" refers to any names specified as such after the copyright statement(s).`,
    expectNames: ["WenJin Mincho", "文津宋体", "文津宋體", "文津明朝", "문진(文津) 명조"],
    expectCopyright: /Takushun Wu/, expectOfl: true, expectDeclared: true },

  { label: "⑤ 得意黑 尖括号名",
    text: `Copyright (c) 2022--2024, atelierAnchor <https://atelier-anchor.com>,
with Reserved Font Name <Smiley> and <得意黑>.

SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
"Reserved Font Name" refers to any names specified as such after the copyright statement(s).`,
    expectNames: ["Smiley", "得意黑"], expectCopyright: /atelierAnchor/, expectOfl: true, expectDeclared: true },

  { label: "⑥ 思源黑体 跨行 RFN 声明",
    text: `Copyright 2014-2025 Adobe (http://www.adobe.com/), with Reserved Font
Name 'Source'. Source is a trademark of Adobe in the United States
and/or other countries.

SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
"Reserved Font Name" refers to any names specified as such after the copyright statement(s).`,
    expectNames: ["Source"], expectCopyright: /Adobe/, expectOfl: true, expectDeclared: true },

  { label: "⑦ Sarasa 非标准 OFL 标题 `v1.1`（无 Version 字样）",
    text: `Copyright (c) 2015-2025, Renzhi Li (aka. Belleve Invis, belleve@typeof.net).
Portions Copyright (c) 2014-2021 Adobe Systems Incorporated (http://www.adobe.com/), with Reserved Font Name 'Source'.

This Font Software is licensed under the SIL Open Font License, Version 1.1.
SIL Open Font License v1.1
PREAMBLE
PERMISSION & CONDITIONS`,
    expectNames: ["Source"], expectCopyright: /Renzhi Li/, expectOfl: true, expectDeclared: true },

  { label: "⑧ 未声明 RFN 的字体（陷阱③：样板定义不得当声明）",
    text: `Copyright (c) 2023, Zhejiang JadeFoci Techonology Co. LTD
(https://www.jadefoci.com/)

-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------
DEFINITIONS
"Reserved Font Name" refers to any names specified as such after the copyright statement(s).`,
    expectNames: [], expectCopyright: /JadeFoci/, expectOfl: true, expectDeclared: false },
]

function selftest() {
  const fails = []
  console.log("══ 解析器自检（8 段真实许可片段）══")
  for (const c of SELFTEST_CASES) {
    const p = parseOfl(c.text)
    const errs = []
    const got = [...p.reservedFontNames].sort().join("|")
    const want = [...c.expectNames].sort().join("|")
    if (got !== want) errs.push(`RFN 期望 [${want}] 实得 [${got}]`)
    if (!c.expectCopyright.test(p.copyrightLine ?? "")) errs.push(`版权行期望匹配 ${c.expectCopyright}，实得 "${(p.copyrightLine ?? "(空)").slice(0, 60)}"`)
    if (p.hasOflBody !== c.expectOfl) errs.push(`OFL 正文识别期望 ${c.expectOfl} 实得 ${p.hasOflBody}`)
    if (p.hasRfnDeclaration !== c.expectDeclared) errs.push(`RFN 声明判定期望 ${c.expectDeclared} 实得 ${p.hasRfnDeclaration}`)
    if (errs.length) {
      console.log(`  ✗ ${c.label}`)
      for (const e of errs) console.log(`        ${e}`)
      fails.push(c.label)
    } else {
      console.log(`  ✓ ${c.label}  →  [${got || "未声明"}]`)
    }
  }
  /*
   * 内容闸门自检 —— 这一节防的是「HTTP 200 但不是许可」这一类假证据。
   * 用**真实抓到的**语雀验证码墙片段做反例（长度取自实测 45272 字节）。
   */
  console.log("\n══ 内容闸门自检（防「200 但不是许可」）══")
  const captchaWall = `<html><head><title>语雀</title></head><body><script>window.__INITIAL_STATE__={"captchaAppKey":"FFFF000000000179A3AD","captchaConfig":{"enabled":true,"renderMode":"embed","version":"1.0"},"publicFrameProtectionEnabled":true,"publicReadonlyEmbed":false}` + "0".repeat(40000) + `</script></body></html>`
  const gate = [
    { label: "语雀验证码墙必须被拒绝", got: looksLikeLicense(captchaWall), want: false },
    { label: "语雀验证码墙 + requireText 也必须被拒绝", got: looksLikeLicense(captchaWall, /下载、安装和使用/i), want: false },
    { label: "真 OFL 文本必须通过", got: looksLikeLicense(SELFTEST_CASES[0].text), want: true },
    { label: "普惠体真证据必须通过", got: looksLikeLicense("阿里巴巴普惠体许可：您可以下载、安装和使用本字体。".repeat(20), /下载、安装和使用/i), want: true },
    { label: "普惠体证据缺授权动词时必须被拒绝", got: looksLikeLicense("阿里巴巴普惠体相关页面内容。".repeat(30), /下载、安装和使用/i), want: false },
    { label: "过短内容必须被拒绝", got: looksLikeLicense("MIT"), want: false },
  ]
  for (const g of gate) {
    if (g.got === g.want) console.log(`  ✓ ${g.label}`)
    else { console.log(`  ✗ ${g.label}（期望 ${g.want} 实得 ${g.got}）`); fails.push(g.label) }
  }

  if (fails.length) {
    console.log(`\n  ✗ 自检失败 ${fails.length}/${SELFTEST_CASES.length} —— 解析器不可信，其「可捆绑」结论无效`)
    process.exit(2)
  }
  console.log(`\n  ✓ ${SELFTEST_CASES.length}/${SELFTEST_CASES.length} 全部通过 —— 解析器可用于判定`)
  process.exit(0)
}

/* ─────────────────────────── 主流程 ─────────────────────────── */

function main() {
  const results = []
  let unreachable = 0

  for (const c of CANDIDATES) {
    const rec = { id: c.id, name: c.name, kind: c.kind, note: c.note ?? null, trapNote: c.trapNote ?? null }
    let text = null

    if (c.licenseUrl) {
      const r = fetchText(c.licenseUrl)
      rec.httpStatus = r.status
      if (r.status === 200 && !r.binary && looksLikeLicense(r.body, c.requireText)) {
        text = r.body
        rec.licenseTextSource = "在线抓取"
      } else if (r.status === 200 && !r.binary) {
        // 200 但不是许可文本（验证码墙 / SPA 外壳）—— 必须回落，否则"判定依据"是乱码
        rec.licenseTextSource = `在线内容不是许可文本（${r.body.length} 字节，疑似验证码墙/SPA 外壳）→ 离线证据`
        rec.rejectedOnlineContent = r.body.slice(0, 120).replace(/\s+/g, " ")
      } else if (r.binary) {
        rec.licenseTextSource = `二进制（${r.body.slice(0, 8)}…）→ 离线证据`
      }
    }
    if (!text && c.cachedEvidence) {
      const p = join(EVIDENCE, c.cachedEvidence)
      if (existsSync(p)) {
        const cached = readFileSync(p, "utf8")
        if (looksLikeLicense(cached, c.requireText)) {
          text = cached
          rec.licenseTextSource = `离线证据 ${c.cachedEvidence}`
        } else {
          rec.cachedEvidenceRejected = `离线证据 ${c.cachedEvidence} 也不像许可文本，已拒绝`
        }
      }
    }
    if (!text) {
      rec.verdict = "UNVERIFIED"
      rec.reason = `许可原文不可得（HTTP ${rec.httpStatus ?? "n/a"}，且无离线证据）—— 按不可捆绑处理`
      unreachable++
      results.push(rec)
      continue
    }
    rec.licenseSha256 = sha256(text)

    // 陷阱检查：仓库根 LICENSE 与字体许可是否不同源
    if (c.repoLicenseUrl) {
      const rr = fetchText(c.repoLicenseUrl)
      if (rr.status === 200 && !rr.binary && rr.body.length > 100) {
        rec.repoRootLicense =
          /GNU GENERAL PUBLIC LICENSE/i.test(rr.body) ? "GPL-3.0"
          : OFL_BODY_RE.test(rr.body) ? "OFL-1.1"
          : /MIT License|Permission is hereby granted, free of charge/i.test(rr.body) ? "MIT"
          : "其他"
        rec.trapConfirmed = Boolean(c.trapNote)
      }
    }

    if (c.kind === "ofl") {
      const p = parseOfl(text)
      rec.copyrightLine = p.copyrightLine
      rec.reservedFontNames = p.reservedFontNames
      if (p.hasOflBody) {
        rec.verdict = "BUNDLEABLE"
        rec.reason = "SIL OFL 1.1 全文已核实"
          + (p.hasRfnDeclaration && p.reservedFontNames.length
            ? `；**声明保留字体名** [${p.reservedFontNames.join(", ")}] → 子集化/改名必须去掉这些名字`
            : "；**未声明保留字体名** → 改名义务较宽松（仍须随附 OFL 全文与版权声明）")
      } else {
        rec.verdict = "UNVERIFIED"
        rec.reason = "未找到 SIL OFL 1.1 全文，不能按 OFL 处理"
        unreachable++
      }
    } else {
      const kws = ["bundle", "redistribut", "embed", "再分发", "进一步分发", "分发", "嵌入", "捆绑", "转让", "转授权", "install and use", "下载、安装和使用", "prominent notice", "modifications"]
      const hits = []
      for (const kw of kws) {
        for (const m of text.matchAll(new RegExp(`.{0,150}${kw}.{0,200}`, "gi"))) {
          hits.push({ keyword: kw, text: m[0].replace(/\s+/g, " ").trim() })
        }
      }
      rec.redistributionClauses = hits.slice(0, 14)
      rec.verdict = c.verdict === "NO" ? "NO" : c.verdict === "YES" ? "BUNDLEABLE" : "MANUAL"
      rec.reason = c.verdict
        ? `已人工逐字判定：${c.verdict === "NO" ? "不可捆绑" : "可捆绑"}（依据见 note，原文见 redistributionClauses）`
        : "专有许可，需人工逐字判定"
    }

    results.push(rec)
  }

  /* ─────────── 输出 ─────────── */
  const by = (v) => results.filter((r) => r.verdict === v)
  console.log("\n══ 字体捆绑许可核验 ══")
  console.log(`候选 ${results.length} 款：可捆绑 ${by("BUNDLEABLE").length} / 明确不可捆绑 ${by("NO").length} / 需人工判定 ${by("MANUAL").length} / 未能核实 ${by("UNVERIFIED").length}\n`)

  for (const r of results) {
    const mark = { BUNDLEABLE: "✓", MANUAL: "?", NO: "✗", UNVERIFIED: "!" }[r.verdict] ?? "?"
    console.log(`  ${mark} [${r.verdict}] ${r.name}`)
    if (r.copyrightLine) console.log(`      版权行: ${r.copyrightLine.slice(0, 150)}`)
    if (r.reservedFontNames?.length) console.log(`      保留字体名: ${r.reservedFontNames.join(" | ")}`)
    if (r.repoRootLicense) console.log(`      仓库根 LICENSE: ${r.repoRootLicense}${r.trapConfirmed ? "  ⚠️ 与字体许可不同源（陷阱已确认）" : ""}`)
    console.log(`      依据: ${r.reason}`)
    if (r.licenseSha256) console.log(`      原文 SHA-256: ${r.licenseSha256.slice(0, 32)}…  (${r.licenseTextSource})`)
    if (r.note) console.log(`      备注: ${r.note.slice(0, 700)}`)
    if (r.trapNote) console.log(`      ⚠️ 陷阱: ${r.trapNote.slice(0, 400)}`)
    console.log("")
  }

  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify({ verifiedAt: new Date().toISOString(), results }, null, 2), "utf8")
    console.log(`  证据已写入: ${JSON_OUT}`)
  }

  if (unreachable === results.length) {
    console.log("✗ 全部候选都不可得 —— 网络不可用，本次结果无效")
    process.exit(2)
  }
  console.log(`  结论：可捆绑 ${by("BUNDLEABLE").length} 款；明确不可捆绑 ${by("NO").length} 款；` +
    `${by("MANUAL").length} 款需人工判定；${by("UNVERIFIED").length} 款未能核实（一律按不可捆绑处理）`)
  process.exit(unreachable > 0 ? 1 : 0)
}

if (AS_SELFTEST) selftest()
else main()
