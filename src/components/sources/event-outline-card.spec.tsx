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

/** 按可见文案取卡片上的某枚按钮（「手动修改」/「重新生成」/「保存细纲」/「取消编辑」）。 */
function cardButton(label: string, scope: ParentNode = document.body): HTMLButtonElement {
  const found = [...scope.querySelectorAll<HTMLButtonElement>("button")]
    .find((item) => item.textContent?.trim() === label)
  expect(found, `卡片上应有「${label}」按钮`).toBeDefined()
  return found!
}

/**
 * 按 aria-label 取编辑表单里的字段。
 *
 * 刻意**不按顺序**取（`querySelectorAll("input")[2]` 那种写法会把字段顺序写进断言，
 * 将来在前面插一个字段就让另一条用例变红，而且红得毫无道理）。
 */
function field<T extends HTMLElement>(scope: ParentNode, label: string): T {
  const found = scope.querySelector<T>(`[aria-label="${label}"]`)
  expect(found, `编辑表单里应有「${label}」字段`).not.toBeNull()
  return found!
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!
  setter.call(textarea, value)
  textarea.dispatchEvent(new Event("input", { bubbles: true }))
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

/*
 * ⚠️ 丙-3b **推翻了**这条用例原来的断言。
 *
 * 原文是「校验不通过时不提供扩写入口」（`expect(writeChapterButton()).toBeUndefined()`），
 * 而卡片现在支持手改：改坏之后再让按钮**直接消失**，用户看到的是「功能没了」，
 * 无从知道是哪儿不合格、也更不知道该改回去什么。所以新契约是
 * **入口不消失、置灰、并把原因说清楚**（见实施计划 §3b 第 3 条：
 * 「不要让它成为偶然行为」）。禁用状态与可见原因由下面两条用例分别钉住。
 */
it("校验不通过时不抽掉扩写入口，而是禁用并给出可见原因", async () => {
  const onWriteChapter = vi.fn()
  const broken = data({ endingHook: "" })
  const { root, host } = render(<EventOutlineCard data={broken} onWriteChapter={onWriteChapter} />)
  await act(async () => {})
  const button = writeChapterButton()
  expect(button, "改坏了也必须留着入口，否则用户以为功能没了").toBeDefined()
  expect(button!.disabled).toBe(true)
  const reason = host.querySelector("[data-event-outline-blocked-reason]")
  expect(reason?.textContent, "禁用的原因必须可见").toContain("待修")
  expect(reason?.textContent).toContain("1 项")
  await act(async () => button!.click())
  expect(onWriteChapter, "禁用的按钮不该还能扩写").not.toHaveBeenCalled()
  await act(async () => root.unmount())
  host.remove()
})

/*
 * 「原因可见」还不够 —— 只说「有 1 项待修」等于让用户自己去猜是哪一项。
 * 所以禁用按钮用 aria-describedby 指向同一张卡上那份逐条体检清单，
 * 这条用例把「指向的确实就是那份具体清单」钉住（否则可以退化成一个空串/野 id）。
 */
it("禁用原因指向具体的体检条目，而不是一句笼统的「有问题」", async () => {
  const broken = data({ endingHook: "" })
  const { root, host } = render(<EventOutlineCard data={broken} onWriteChapter={() => {}} />)
  await act(async () => {})
  const button = writeChapterButton()!
  const describedBy = button.getAttribute("aria-describedby")
  expect(describedBy, "禁用按钮必须把具体原因关联进来").toBeTruthy()
  const described = document.getElementById(describedBy!)
  expect(described, `aria-describedby=${describedBy} 应指向真实存在的节点`).not.toBeNull()
  expect(described!.textContent).toContain("缺少全章结尾钩子")
  await act(async () => root.unmount())
  host.remove()
})

it("未提供 onWriteChapter 时不渲染扩写入口（与校验无关）", async () => {
  const broken = data({ endingHook: "" })
  const { root, host } = render(<EventOutlineCard data={broken} />)
  await act(async () => {})
  expect(writeChapterButton()).toBeUndefined()
  await act(async () => root.unmount())
  host.remove()
})

/* ── 丙-3a：AI 重新生成（低风险那半，只回传一个意图，数据链路不变） ── */

it("未提供 onRegenerate 时不出现「重新生成」（大纲会话里的旧卡片不凭空多出按钮）", async () => {
  const { root, host } = render(<EventOutlineCard data={data()} onWriteChapter={() => {}} />)
  await act(async () => {})
  const found = [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === "重新生成")
  expect(found).toBeUndefined()
  await act(async () => root.unmount())
  host.remove()
})

it("点「重新生成」把「重跑原请求」的意图交给上层（本组件不自己发起生成）", async () => {
  const onRegenerate = vi.fn()
  const { root, host } = render(
    <EventOutlineCard data={data()} onWriteChapter={() => {}} onRegenerate={onRegenerate} />,
  )
  await act(async () => {})
  await act(async () => cardButton("重新生成", host).click())
  expect(onRegenerate).toHaveBeenCalledTimes(1)
  // 组件不该顺手改自己的数据：手改/重生成后的真相都在上层（task.outline）
  expect(host.querySelector("[data-event-outline-problems]")).toBeNull()
  await act(async () => root.unmount())
  host.remove()
})

/* ── 丙-3b：手动编辑（唯一需要动数据链路的一半） ── */

it("未提供 onSaveOutline 时不出现「手动修改」（旧会话里的卡片保持只读）", async () => {
  const { root, host } = render(<EventOutlineCard data={data()} onWriteChapter={() => {}} />)
  await act(async () => {})
  const found = [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === "手动修改")
  expect(found).toBeUndefined()
  await act(async () => root.unmount())
  host.remove()
})

it("「手动修改」打开表单，且字段预填的是当前这份细纲", async () => {
  const { root, host } = render(
    <EventOutlineCard data={data({ requirement: "必须交代失望" })} onWriteChapter={() => {}} onSaveOutline={() => {}} />,
  )
  await act(async () => {})
  await act(async () => cardButton("手动修改", host).click())

  expect(field<HTMLInputElement>(host, "细纲标题").value).toBe("第12章 · 令牌初现")
  expect(field<HTMLInputElement>(host, "细纲目标字数").value).toBe("3000")
  expect(field<HTMLInputElement>(host, "事件3的一句话标题").value).toBe("致歉被当成要钱")
  expect(field<HTMLTextAreaElement>(host, "事件3的细节抓手").value).toBe("神情：楚白的手僵在那里。\n环境：磨破后跟的鞋。")
  expect(field<HTMLTextAreaElement>(host, "细纲章尾钩子").value).toBe("令牌上刻着四个字：高人一等。")
  expect(field<HTMLTextAreaElement>(host, "细纲本章要求").value).toBe("必须交代失望")
  // 章号**不进表单**：它是任务的权威（store 层 finishTask/updateTaskOutline 都以它为准），
  // 在卡片里再给一个能改的章号就是第二份真相。
  expect(host.querySelector('[aria-label="细纲章号"]')).toBeNull()
  await act(async () => root.unmount())
  host.remove()
})

it("保存回传改后的整份细纲：事件标题 / 抓手逐行解析 / 钩子 / 标题 / 目标字数 / 要求", async () => {
  const onSaveOutline = vi.fn()
  const { root, host } = render(
    <EventOutlineCard data={data({ requirement: "必须交代失望" })} onWriteChapter={() => {}} onSaveOutline={onSaveOutline} />,
  )
  await act(async () => {})
  await act(async () => cardButton("手动修改", host).click())
  await act(async () => setInputValue(field<HTMLInputElement>(host, "细纲标题"), "第12章 · 改过的章名"))
  await act(async () => setInputValue(field<HTMLInputElement>(host, "细纲目标字数"), "3600"))
  await act(async () => setInputValue(field<HTMLInputElement>(host, "事件3的一句话标题"), "骆轻竹把刀递给楚白"))
  // 逐行一条抓手；空行直接丢掉（不然验证器会把它算成「抓手条数超了」）
  await act(async () => setTextareaValue(
    field<HTMLTextAreaElement>(host, "事件3的细节抓手"),
    "关键台词：接着。\n\n神情动作：他没有伸手。",
  ))
  await act(async () => setTextareaValue(field<HTMLTextAreaElement>(host, "细纲章尾钩子"), "改后的钩子。"))
  await act(async () => setTextareaValue(field<HTMLTextAreaElement>(host, "细纲本章要求"), "改后的要求。"))
  await act(async () => cardButton("保存细纲", host).click())

  expect(onSaveOutline).toHaveBeenCalledTimes(1)
  const saved = onSaveOutline.mock.calls[0][0] as EventOutlineData
  expect(saved.title).toBe("第12章 · 改过的章名")
  expect(saved.targetWords).toBe(3600)
  expect(saved.events).toHaveLength(4)
  expect(saved.events[2].title).toBe("骆轻竹把刀递给楚白")
  expect(saved.events[2].points).toEqual(["关键台词：接着。", "神情动作：他没有伸手。"])
  expect(saved.events[2].id).toBe(3)
  expect(saved.endingHook).toBe("改后的钩子。")
  expect(saved.requirement).toBe("改后的要求。")
  // 没改的部分原样带回去（不是只回传改过的字段）
  expect(saved.events[0].title).toBe("院子里的哭声")
  expect(saved.events[0].points).toEqual(["关键台词：「夜壶里的东西是药。」", "神情：念念护住屁股蛋。"])
  expect(saved.chapterNumber).toBe(12)
  expect(saved.version).toBe(1)
  // 保存后回到只读视图（表单不再留着）
  expect(host.querySelector('[aria-label="细纲标题"]')).toBeNull()
  await act(async () => root.unmount())
  host.remove()
})

it("「取消编辑」丢弃草稿：关掉表单、不回传、值回到原样", async () => {
  const onSaveOutline = vi.fn()
  const { root, host } = render(
    <EventOutlineCard data={data()} onWriteChapter={() => {}} onSaveOutline={onSaveOutline} />,
  )
  await act(async () => {})
  await act(async () => cardButton("手动修改", host).click())
  await act(async () => setInputValue(field<HTMLInputElement>(host, "细纲标题"), "不该被保存的标题"))
  await act(async () => cardButton("取消编辑", host).click())
  expect(onSaveOutline).not.toHaveBeenCalled()
  expect(host.querySelector('[aria-label="细纲标题"]')).toBeNull()
  // 再打开一次：草稿必须被丢掉，而不是又粘回来
  await act(async () => cardButton("手动修改", host).click())
  expect(field<HTMLInputElement>(host, "细纲标题").value).toBe("第12章 · 令牌初现")
  await act(async () => root.unmount())
  host.remove()
})

/*
 * 手改目标字数写成非数字时**不拦保存**：目标字数是结构性校验项，
 * 存进去之后卡片自己会把它列进「细纲体检」，写正文按钮随之禁用并说明原因 ——
 * 这正是本子批对 `validation.ok` 交互的显式决定（允许存不合法，但不静默抽掉入口）。
 */
it("目标字数填成非数字：照样回传（0 会被体检列出来），不静默丢掉用户的输入", async () => {
  const onSaveOutline = vi.fn()
  const { root, host } = render(
    <EventOutlineCard data={data()} onWriteChapter={() => {}} onSaveOutline={onSaveOutline} />,
  )
  await act(async () => {})
  await act(async () => cardButton("手动修改", host).click())
  await act(async () => setInputValue(field<HTMLInputElement>(host, "细纲目标字数"), "三千字"))
  await act(async () => cardButton("保存细纲", host).click())
  expect(onSaveOutline).toHaveBeenCalledTimes(1)
  expect((onSaveOutline.mock.calls[0][0] as EventOutlineData).targetWords).toBe(0)
  await act(async () => root.unmount())
  host.remove()
})

/*
 * 用户把「3000」手打成「约3000字」是常事，而 AI 也爱这么写 —— 解析口径必须与
 * 后端的 `positiveInteger`（event-outline.ts）一致：扫出第一段数字，而不是直接
 * `Number.parseInt(整串)` 拿到 NaN。用 `Number.parseInt` 的话这条会红。
 */
it("目标字数能读出「约3000字」里的数字，与后端解析口径一致", async () => {
  const onSaveOutline = vi.fn()
  const { root, host } = render(
    <EventOutlineCard data={data()} onWriteChapter={() => {}} onSaveOutline={onSaveOutline} />,
  )
  await act(async () => {})
  await act(async () => cardButton("手动修改", host).click())
  await act(async () => setInputValue(field<HTMLInputElement>(host, "细纲目标字数"), "约3000字"))
  await act(async () => cardButton("保存细纲", host).click())
  expect((onSaveOutline.mock.calls[0][0] as EventOutlineData).targetWords).toBe(3000)
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
