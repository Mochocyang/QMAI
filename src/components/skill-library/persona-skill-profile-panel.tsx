/**
 * 「人物 Skill」的档案面板：点开一个角色后看到的东西。
 *
 * 为什么不是一个大 textarea：人物 Skill 是**从章节里长出来的档案**，
 * 用户点开它是想确认「AI 记住了这个人哪些事」，而不是想读一段 Markdown。
 * 自由文本里「定位 / 势力组织 / 说话方式」全糊在一起，既看不出缺了什么，
 * 也没法只改一格 —— 所以这里按档案卡的方式分页签、分字段。
 *
 * 原文仍然可编辑（「原始 Markdown」页签）：结构化表单总会漏掉某种用户想写的东西，
 * 留一扇后门比假装表单能覆盖一切要诚实。
 */
import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, RefreshCw } from "lucide-react"
import {
  PERSONA_MAJOR_ROLE_TYPES,
  PERSONA_MINOR_ROLE_TYPES,
  type PersonaSkillMeta,
} from "@/lib/novel/persona-skill-types"
import {
  parsePersonaRelations,
  readPersonaDocumentFields,
  readPersonaSupplement,
} from "@/lib/novel/persona-skill-profile"

const STATUS_LABELS = { active: "活跃", dormant: "潜伏", archived: "归档" } as const
const TIER_LABELS = { major: "主要人物", minor: "次要人物" } as const

type TabKey = "basic" | "act" | "relation" | "status" | "raw"

const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: "basic", label: "基础设定" },
  { key: "act", label: "语言与行为" },
  { key: "relation", label: "关系" },
  { key: "status", label: "当前状态" },
  { key: "raw", label: "原始 Markdown" },
]

/** 基础设定里的长文本字段，顺序即界面顺序。 */
const BASIC_LONG_FIELDS = ["外貌", "性格", "背景", "动机", "能力", "成长轨迹"] as const
/** 演技字段：注入写正文时真正生效的 5 条。 */
const ACT_FIELDS = ["怎么说话", "怎么想", "怎么判断", "什么不做", "知道局限"] as const

/**
 * 由「提取记忆」自动维护的四段。放在「当前状态」页签里，和出场/版本这些
 * 元数据一起看 —— 它们回答的是同一个问题：他现在是什么处境。
 */
const LIVE_FIELDS = [
  { name: "当前状态", hint: "本章快照：身份、阵营、目标、弧光与最新处境" },
  { name: "出场组织", hint: "本章与他有证据关联的组织（成员 / 属于 / 其它关系）" },
  { name: "认知变化", hint: "他知道 / 不知道 / 刚得知的事，累积保留最近若干条" },
  { name: "关系变化", hint: "和谁的关系发生了什么变化，累积保留最近若干条" },
] as const

const ACT_HINTS: Record<(typeof ACT_FIELDS)[number], string> = {
  怎么说话: "口头禅、称呼、句长与停顿、情绪上来时的变化、绝不会说的词",
  怎么想: "遇到事情先想什么，在意什么，怕什么",
  怎么判断: "他怎么做决定：看证据、看人情，还是看利害",
  什么不做: "底线与禁忌，什么情况下也不会做的事",
  知道局限: "他认知上的盲区：不知道、误以为什么",
}

const ROLE_OPTIONS = [...PERSONA_MAJOR_ROLE_TYPES, ...PERSONA_MINOR_ROLE_TYPES]

export interface PersonaSkillProfilePanelProps {
  meta: PersonaSkillMeta
  document: string
  research: Record<string, string>
  revisionCount: number
  /** 每次保存成功 +1：正文没变（例如只改了定位）时，靠它把「未保存」重置掉。 */
  resetToken?: number
  busy: boolean
  message: string
  onBack: () => void
  onDirtyChange: (dirty: boolean) => void
  /** 保存结构化字段（含定位）。 */
  onSaveProfile: (input: { fields: Record<string, string>; roleType: string }) => void
  /** 保存原始 Markdown。 */
  onSaveRaw: (text: string) => void
  onRestoreRevision: () => void
  onRegenerateResearch: () => void
  /** 关系里点到一个已建档人物：跳到他那份档案。 */
  onOpenCharacter?: (name: string) => void
  /** 判断某个人名有没有档案（用于关系列表的「可跳转」标记）。 */
  hasCharacter?: (name: string) => boolean
}

