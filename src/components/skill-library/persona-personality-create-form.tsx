/**
 * 「新建人物角色」表单。
 *
 * 为什么不复用 PersonaSkillProfilePanel：那是**已存在档案**的浏览器 ——
 * 它围绕 meta（出场次数、章节、版本历史、研究文件）组织，新建时这些都还不存在。
 * 硬塞进去要么伪造一份假 meta，要么给面板加一堆 isNew 分支，
 * 两者都会让「打开一个老角色」这条主路径变复杂。
 *
 * ⚠️ 样式必须用 `ui-test-*` 那一套（--ui-line / --ui-paper / --ui-ink 这几个变量）。
 * 早先这里写的是 Tailwind 的 `rounded border px-2 py-1`：它能编译、也能用，
 * 但配色与字体跟应用皮肤是两套 token，实测出来就是一片惨白的默认边框，
 * 和「人物 Skill」档案页完全不像同一个软件。表单类统一用：
 *   ui-test-persona-grid（两列） + ui-test-persona-field（标签在上）
 *   + ui-test-persona-input / ui-test-persona-textarea（输入框）
 */
import { useState } from "react"
import { ArrowLeft } from "lucide-react"
import { PERSONA_MAJOR_ROLE_TYPES, PERSONA_MINOR_ROLE_TYPES } from "@/lib/novel/persona-skill-types"
import { parsePersonalitySection, renderPersonalitySection } from "@/lib/novel/persona-skill-profile"
import { PersonaPersonalityTab } from "./persona-personality-tab"

const ROLE_OPTIONS = [...PERSONA_MAJOR_ROLE_TYPES, ...PERSONA_MINOR_ROLE_TYPES]

/** 基本信息里两列排布的短字段，顺序即界面顺序。 */
const BASIC_SHORT_FIELDS = ["性别", "年龄", "势力组织", "外貌"] as const
/** 角色小传：整行宽度的长文本。 */
const BASIC_LONG_FIELDS = [
  { key: "背景", hint: "出身、经历、现在的处境" },
  { key: "动机", hint: "他想要什么、为什么非做不可" },
  { key: "能力", hint: "擅长什么、弱点在哪" },
  { key: "成长轨迹", hint: "从哪里来、要往哪里去" },
] as const

export interface PersonaCreateInput {
  characterName: string
  roleType: string
  fields: Record<string, string>
  boundSoul: string
}

export interface PersonaPersonalityCreateFormProps {
  busy: boolean
  message: string
  /** 判断是否重名：重名要当场拦住，否则会静默合并进老档案。 */
  hasCharacter: (name: string) => boolean
  onCancel: () => void
  onSubmit: (input: PersonaCreateInput) => void
}

