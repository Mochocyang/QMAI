import { useId, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { CustomIdeaSection } from "@/components/chat/custom-idea-section"
import {
  eventOutlineToProsePrompt,
  splitEventPointLabel,
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
  /**
   * 「丢弃这份细纲」：把**整条任务**收掉（上层 `removeTask`）。
   *
   * 为什么这枚入口必须由卡片渲染（F4）：它原先挂在上层、卡片**外面**，
   * 而上层的卡片壳看不见卡片自己的编辑态 —— 用户在表单里敲了一屏，顺手点它，
   * 草稿连同任务一起消失，连一句提示都没有。挂进卡片之后，编辑态整块替换掉
   * 只读视图，这枚入口**在 DOM 里根本不存在**，不依赖任何跨组件状态同步
   * （也就不会有「组件重挂后忘了把标志复位」这第二种 bug）。
   */
  onDiscard?: () => void
  /**
   * 共创这一轮判了「前文不足以推演」的原因（原话照抄 `judgment`）。
   *
   * 用户 2026-10-13 的要求：这种场合下模型往往**顺手把整章细纲也给了出来**
   * （只是没给多向分支），于是屏幕上会并排出现「一张能用的细纲卡」和「一张说
   * 前文不足的琥珀卡」，两张卡还各带一枚「换一批」，用户不知道按哪个。
   * 现在改成只留细纲这一张：原因以一行小字并入卡内，动作也合并到**同一条动作行**里。
   */
  discussNote?: string
  /** 共创「换一批」：按上一批判断重新推演一批走向。与 onRegenerate 是两件事。 */
  onDiscussRegenerate?: () => void
  /** 共创「其他想法」：作者自己写的走向，交给 AI 按它重新推演。 */
  onDiscussCustomIdea?: (idea: string) => void | Promise<void>
}

/**
 * 事件细纲卡片：卡片内展示 + 最多四枚入口（手动修改 / 重新生成 /
 * 用这份细纲写这一章 / 丢弃这份细纲），每枚都由对应回调是否接线决定渲染与否。
 * 上面就是渲染次序：**破坏性的「丢弃」刻意排在最后**，免得它抢在动作行首位挨误点。
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
 * - 编辑表单（下面 `EventOutlineEditor`）只持有**临时字符串草稿**，保存后整块卸载。
 *   它确实**能**与 store 里那份分叉：`outlineFromDraft(draft, data)` 拿的是
 *   **表单打开那一刻**捕获的 `data` 当底稿，未改动的字段按那份底稿写回，
 *   所以「打开表单 → outline 被别处改掉 → 保存」会把旧值写回去。
 *   今天到不了这一步，靠的是两条**组件之外**的约束，而不是本组件自己的保证：
 *   1. `awaiting-confirm` 期间 `outline` 的写者只有本卡片这一次保存（唯一写者）；
 *   2. 其它路径都会把卡片整块卸掉 —— `failTask` 置 `outline: null`、`removeTask`
 *      摘掉该行、同章 `startTask` 换一条从 `generating` 重来的新任务，卡片先退场。
 *   将来若给卡片加了「编辑期间外部也能改 outline」的入口，上面两条就不再成立，
 *   那时必须把底稿换成保存那一刻的最新 `data`（或干脆把编辑态提升到上层）。
 *
 * ⚠️ 校验失败时「用这份细纲写这一章」**不隐藏**，而是置灰 + 列出可见原因：
 * 手改改坏了就把主 CTA 抽掉，用户只会以为「功能没了」，也无从知道该改回什么。
 * 这是实施计划 §3b 第 3 条要求的**显式决定**，不是偶然行为。
 */
export function EventOutlineCard({ data, onWriteChapter, onRegenerate, onSaveOutline, onDiscard, discussNote, onDiscussRegenerate, onDiscussCustomIdea }: EventOutlineCardProps) {
  const validation = useMemo(() => validateEventOutlineData(data), [data])
  const perEventWords = data.events.length > 0 ? Math.round(data.targetWords / data.events.length) : 0
  /*
   * 禁用按钮用 aria-describedby 指向下面那份逐条体检：只说「有 N 项待修」等于让用户
   * 自己去猜是哪一项。用 useId 而不是拿 `data.chapterNumber` 拼 id —— 大纲会话里
   * **同一章可能有多张历史卡片**（同一个会话可以重出好几轮），拼章号会出现重复 id。
   */
  const problemsId = `${useId()}event-outline-problems`
  const [editing, setEditing] = useState(false)
  /*
   * 「其他想法」的内联输入态。与 chapter-discuss-card 共用 `CustomIdeaSection`，
   * 所以这几个状态与提交中的互斥判断也照那一份写：同一枚按钮在两处行为必须一致。
   */
  const [customOpen, setCustomOpen] = useState(false)
  const [customText, setCustomText] = useState("")
  const [customSubmitting, setCustomSubmitting] = useState(false)

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
        <span className="text-xs text-muted-foreground" data-event-outline-summary>
          {/*
           * 目标字数缺失（0）时**不写**「目标 0 字 · 每事件约 0 字」：那是把「没填」
           * 说成一个明确的数字，与下方「细纲体检：缺少本章目标字数」自相矛盾，
           * 用户会以为是软件把字数算成了 0。
           */}
          {data.events.length} 个事件
          {data.targetWords > 0
            ? ` · 目标 ${data.targetWords} 字 · 每事件约 ${perEventWords} 字`
            : ""}
        </span>
      </div>

      {/*
        共创判「前文不足以推演」的原因并入本卡（不再单独长出一张琥珀卡）。
        措辞说明它「不影响这份细纲可用」：用户上一次看到的是一张说前文不足的卡，
        很容易以为这份细纲也不能用，而事实相反 —— 它整份都是可写的。
      */}
      {discussNote ? (
        <div
          data-event-outline-discuss-note
          className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-xs leading-5 text-muted-foreground"
        >
          <span className="font-medium text-amber-700 dark:text-amber-300">
            共创这一轮判了「前文不足以推演」
          </span>
          <span className="mx-1">—</span>
          {discussNote}
          <span className="ml-1">这份细纲仍然可以直接拿来写这一章。</span>
        </div>
      ) : null}

      <ol className="mt-2 space-y-2">
        {data.events.map((event) => (
          <li key={event.id} className="rounded-md border border-border/60 bg-muted/20 px-2 py-1.5">
            <div className="flex items-baseline gap-1.5">
              <span className="text-xs font-semibold text-primary/70">{event.id}</span>
              <span className="text-sm font-medium leading-5">{event.title}</span>
            </div>
            {/*
              抓手按「类别列 + 正文列」排：模型把故事推进/冲突与转折/关键台词等都写成
              「类别：一长段话」，平铺成 `· 长段话` 会挤成一大片（用户 2026-10-13
              反馈「非常乱」）。类别列宽度固定，正文列自然换行，几类一眼能对齐。
              认不出的类别整行铺满，一个字都不改（见 splitEventPointLabel）。
            */}
            <ul className="mt-1 space-y-1">
              {event.points.map((point, index) => {
                const parts = splitEventPointLabel(point)
                return (
                  <li
                    key={`${event.id}-${index}`}
                    data-event-outline-point
                    /*
                     * 没有类别词时**不能**还挂着两列网格：那会留一个 4.5rem 的空标签列，
                     * 正文被白白推进一个缩进、还窄了 4.5rem —— 与注释里承诺的「整行铺满」
                     * 恰好相反（复审实测：认不出的抓手齐刷刷缩进一截，看着像层级错了）。
                     * 所以网格类是条件渲染的，无标签时正文独占整行。
                     */
                    className={
                      parts.label
                        ? "grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-x-2 text-xs leading-5"
                        : "text-xs leading-5"
                    }
                  >
                    {parts.label ? (
                      <span className="pt-px">
                        <span className="inline-block whitespace-nowrap rounded bg-muted px-1 text-[0.6875rem] text-muted-foreground">
                          {parts.label}
                        </span>
                      </span>
                    ) : null}
                    <span className="block min-w-0 whitespace-pre-wrap break-words text-foreground/90">
                      {parts.text}
                    </span>
                  </li>
                )
              })}
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
        {/* 入口各自由回调是否接线决定，互不依赖：手动修改 / 重新生成（丙-3 的「重新修改」）/
            主 CTA / 丢弃（收掉整条任务）。丢弃**排在最后**：F4 把它移进卡片时曾排在最左，
            于是它成了这一行里第一个可聚焦控件（搬进来之前它是行尾右对齐的一个链接）——
            一个破坏性入口领着 Tab 次序就是请人误点。排到最后同时也恢复了它原来的行尾位置。
            它只在只读视图里渲染（编辑态整块替换只读视图）。 */}
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
            {/*
             * ⚠️ 不合法时**照样渲染**这枚按钮，只是置灰并说明原因（见组件注释最后一段）。
             *
             * 文案里那句「结构问题改不了，需要重新生成」是**如实的**：`validateEventOutlineData`
             * 的 problems 里，事件数越界是这个表单**做不到**的一件事（表单只能改标题 / 抓手 /
             * 钩子 / 目标字数 / 要求，既不能增删事件、也不重编号），原文案「修好后才能用」会让
             * 一个 9 事件的用户对着永远灰着的按钮找一个不存在的修法。
             *
             * ⚠️ 但同一句里点名的**第二项「事件序号不连续」今天根本不可达**，这里不再把它
             * 说成「另一件表单做不到的事」（复审更正：原注释那样写是把一个死分支当成了真缺陷）：
             *   · 基础：`readEventOutline` → `normalizeEvents` **总是**按位置重编号为 1..N
             *     （该行为由 `event-outline.spec.ts` 的「把 id 重排为从 1 起的连续序号」钉住），
             *     而所有细纲都从这里进来；
             *   · 归纳：`outline` 的三个写者都不重排 id —— store 的 `finishTask` 与
             *     `updateTaskOutline` 只 `{ ...outline, chapterNumber }`，本卡片的
             *     `outlineFromDraft` 则逐条照抄草稿里的 id（表单没有增删/重排事件的能力）。
             *   于是「序号不连续」这个分支只能被**非**本链路构造的入参触发；校验器保留它是对的
             *   （`validateEventOutlineData` 契约上不假设入参已归一化，草稿直传也走这里），
             *   但卡片不必为一个不可达分支改变能力声明。
             *   ⇒ 面向用户的文案「事件数量、事件序号这类结构问题」**不算错**（泛指这一类问题），
             *     所以**有意不改文案**；错的只是这条注释原先的举例口径，已按上面更正。
             *
             * ⚠️ 刻意**不在这里重算**哪些问题是结构性的：同一份 problems 已被
             * `validateEventOutlineData` 判定过一次，在卡片里再判一遍就是两处判据，
             * 早晚分叉。所以这里只做**能力声明**（有没有「手动修改」入口），
             * 不对问题清单做任何分支。
             */}
            {!validation.ok ? (
              <span data-event-outline-blocked-reason role="status" className="text-xs text-destructive">
                细纲还有 {validation.problems.length} 项待修（详见上方「细纲体检」）：
                {onSaveOutline ? "标题、细节抓手、章尾钩子与目标字数可以点「手动修改」自己改；" : null}
                事件数量、事件序号这类结构问题改不了，需要重新生成一份细纲。
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
        {/*
          共创判「前文不足以推演」时，把「换一批」「其他想法」并进**同一条动作行**：
          原先它们是另一张琥珀卡上的两枚按钮，与这张卡的「用这份细纲写这一章」并排，
          用户得先猜「哪张卡才是现在该按的」。合并之后三条动作挨着，路径唯一。
          各自的回调没接线就不渲染（与上面几枚入口同一套契约）。
        */}
        {onDiscussRegenerate ? (
          <Button type="button" variant="outline" size="sm" onClick={onDiscussRegenerate}>
            换一批
          </Button>
        ) : null}
        {onDiscussCustomIdea ? (
          <CustomIdeaSection
            open={customOpen}
            value={customText}
            onOpenChange={setCustomOpen}
            onValueChange={setCustomText}
            onSubmit={() => {
              const idea = customText.trim()
              if (!idea || customSubmitting) return
              setCustomSubmitting(true)
              void Promise.resolve(onDiscussCustomIdea(idea)).finally(() => setCustomSubmitting(false))
            }}
            disabled={false}
            submitting={customSubmitting}
          />
        ) : null}
        {onDiscard ? (
          <button
            type="button"
            className="text-xs text-muted-foreground underline"
            onClick={onDiscard}
          >
            丢弃这份细纲
          </button>
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
 * - 目标字数照 `positiveInteger` 的口径扫第一段数字（「约3000字」也读得出来）。
 *   口径与后端保持一致是刻意的：同一段文本在卡片与 `readEventOutline` 里必须得到
 *   同一个值。代价是它**不是**一个完整的数字解析器 —— `3.5万` 读成 3、`1e5` 读成 1、
 *   全角 `３０００` 一段数字都扫不到、`-500` 读成 500。这是既有口径的既有行为
 *   （`positiveInteger` 同样如此），不是本次新引入的。
 * - 一段数字都没有时**存 0** 而不是拒绝保存：卡片会把「缺少本章目标字数」列进体检，
 *   写正文入口相应置灰并说明原因。也就是说：用户敲的**其它字段**（标题 / 抓手 /
 *   钩子 / 要求）会逐字保存，只有这个数字框里「第一段数字之外的部分」不会保留 ——
 *   别把它说成「一个字都不丢」。
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
