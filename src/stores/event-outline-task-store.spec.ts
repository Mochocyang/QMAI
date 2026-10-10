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

  it("removeTask 摘掉任务（丢弃 / 取消 / 确认后都走它）", () => {
    const id = useEventOutlineTaskStore.getState().startTask({ projectPath: "/p", request: request() })
    useEventOutlineTaskStore.getState().removeTask(id)
    expect(useEventOutlineTaskStore.getState().tasks).toHaveLength(0)
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
})
