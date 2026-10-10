import { useId, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  eventOutlineToProsePrompt,
  validateEventOutlineData,
  type EventOutlineData,
} from "@/lib/novel/event-outline"

interface EventOutlineCardProps {
  data: EventOutlineData
  /**
   * 点「用这份细纲写这一章」时把扩写提示词交给上层。
   *
   * ⚠️ 校验不通过时**不隐藏**这枚按钮（旧行为），而是置灰 + 给出可见原因 ——
   * 详见组件注释最后一段。
   */
  onWriteChapter?: (prompt: string) => void
  /**
   * 「重新生成」：用原请求重出一份（丙-3a）。
   *
   * 本组件只回传「用户点了」这个意图，不自己发起生成：原始请求存在
   * `EventOutlineTask.request` 上，重跑那条通路（含中止被取代的生成）属于上层。
   * 不传该回调时不渲染这枚按钮 —— 大纲会话里那些**旧会话**的卡片就是这种情形。
   */
  onRegenerate?: () => void
  /** 「手动修改」保存（丙-3b）：回传整份改后的细纲，由上层写回 `task.outline`。 */
  onSaveOutline?: (outline: EventOutlineData) => void
}

/**
 * 事件细纲卡片：卡片内展示 + 三枚入口（手动修改 / 重新生成 / 用这份细纲写这一章）。
 *
 * ⚠️ 本组件**曾经刻意不做卡片内编辑**，原注释写的是「修改事件靠在大纲对话里说
 * 『第 3 个事件改成……』重出一轮，这样生成与修改走同一条链路」。用户 2026-10-10
 * 明确要求「用户可以手动去编辑，也可以让 AI 重新生成」，所以那条决定被**有意推翻**
 * （实施计划 §3b）：手改是需求本身，不是能靠对话迂回掉的东西。
 *
 * 推翻之后，原注释担心的「界面里改过、模型不知道」并没有消失，只是换了承载方式：
 * - 手改的落点是 `EventOutlineTask.outline`（store 的 `updateTaskOutline`，
 *   **只改这一个字段**、不碰 status：手改不是确认，任务仍停在 awaiting-confirm，
 *   否则卡片会整块消失，用户看到的是「改坏了」）；
 * - 本组件**不持有**细纲数据：`data` 由上层从 `task.outline` 传入，保存后仍由上层
 *   把新的 `task.outline` 传回来。于是卡片渲染与
 *   `onWriteChapter(eventOutlineToProsePrompt(data))` 读的是**同一个对象**，
 *   不存在「组件里一份、store 里一份」的双份真相；
 * - 编辑表单（下面 `EventOutlineEditor`）只持有**临时字符串草稿**，它不参与任何
 *   下游取值，保存后整块卸载 —— 唯一真相始终是 store 里那份。
 *
 * ⚠️ 校验失败时「用这份细纲写这一章」**不隐藏**，而是置灰 + 列出可见原因：
 * 手改改坏了就把主 CTA 抽掉，用户只会以为「功能没了」，也无从知道该改回什么。
 * 这是实施计划 §3b 第 3 条要求的**显式决定**，不是偶然行为。
 */
