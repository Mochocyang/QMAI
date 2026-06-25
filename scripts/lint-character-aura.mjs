import { readdirSync, readFileSync, existsSync, statSync } from "fs"
import { resolve, join } from "path"
import process from "process"

const ROOT = process.argv[2] || process.cwd()
const NVWA = resolve(ROOT, "skills", "soulskill")
const CHARACTER_AURA_PATH = resolve(ROOT, "src", "lib", "novel", "character-aura.ts")

const CURLY_LEFT = "\u201C"
const CURLY_RIGHT = "\u201D"

const ENGLISH_BASED_SLUGS = new Set([
  "elon-musk", "feynman", "munger", "charlie-munger",
  "naval", "steve-jobs", "taleb", "trump",
  "paul-graham", "andrei-kapasi", "ilya-sutskaver",
  "mr-beast", "sun-yuchen",
])

let errors = 0

function report(file, message) {
  console.error(`  ${file}  ${message}`)
  errors++
}

function checkCurlyQuotes(content, file) {
  const lines = content.split("\n")
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(CURLY_LEFT) || lines[i].includes(CURLY_RIGHT)) {
      report(file, `第${i + 1}行 包含中文弯引号 ""（oxc 不兼容），请替换为 「」`)
    }
  }
}

function stripFrontmatter(content) {
  const start = content.indexOf("---")
  if (start !== 0) return content
  const end = content.indexOf("---", start + 3)
  if (end === -1) return content
  return content.slice(end + 3)
}

function isEnglishBased(folderName) {
  return ENGLISH_BASED_SLUGS.has(folderName)
}

function walk(dir, cb, depth = 0) {
  if (!existsSync(dir)) return
  const entries = readdirSync(dir)
  for (const entry of entries) {
    if (entry.startsWith(".")) continue
    const full = join(dir, entry)
    const stat = statSync(full)

    if (stat.isDirectory()) {
      if (entry.startsWith("x-") || entry.startsWith("SKILL")) continue
      if (depth === 0 && isEnglishBased(entry)) continue
      walk(full, cb, depth + 1)
    } else if (entry.endsWith(".md")) {
      if (depth >= 1 && isEnglishBased(full.split("\\").slice(-3, -2)[0] || "")) continue
      cb(full)
    }
  }
}

console.log("=== 角色灵魂内容校验 ===")
console.log()

console.log("--- character-aura.ts 弯引号 + 字段英文检查 ---")
const auraContent = readFileSync(CHARACTER_AURA_PATH, "utf8")
checkCurlyQuotes(auraContent, "src/lib/novel/character-aura.ts")

const createBuiltInCalls = auraContent.match(/createBuiltInAura\([\s\S]*?\)\s*,?\s*$/gm) || []
for (const call of createBuiltInCalls) {
  const stringArgs = call.match(/"([^"]*)"/g) || []
  if (stringArgs.length < 8) continue
  const fields = {
    name: stringArgs[2].replace(/"/g, ""),
    corpus: stringArgs[3].replace(/"/g, ""),
    expressionDna: stringArgs[4].replace(/"/g, ""),
    mentalModel: stringArgs[5].replace(/"/g, ""),
    decisionHeuristics: stringArgs[6].replace(/"/g, ""),
    valueAntiPatterns: stringArgs[7].replace(/"/g, ""),
  }

  for (const [fieldName, value] of Object.entries(fields)) {
    if (/[A-Za-z]/.test(value)) {
      report("src/lib/novel/character-aura.ts", `角色 ${fields.name} 字段 ${fieldName} 包含英文: ${value.slice(0, 60)}`)
    }
    if (value.includes(CURLY_LEFT) || value.includes(CURLY_RIGHT)) {
      report("src/lib/novel/character-aura.ts", `角色 ${fields.name} 字段 ${fieldName} 包含弯引号`)
    }
  }
}

console.log()
console.log("--- 中文角色 SKILL.md 弯引号检查 ---")
walk(NVWA, (file) => {
  if (!file.endsWith("SKILL.md")) return
  const content = readFileSync(file, "utf8")
  const relPath = file.replace(ROOT, "").replace(/^[\\/]/, "")
  checkCurlyQuotes(stripFrontmatter(content), relPath)
})

console.log()
console.log("--- 中文角色研究文件弯引号检查 ---")
walk(NVWA, (file) => {
  if (!file.includes("research") || !file.endsWith(".md")) return
  const content = readFileSync(file, "utf8")
  const relPath = file.replace(ROOT, "").replace(/^[\\/]/, "")
  checkCurlyQuotes(content, relPath)
})

console.log()
if (errors === 0) {
  console.log("✓ 全部通过！没有发现英文或弯引号问题。")
  process.exit(0)
} else {
  console.log(`✗ 发现 ${errors} 个问题，请修复后重新运行。`)
  process.exit(1)
}