export function PersonaPersonalityCreateForm({
  busy,
  message,
  hasCharacter,
  onCancel,
  onSubmit,
}: PersonaPersonalityCreateFormProps) {
  const [name, setName] = useState("")
  const [roleType, setRoleType] = useState<string>("主角")
  const [fields, setFields] = useState<Record<string, string>>({})
  const [tags, setTags] = useState<string[]>([])
  const [boundSoul, setBoundSoul] = useState("")
  const [localError, setLocalError] = useState("")

  const setField = (key: string, value: string) => setFields((prev) => ({ ...prev, [key]: value }))

  function handleSubmit() {
    const trimmed = name.trim()
    if (!trimmed) {
      setLocalError("请先填写人物姓名")
      return
    }
    if (hasCharacter(trimmed)) {
      // 不直接合并：用户以为在新建，实际却改到了老角色，是那种「看着成功、其实写错人」的事故。
      setLocalError(`「${trimmed}」已经有档案了。请到列表里打开他继续编辑，或换一个名字。`)
      return
    }
    setLocalError("")
    const next: Record<string, string> = {}
    for (const [key, value] of Object.entries(fields)) {
      if (value.trim()) next[key] = value.trim()
    }
    if (tags.length > 0) {
      next["性格"] = renderPersonalitySection({ tags, boundSoul: "" })
    }
    onSubmit({ characterName: trimmed, roleType, fields: next, boundSoul: boundSoul.trim() })
  }

  // 新建时没有既有内容，不需要保留 raw。
  const personalityView = parsePersonalitySection("")

  return (
    <div data-testid="persona-create-form" className="ui-test-skills-gallery ui-test-pdoc">
      <div className="ui-test-pdoc-scroll">
        <div className="ui-test-pdoc-inner">
      <button type="button" className="ui-test-skills-back" onClick={onCancel}>
        <ArrowLeft /> 返回人物 Skill 列表
      </button>

      <header className="ui-test-persona-hero">
        <div className="ui-test-persona-avatar" aria-hidden="true">
          {name.trim().slice(0, 1) || "新"}
        </div>
        <div className="ui-test-persona-hero-copy">
          <h3>{name.trim() || "新建人物角色"}</h3>
          <div className="ui-test-skill-card-badges">
            <span className="ui-test-skill-badge is-type">待创建</span>
            {roleType ? <span className="ui-test-skill-badge">{roleType}</span> : null}
          </div>
          <p className="ui-test-persona-hero-line">
            保存后这个角色会同时出现在「人物小传」与人物 Skill 列表，字段与技能库中的人物 Skill 完全一致。
          </p>
        </div>
        <div className="ui-test-persona-hero-actions">
          <span className="ui-test-persona-dirty">{busy ? "正在创建" : "未保存"}</span>
          <button
            type="button"
            data-testid="persona-create-submit"
            className="ui-test-persona-save"
            disabled={busy}
            onClick={handleSubmit}
          >
            {busy ? "正在创建…" : "创建人物"}
          </button>
        </div>
      </header>

      <section className="ui-test-persona-panel">
        <p className="ui-test-persona-note">
          只有「姓名」是必填的。其余格子留空不影响创建，之后在档案里随时能补。
        </p>

        <div className="ui-test-persona-grid">
          <label className="ui-test-persona-field">
            <span>姓名</span>
            <input
              data-testid="persona-create-name"
              className="ui-test-persona-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例：林清越"
              autoFocus
            />
          </label>
          <label className="ui-test-persona-field">
            <span>定位</span>
            <select
              data-testid="persona-create-role"
              className="ui-test-persona-input"
              value={roleType}
              onChange={(event) => setRoleType(event.target.value)}
            >
              {ROLE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          {BASIC_SHORT_FIELDS.map((key) => (
            <label key={key} className="ui-test-persona-field">
              <span>{key}</span>
              <input
                data-testid={`persona-create-${key}`}
                className="ui-test-persona-input"
                value={fields[key] ?? ""}
                onChange={(event) => setField(key, event.target.value)}
              />
            </label>
          ))}
        </div>

        <div className="ui-test-persona-grid">
          {BASIC_LONG_FIELDS.map((field) => (
            <label key={field.key} className="ui-test-persona-field is-wide">
              <span>
                {field.key}
                <em className="ui-test-persona-hint">{field.hint}</em>
              </span>
              <textarea
                data-testid={`persona-create-${field.key}`}
                className="ui-test-persona-textarea is-short"
                value={fields[field.key] ?? ""}
                onChange={(event) => setField(field.key, event.target.value)}
              />
            </label>
          ))}
        </div>

        <div className="ui-test-persona-grid">
          <div className="ui-test-persona-field is-wide">
            <span>
              性格与灵魂
              <em className="ui-test-persona-hint">性格决定「演成什么样」，会进入写作注入</em>
            </span>
            <PersonaPersonalityTab
              tags={tags}
              boundSoul={boundSoul}
              raw={personalityView.raw}
              onChange={(next) => {
                setTags(next.tags)
                setBoundSoul(next.boundSoul)
              }}
            />
          </div>
        </div>

        {localError ? (
          <p className="ui-test-skills-message" data-testid="persona-create-error">
            {localError}
          </p>
        ) : null}
        {message ? <span className="ui-test-skills-message">{message}</span> : null}

        <div className="ui-test-persona-hero-actions" style={{ justifyContent: "flex-start", marginTop: 16 }}>
          <button type="button" className="ui-test-persona-save" disabled={busy} onClick={handleSubmit}>
            {busy ? "正在创建…" : "创建人物"}
          </button>
          <button type="button" className="ui-test-skills-chip" onClick={onCancel}>
            取消
          </button>
        </div>
      </section>
        </div>
      </div>
    </div>
  )
}