export function EventOutlineCard({ data, onWriteChapter, onRegenerate, onSaveOutline }: EventOutlineCardProps) {
  const validation = useMemo(() => validateEventOutlineData(data), [data])
  const perEventWords = data.events.length > 0 ? Math.round(data.targetWords / data.events.length) : 0
  /*
   * 禁用按钮用 aria-describedby 指向下面那份逐条体检：只说「有 N 项待修」等于让用户
   * 自己去猜是哪一项。用 useId 而不是拿 `data.chapterNumber` 拼 id —— 大纲会话里
   * **同一章可能有多张历史卡片**（同一个会话可以重出好几轮），拼章号会出现重复 id。
   */
  const problemsId = `${useId()}event-outline-problems`
  const [editing, setEditing] = useState(false)

  if (editing && onSaveOutline) {
    return (
      <EventOutlineEditor
        data={data}
        onCancel={() => setEditing(false)}
        onSave={(next) => {
          // 先关表单再回传：回传之后真相归上层，本组件不缓存「刚保存的那份」。
          setEditing(false)
          onSaveOutline(next)
        }}
      />
    )
  }

  return (
    <div className="mt-2 rounded-lg border bg-background/60 p-3 text-sm" data-event-outline-card>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <strong className="text-sm">{data.title || `第${data.chapterNumber}章 · 事件细纲`}</strong>
        <span className="text-xs text-muted-foreground">
          {data.events.length} 个事件 · 目标 {data.targetWords} 字 · 每事件约 {perEventWords} 字
        </span>
      </div>

      <ol className="space-y-2">
        {data.events.map((event) => (
          <li key={event.id} className="rounded border-l-2 border-primary/40 pl-2">
            <div className="font-medium">{event.id}. {event.title}</div>
            <ul className="mt-0.5 space-y-0.5 text-xs text-muted-foreground">
              {event.points.map((point, index) => (
                <li key={`${event.id}-${index}`}>· {point}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      {data.endingHook ? (
        <p className="mt-2 text-xs">
          <span className="text-muted-foreground">章尾钩子：</span>{data.endingHook}
        </p>
      ) : null}

      {validation.problems.length > 0 ? (
        <div
          id={problemsId}
          data-event-outline-problems
          className="mt-2 rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive"
        >
          <div className="font-medium">细纲体检：{validation.problems.length} 项待修（仍可保存）</div>
          <ul className="mt-1 space-y-0.5">
            {validation.problems.map((problem, index) => (
              <li key={index}>· {problem}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* 软性提示（字数分配一类）只提示、不阻断扩写：项目单章目标字数可到 10000，
          固定的事件字数区间不可能是硬的。 */}
      {validation.advisories.length > 0 ? (
        <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-muted-foreground">
          <div className="font-medium">节奏提示：{validation.advisories.length} 条</div>
          <ul className="mt-1 space-y-0.5">
            {validation.advisories.map((advisory, index) => (
              <li key={index}>· {advisory}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        {/* 「重新修改」的两个动作（丙-3）。各自由回调是否接线决定，互不依赖。 */}
        {onSaveOutline ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
            手动修改
          </Button>
        ) : null}
        {onRegenerate ? (
          <Button type="button" variant="outline" size="sm" onClick={onRegenerate}>
            重新生成
          </Button>
        ) : null}
        {onWriteChapter ? (
          <>
            {/* ⚠️ 不合法时**照样渲染**这枚按钮，只是置灰并说明原因（见组件注释最后一段）。 */}
            {!validation.ok ? (
              <span data-event-outline-blocked-reason role="status" className="text-xs text-destructive">
                细纲还有 {validation.problems.length} 项待修，修好后才能用这份细纲写正文（详见上方「细纲体检」）。
              </span>
            ) : null}
            <Button
              type="button"
              size="sm"
              disabled={!validation.ok}
              aria-describedby={validation.ok ? undefined : problemsId}
              onClick={() => onWriteChapter(eventOutlineToProsePrompt(data))}
            >
              用这份细纲写这一章
            </Button>
          </>
        ) : null}
      </div>
    </div>
  )
}

interface EventOutlineEditorProps {
  data: EventOutlineData
  onCancel: () => void
  onSave: (outline: EventOutlineData) => void
}

/**
 * 卡片内的手动编辑表单（丙-3b）。
 *
 * 字段风格照 `event-outline-wizard-dialog.tsx`（`ui-test-wizard-field` + `Input`/`Textarea`），
 * 但**不复用那个对话框组件**：它的字段是「生成请求」（章号/事件数/目标字数/要求），
 * 与「已生成的细纲内容」是两个不同的数据形状，硬凑成一套 props 只会让两边都变形。
 *
 * 草稿是**字符串**（见 `EventOutlineDraft` 的注释），只在保存那一刻转成
 * `EventOutlineData`，且**不做校验、不拒绝保存**：见实施计划 §3b 第 3 条的显式决定。
 */
function EventOutlineEditor({ data, onCancel, onSave }: EventOutlineEditorProps) {
  const [draft, setDraft] = useState<EventOutlineDraft>(() => draftFrom(data))

  return (
    <div
      className="mt-2 space-y-3 rounded-lg border bg-background/60 p-3 text-sm"
      data-event-outline-card
      data-event-outline-editing
    >
      <div className="ui-test-wizard-grid">
        <label className="ui-test-wizard-field">
          <span>细纲标题</span>
          <Input
            aria-label="细纲标题"
            value={draft.title}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
          />
        </label>
        {/*
          章号**刻意不在表单里**：它是任务的权威（store 的 finishTask / updateTaskOutline
          都以任务章号覆盖数据里的章号），在这里再给一个能改的章号就是第二份真相 ——
          提示词会写「写出第 7 章正文」，而文件写在第 3 章上。
        */}
        <label className="ui-test-wizard-field">
          <span>本章目标字数</span>
          <Input
            aria-label="细纲目标字数"
            value={draft.targetWords}
            onChange={(event) => setDraft((current) => ({ ...current, targetWords: event.target.value }))}
          />
        </label>
      </div>

      {draft.events.map((event, index) => (
        <div key={`${event.id}-${index}`} className="space-y-2 rounded border-l-2 border-primary/40 pl-2">
          {/* 序号用事件自己的 id：与只读视图里那个编号是同一个，用户才对得上。 */}
          <div className="text-xs text-muted-foreground">事件 {event.id}</div>
          <label className="ui-test-wizard-field">
            <span>一句话标题</span>
            <Input
              aria-label={`事件${event.id}的一句话标题`}
              value={event.title}
              onChange={(inputEvent) => setDraft((current) => patchDraftEvent(current, index, {
                title: inputEvent.target.value,
              }))}
            />
          </label>
          <label className="ui-test-wizard-field">
            <span>细节抓手（每行一条）</span>
            <Textarea
              aria-label={`事件${event.id}的细节抓手`}
              value={event.pointsText}
              onChange={(inputEvent) => setDraft((current) => patchDraftEvent(current, index, {
                pointsText: inputEvent.target.value,
              }))}
            />
          </label>
        </div>
      ))}

      <label className="ui-test-wizard-field">
        <span>章尾钩子</span>
        <Textarea
          aria-label="细纲章尾钩子"
          value={draft.endingHook}
          onChange={(event) => setDraft((current) => ({ ...current, endingHook: event.target.value }))}
        />
      </label>
      <label className="ui-test-wizard-field">
        <span>本章要求（可选）</span>
        <Textarea
          aria-label="细纲本章要求"
          value={draft.requirement}
          placeholder="例如：这一章要让主角第一次动用令牌。"
          onChange={(event) => setDraft((current) => ({ ...current, requirement: event.target.value }))}
        />
      </label>

      <div className="flex justify-end gap-2">
        {/* 「取消编辑」= 丢掉草稿，不改任何数据（草稿只活在这次编辑里）。 */}
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>取消编辑</Button>
        <Button type="button" size="sm" onClick={() => onSave(outlineFromDraft(draft, data))}>
          保存细纲
        </Button>
      </div>
    </div>
  )
}

/**
 * 编辑草稿：字段全是字符串。
 *
 * 为什么不让表单直接编辑 `EventOutlineData`：数字字段（目标字数）在输入途中必然出现
 * `""` / `"3"` / `"三千字"` 这类**暂时不合法**的中间态，直接改结构对象就得在每次
 * onChange 里做转换，用户的输入会被边打边改写（`Number("")` 是 0，退格删空就永久变 0）。
 * 草稿只在保存那一刻转一次，且**不校验、不拒绝**（见实施计划 §3b 第 3 条的显式决定）。
 */
interface EventOutlineDraft {
  title: string
  targetWords: string
  events: Array<{ id: number; title: string; pointsText: string }>
  endingHook: string
  requirement: string
}

function draftFrom(data: EventOutlineData): EventOutlineDraft {
  return {
    title: data.title,
    targetWords: String(data.targetWords),
    // points 逐行铺开：一个 textarea 承载整个列表，增删抓手就是增删行。
    events: data.events.map((event) => ({
      id: event.id,
      title: event.title,
      pointsText: event.points.join("\n"),
    })),
    endingHook: data.endingHook,
    requirement: data.requirement ?? "",
  }
}

function patchDraftEvent(
  draft: EventOutlineDraft,
  index: number,
  patch: Partial<{ title: string; pointsText: string }>,
): EventOutlineDraft {
  return {
    ...draft,
    events: draft.events.map((event, eventIndex) => (
      eventIndex === index ? { ...event, ...patch } : event
    )),
  }
}

/**
 * 草稿 → 细纲数据。
 *
 * - `id` 原样保留（不按位置重编号）：手改的是**文字**，不该顺手替用户重排结构；
 *   真有断号时校验会把它列进「细纲体检」，用户可以选择重新生成。
 * - 抓手按行拆、去空白、丢空行：否则多敲一个回车就变成一条空抓手，
 *   让「2~5 条」的校验无端变红。
 * - 目标字数照 `positiveInteger` 的口径扫第一段数字（「约3000字」也读得出来），
 *   一段数字都没有时**存 0** 而不是拒绝保存：卡片会把「缺少本章目标字数」列进体检，
 *   写正文入口相应置灰并说明原因 —— 用户刚敲的内容一个字都不丢。
 * - `requirement` 为空时写回 `undefined` 而不是空串：读旧数据那一侧
 *   （`readEventOutline`）用的是 `|| undefined`，两处口径要一致，
 *   免得「空要求」与「没有要求」变成两种空值。
 */
function outlineFromDraft(draft: EventOutlineDraft, data: EventOutlineData): EventOutlineData {
  return {
    ...data,
    title: draft.title.trim(),
    targetWords: parseTargetWords(draft.targetWords),
    events: draft.events.map((event) => ({
      id: event.id,
      title: event.title.trim(),
      points: event.pointsText
        .split("\n")
        .map((point) => point.trim())
        .filter(Boolean),
    })),
    endingHook: draft.endingHook.trim(),
    requirement: draft.requirement.trim() || undefined,
  }
}

function parseTargetWords(value: string): number {
  const digits = value.match(/\d+/)?.[0]
  const parsed = digits ? Number.parseInt(digits, 10) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}
