/**
 * Vitest setup file: loads `.env.test.local` into process.env before
 * any test module imports. Registered via `test.setupFiles` in
 * vite.config.ts.
 *
 * This intentionally avoids a dotenv dependency. Supported syntax is
 * KEY=value lines, optional surrounding quotes, and # comments.
 */
import fs from "node:fs"
import path from "node:path"

const envPath = path.resolve(process.cwd(), ".env.test.local")

if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf-8")
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith("#")) continue

    const eqIdx = line.indexOf("=")
    if (eqIdx < 0) continue

    const key = line.slice(0, eqIdx).trim()
    const rawValue = line.slice(eqIdx + 1).trim()
    const value =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue

    if (!(key in process.env)) process.env[key] = value
  }
}
