/**
 * 人物档案的「整页文档」视图（方案 N1 + 研究文件 R2）。
 *
 * ── 为什么不是 iframe ──
 * 之前用 iframe + srcdoc 渲染文档，好处是排版隔离，坏处是**改不了**：
 * iframe 里要回写内容需要 allow-same-origin + 一堆 DOM 抓取，还得再加一个
 * 「编辑原文」按钮切到另一套视图。用户明确要求「点开就能改、不要按钮」，
 * 所以这里改成普通 React 渲染：文档排版由 CSS 提供，每个字段的值是一个
 * `contentEditable` 行内块，点进去就能输入。
 *
 * ── 为什么只在 blur 提交 ──
 * contentEditable 若每次输入都 setState 回写，React 重渲染会把光标顶到行首。
 * 所以输入过程中**不**改 React 状态（DOM 自己维护内容），失焦时读一次
 * textContent 提交 —— 上层据此走既有的自动保存。
 *
 * ── 研究文件为什么折叠 ──
 * 6 份、每份 200–600 字，全铺开会把档案正文冲淡（方案 R1 的代价）。
 * R2 让每份默认收起，只显示标题 / 状态 / 字数，点开才读。
 */
import { PERSONA_RESEARCH_DOCUMENTS } from "@/lib/novel/persona-skill-types"

export interface PersonaDocumentViewProps {
  characterName: string
  roleType: string
  fields: Record<string, string>
  research: Record<string, string>
  /** 已生成的注入预览文本（只读，不可编辑）。 */
  injectPreview: string
  /** 提交某个字段的新值（来自 contentEditable 失焦）。 */
  onCommitField: (name: string, value: string) => void
}

interface SectionSpec {
  title: string
  fields: ReadonlyArray<string>
}

/**
 * 文档的固定结构：四章 + 研究文件。
 *
 * 顺序刻意与「表格」页一致（档案在前、演技居中、动态在后），
 * 这样两种视图滚动时看到的是同一个顺序，不会读着读着走失。
 */
const SECTIONS: ReadonlyArray<SectionSpec> = [
  { title: "基本信息", fields: ["性别", "年龄", "势力组织", "外貌"] },
  { title: "性格与灵魂", fields: ["性格"] },
  { title: "语言与行为", fields: ["怎么说话", "怎么想", "怎么判断", "什么不做", "知道局限"] },
  { title: "关系与状态", fields: ["关系网", "当前状态", "出场组织", "认知变化", "关系变化", "备注"] },
]

export function PersonaDocumentView(props: PersonaDocumentViewProps) {
  const { characterName, roleType, fields, research, injectPreview, onCommitField } = props

  const summaryParts = [
    roleType.trim() || "未标注定位",
    (fields["性别"] ?? "").trim(),
    (fields["年龄"] ?? "").trim(),
    (fields["势力组织"] ?? "").trim(),
  ].filter(Boolean)

  return (
    <article className="ui-test-pdoc-doc" data-testid="persona-doc-view">
      <h1>{characterName} · 人物 Skill</h1>
      {summaryParts.length > 0 ? <p className="ui-test-pdoc-meta">{summaryParts.join(" · ")}</p> : null}

      {SECTIONS.map((section) => (
        <section key={section.title}>
          <h2>{section.title}</h2>
          {section.fields.map((name) => (
            <p key={name} className="ui-test-pdoc-row">
              <b>{name}：</b>
              <EditableValue
                name={name}
                value={fields[name] ?? ""}
                onCommit={onCommitField}
              />
            </p>
          ))}
          {section.title === "性格与灵魂" ? (
            <p className="ui-test-pdoc-row is-static">
              <b>注入预览：</b>
              <span className="ui-test-pdoc-readonly">{injectPreview}</span>
            </p>
          ) : null}
        </section>
      ))}

      <section>
        <h2>
          研究文件
          <span className="ui-test-pdoc-count">
            {PERSONA_RESEARCH_DOCUMENTS.length} 份 ·{" "}
            {PERSONA_RESEARCH_DOCUMENTS.filter((name) => (research[name] ?? "").trim()).length} 份已生成
          </span>
        </h2>
        {PERSONA_RESEARCH_DOCUMENTS.map((name) => {
          const content = (research[name] ?? "").trim()
          return (
            <details key={name} className="ui-test-pdoc-fold">
              <summary>
                <b>{name}</b>
                {content ? (
                  <span className="ui-test-pdoc-tag">已生成</span>
                ) : (
                  <span className="ui-test-pdoc-tag is-none">未生成</span>
                )}
                {content ? <span className="ui-test-pdoc-count">约 {content.length} 字</span> : null}
              </summary>
              <div className="ui-test-pdoc-fold-body">
                {content ? (
                  content.split(/\n{2,}/).map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))
                ) : (
                  <p className="ui-test-pdoc-empty">（未生成）</p>
                )}
              </div>
            </details>
          )
        })}
      </section>
    </article>
  )
}

/**
 * 文档里的一个可编辑值。
 *
 * 空值显示「（未填）」占位：用 CSS 的 `:empty::before` 实现，**不写进 DOM**，
 * 否则占位文字会被当成用户输入提交回字段（那是凭空往档案里写内容）。
 */
function EditableValue(input: {
  name: string
  value: string
  onCommit: (name: string, value: string) => void
}) {
  return (
    <span
      className="ui-test-pdoc-value"
      data-placeholder="（未填）"
      data-testid={`persona-doc-field-${input.name}`}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      onBlur={(event) => {
        const next = event.currentTarget.textContent ?? ""
        const normalized = next.replace(/\u00a0/g, " ").trim()
        if (normalized !== input.value.trim()) input.onCommit(input.name, normalized)
      }}
    >
      {input.value}
    </span>
  )
}
