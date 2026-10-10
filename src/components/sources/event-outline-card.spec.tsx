// @vitest-environment jsdom
import { act, type ReactElement } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { EventOutlineCard } from "@/components/sources/event-outline-card"
import type { EventOutlineData } from "@/lib/novel/event-outline"

function data(overrides: Partial<EventOutlineData> = {}): EventOutlineData {
  return {
    version: 1,
    chapterNumber: 12,
    title: "第12章 · 令牌初现",
    targetWords: 3000,
    events: [
      { id: 1, title: "院子里的哭声", points: ["关键台词：「夜壶里的东西是药。」", "神情：念念护住屁股蛋。"] },
      { id: 2, title: "楚白醒来", points: ["环境：黑黢黢的房梁", "动作：往床头摸手机。"] },
      { id: 3, title: "致歉被当成要钱", points: ["神情：楚白的手僵在那里。", "环境：磨破后跟的鞋。"] },
      { id: 4, title: "令牌出现", points: ["环境：浴桶", "推进：识海深处有力量拉扯。"] },
    ],
    endingHook: "令牌上刻着四个字：高人一等。",
    ...overrides,
  }
}

function render(ui: ReactElement) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  // 计划里给的桩少了这一行：不 root.render(ui) 的话所有断言都只能看到空 body。
  act(() => {
    root.render(ui)
  })
  return { root, host }
}

/** 按可见文案取扩写按钮：querySelectorAll("button") 只认真正的 <button> 元素。 */
function writeChapterButton(): HTMLButtonElement | undefined {
  return [...document.querySelectorAll("button")]
    .find((item) => item.textContent === "用这份细纲写这一章")
}

it("渲染事件标题、抓手、章尾钩子与字数小计", async () => {
  const { root, host } = render(<EventOutlineCard data={data()} />)
  await act(async () => {})
  const text = document.body.textContent ?? ""
  expect(text).toContain("第12章 · 令牌初现")
  expect(text).toContain("院子里的哭声")
  expect(text).toContain("夜壶里的东西是药")
  expect(text).toContain("高人一等")
  expect(text).toContain("3000")
  await act(async () => root.unmount())
  host.remove()
})

it("校验不通过时逐条列出问题", async () => {
  const broken = data({ events: data().events.slice(0, 2), endingHook: "" })
  const { root, host } = render(<EventOutlineCard data={broken} />)
  await act(async () => {})
  const text = document.body.textContent ?? ""
  expect(text).toContain("结尾钩子")
  expect(text).toContain("应在 4~8 个之间")
  await act(async () => root.unmount())
  host.remove()
})

it("点「用这份细纲写这一章」把提示词交给上层", async () => {
  const onWriteChapter = vi.fn()
  const { root, host } = render(<EventOutlineCard data={data()} onWriteChapter={onWriteChapter} />)
  await act(async () => {})
  const button = writeChapterButton()!
  await act(async () => button.click())
  expect(onWriteChapter).toHaveBeenCalledTimes(1)
  expect(onWriteChapter.mock.calls[0][0]).toContain("院子里的哭声")
  await act(async () => root.unmount())
  host.remove()
})

it("校验不通过时不提供扩写入口", async () => {
  const broken = data({ endingHook: "" })
  const { root, host } = render(<EventOutlineCard data={broken} onWriteChapter={() => {}} />)
  await act(async () => {})
  expect(writeChapterButton()).toBeUndefined()
  await act(async () => root.unmount())
  host.remove()
})

// 本文件最重要的一条：软性节奏提示（advisories）绝不能拦掉扩写入口。
// 项目单章目标字数被钳在 1000~10000，4000 字 / 4 个事件 = 每事件 1000 字，
// 必然落到 150~800 的软性区间之外，但这是一份完全合法的细纲。
it("软性节奏提示照常提示，但不阻断扩写入口", async () => {
  const onWriteChapter = vi.fn()
  const { root, host } = render(
    <EventOutlineCard data={data({ targetWords: 4000 })} onWriteChapter={onWriteChapter} />,
  )
  await act(async () => {})
  const text = document.body.textContent ?? ""
  expect(text).toContain("节奏提示")
  const button = writeChapterButton()
  expect(button).toBeDefined()
  await act(async () => button!.click())
  expect(onWriteChapter).toHaveBeenCalledTimes(1)
  await act(async () => root.unmount())
  host.remove()
})

// 标题超 24 字只是排版级别的超标（设计文档：超出提示压缩，不算错），
// 不能因此把 ok 打成 false —— 那会连带抽掉「用这份细纲写这一章」这个主 CTA。
it("事件标题超 24 字时只给压缩提示，主 CTA 照常在位", async () => {
  const longTitle = "这是一个被写得太长的事件标题用来触发标题长度校验的用例文本三"
  expect(longTitle.length).toBe(30)
  const onWriteChapter = vi.fn()
  const { root, host } = render(
    <EventOutlineCard
      data={data({ events: data().events.map((item, index) => (index === 0 ? { ...item, title: longTitle } : item)) })}
      onWriteChapter={onWriteChapter}
    />,
  )
  try {
    await act(async () => {})
    // 断言只在本卡的 host 上做：万一中途失败，泄漏到 document.body 的节点不会污染后续用例。
    const text = host.textContent ?? ""
    expect(text).toContain("节奏提示")
    expect(text).toContain("超过 24 字")
    expect(text).not.toContain("待修")
    const button = [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((item) => item.textContent === "用这份细纲写这一章")
    expect(button, "标题超标不应抽掉主 CTA").toBeDefined()
    await act(async () => button!.click())
    expect(onWriteChapter).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

it("结构缺陷逐条列出，不顺带隐藏事件条数", async () => {
  const events = Array.from({ length: 9 }, (_, index) => ({
    id: index + 1,
    title: `第${index + 1}个事件`,
    points: ["关键台词：台词", "神情：神情"],
  }))
  const { root, host } = render(<EventOutlineCard data={data({ events })} />)
  await act(async () => {})
  const text = document.body.textContent ?? ""
  expect(text).toContain("待修")
  expect(text).toContain("事件数为 9")
  expect(text).toContain("应在 4~8 个之间")
  await act(async () => root.unmount())
  host.remove()
})

it("上抛的扩写提示词反映真实数据而不是只有事件标题", async () => {
  const onWriteChapter = vi.fn()
  const { root, host } = render(
    <EventOutlineCard
      data={data({ targetWords: 3200, endingHook: "浴桶底下压着一块旧木牌。" })}
      onWriteChapter={onWriteChapter}
    />,
  )
  await act(async () => {})
  await act(async () => writeChapterButton()!.click())
  const prompt = onWriteChapter.mock.calls[0][0] as string
  expect(prompt).toContain("3200")
  expect(prompt).toContain("浴桶底下压着一块旧木牌。")
  await act(async () => root.unmount())
  host.remove()
})

it("未提供 onWriteChapter 时即便细纲合法也不出现扩写入口", async () => {
  const { root, host } = render(<EventOutlineCard data={data()} />)
  await act(async () => {})
  expect(writeChapterButton()).toBeUndefined()
  await act(async () => root.unmount())
  host.remove()
})

it("细纲合法时不显示体检块", async () => {
  const { root, host } = render(<EventOutlineCard data={data()} />)
  await act(async () => {})
  expect(document.body.textContent ?? "").not.toContain("待修")
  await act(async () => root.unmount())
  host.remove()
})
