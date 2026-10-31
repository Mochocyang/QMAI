import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * 「档案里取消绿勾，左栏对号不消失」的回归守卫。
 *
 * 根因：左栏（PersonaTreeSection）与档案页（PersonaSkillView）是**两份独立的
 * 数据副本**，各自 reload。在档案里改索引只重读了档案那份，左栏还拿着旧快照，
 * 于是两端显示不一致。
 *
 * 修法：store 里加 `personaDataVersion`，任何改索引/候选池的操作都 +1，
 * 左栏的 reload 依赖它。这里用源码守卫把这条链路钉死 —— 少任何一环都会红。
 */
describe("人物数据变更必须在左右两端同步", () => {
  const store = readFileSync(resolve(process.cwd(), "src/stores/wiki-store.ts"), "utf8")
  const tree = readFileSync(
    resolve(process.cwd(), "src/components/layout/persona-tree-section.tsx"),
    "utf8",
  )
  const view = readFileSync(
    resolve(process.cwd(), "src/components/skill-library/persona-skill-view.tsx"),
    "utf8",
  )

  it("store 提供版本号与 bump 函数", () => {
    expect(store).toContain("personaDataVersion: number")
    expect(store).toMatch(/bumpPersonaDataVersion:\s*\(\)\s*=>/)
  })

  it("左栏的 reload 依赖版本号", () => {
    expect(tree).toContain("personaDataVersion")
    expect(tree).toMatch(/\},\s*\[reload,\s*refreshKey,\s*personaDataVersion\]\)/)
  })

  it("左栏自己的写操作会 bump", () => {
    expect(tree).toContain("bumpPersonaDataVersion()")
    // 标记重要 / 建档 / 删除 都要通知
    for (const fn of ["handleToggleImportant", "handlePromote", "handleDeleteCandidate", "handleDeletePersona"]) {
      expect(tree, fn).toContain(`async function ${fn}`)
    }
  })

  it("档案页的写操作也会 bump（这才是用户报的那条路径）", () => {
    expect(view).toContain("bumpPersonaDataVersion")
    const pinHandler = view.slice(
      view.indexOf("async function handleToggleImportant"),
      view.indexOf("async function handleToggleImportant") + 1200,
    )
    expect(pinHandler).toContain("bumpPersonaDataVersion()")
  })

  it("退回候选：bump 版本号，并切到候选预览（不落到旧列表页）", () => {
    const demote = view.slice(
      view.indexOf("async function handleDemote"),
      view.indexOf("async function handleDemote") + 1800,
    )
    expect(demote).toContain("bumpPersonaDataVersion()")
    expect(demote).toContain('mode: "candidate"')
  })

  it("面板的早返回顺序：新建 → 候选预览 → 角色档案 → 空态 → 列表", () => {
    /*
     * 这里盯的是**顺序**，不是存在性。
     * 曾经把「面板空态」的早返回插到了「候选预览」块的里面，
     * 于是点候选永远只看到空白、档案也打不开 —— 只有顺序断言能拦住这类回归。
     */
    const at = (needle: string) => {
      const index = view.indexOf(needle)
      expect(index, needle).toBeGreaterThan(-1)
      return index
    }
    const creating = at("if (creating) {")
    const candidate = at("if (candidateFocus) {")
    const selectedAt = at("if (selected) {")
    const empty = at("if (paneMode) {")

    expect(creating).toBeLessThan(candidate)
    expect(candidate).toBeLessThan(selectedAt)
    expect(selectedAt).toBeLessThan(empty)
  })

  it("候选预览块里不再嵌着面板空态（这正是上次的 bug）", () => {
    const start = view.indexOf("if (candidateFocus) {")
    const end = view.indexOf("if (selected) {", start)
    const block = view.slice(start, end)
    expect(block).not.toContain("if (paneMode)")
  })

  it("面板模式下不渲染旧的整页列表，只给空态", () => {
    // 人物搬回大纲后，左栏已经承担列表职责；面板里再铺一套列表就是重复信息。
    expect(view).toContain("if (paneMode)")
    expect(view).toContain("persona-pane-empty")
  })

  it("建档成功后离开预览卡、直接打开新档案", () => {
    expect(view).toContain("setCandidateFocus(null)")
    const promoteHandler = view.slice(
      view.indexOf("async function handlePromote"),
      view.indexOf("async function handlePromote") + 1600,
    )
    expect(promoteHandler).toContain("setSelectedId(created.id)")
  })
})
