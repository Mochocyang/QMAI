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

/* ── F5：三条此前**没有任何测试保护**的断言（都被变异存活过） ── */

/*
 * 合法细纲上不该挂 `aria-describedby`。
 *
 * 变异「把 `validation.ok ?` 那个三元拆掉、无条件写成 problemsId」在全量测试里是
 * **绿的**：合法卡上确实没有体检块，于是这个属性指向一个不存在的节点（悬空引用），
 * 而唯一会读它的读屏软件不在测试里。这条用例把「合法卡上必须是 null」钉住。
 */
it("合法细纲上不挂 aria-describedby（合法卡没有体检块，挂了就是悬空引用）", async () => {
  const { root, host } = render(<EventOutlineCard data={data()} onWriteChapter={() => {}} />)
  try {
    await act(async () => {})
    const button = [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((item) => item.textContent === "用这份细纲写这一章")!
    expect(button.disabled, "合法细纲不该置灰").toBe(false)
    // 反向控制：合法卡上确实没有体检块 ⇒ 此时任何 id 都必然指向不存在的节点
    expect(host.querySelector("[data-event-outline-problems]")).toBeNull()
    expect(
      button.getAttribute("aria-describedby"),
      "合法卡挂 aria-describedby 就是悬空引用（读屏会指向不存在的节点）",
    ).toBeNull()
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

/*
 * 同一章的多张卡片必须各有各的体检 id。
 *
 * 变异「把 `useId()` 换成 `data.chapterNumber` 拼 id」在全量测试里也是**绿的**，
 * 而碰撞是真实可发生的：大纲会话里每一条助手消息都可能挂一张卡片，同一个会话
 * 可以为同一章重出好几轮 —— 那时 `aria-describedby` 会指到**另一张卡**的体检块上。
 * 这条用例用同一章的两张卡把 id 的同一性逼出来。
 */
it("同一章的两张卡片各有自己的体检 id（不能拿章号拼 id）", async () => {
  const first = render(<EventOutlineCard data={data({ endingHook: "" })} onWriteChapter={() => {}} />)
  const second = render(<EventOutlineCard data={data({ endingHook: "" })} onWriteChapter={() => {}} />)
  try {
    await act(async () => {})
    const describedBy = (host: HTMLElement) => {
      const button = [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((item) => item.textContent === "用这份细纲写这一章")!
      return button.getAttribute("aria-describedby")
    }
    const firstId = describedBy(first.host)
    const secondId = describedBy(second.host)
    expect(firstId, "禁用按钮必须把具体原因关联进来").toBeTruthy()
    expect(secondId).toBeTruthy()
    expect(firstId, "同一章多张卡片的体检 id 不能相同（相同会让读屏指到另一张卡上）").not.toBe(secondId)
    // 而且每个 id 指向的是**自己那张卡**里的体检块
    expect(first.host.querySelector(`[id="${firstId}"]`)?.textContent).toContain("缺少全章结尾钩子")
    expect(second.host.querySelector(`[id="${secondId}"]`)?.textContent).toContain("缺少全章结尾钩子")
  } finally {
    await act(async () => first.root.unmount())
    await act(async () => second.root.unmount())
    first.host.remove()
    second.host.remove()
  }
})

/*
 * `useId()` 必须在**任何 early return 之前**调用。
 *
 * 编辑态那条 `if (editing && onSaveOutline) return <EventOutlineEditor …/>` 是
 * 本组件唯一的早退分支：把 `useId()` 挪到它下面，「只读 → 编辑 → 只读」这条
 * 用户真实会走的往返就会让 hook 数量 3 → 2 → 3，React 在 3 → 2 那一步直接抛错。
 *
 * ⚠️ 这里原先引的是「Rendered more hooks than during the previous render」——**引错了**，
 * 那是**另一条**错误（hook 数量变**多**时抛的，来自 `updateWorkInProgressHook`）。
 * 本条路径上是 render 结束得比上一次**早**（早退让 `useId` 根本没被调到），所以 React 报的是
 * 「少」这一侧。实测（把 `useId()` 挪到上面那个早退之后、只跑本条用例）抛出的原文是：
 *   `Error: Rendered fewer hooks than expected. This may be caused by an accidental early return statement.`
 * 引文照抄这一条，不再凭印象写。
 */
it("编辑开关往返一次后卡片照常工作（useId 必须在早退之前无条件调用）", async () => {
  const { root, host } = render(
    <EventOutlineCard data={data({ endingHook: "" })} onWriteChapter={() => {}} onSaveOutline={() => {}} />,
  )
  try {
    await act(async () => {})
    const idBefore = [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((item) => item.textContent === "用这份细纲写这一章")!.getAttribute("aria-describedby")
    expect(idBefore, "只读视图里禁用按钮应指向体检块").toBeTruthy()

    await act(async () => cardButton("手动修改", host).click())
    await act(async () => cardButton("取消编辑", host).click())

    const idAfter = [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((item) => item.textContent === "用这份细纲写这一章")!.getAttribute("aria-describedby")
    expect(idAfter, "往返之后仍应指向体检块（hook 次序没变）").toBe(idBefore)
    expect(host.querySelector(`[id="${idAfter}"]`)?.textContent).toContain("缺少全章结尾钩子")
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

/* ── F2：禁用原因必须如实说明「哪些问题表单改不了」 ── */

/*
 * 9 个事件是**表单做不到**的缺陷：编辑表单没有增删事件、也不重编号。
 * 原文案「修好后才能用这份细纲写正文」等于承诺表单能修好所有待修项，
 * 而这类用户只会对着一枚永远灰着的按钮找一个不存在的修法。
 *
 * ⚠️ 断言只要求文案**提到重新生成**、且不再出现「修好后才能」：
 * 卡片刻意不在这里重算哪些问题是结构性的（那会与 validateEventOutlineData 分叉）。
 */
it("结构性缺陷（9 个事件）时，禁用原因指向重新生成而不是承诺表单改得动", async () => {
  const events = Array.from({ length: 9 }, (_, index) => ({
    id: index + 1,
    title: `第${index + 1}个事件`,
    points: ["关键台词：台词", "神情：神情"],
  }))
  const { root, host } = render(<EventOutlineCard data={data({ events })} onWriteChapter={() => {}} />)
  try {
    await act(async () => {})
    const reason = host.querySelector("[data-event-outline-blocked-reason]")
    expect(reason, "结构不合法时禁用原因必须可见").not.toBeNull()
    expect(reason!.textContent).toContain("待修")
    expect(reason!.textContent, "事件数/序号这类结构问题在表单里修不了，出口是重新生成").toContain("重新生成")
    expect(
      reason!.textContent,
      "不得再承诺「修好后才能」——事件数与序号在表单里改不了",
    ).not.toContain("修好后才能")
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
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

/*
 * 抓手的排版（用户 2026-10-13 反馈「非常乱」）：原来四条长抓手平铺成
 * `· 一长段话`，类别词（环境物件 / 神情动作 / 关键台词 / 推进与收束）埋在句子开头，
 * 四类之间完全对不齐。现在拆成「类别列 + 正文列」——
 * 这条用例钉的是「类别与正文**确实分成了两个节点**」，而不是「文字还在」，
 * 否则把两列改回一个整行段落它照样绿。
 */
it("抓手按类别拆成两列：类别词单独成节点，正文里不再重复带类别", async () => {
  const { root, host } = render(<EventOutlineCard data={data()} />)
  try {
    await act(async () => {})
    const rows = [...host.querySelectorAll("[data-event-outline-point]")]
    expect(rows.length, "每个事件的每条抓手都要落在自己的行上").toBe(
      data().events.reduce((sum, event) => sum + event.points.length, 0),
    )
    // 「神情：念念护住屁股蛋。」——类别与正文必须是**两个**节点
    const labeled = rows.find((row) => row.textContent?.includes("念念护住屁股蛋"))
    expect(labeled).toBeDefined()
    const cells = [...labeled!.children]
    expect(cells, "类别列 + 正文列两列").toHaveLength(2)
    expect(cells[0].textContent, "类别词单独占一列").toBe("神情")
    expect(cells[1].textContent, "正文列里不再重复写一遍类别").toBe("念念护住屁股蛋。")
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

it("认不出类别的抓手整行铺满，不硬塞进类别列", async () => {
  const { root, host } = render(
    <EventOutlineCard data={data({
      events: data().events.map((event, index) => (
        index === 0 ? { ...event, points: ["令牌亮起，院外传来脚步声。"] } : event
      )),
    })} />,
  )
  try {
    await act(async () => {})
    const row = [...host.querySelectorAll("[data-event-outline-point]")]
      .find((item) => item.textContent?.includes("令牌亮起"))
    expect(row).toBeDefined()
    const cells = [...row!.children]
    expect(cells[0].textContent, "没有类别词时类别列应为空").toBe("")
    expect(cells[1].textContent).toBe("令牌亮起，院外传来脚步声。")
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

/* ── 2026-10-13：共创判「前文不足以推演」时，动作并入本卡 ── */

it("不传共创回调时不出现「换一批」「其他想法」（旧卡片不凭空多出按钮）", async () => {
  const { root, host } = render(<EventOutlineCard data={data()} onWriteChapter={() => {}} />)
  try {
    await act(async () => {})
    expect(host.querySelector('[aria-label="换一批"]')).toBeNull()
    expect(host.querySelector('[aria-label="其他想法"]')).toBeNull()
    expect(host.querySelector("[data-event-outline-discuss-note]")).toBeNull()
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

it("传入原因与两枚共创回调时，原因并入卡内且三条动作在同一张卡上", async () => {
  const onWriteChapter = vi.fn()
  const onDiscussRegenerate = vi.fn()
  const { root, host } = render(
    <EventOutlineCard
      data={data()}
      onWriteChapter={onWriteChapter}
      discussNote="原回复只给了固定情节，未提供可供挑选的多向剧情分支。"
      onDiscussRegenerate={onDiscussRegenerate}
      onDiscussCustomIdea={() => {}}
    />,
  )
  try {
    await act(async () => {})
    const note = host.querySelector("[data-event-outline-discuss-note]")
    expect(note, "原因必须并入细纲卡片，而不是另长一张卡").not.toBeNull()
    expect(note!.textContent).toContain("前文不足以推演")
    expect(note!.textContent).toContain("未提供可供挑选的多向剧情分支")
    // 三枚动作在同一张卡里
    const labels = [...host.querySelectorAll("button")].map((item) => item.textContent?.trim())
    expect(labels).toContain("用这份细纲写这一章")
    expect(labels).toContain("换一批")
    expect(labels).toContain("其他想法")
    await act(async () => cardButton("换一批", host).click())
    expect(onDiscussRegenerate).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

it("「其他想法」展开后提交作者写的走向，并把输入一起回传", async () => {
  const onDiscussCustomIdea = vi.fn()
  const { root, host } = render(
    <EventOutlineCard
      data={data()}
      onWriteChapter={() => {}}
      discussNote="前文不足以推演"
      onDiscussRegenerate={() => {}}
      onDiscussCustomIdea={onDiscussCustomIdea}
    />,
  )
  try {
    await act(async () => {})
    expect(host.querySelector('[aria-label="输入你的想法"]'), "未点开时不该有输入框").toBeNull()
    await act(async () => cardButton("其他想法", host).click())
    await act(async () => setTextareaValue(field<HTMLTextAreaElement>(host, "输入你的想法"), "让主角先躲起来再反杀"))
    await act(async () => cardButton("按这个想法重新推演", host).click())
    expect(onDiscussCustomIdea).toHaveBeenCalledWith("让主角先躲起来再反杀")
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

it("「其他想法」留空时提交按钮禁用（空想法不发起推演）", async () => {
  const onDiscussCustomIdea = vi.fn()
  const { root, host } = render(
    <EventOutlineCard
      data={data()}
      onWriteChapter={() => {}}
      discussNote="前文不足以推演"
      onDiscussCustomIdea={onDiscussCustomIdea}
    />,
  )
  try {
    await act(async () => {})
    await act(async () => cardButton("其他想法", host).click())
    const submit = cardButton("按这个想法重新推演", host)
    expect(submit.disabled).toBe(true)
    await act(async () => submit.click())
    expect(onDiscussCustomIdea).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

/* ── Tab 次序：破坏性入口不得排在卡片动作的最前 ── */

/*
 * 「丢弃这份细纲」是卡片上唯一的破坏性入口（它收掉**整条任务**，未保存的手改草稿
 * 一并没）。F4 把它从上层搬进卡片时，它被排在动作行的**最左** —— 于是它成了卡片里
 * **第一个**可聚焦控件（搬进来之前它是行尾右对齐的一个链接），Tab 一下就落在它身上。
 * 一个破坏性操作领着 Tab 次序就是请人误点，所以它排到最后（同时也就恢复了它原来的
 * 行尾位置）。
 *
 * 用 **DOM 次序**当代理：jsdom 不实现 Tab 键的焦点移动，而浏览器按 DOM 次序聚焦，
 * `querySelectorAll` 也照 DOM 次序返回 —— 这里断言的就是那个次序依据。
 * 这条用例只钉次序，标签/样式/`type="button"`/不挂 `aria-*` 由既有用例守着。
 */
it("「丢弃这份细纲」排在卡片动作的最后（破坏性入口不领 Tab 次序）", async () => {
  const { root, host } = render(
    <EventOutlineCard
      data={data()}
      onWriteChapter={() => {}}
      onRegenerate={() => {}}
      onSaveOutline={() => {}}
      onDiscard={() => {}}
    />,
  )
  try {
    await act(async () => {})
    const labels = [...host.querySelectorAll("button")].map((item) => item.textContent?.trim())
    // 反向控制：四枚入口都在，否则「排在最后」是空话
    expect(labels).toEqual(["手动修改", "重新生成", "用这份细纲写这一章", "丢弃这份细纲"])
    expect(labels.at(-1), "破坏性入口必须是最后一个可聚焦控件").toBe("丢弃这份细纲")
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
