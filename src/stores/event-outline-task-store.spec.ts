import { beforeEach, describe, expect, it } from "vitest"
import type { EventOutlineData, EventOutlineRequest } from "@/lib/novel/event-outline"
import {
  selectProjectEventOutlineTasks,
  useEventOutlineTaskStore,
} from "@/stores/event-outline-task-store"

function request(overrides: Partial<EventOutlineRequest> = {}): EventOutlineRequest {
  return { chapterNumber: 7, eventCount: 4, targetWords: 3000, requirement: "", ...overrides }
}

function outline(chapterNumber = 7): EventOutlineData {
  return {
    version: 1,
    chapterNumber,
    title: `第${chapterNumber}章 · 雨夜递刀`,
    targetWords: 3000,
    events: [{ id: 1, title: "事件", points: ["抓手"] }],
    endingHook: "钩子",
  }
}

describe("event-outline-task-store", () => {
  beforeEach(() => {
    useEventOutlineTaskStore.setState({ tasks: [] })
  })

  it("新任务是 generating，并带上请求里的章号", () => {
    const id = useEventOutlineTaskStore.getState().startTask({ projectPath: "/p", request: request() })
    const task = useEventOutlineTaskStore.getState().tasks.find((item) => item.id === id)
    expect(task?.status).toBe("generating")
    expect(task?.chapterNumber).toBe(7)
    expect(task?.outline).toBeNull()
    expect(task?.receivedChars).toBe(0)
  })

  it("finishTask 落到 awaiting-confirm 并带上细纲", () => {
    const id = useEventOutlineTaskStore.getState().startTask({ projectPath: "/p", request: request() })
    useEventOutlineTaskStore.getState().finishTask(id, outline())
    const task = useEventOutlineTaskStore.getState().tasks.find((item) => item.id === id)
    expect(task?.status).toBe("awaiting-confirm")
    expect(task?.outline?.title).toBe("第7章 · 雨夜递刀")
  })

  it("failTask 记下原因并清掉细纲", () => {
    const id = useEventOutlineTaskStore.getState().startTask({ projectPath: "/p", request: request() })
    useEventOutlineTaskStore.getState().failTask(id, "网络连接中断")
    const task = useEventOutlineTaskStore.getState().tasks.find((item) => item.id === id)
    expect(task?.status).toBe("error")
    expect(task?.error).toBe("网络连接中断")
    expect(task?.outline).toBeNull()
  })

  it("appendProgress 只更新字数，不动其它字段", () => {
    const id = useEventOutlineTaskStore.getState().startTask({ projectPath: "/p", request: request() })
    useEventOutlineTaskStore.getState().appendProgress(id, 1200)
    const task = useEventOutlineTaskStore.getState().tasks.find((item) => item.id === id)
    expect(task?.receivedChars).toBe(1200)
    expect(task?.status).toBe("generating")
  })

  /*
   * 同一章同时挂两份细纲卡片没有可用语义（两套卡片都写着「用这份细纲写第 7 章」，
   * 用户无从分辨该点哪一个），所以重开会替换而不是追加。
   */
  it("同项目同章号重开会替换旧任务，而不是并排两张卡片", () => {
    useEventOutlineTaskStore.getState().startTask({ projectPath: "/p", request: request() })
    useEventOutlineTaskStore.getState().startTask({ projectPath: "/p", request: request() })
    expect(useEventOutlineTaskStore.getState().tasks).toHaveLength(1)
  })

  it("不同章号可以并存（先给第 8 章生成、再回头看第 7 章）", () => {
    useEventOutlineTaskStore.getState().startTask({ projectPath: "/p", request: request({ chapterNumber: 7 }) })
    useEventOutlineTaskStore.getState().startTask({ projectPath: "/p", request: request({ chapterNumber: 8 }) })
    expect(useEventOutlineTaskStore.getState().tasks).toHaveLength(2)
  })

  /*
   * 「同项目」与「同章号」是两个**都必须**成立的条件。
   *
   * 用两条同章号但不同项目的任务来测：若 startTask 的过滤把 && 写成 ||，
   * 它就会把别的项目的任务一起删掉 —— 而先前的用例全是「同项目不同章」
   * 或「同项目同章」，两种写法都能通过，这个缺陷可以完全不被发现。
   */
  it("不同项目的同章号任务互不相干，两个都留下", () => {
    useEventOutlineTaskStore.getState().startTask({ projectPath: "/book-a", request: request({ chapterNumber: 3 }) })
    useEventOutlineTaskStore.getState().startTask({ projectPath: "/book-b", request: request({ chapterNumber: 3 }) })
    expect(useEventOutlineTaskStore.getState().tasks).toHaveLength(2)
    const tasks = useEventOutlineTaskStore.getState().tasks
    expect(selectProjectEventOutlineTasks(tasks, "/book-a")).toHaveLength(1)
    expect(selectProjectEventOutlineTasks(tasks, "/book-b")).toHaveLength(1)
  })

  it("换项目重开同章号只替换本项目那一条", () => {
    const first = useEventOutlineTaskStore.getState().startTask({ projectPath: "/book-a", request: request({ chapterNumber: 3 }) })
    const other = useEventOutlineTaskStore.getState().startTask({ projectPath: "/book-b", request: request({ chapterNumber: 3 }) })
    const replaced = useEventOutlineTaskStore.getState().startTask({ projectPath: "/book-a", request: request({ chapterNumber: 3 }) })

    const ids = useEventOutlineTaskStore.getState().tasks.map((task) => task.id)
    expect(ids).toHaveLength(2)
    expect(ids).not.toContain(first)
    expect(ids).toContain(replaced)
    // B 书那条必须活着：这正是 && 写成 || 时会丢掉的
    expect(ids).toContain(other)
  })

  it("removeTask 摘掉任务（丢弃 / 取消 / 确认后都走它）", () => {
    const id = useEventOutlineTaskStore.getState().startTask({ projectPath: "/p", request: request() })
    useEventOutlineTaskStore.getState().removeTask(id)
    expect(useEventOutlineTaskStore.getState().tasks).toHaveLength(0)
  })

  /*
   * ── 正文生成这一段状态机（丙-2b）──
   *
   * 关键差别只有一条：正文失败**不能**复用 failTask。failTask 会把 outline 清成 null，
   * 而正文失败时用户最需要的恰恰是那份已确认的细纲（点一下按钮就能重试）。
   * 下面的用例把这条差别钉在 store 层，组件层另有渲染断言。
   */
  it("startWriting 进入 writing 并清掉上一次的失败痕迹", () => {
    const id = useEventOutlineTaskStore.getState().startTask({ projectPath: "/p", request: request() })
    useEventOutlineTaskStore.getState().finishTask(id, outline())
    useEventOutlineTaskStore.getState().failWriting(id, "上一次的超时")
    useEventOutlineTaskStore.getState().startWriting(id)

    const task = useEventOutlineTaskStore.getState().tasks.find((item) => item.id === id)
    expect(task?.status).toBe("writing")
    expect(task?.writingError).toBeNull()
    expect(task?.writingStage).toBeNull()
    expect(task?.outline?.title).toBe("第7章 · 雨夜递刀")
  })

  it("failWriting 退回 awaiting-confirm，**保留 outline** 并写下 writingError", () => {
    const id = useEventOutlineTaskStore.getState().startTask({ projectPath: "/p", request: request() })
    useEventOutlineTaskStore.getState().finishTask(id, outline())
    useEventOutlineTaskStore.getState().startWriting(id)
    useEventOutlineTaskStore.getState().failWriting(id, "网络连接中断")

    const task = useEventOutlineTaskStore.getState().tasks.find((item) => item.id === id)
    expect(task?.status).toBe("awaiting-confirm")
    expect(task?.writingError).toBe("网络连接中断")
    // 与 failTask 的分水岭：细纲必须还在，卡片与重试按钮才有东西可渲染
    expect(task?.outline?.title).toBe("第7章 · 雨夜递刀")
    expect(task?.error).toBeNull()
  })

  it("cancelWriting 退回 awaiting-confirm 且不留错误（取消不是失败）", () => {
    const id = useEventOutlineTaskStore.getState().startTask({ projectPath: "/p", request: request() })
    useEventOutlineTaskStore.getState().finishTask(id, outline())
    useEventOutlineTaskStore.getState().startWriting(id)
    useEventOutlineTaskStore.getState().setWritingStage(id, "写出初稿")
    useEventOutlineTaskStore.getState().cancelWriting(id)

    const task = useEventOutlineTaskStore.getState().tasks.find((item) => item.id === id)
    expect(task?.status).toBe("awaiting-confirm")
    expect(task?.writingError).toBeNull()
    expect(task?.writingStage).toBeNull()
    expect(task?.outline?.title).toBe("第7章 · 雨夜递刀")
  })

  it("setWritingStage 只改阶段名，不动状态与细纲", () => {
    const id = useEventOutlineTaskStore.getState().startTask({ projectPath: "/p", request: request() })
    useEventOutlineTaskStore.getState().finishTask(id, outline())
    useEventOutlineTaskStore.getState().startWriting(id)
    useEventOutlineTaskStore.getState().setWritingStage(id, "审稿返修")

    const task = useEventOutlineTaskStore.getState().tasks.find((item) => item.id === id)
    expect(task?.writingStage).toBe("审稿返修")
    expect(task?.status).toBe("writing")
    expect(task?.outline?.title).toBe("第7章 · 雨夜递刀")
  })

  /*
   * 同章重提会把正在写正文的那条任务整行换掉（startTask 按项目+章号替换），
   * 用户既看不到它、也没法取消 —— 所以那一步必须由调用方（preview-panel 的
   * supersede 循环）负责中止。这里只钉住「被换掉的旧行确实不在 store 里了」，
   * 免得日后有人改成留下僵尸行。
   */
  it("同章重提会把正在写正文的那条任务换掉，不留僵尸行", () => {
    const first = useEventOutlineTaskStore.getState().startTask({ projectPath: "/p", request: request() })
    useEventOutlineTaskStore.getState().finishTask(first, outline())
    useEventOutlineTaskStore.getState().startWriting(first)
    const second = useEventOutlineTaskStore.getState().startTask({ projectPath: "/p", request: request() })

    const ids = useEventOutlineTaskStore.getState().tasks.map((task) => task.id)
    expect(ids).toEqual([second])
    expect(ids).not.toContain(first)
  })

  /*
   * 项目过滤不是可选的美化：切到另一本书之后，上一个项目的细纲卡片仍在 store 里，
   * 若不过滤，用户会在 B 书里看到 A 书的细纲，并可能把它写成 B 书的章节。
   */
  it("按项目过滤：B 书里看不到 A 书的待确认细纲", () => {
    useEventOutlineTaskStore.getState().startTask({ projectPath: "/book-a", request: request() })
    const tasks = useEventOutlineTaskStore.getState().tasks
    expect(selectProjectEventOutlineTasks(tasks, "/book-a")).toHaveLength(1)
    expect(selectProjectEventOutlineTasks(tasks, "/book-b")).toHaveLength(0)
    expect(selectProjectEventOutlineTasks(tasks, null)).toHaveLength(0)
  })

  it("项目路径的大小写与结尾斜杠差异不算不同项目", () => {
    useEventOutlineTaskStore.getState().startTask({ projectPath: "C:\\BookA", request: request() })
    const tasks = useEventOutlineTaskStore.getState().tasks
    expect(selectProjectEventOutlineTasks(tasks, "C:/booka/")).toHaveLength(1)
  })

  /*
   * 上面那条用的是 `C:\BookA` vs `C:/booka/` —— **旧实现也通过**，
   * 所以它钉不住 D8 的两处归一化。下面两条各自钉一处：
   *
   * - 盘根：判 Windows 形态必须在剥尾斜杠**之前**做。若先剥再判，
   *   `C:/` 变成 `C:`，`/^[A-Za-z]:\//` 匹配不上 ⇒ 盘根不会被小写化，
   *   同一个盘符根目录就成了两个项目。
   * - 双尾斜杠：必须剥掉**全部**尾斜杠（normalizeComparablePath 的 `\/+$`），
   *   手写 `.replace(/\/$/, "")` 只去一个，`C:/Book//` 与 `C:/Book` 不相等。
   */
  it("盘根的大小写差异不算不同项目（C:/ 与 c:/）", () => {
    useEventOutlineTaskStore.getState().startTask({ projectPath: "C:/", request: request() })
    const tasks = useEventOutlineTaskStore.getState().tasks
    expect(selectProjectEventOutlineTasks(tasks, "c:/")).toHaveLength(1)
  })

  it("重复结尾斜杠不算不同项目（C:/Book// 与 C:/Book）", () => {
    useEventOutlineTaskStore.getState().startTask({ projectPath: "C:/Book//", request: request() })
    const tasks = useEventOutlineTaskStore.getState().tasks
    expect(selectProjectEventOutlineTasks(tasks, "C:/Book")).toHaveLength(1)
  })

  /*
   * 残留边界（**有意不修**，真实项目路径不可达）：
   * `"C:"` 经 normalizeComparablePath 仍是 `"C:"`，而 `"C:/"` 变成 `"c:"` ——
   * 前者不是 Windows 形态、不做小写化，于是两者不相等。
   * 用户不可能把一个项目开在 `C:`（无斜杠）这种路径上，故只记录。
   */
})
