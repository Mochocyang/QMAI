import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("plot framework library layout", () => {
  it("keeps the framework list as an internal scroll region", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/novel/plot-framework-library-view.tsx"),
      "utf8",
    )

    expect(source).toContain('className="min-h-0 flex-1 overflow-y-auto p-4"')
  })
})
