import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8").replace(/\r\n/g, "\n")

describe("章节摄取里的人物 Skill 挂钩", () => {
  const ingest = read("./chapter-ingest.ts")

  it("摄取签名不变（chapter-ingest.spec.ts 有源码字符串断言）", () => {
    expect(ingest).toContain("export async function ingestChapter(")
    expect(ingest).toContain("options: IngestChapterOptions = {},")
  })

  it("挂钩用的是同一条提取模型解析结果", () => {
    expect(ingest).toContain('import { learnPersonaSkillsFromChapter } from "./persona-skill-learning"')
    expect(ingest).toContain("llmConfig: runtimeLlmConfig,")
  })

  it("后台异步：void 调用，绝不 await（不阻塞提取记忆按钮）", () => {
    expect(ingest).toContain("void learnPersonaSkillsFromChapter({")
    expect(ingest).not.toContain("await learnPersonaSkillsFromChapter(")
  })

  it("挂钩在 syncSnapshotToMemory 之后（人物状态已经同步完）", () => {
    expect(ingest.indexOf("void learnPersonaSkillsFromChapter(")).toBeGreaterThan(
      ingest.indexOf("const syncResult = await syncSnapshotToMemory("),
    )
  })

  it("挂钩只在 ingestChapter 里，不许跑到 ingestOutline 里", () => {
    // 本文件里 syncSnapshotToMemory 出现了两次：ingestChapter(:442) 与 ingestOutline(:1487)。
    // 上面那条断言用 indexOf 取的是第一处，所以钩子即使被放进 ingestOutline 也会通过 ——
    // 必须单独钉住函数边界。
    const hookAt = ingest.indexOf("void learnPersonaSkillsFromChapter(")
    const outlineAt = ingest.indexOf("export async function ingestOutline(")
    expect(outlineAt).toBeGreaterThan(-1)
    expect(hookAt).toBeGreaterThan(-1)
    expect(hookAt).toBeLessThan(outlineAt)
  })

  it("重新提取也要学习：挂钩不被 isReingest 短路（幂等性由 learning 自己保证）", () => {
    const hookAt = ingest.indexOf("void learnPersonaSkillsFromChapter(")
    expect(hookAt).toBeGreaterThan(-1)
    // 旧版这里是 `if (!isReingest) {`。短路会造成「某一轮没建出档案 → 永久放弃修复」，
    // 因为用户唯一的补救动作（重新提取）正好被跳过。幂等性改由
    // planPersonaSkillRound 的 lastLearnedChapter 守卫与候选池 chapters[] 去重承担。
    const guardAt = ingest.lastIndexOf("if (!isReingest) {", hookAt)
    expect(guardAt).toBe(-1)
  })

  it("保存正式章节那条路完全不掺和（草稿隔离）", () => {
    const previewPanel = read("../../components/layout/preview-panel.tsx")
    expect(previewPanel).not.toContain("persona-skill")
    expect(previewPanel).not.toContain("learnPersonaSkillsFromChapter")
  })

  it("整章人物一次性传入（不是循环里一人调一次）", () => {
    const hookAt = ingest.indexOf("void learnPersonaSkillsFromChapter(")
    const block = ingest.slice(hookAt, ingest.indexOf("})", hookAt))
    expect(block).toContain("characters: snapshot.characters,")
    expect(block).toContain("characterAliases: snapshot.characterAliases,")
  })
})
