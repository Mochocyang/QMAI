import { readFileSync } from "node:fs"

for (const p of [
  "src/lib/changelog.ts",
  "docs/release-4.1.1-20261007/changelog-entry-4.1.1.txt",
]) {
  const text = readFileSync(p, "utf8")
  const crlf = (text.match(/\r\n/g) || []).length
  const loneLf = (text.match(/(?<!\r)\n/g) || []).length
  console.log(`${p}\n  CRLF: ${crlf}   裸LF: ${loneLf}`)
}
