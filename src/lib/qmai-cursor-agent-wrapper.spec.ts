import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const require = createRequire(import.meta.url)
const wrapperPath = fileURLToPath(
  new URL("../../src-tauri/scripts/qmai-cursor-agent.cjs", import.meta.url),
)
const {
  cliModelToAcpValue,
  resolveAcpArgvModel,
  rewriteAcpArgs,
} = require(wrapperPath) as {
  cliModelToAcpValue: (model: string) => string
  resolveAcpArgvModel: (argvModel: string, pinned: string) => string
  rewriteAcpArgs: (args: string[], pinned: string) => string[]
}

describe("qmai-cursor-agent wrapper", () => {
  it("keeps the CLI catalog id on argv and ignores the shared pin", () => {
    expect(
      rewriteAcpArgs(
        ["acp", "--model", "cursor-grok-4.6-medium-fast"],
        "composer-2.5[fast=true]",
      ),
    ).toEqual(["acp", "--model", "cursor-grok-4.6-medium-fast"])
    expect(
      rewriteAcpArgs(["acp", "--model", "gemini-3.7-flash-high"], "cursor-grok-4.6-high-fast"),
    ).toEqual(["acp", "--model", "gemini-3.7-flash-high"])
  })

  it("reads a CLI pin only for default or missing --model", () => {
    expect(resolveAcpArgvModel("default", "cursor-grok-4.6-medium-fast")).toBe(
      "cursor-grok-4.6-medium-fast",
    )
    expect(resolveAcpArgvModel("auto", "gemini-3.7-flash[effort=high,fast=true]")).toBe("")
    expect(rewriteAcpArgs(["acp", "--model", "default"], "gemini-3.7-flash-high")).toEqual([
      "acp",
      "--model",
      "gemini-3.7-flash-high",
    ])
    expect(rewriteAcpArgs(["acp"], "composer-2.5-fast")).toEqual([
      "acp",
      "--model",
      "composer-2.5-fast",
    ])
  })

  it("does not use a parameterized ACP pin", () => {
    expect(cliModelToAcpValue("cursor-grok-4.6-medium-fast")).toBe(
      "grok-4.6[effort=medium,fast=true]",
    )
    expect(resolveAcpArgvModel("default", "gemini-3.7-flash[effort=high,fast=true]")).toBe("")
    expect(rewriteAcpArgs(["acp", "--model", "default"], "grok-4.6[effort=high,fast=true]")).toEqual([
      "acp",
      "--model",
      "default",
    ])
  })
})
