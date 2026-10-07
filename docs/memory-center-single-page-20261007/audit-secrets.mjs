/**
 * 推送到 GitHub 之前的敏感信息排查。
 *
 * 为什么必须做：这个仓库要上传到公开的 GitHub。
 * 之前排查配置时已经确认 %APPDATA%\com.qingmuai.writer\app-state.json
 * 内含凭据 —— 这类文件一旦进了历史，删文件是删不掉的（历史里还在），
 * 只能改写历史，代价极大。所以宁可在推送前多查一遍。
 *
 * 三层检查：
 *   1) 当前被跟踪的文件名里有没有典型的凭据文件名；
 *   2) 当前工作树全部被跟踪文件的内容里有没有密钥/令牌特征串；
 *   3) 待推送范围的**历史新增行**里有没有（当前已删除但历史留存的情况）。
 *
 * 用法: node docs/memory-center-single-page-20261007/audit-secrets.mjs
 */
import { execFileSync } from "node:child_process"

const repo = process.cwd()
const git = (args, opts = {}) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, ...opts })

const failures = []
const notes = []
const check = (ok, label, detail = "") => {
  if (ok) notes.push(`  OK   ${label}${detail ? `  — ${detail}` : ""}`)
  else failures.push(`  FAIL ${label}${detail ? `  — ${detail}` : ""}`)
}

// ---------- 1. 文件名 ----------
const tracked = git(["ls-files"]).split("\n").filter(Boolean)
const dangerousNames = [
  /(^|\/)\.env(\.|$)/i,
  /app-state\.json$/i,
  /(^|\/)credentials?(-|\.|$)/i,
  /\.(pem|key|p12|pfx|jks)$/i,
  /(^|\/)id_rsa/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.netrc$/i,
  /(^|\/)secrets?\.(json|ya?ml|toml)$/i,
  /tauri.*\.key$/i,
]
const badNames = tracked.filter((f) => dangerousNames.some((re) => re.test(f)))
check(badNames.length === 0, `被跟踪的 ${tracked.length} 个文件里没有典型凭据文件`,
  badNames.length ? badNames.join(", ") : "")
if (badNames.length) failures.push(`         ^ 这些文件必须先从跟踪中移除`)

// ---------- 2. 当前内容 ----------
/**
 * 高置信度的密钥特征。故意避开宽泛的 `password` 之类词，那些在 i18n 文案里到处都是。
 * 这里只放"几乎不可能是正常代码"的形态。
 */
const secretPatterns = [
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, name: "PEM 私钥块" },
  { re: /\bsk-[A-Za-z0-9_-]{20,}\b/, name: "OpenAI 风格密钥 sk-…" },
  { re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/, name: "Anthropic 密钥" },
  { re: /\bAIza[0-9A-Za-z_-]{30,}\b/, name: "Google API 密钥" },
  { re: /\bghp_[A-Za-z0-9]{30,}\b/, name: "GitHub PAT (ghp_)" },
  { re: /\bgithub_pat_[A-Za-z0-9_]{30,}\b/, name: "GitHub PAT (fine-grained)" },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, name: "Slack token" },
  { re: /\bAKIA[0-9A-Z]{16}\b/, name: "AWS Access Key ID" },
  { re: /\bya29\.[A-Za-z0-9_-]{20,}\b/, name: "Google OAuth token" },
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, name: "JWT" },
]

/**
 * 豁免名单：**必须逐条写明理由**，且只做精确子串匹配。
 *
 * 为什么不得不用它：正则永远会有误报，而"看到就失败"的扫描器会很快
 * 被当成噪音而整体忽略 —— 那比没有扫描器更糟。
 *
 * 两道防退化：
 *   1) 豁免项用精确串，不是正则，避免它慢慢变成一张大网；
 *   2) 每条豁免都要**在仓库里真的还能命中**，否则报 FAIL（见下面的 staleAllows）。
 *      没有这一条，豁免名单会随着代码演进而变成"永久免检"。
 */
const ALLOWLIST = [
  {
    value: "sk-must-not-be-persisted",
    why: "llm-request-trace.spec.ts 的哨兵值：该用例正是断言密钥不会被写入追踪日志，本身是假串",
  },
]

// ---------- 2. 当前内容 ----------
/*
 * 用 `git grep` 而不是逐个 `git show HEAD:<path>`：
 * 后者对非 ASCII 路径需要处理 Git 的 C 风格引号转义，第一版就是这么漏掉
 * 所有中文文件名（skills/soulskill/**、tests/fixtures/** 里的中文资料）——
 * 「扫了 2518 个文件」里其实有一批根本没读到，是**静默漏检**。
 * `git grep` 在对象库内部匹配，不受 shell 与路径转义影响。
 */
