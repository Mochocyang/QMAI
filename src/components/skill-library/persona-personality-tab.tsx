/**
 * 性格面板（方案 T2「题材卡包」）。
 *
 * ── 旧版的问题 ──
 * 一长串平铺标签：选过的、没选的、别的题材的挤在同一排；「语气 / 怪癖 / 关系 / 反差」
 * 四组共用一套「展开更多」开关，展开后一屏 80 个标签，找一条要肉眼扫完。
 *
 * ── 这一版怎么排 ──
 *   1. 最上面是**已选**，带预算条（条数 / 字数）——先看清手上有什么
 *   2. **按分类挑单个**：语气 / 怪癖 / 关系 / 反差 各占一行，不再藏起来
 *   3. 自定义输入：拒绝抽象词，只收能演出来的具体特征
 *
 * ── 绑定灵魂 ──
 * 不再是一个空输入框，而是「当前灵魂 + 更换灵魂」按钮，点开走
 * `PersonaSoulPickerDialog`（方案 S1）从角色灵魂库里挑。
 *
 * 上限 4 条是注入预算决定的（PERSONA_INJECT_PERSONALITY_MAX_TAGS），
 * 所以在 UI 上就拦住，而不是等注入时静默截断 —— 用户选了 6 条却只生效 4 条，
 * 是那种「界面没骗人但结果不对」的坑。
 */
import { useState } from "react"
import {
  PERSONALITY_TAGS,
  PERSONALITY_TAG_MAX_CHARS,
  isPerformanceTag,
  type PersonalityTagGroup,
} from "@/lib/novel/personality-tags"
import {
  PERSONA_INJECT_PERSONALITY_MAX_CHARS,
  PERSONA_INJECT_PERSONALITY_MAX_TAGS,
} from "@/lib/novel/persona-skill-types"
import { PersonaSoulPickerDialog } from "./persona-soul-picker-dialog"

const GROUPS: PersonalityTagGroup[] = ["语气", "怪癖", "关系", "反差"]

export interface PersonaPersonalityTabProps {
  tags: readonly string[]
  boundSoul: string
  raw: string
  onChange: (next: { tags: string[]; boundSoul: string }) => void
  /** 用于读角色灵魂库；缺省时「绑定灵魂」会提示需要先打开项目。 */
  projectPath?: string
  /** 弹窗标题里显示的角色名。 */
  characterName?: string
}

