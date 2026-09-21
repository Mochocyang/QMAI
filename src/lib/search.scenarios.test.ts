/**
 * Scenario-driven tests for searchWiki.
 *
 * Each scenario materializes a wiki dir + a query string, then asserts
 * the ranked result list from searchWiki.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest"
import path from "node:path"
import fs from "node:fs/promises"
import { realFs, createTempProject } from "@/test-helpers/fs-temp"
import { materializeScenario, copyDir } from "@/test-helpers/scenarios/materialize"
import { searchScenarios } from "@/test-helpers/scenarios/search-scenarios"
import type { SearchScenario } from "@/test-helpers/scenarios/types"

vi.mock("@/commands/fs", () => realFs)

import { searchWiki } from "./search"
import { useWikiStore } from "@/stores/wiki-store"

const FIXTURES_ROOT = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "scenarios-search",
)

beforeAll(async () => {
  await fs.rm(FIXTURES_ROOT, { recursive: true, force: true })
  await fs.mkdir(FIXTURES_ROOT, { recursive: true })
  for (const s of searchScenarios) {
    await materializeScenario(s, FIXTURES_ROOT)
  }
})

beforeEach(() => {
  // Disable embedding/vector search — we only want to exercise the
  // BM25-style text search path.
  useWikiStore.getState().setEmbeddingConfig({
    enabled: false,
    endpoint: "",
    apiKey: "",
    model: "",
  })
})

interface Ctx {
  tmp: { path: string; cleanup: () => Promise<void> }
}
let ctx: Ctx | undefined

async function setup(scenario: SearchScenario): Promise<Ctx> {
  const tmp = await createTempProject(
    `search-${scenario.name.replace(/\//g, "-")}`,
  )
  const initialWikiDir = path.join(FIXTURES_ROOT, scenario.name, "initial-wiki")
  await copyDir(initialWikiDir, tmp.path)
  return { tmp }
}

afterEach(async () => {
  if (ctx) {
    await ctx.tmp.cleanup()
    ctx = undefined
  }
})

describe("search scenarios (fixture-driven)", () => {
  it.each(searchScenarios.map((s) => [s.name, s]))(
    "%s",
    async (_name, scenario) => {
      ctx = await setup(scenario)

      const results = await searchWiki(ctx.tmp.path, scenario.query)

      // Helper: does a scenario-relative path (e.g. "wiki/attention.md")
      // match any result in the list?
      function resultFor(relPath: string) {
        // Results have absolute paths; compare by suffix-ending-in-relPath
        return results.find((r) =>
          r.path.endsWith("/" + relPath) || r.path.endsWith(relPath),
        )
      }

      try {
        // 1. Top results in the expected order
        for (let i = 0; i < scenario.expected.topResultPaths.length; i++) {
          const expectedPath = scenario.expected.topResultPaths[i]
          const actual = results[i]
          expect(
            actual,
            `result #${i} missing (expected ${expectedPath}); got ${results.length} results`,
          ).toBeTruthy()
          expect(
            actual.path.endsWith("/" + expectedPath) ||
              actual.path.endsWith(expectedPath),
            `result #${i} path mismatch — expected ending with ${expectedPath}, got ${actual.path}`,
          ).toBe(true)
        }

        // 2. Excluded paths
        if (scenario.expected.excludedPaths) {
          for (const excluded of scenario.expected.excludedPaths) {
            expect(
              resultFor(excluded),
              `excluded path found in results: ${excluded}`,
            ).toBeFalsy()
          }
        }

        // 3. Paths that must have titleMatch=true
        if (scenario.expected.titleMatchPaths) {
          for (const p of scenario.expected.titleMatchPaths) {
            const r = resultFor(p)
            expect(r, `title-match page ${p} missing from results`).toBeTruthy()
            expect(r!.titleMatch, `${p} should have titleMatch=true`).toBe(true)
          }
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          `\n[search: ${scenario.name}] query="${scenario.query}" — actual results:\n` +
            JSON.stringify(
              results.map((r) => ({
                path: r.path,
                titleMatch: r.titleMatch,
                score: r.score,
              })),
              null,
              2,
            ),
        )
        throw err
      }
    },
  )
})