const combinedPattern = secretPatterns.map((p) => p.re.source).join("|")
let grepOutput = ""
try {
  grepOutput = git(["grep", "-I", "-n", "-E", "-e", combinedPattern, "HEAD", "--", "."])
} catch (err) {
  // git grep 无命中时退出码为 1，这是正常情况，不是错误
  if (err.status === 1 && !err.stdout) grepOutput = ""
  else grepOutput = err.stdout ?? ""
}

const rawHits = grepOutput.split("\n").filter(Boolean).map((line) => {
  // 格式：HEAD:path:lineno:content
  const match = line.match(/^HEAD:(.*?):(\d+):(.*)$/)
  if (!match) return { path: line, line: 0, content: line }
  return { path: match[1], line: Number(match[2]), content: match[3] }
})

const allowedHits = []
const realHits = []
for (const hit of rawHits) {
  const allow = ALLOWLIST.find((item) => hit.content.includes(item.value))
  if (allow) allowedHits.push({ ...hit, allow })
  else realHits.push(hit)
}

check(realHits.length === 0, `当前被跟踪内容里没有未豁免的密钥特征串（已扫 ${secretPatterns.length} 种特征）`,
  realHits.length ? realHits.slice(0, 5).map((h) => `${h.path}:${h.line}`).join(", ") : "")
if (realHits.length) {
  failures.push(`         ^ 必须处理，否则会随推送公开：`)
  for (const h of realHits.slice(0, 5)) failures.push(`           ${h.path}:${h.line}  ${h.content.trim().slice(0, 80)}`)
}

for (const hit of allowedHits) {
  notes.push(`  豁免 ${hit.path}:${hit.line} —— ${hit.allow.why}`)
}

/*
 * 豁免名单不能变成空头支票：每条都必须在仓库里真的还能命中。
 * 命中不到说明这条豁免已经过期，应当删掉，否则它只是在给未来的误报留后门。
 */
const staleAllows = ALLOWLIST.filter((item) => !rawHits.some((h) => h.content.includes(item.value)))
check(staleAllows.length === 0, "豁免名单没有过期项（每条都仍在仓库里命中）",
  staleAllows.length ? staleAllows.map((s) => s.value).join(", ") : `${ALLOWLIST.length} 条均有效`)
if (staleAllows.length) failures.push(`         ^ 过期豁免应删除，否则会变成永久免检`)

// ---------- 3. 待推送范围的历史新增行 ----------
/*
 * 当前内容干净 ≠ 历史干净：某个密钥可能在这一段历史里被加进去又删掉，
 * 文件没了但对象还在，clone 下来照样能看到。所以额外扫一遍新增行。
 */
let rangeAdded = ""
try {
  rangeAdded = git(["log", "-p", "--no-color", "--format=", "origin/main..HEAD"])
} catch (err) {
  rangeAdded = ""
  notes.push(`  ??   历史范围扫描跳过：${err.message.split("\n")[0]}`)
}

if (rangeAdded) {
  // 只看新增行，避免把"删除密钥"的那一行也算成命中
  const addedLines = rangeAdded.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++"))
  const hits = []
  for (const line of addedLines) {
    for (const { re, name } of secretPatterns) {
      if (re.test(line)) {
        hits.push(`${name}: ${line.slice(1, 90).trim()}`)
        break
      }
    }
  }
  check(hits.length === 0, `待推送范围 ${addedLines.length} 行新增内容里没有密钥特征串`,
    hits.length ? `\n         ${hits.slice(0, 5).join("\n         ")}` : "")
  if (hits.length) failures.push(`         ^ 历史里已存在，需改写历史才能彻底移除`)
}

// ---------- 4. 顺带确认不该上传的构建产物没被跟踪 ----------
const bigTracked = tracked.filter((f) => /^(dist|release-portable|src-tauri\/target)\//.test(f))
check(bigTracked.length === 0, "构建产物未被跟踪（dist / release-portable / src-tauri/target）",
  bigTracked.length ? `${bigTracked.length} 个，例如 ${bigTracked.slice(0, 3).join(", ")}` : "")

console.log(notes.join("\n"))
if (failures.length) {
  console.log("\n" + failures.join("\n"))
  console.log(`\n通过 ${notes.length}，问题 ${failures.length}`)
  process.exitCode = 1
} else {
  console.log(`\n全部通过：${notes.length} 项 —— 可以推送`)
}