export function PersonaPersonalityTab({
  tags,
  boundSoul,
  raw,
  onChange,
  projectPath,
  characterName,
}: PersonaPersonalityTabProps) {
  const [custom, setCustom] = useState("")
  const [hint, setHint] = useState("")
  const [pickerOpen, setPickerOpen] = useState(false)

  const usedChars = tags.reduce((total, tag) => total + tag.length, 0)
  const full = tags.length >= PERSONA_INJECT_PERSONALITY_MAX_TAGS

  const toggle = (label: string) => {
    if (tags.includes(label)) {
      setHint("")
      onChange({ tags: tags.filter((tag) => tag !== label), boundSoul })
      return
    }
    if (full) {
      setHint(`最多选 ${PERSONA_INJECT_PERSONALITY_MAX_TAGS} 条，超出的不会进入写作注入`)
      return
    }
    setHint("")
    onChange({ tags: [...tags, label], boundSoul })
  }

  const addCustom = () => {
    const label = custom.trim()
    if (!label) return
    if (!isPerformanceTag(label)) {
      setHint(`请写能演出来的具体特征（不超过 ${PERSONALITY_TAG_MAX_CHARS} 字），例如「见到美酒走不动路」`)
      return
    }
    toggle(label)
    setCustom("")
  }

  const tagButton = (label: string) => (
    <button
      key={label}
      type="button"
      onClick={() => toggle(label)}
      aria-pressed={tags.includes(label)}
      className={`ui-test-skills-chip${tags.includes(label) ? " is-active" : ""}`}
    >
      {label}
    </button>
  )

  return (
    <div className="ui-test-ptab">
      {raw && (
        <p className="ui-test-persona-note">
          当前性格是一段手写文字，未按标签管理。改成标签会覆盖这段文字。
        </p>
      )}

      {/* 1. 绑定灵魂 —— 先说清「以谁为底子」，再挑性格 */}
      <section className="ui-test-ptab-block">
        <div className="ui-test-soul-row">
          <h6 className="ui-test-soul-label">绑定灵魂</h6>
          {boundSoul.trim() ? (
            <span className="ui-test-ptab-soul-name">
              <i aria-hidden="true">{boundSoul.trim().slice(0, 1)}</i>
              <b>{boundSoul}</b>
            </span>
          ) : (
            <span className="ui-test-soul-value">未绑定</span>
          )}
          <span className="ui-test-soul-hint">只决定「怎么演」；冲突时以性格为准</span>
          <div className="ui-test-soul-actions">
            <button
              type="button"
              data-testid="persona-soul-open"
              className="ui-test-skills-action"
              onClick={() => setPickerOpen(true)}
              disabled={!projectPath}
              title={projectPath ? undefined : "需要先打开一个项目"}
            >
              {boundSoul.trim() ? "更换灵魂" : "绑定灵魂"}
            </button>
            {boundSoul.trim() ? (
              <button
                type="button"
                data-testid="persona-soul-clear"
                className="ui-test-skills-action"
                onClick={() => onChange({ tags: [...tags], boundSoul: "" })}
              >
                解绑
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {/* 2. 已选性格 + 预算 */}
      <section className="ui-test-ptab-block">
        <header className="ui-test-ptab-head">
          <h6>性格</h6>
          <span className="ui-test-ptab-count">
            {tags.length} / {PERSONA_INJECT_PERSONALITY_MAX_TAGS} 条 · {usedChars} /{" "}
            {PERSONA_INJECT_PERSONALITY_MAX_CHARS} 字
          </span>
        </header>
        <div className="ui-test-ptab-budget" aria-hidden="true">
          <i
            style={{
              width: `${Math.min(100, (usedChars / PERSONA_INJECT_PERSONALITY_MAX_CHARS) * 100)}%`,
            }}
          />
        </div>
        {tags.length > 0 ? (
          <div className="ui-test-skills-chips">
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => toggle(tag)}
                className="ui-test-skills-chip is-active"
              >
                {tag} ×
              </button>
            ))}
          </div>
        ) : null}
        {hint && <p className="ui-test-persona-hint is-error">{hint}</p>}
      </section>

      {/* 4. 按分类挑单个 */}
      <section className="ui-test-ptab-block">
        <header className="ui-test-ptab-head">
          <h6>按分类挑单个</h6>
          <span className="ui-test-ptab-count">最多 {PERSONA_INJECT_PERSONALITY_MAX_TAGS} 条</span>
        </header>
        <div className="ui-test-ptab-groups">
          {GROUPS.map((group) => {
            const all = PERSONALITY_TAGS.filter((item) => item.group === group)
            return (
              <div key={group} className="ui-test-ptab-group">
                <span className="ui-test-ptab-group-name">{group}</span>
                <div className="ui-test-skills-chips">{all.map((item) => tagButton(item.label))}</div>
              </div>
            )
          })}
        </div>
      </section>

      {/* 5. 自定义 */}
      <section className="ui-test-ptab-block">
        <header className="ui-test-ptab-head">
          <h6>自定义输入</h6>
          <span className="ui-test-ptab-count">只收能演出来的具体特征</span>
        </header>
        <div className="ui-test-ptab-custom">
          <input
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            placeholder="例：见到美酒走不动路"
            className="ui-test-persona-input"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                addCustom()
              }
            }}
          />
          <button type="button" onClick={addCustom} className="ui-test-skills-action">
            添加
          </button>
        </div>
      </section>

      <PersonaSoulPickerDialog
        open={pickerOpen}
        projectPath={projectPath}
        characterName={(characterName ?? "").trim() || "这个角色"}
        currentSoulName={boundSoul}
        onOpenChange={setPickerOpen}
        onConfirm={(soulName) => {
          onChange({ tags: [...tags], boundSoul: soulName })
          setPickerOpen(false)
        }}
      />
    </div>
  )
}
