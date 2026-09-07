import { describe, expect, it } from "vitest"
import { normalizeGlobalUserMemoryConfig } from "@/lib/user-memory/store"
import type { LlmConfig } from "@/stores/wiki-store"
import { createAnalysisStageCache, type AnalysisStageCacheInput } from "./analysis-stage-cache"

function fixture() {
  const files = new Map<string, string>()
  let memory = normalizeGlobalUserMemoryConfig({ enabled: false })
  const cache = createAnalysisStageCache({
    io: {
      createDirectory: async () => {},
      fileExists: async (path) => files.has(path),
      readFile: async (path) => { if (!files.has(path)) throw new Error("不存在"); return files.get(path)! },
      writeFileAtomic: async (path, text) => { files.set(path, text) },
    },
    loadUserMemory: () => memory,
  })
  const input: AnalysisStageCacheInput = {
    bookPath: "C:/novel/book-analysis/book-1", projectPath: "C:/novel",
    llmConfig: { provider: "openai", model: "fixture-model", apiKey: "secret-key", maxOutputTokens: 4096 } as LlmConfig,
    stage: "verification-style", materials: { prompt: "完整验证材料" },
  }
  return { cache, input, files, setMemory: (value: typeof memory) => { memory = value } }
}

describe("拆书汇总与验证结果缓存", () => {
  it("同输入可读回，完整材料、阶段、模型或参数改变会失效，密钥轮换不失效", async () => {
    const { cache, input, files } = fixture()
    const key = await cache.createKey(input)
    expect(key).toMatch(/^[a-f0-9]{64}$/)
    await cache.write(input, key!, { verdict: "pass" })
    expect(await cache.read(input, key!)).toEqual({ verdict: "pass" })
    expect([...files.values()].join("")).not.toContain("secret-key")
    for (const changed of [
      { ...input, materials: { prompt: "完整验证材料改动" } },
      { ...input, stage: "aggregate-style" },
      { ...input, llmConfig: { ...input.llmConfig, model: "other-model" } },
      { ...input, llmConfig: { ...input.llmConfig, maxOutputTokens: 8192 } },
    ]) expect(await cache.createKey(changed)).not.toBe(key)
    expect(await cache.createKey({ ...input, llmConfig: { ...input.llmConfig, apiKey: "rotated-key" } })).toBe(key)
  })

  it("取消不写缓存，损坏条目不复用，不接受越界作品路径", async () => {
    const { cache, input, files } = fixture()
    const key = await cache.createKey(input)
    const controller = new AbortController()
    controller.abort()
    await cache.write(input, key!, { verdict: "pass" }, controller.signal)
    expect(files.size).toBe(0)
    await cache.write(input, key!, { verdict: "pass" })
    const [path, text] = [...files][0]
    files.set(path, text.replace("pass", "fail"))
    expect(await cache.read(input, key!)).toBeNull()
    expect(await cache.createKey({ ...input, bookPath: "C:/elsewhere/book" })).toBeNull()
    expect(await cache.createKey({ ...input, bookPath: "C:/novel/../other" })).toBeNull()
  })

  it("有效用户偏好改变会失效，稳定配置更新时间不影响键", async () => {
    const { cache, input, setMemory } = fixture()
    const key = await cache.createKey(input)
    setMemory(normalizeGlobalUserMemoryConfig({ enabled: false, updatedAt: 999 }))
    expect(await cache.createKey(input)).toBe(key)
    setMemory(normalizeGlobalUserMemoryConfig({ enabled: true, autoRead: true, rules: [{
      id: "manual-rule", rule: "验证必须给出具体原文证据", category: "writing", source: "manual",
      enabled: true, confidence: 1, updatedAt: 1, createdAt: 1,
    }] }))
    expect(await cache.createKey(input)).not.toBe(key)
  })
})
