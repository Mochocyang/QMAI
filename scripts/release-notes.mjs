import { readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import ts from "typescript"

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

function optionalIconvLite() {
  try {
    return require("iconv-lite")
  } catch {
    return null
  }
}

function repairLikelyMojibake(text) {
  if (!/[锛銆涓绔榛勯噾瀹]/.test(text)) return text

  const iconv = optionalIconvLite()
  if (!iconv) return text

  try {
    const repaired = iconv.decode(iconv.encode(text, "gbk"), "utf8")
    return repaired.includes("�") ? text : repaired
  } catch {
    return text
  }
}

async function loadChangelog(rootDir = root) {
  const source = readFileSync(resolve(rootDir, "src/lib/changelog.ts"), "utf8")
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
  return import(moduleUrl)
}

export function formatReleaseNotes(entry) {
  const zhItems = entry?.highlights?.zh ?? []
  if (!entry || zhItems.length === 0) return ""

  return zhItems
    .map((item, index) => `${index + 1}. ${repairLikelyMojibake(item)}`)
    .join("\n")
}

export async function buildReleaseNotes(version, rootDir = root) {
  const changelog = await loadChangelog(rootDir)
  const entry = changelog.currentVersionChangelog(version)[0]
  const notes = formatReleaseNotes(entry)

  return notes || `QMAI ${version} 发布版本`
}

export async function buildCurrentReleaseNotes(rootDir = root) {
  const pkg = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8"))
  return buildReleaseNotes(pkg.version, rootDir)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const outIndex = args.indexOf("--out")
  const outPath = outIndex >= 0 ? args[outIndex + 1] : ""
  const version = args.find((arg, index) => index !== outIndex && index !== outIndex + 1)
  const notes = version ? await buildReleaseNotes(version) : await buildCurrentReleaseNotes()
  if (outPath) {
    writeFileSync(outPath, notes, "utf8")
  } else {
    process.stdout.write(notes)
  }
}