export function PersonaSkillProfilePanel(props: PersonaSkillProfilePanelProps) {
  const { meta, document, onDirtyChange } = props
  const [tab, setTab] = useState<TabKey>("basic")
  const [fields, setFields] = useState<Record<string, string>>(() => readPersonaDocumentFields(document))
  const [raw, setRaw] = useState(document)
  const [roleType, setRoleType] = useState(meta.roleType)
  const [dirty, setDirty] = useState(false)

  // 文档换了（切换人物 / 保存后重读）就重置草稿。只在 document / resetToken 真变时触发：
  // 依赖 fields 会把用户正在敲的字打回去。
  useEffect(() => {
    setFields(readPersonaDocumentFields(document))
    setRaw(document)
    setRoleType(meta.roleType)
    setDirty(false)
    onDirtyChange(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document, meta.id, props.resetToken])

  const markDirty = () => {
    setDirty(true)
    onDirtyChange(true)
  }

  function setField(name: string, value: string) {
    // 空串要**留在键上**：`applyPersonaProfileEdits` 用「键存在但为空」表示
    // 用户清空了这一格（删除该段），用「键不存在」表示没动过（保留原值）。
    // 在这里 delete 掉空键，清空就变成了「没动过」—— 用户会发现自己删不掉东西。
    setFields((previous) => ({ ...previous, [name]: value }))
    markDirty()
  }

  const relations = useMemo(() => parsePersonaRelations(fields["关系网"] ?? ""), [fields])
  const supplement = useMemo(() => readPersonaSupplement(document), [document])
  const roleChoices = useMemo(() => {
    const current = meta.roleType.trim()
    return current && !ROLE_OPTIONS.includes(current as (typeof ROLE_OPTIONS)[number])
      ? [...ROLE_OPTIONS, current]
      : [...ROLE_OPTIONS]
  }, [meta.roleType])

  const relationCount = relations.filter((line) => line.relation).length

  function handleSave() {
    if (tab === "raw") props.onSaveRaw(raw)
    else props.onSaveProfile({ fields, roleType })
  }

  return (
    <div data-testid="persona-skill-view" className="ui-test-skills-gallery">
      <button type="button" className="ui-test-skills-back" onClick={props.onBack}>
        <ArrowLeft /> 返回人物 Skill 列表
      </button>

      <header className="ui-test-persona-hero">
        <div className="ui-test-persona-avatar" aria-hidden="true">
          {meta.characterName.slice(0, 1)}
        </div>
        <div className="ui-test-persona-hero-copy">
          <h3>{meta.characterName}</h3>
          <div className="ui-test-skill-card-badges">
            <span className="ui-test-skill-badge is-type">{TIER_LABELS[meta.tier]}</span>
            <span className="ui-test-skill-badge">{STATUS_LABELS[meta.status]}</span>
            {meta.roleType ? <span className="ui-test-skill-badge">{meta.roleType}</span> : null}
            <span className="ui-test-skill-badge">出场 {meta.appearanceCount} 次</span>
            {meta.aliases.length > 0 ? (
              <span className="ui-test-skill-badge">别名：{meta.aliases.join("、")}</span>
            ) : null}
          </div>
          <p className="ui-test-persona-hero-line">
            首次第 {meta.firstChapter} 章 · 最近第 {meta.lastChapter} 章 · 建档于第 {meta.createdChapter} 章
            {supplement ? " · 含 AI 追加观察" : ""}
          </p>
        </div>
        <div className="ui-test-persona-hero-actions">
          <span className="ui-test-persona-dirty">{dirty ? "未保存" : "已保存"}</span>
          <button
            type="button"
            data-testid="persona-profile-save"
            className="ui-test-persona-save"
            onClick={handleSave}
            disabled={props.busy}
          >
            保存角色
          </button>
        </div>
      </header>

      <div role="tablist" className="ui-test-persona-tabs">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            data-testid={`persona-profile-tab-${item.key}`}
            aria-selected={tab === item.key}
            className={`ui-test-persona-tab${tab === item.key ? " is-active" : ""}`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
            {item.key === "relation" && relationCount > 0 ? ` ${relationCount}` : ""}
          </button>
        ))}
      </div>

      {props.message ? <span className="ui-test-skills-message">{props.message}</span> : null}

      {tab === "basic" ? (
        <section data-testid="persona-profile-basic" className="ui-test-persona-panel">
          <div className="ui-test-persona-grid">
            <label className="ui-test-persona-field">
              <span>姓名</span>
              <input className="ui-test-persona-input" value={meta.characterName} readOnly />
            </label>
            <label className="ui-test-persona-field">
              <span>性别</span>
              <input
                className="ui-test-persona-input"
                data-testid="persona-field-性别"
                value={fields["性别"] ?? ""}
                placeholder="正文没写明就留空"
                onChange={(event) => setField("性别", event.target.value)}
              />
            </label>
            <label className="ui-test-persona-field">
              <span>年龄</span>
              <input
                className="ui-test-persona-input"
                data-testid="persona-field-年龄"
                value={fields["年龄"] ?? ""}
                placeholder="例如：二十出头 / 四十上下"
                onChange={(event) => setField("年龄", event.target.value)}
              />
            </label>
            <label className="ui-test-persona-field">
              <span>定位</span>
              <select
                className="ui-test-persona-input"
                data-testid="persona-field-定位"
                value={roleType}
                onChange={(event) => {
                  setRoleType(event.target.value)
                  markDirty()
                }}
              >
                <option value="">未标注</option>
                {roleChoices.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </label>
            <label className="ui-test-persona-field is-wide">
              <span>势力组织</span>
              <input
                className="ui-test-persona-input"
                data-testid="persona-field-势力组织"
                value={fields["势力组织"] ?? ""}
                placeholder="门派 / 家族 / 阵营 / 所属机构"
                onChange={(event) => setField("势力组织", event.target.value)}
              />
            </label>
          </div>

          <div className="ui-test-persona-grid">
            {BASIC_LONG_FIELDS.map((name) => (
              <label key={name} className="ui-test-persona-field">
                <span>{name}</span>
                <textarea
                  className="ui-test-persona-textarea"
                  data-testid={`persona-field-${name}`}
                  value={fields[name] ?? ""}
                  placeholder={`${name}（正文里看不出来就留空）`}
                  onChange={(event) => setField(name, event.target.value)}
                />
              </label>
            ))}
            <label className="ui-test-persona-field is-wide">
              <span>备注</span>
              <textarea
                className="ui-test-persona-textarea is-short"
                data-testid="persona-field-备注"
                value={fields["备注"] ?? ""}
                placeholder="其它确凿、但没处安放的事实"
                onChange={(event) => setField("备注", event.target.value)}
              />
            </label>
          </div>
        </section>
      ) : null}

      {tab === "act" ? (
        <section data-testid="persona-profile-act" className="ui-test-persona-panel">
          <p className="ui-test-persona-note">
            这 5 条是写正文时真正会喂给模型的「演技」——它决定这一场怎么演他。
            定位为次要人物时，只注入「怎么说话」与「怎么判断」。
          </p>
          {ACT_FIELDS.map((name) => (
            <label key={name} className="ui-test-persona-field is-wide">
              <span>
                {name}
                <em className="ui-test-persona-hint">{ACT_HINTS[name]}</em>
              </span>
              <textarea
                className="ui-test-persona-textarea"
                data-testid={`persona-field-${name}`}
                value={fields[name] ?? ""}
                onChange={(event) => setField(name, event.target.value)}
              />
            </label>
          ))}
          {supplement ? (
            <div className="ui-test-persona-note" data-testid="persona-profile-supplement">
              <strong>AI 追加观察</strong>
              <pre>{supplement}</pre>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === "relation" ? (
        <section data-testid="persona-profile-relation" className="ui-test-persona-panel">
          <label className="ui-test-persona-field is-wide">
            <span>
              关系网
              <em className="ui-test-persona-hint">每行一位：对象：关系（性质）</em>
            </span>
            <textarea
              className="ui-test-persona-textarea"
              data-testid="persona-field-关系网"
              value={fields["关系网"] ?? ""}
              placeholder={"例如：\n陆云飞：竞争对手（权力斗争）\n沈砚：旧识（互相提防）"}
              onChange={(event) => setField("关系网", event.target.value)}
            />
          </label>
          {relations.length > 0 ? (
            <ul className="ui-test-persona-relations">
              {relations.map((line, index) => {
                const openable = Boolean(props.hasCharacter?.(line.name))
                return (
                  <li key={`${line.name}-${index}`} className="ui-test-persona-relation">
                    <button
                      type="button"
                      className="ui-test-persona-relation-name"
                      disabled={!openable}
                      title={openable ? `打开「${line.name}」的档案` : "还没有这个人的档案"}
                      onClick={() => props.onOpenCharacter?.(line.name)}
                    >
                      {line.name}
                    </button>
                    {line.relation ? <span className="is-relation">{line.relation}</span> : null}
                    {line.nature ? <span className="is-nature">{line.nature}</span> : null}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="ui-test-skills-empty">
              「关系网」还没有内容。AI 会在该人物出场时补上；也可以自己写。
            </p>
          )}
        </section>
      ) : null}

      {tab === "status" ? (
        <section data-testid="persona-profile-status" className="ui-test-persona-panel">
          <dl className="ui-test-persona-facts">
            <div>
              <dt>状态</dt>
              <dd>{STATUS_LABELS[meta.status]}</dd>
            </div>
            <div>
              <dt>档位</dt>
              <dd>{TIER_LABELS[meta.tier]}{meta.pinned ? " · ★重点" : ""}</dd>
            </div>
            <div>
              <dt>出场</dt>
              <dd>{meta.appearanceCount} 次</dd>
            </div>
            <div>
              <dt>首次 / 最近</dt>
              <dd>
                第 {meta.firstChapter} 章 / 第 {meta.lastChapter} 章
              </dd>
            </div>
            <div>
              <dt>最近学习</dt>
              <dd>第 {meta.lastLearnedChapter} 章</dd>
            </div>
            <div>
              <dt>档案版本</dt>
              <dd>
                第 {meta.skillRevision} 版{meta.editedByUser ? " · 你手改过" : ""}
                {props.revisionCount > 0 ? ` · 可回退 ${props.revisionCount} 版` : ""}
              </dd>
            </div>
          </dl>

          <p className="ui-test-persona-note">
            下面四段由「提取记忆」自动维护：每次提取都会把本章的状态、出场组织、
            认知与关系写进来。<strong>手改会在下次提取时被覆盖。</strong>
          </p>

          <div className="ui-test-persona-grid">
            {LIVE_FIELDS.map((item) => (
              <label key={item.name} className="ui-test-persona-field is-wide">
                <span>
                  {item.name}
                  <em className="ui-test-persona-hint">{item.hint}</em>
                </span>
                <textarea
                  className="ui-test-persona-textarea"
                  data-testid={`persona-live-${item.name}`}
                  value={fields[item.name] ?? ""}
                  placeholder="还没有内容。下一次「提取记忆」会自动写入。"
                  onChange={(event) => setField(item.name, event.target.value)}
                />
              </label>
            ))}
          </div>

          <div className="ui-test-skills-actions">
            {props.revisionCount > 0 ? (
              <button
                type="button"
                data-testid="persona-skill-restore"
                className="ui-test-skills-action"
                title={`保留了最近 ${props.revisionCount} 个历史版本`}
                onClick={props.onRestoreRevision}
                disabled={props.busy}
              >
                回退上一版
              </button>
            ) : null}
          </div>

          {Object.keys(props.research).length > 0 && meta.pinned ? (
            <div data-testid="persona-skill-research" className="ui-test-persona-research">
              <h4>研究文件</h4>
              {Object.entries(props.research).map(([name, content]) => (
                <details key={name}>
                  <summary>{name}</summary>
                  <pre>{content}</pre>
                </details>
              ))}
              <button
                type="button"
                className="ui-test-skills-action"
                onClick={props.onRegenerateResearch}
                disabled={props.busy}
              >
                <RefreshCw /> 重新整理研究文件
              </button>
            </div>
          ) : (
            <p className="ui-test-skills-empty">
              {meta.pinned
                ? "研究文件会在该人物下次出场时自动生成。"
                : "点亮绿勾后，该人物会生成研究文件。"}
            </p>
          )}
        </section>
      ) : null}

      {tab === "raw" ? (
        <section data-testid="persona-profile-raw" className="ui-test-persona-panel">
          <p className="ui-test-persona-note">
            整份 SKILL.md 原文。改了这里就等于跳过上面的表单 ——
            标题写错（比如把「怎么说话」写成「说话方式」）会让那一格在表单里读不出来。
          </p>
          <textarea
            data-testid="persona-skill-editor"
            className="ui-test-persona-editor"
            value={raw}
            onChange={(event) => {
              setRaw(event.target.value)
              markDirty()
            }}
          />
        </section>
      ) : null}
    </div>
  )
}
