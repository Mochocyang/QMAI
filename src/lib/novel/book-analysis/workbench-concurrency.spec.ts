/**
 * 自动入库与用户删除之间的竞态（独立审查发现，实测可复现）。
 *
 * 症状（两个都真实存在）：
 *  A. 丢失更新：confirmWorkbenchRevision 一开始就把版本读进内存，发布循环跑完再用
 *     `{ ...旧快照, confirmedAt }` 整份写回。用户在循环期间删掉一个对象，
 *     刚写下的 removedSubjects 会被覆盖成 undefined —— 重新打开页面，已删的卡片又回来了，
 *     而「删了就别再出现」正是本次需求的核心。
 *  B. 删除后照样入库：发布循环用的是「读版本那一刻」的 items 快照，会为刚被删掉的对象
 *     继续创建灵魂。
 *
 * 修法：让「确认入库」与「删除条目」在同一版本的锁上串行；删除时按盘上最新内容合并；
 * 发布时跳过 removedSubjects 里的对象。
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { WorkbenchRevision } from "./workbench-core"

const io = vi.hoisted(() => ({
  files: new Map<string, string>(),
  auras: [] as any[],
  created: [] as string[],
  // 用来把发布循环卡在中途，好让测试在「循环进行中」插入一次删除。
  gate: { promise: Promise.resolve() as Promise<void>, release: () => {} },
  armed: { promise: Promise.resolve() as Promise<void>, resolve: () => {} },
}))

vi.mock("@/commands/fs", () => ({
  readFile: async (path: string) => {
    if (!io.files.has(path)) throw new Error("文件缺失")
    return io.files.get(path)!
  },
  writeFile: async (path: string, text: string) => { io.files.set(path, text) },
  writeFileAtomic: async (path: string, text: string) => { io.files.set(path, text) },
  createDirectory: async () => {},
  fileExists: async (path: string) =>
    io.files.has(path) || [...io.files.keys()].some((key) => key.startsWith(`${path}/`)),
  listDirectory: async (path: string) => [...io.files.keys()]
    .filter((key) => key.startsWith(`${path}/`))
    .map((key) => ({ name: key.slice(path.length + 1), path: key, is_dir: false })),
}))
vi.mock("./analysis-engine", () => ({ loadChapterList: async () => [] }))
vi.mock("../character-aura", () => ({
  loadCharacterAuraStore: async () => ({ customAuras: [...io.auras], bindings: [] }),
  deleteCustomCharacterAura: async (_projectPath: string, auraId: string) => {
    io.auras = io.auras.filter((aura) => aura.id !== auraId)
    return { customAuras: io.auras, bindings: [] }
  },
  updateCustomCharacterAura: async (_projectPath: string, auraId: string, patch: any) => ({ ...patch, id: auraId }),
  createCustomCharacterAuraFromGeneratedSkill: async (_projectPath: string, input: any) => {
    io.created.push(input.name)
    // 通知测试「已经进入发布循环」，然后卡住等放行。
    io.armed.resolve()
    await io.gate.promise
    const aura = { ...input, id: `custom-new-${io.created.length}`, builtIn: false }
    io.auras.push(aura)
    return aura
  },
}))

import { confirmWorkbenchRevision, inspectWorkbenchPublication } from "./workbench-publish"
import { removeWorkbenchRevisionItem } from "./workbench-remove"
import { saveWorkbenchRevision, workbenchRevisionPath } from "./workbench-storage"

const PROJECT = "/project"
const BOOK_PATH = "/project/book-analysis/book-1"

const rule = (id: string) => ({ id, dimension: "judgment", condition: "条件", action: "行动", boundary: "边界", observation: "观察", evidenceIds: [] })

function revision(overrides: Partial<WorkbenchRevision> = {}): WorkbenchRevision {
  return {
    workbenchVersion: 2, id: "r-race", taskId: "t1", bookId: "book-1", bookTitle: "测试作品",
    skill: "characters", requirements: "", selectedChapterIds: [], createdAt: 1, evidence: [], coverage: [],
    items: [
      { subject: "许七安", summary: "概述", limitations: "", rules: [rule("R1")] },
      { subject: "魏渊", summary: "概述", limitations: "", rules: [rule("R2")] },
    ],
    ...overrides,
  }
}
const readRevision = () => JSON.parse(io.files.get(workbenchRevisionPath(BOOK_PATH, "r-race"))!) as WorkbenchRevision

beforeEach(() => {
  io.files.clear(); io.auras = []; io.created = []
  let release: () => void = () => {}
  io.gate = { promise: new Promise<void>((resolve) => { release = resolve }), release: () => release() }
  let arm: () => void = () => {}
  io.armed = { promise: new Promise<void>((resolve) => { arm = resolve }), resolve: () => arm() }
})

describe("自动入库与删除的竞态", () => {
  it("入库循环进行中删除对象：删除记录不会丢，库里最终也没有被删对象", async () => {
    const rev = revision()
    await saveWorkbenchRevision(BOOK_PATH, rev)
    const preview = await inspectWorkbenchPublication(PROJECT, rev)

    // 1) 自动入库开始：它先把版本读进内存（此刻还没有 removedSubjects）。
    const confirming = confirmWorkbenchRevision(PROJECT, BOOK_PATH, rev.id, preview.fingerprint)
    await io.armed.promise // 2) 等它真的进入发布循环

    // 3) 用户在这一刻点了删除。删除会排在入库之后（同一把锁），故不能先 await 它，
    //    要先把发布循环放行。
    const removing = removeWorkbenchRevisionItem({ projectPath: PROJECT, bookPath: BOOK_PATH, revision: rev, subject: "许七安" })
    io.gate.release()
    const confirmed = await confirming
    const afterRemove = await removing

    /*
     * 症状 A（本次修的就是它）：删除记录不能被入库的旧快照整份覆盖。
     * 注意 confirmed.removedSubjects 本来就该是 undefined —— 删除排在入库之后，
     * 入库写回时那次删除还没发生。真正要守的是「盘上最终状态」。
     */
    expect(confirmed.removedSubjects).toBeUndefined()
    expect(afterRemove.removedSubjects).toEqual(["许七安"])
    expect(readRevision().removedSubjects).toEqual(["许七安"])

    /*
     * 症状 B：被删的「许七安」不能留在库里。
     * 串行化之后入库会先为它建一次灵魂，紧接着删除把它移掉——中间有一次多余创建，
     * 但用户可见的最终状态必须干净：库里只剩「魏渊」。
     */
    expect(io.auras.map((aura) => aura.name)).toEqual(["魏渊"])
  })

  it("版本已记录 removedSubjects 时，重新入库跳过被删对象（不复活已删灵魂）", async () => {
    const rev = revision({ removedSubjects: ["许七安"] })
    await saveWorkbenchRevision(BOOK_PATH, rev)
    const preview = await inspectWorkbenchPublication(PROJECT, rev)
    io.gate.release()

    const confirmed = await confirmWorkbenchRevision(PROJECT, BOOK_PATH, rev.id, preview.fingerprint)
    expect(io.created).toEqual(["魏渊"])
    expect(confirmed.removedSubjects).toEqual(["许七安"])
    expect(readRevision().removedSubjects).toEqual(["许七安"])
  })

  it("删除时传入过期的版本快照，也不会覆盖盘上更新的内容", async () => {
    const rev = revision()
    await saveWorkbenchRevision(BOOK_PATH, rev)
    // 盘上已经有另一个来源写入的更新（例如上一次删除）。
    await saveWorkbenchRevision(BOOK_PATH, { ...rev, removedSubjects: ["魏渊"] })

    // 组件手里拿的是过期快照（没有 removedSubjects），照旧调用删除。
    const next = await removeWorkbenchRevisionItem({ projectPath: PROJECT, bookPath: BOOK_PATH, revision: rev, subject: "许七安" })

    expect(next.removedSubjects?.sort()).toEqual(["许七安", "魏渊"])
    expect(readRevision().removedSubjects?.sort()).toEqual(["许七安", "魏渊"])
  })

  it("串行不变量：同一版本的确认入库不会被并发执行两次", async () => {
    const rev = revision()
    await saveWorkbenchRevision(BOOK_PATH, rev)
    const preview = await inspectWorkbenchPublication(PROJECT, rev)
    io.gate.release()

    const [a, b] = await Promise.all([
      confirmWorkbenchRevision(PROJECT, BOOK_PATH, rev.id, preview.fingerprint),
      confirmWorkbenchRevision(PROJECT, BOOK_PATH, rev.id, preview.fingerprint),
    ])
    // 每个对象只发布一次（第二次进来时已经 confirmedAt，直接返回）。
    expect(io.created).toEqual(["许七安", "魏渊"])
    expect(a.confirmedAt).toBeGreaterThan(0)
    expect(b.confirmedAt).toBeGreaterThan(0)
  })
})
