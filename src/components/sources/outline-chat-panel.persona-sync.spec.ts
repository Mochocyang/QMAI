// 大纲保存 → 人物小传同步的接线约束。
//
// 这里只做源码断言，不挂载整个 OutlineChatPanel：那个组件依赖 AgentRunner、
// outline store、模型解析等一大串运行时，单为验证「在哪儿调、怎么调」去全量挂载
// 成本远大于收益，而真正会出错的恰恰是这几条结构性约束：
// 1. 必须挂在「保存成功之后」的分支里 —— 不保存就不抓（用户拍板口径）。
// 2. 必须不 await —— 同步不阻塞保存返回。
// 3. 必须走永不抛包装 —— 否则失败会伪装成「保存失败」。
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "outline-chat-panel.tsx"), "utf8")

describe("保存后同步人物小传", () => {
  it("同步调用落在 saveResult.saved.length > 0 分支内", () => {
    const branchAt = source.indexOf("if (saveResult.saved.length > 0)")
    const callAt = source.indexOf("syncPersonaFromOutlineSave({")
    const drainAt = source.indexOf("drainNextSaveBatch();", branchAt)
    expect(branchAt).toBeGreaterThan(-1)
    expect(callAt).toBeGreaterThan(branchAt)
    // 同步排在「排空保存队列」之后：先把这批文件都落盘，
    // 再去抓角色，否则会抓到只保存了一半的大纲。
    expect(drainAt).toBeGreaterThan(branchAt)
    expect(callAt).toBeGreaterThan(drainAt)
  })

  it("不 await：同步不得阻塞保存返回", () => {
    expect(source).toContain("void runPersonaSyncSafely(")
    expect(source).not.toContain("await syncPersonaFromOutlineSave(")
    expect(source).not.toContain("await runPersonaSyncSafely(")
  })

  it("走永不抛包装，并把大纲文件名与本次请求一起传进去", () => {
    expect(source).toContain('"保存后同步人物小传"')
    expect(source).toContain("outlineFileName: savedOutlineFileName")
    expect(source).toContain("requests,")
  })

  it("同步只接在保存路径上，不接在生成或提取路径上", () => {
    // 全文件只应有一处调用：多一处就意味着「不保存也会抓」
    const occurrences = source.split("syncPersonaFromOutlineSave({").length - 1
    expect(occurrences).toBe(1)
  })
})
