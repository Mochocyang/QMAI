/**
 * 「人物 Skill」的档案面板。
 *
 * 版式取自方案 G1：
 *   - 顶部一条紧凑栏：头像 + 名字 + 徽章 + 定位/出场 + 保存（一行放完，不占高度）
 *   - 下面一排页签：档案 / 性格与灵魂 / 语言与行为 / 关系与状态 / 研究文件
 *   - 每页内部用 5 列密排短字段：姓名/性别/年龄/定位/状态挤在同一行
 *
 * 两条硬约束（用户提的）：
 *   ① **短字段不许各占一行**。原来「姓名」独占一行，一屏只能看四五条，
 *      用户根本不愿意往下翻。现在一行排 5 个，档案页首屏能看到十几条。
 *   ② **必须拆子页面**。性格、灵魂、语言、关系、研究各自独立，
 *      每页都短，不再是一整条长滚动。
 *
 * 编辑方式：**零点击**——格子平时显示为文字，hover 浮出边框，点上去就能改，
 * 改完点顶栏「保存角色」。不再有「先点编辑、再点完成」那两步。
 *
 * 原文仍然可编辑（研究文件页）：结构化表单总会漏掉某种用户想写的东西。
 */
import { useEffect, useMemo, useState } from "react"
import { Check, RefreshCw } from "lucide-react"
import {
  PERSONA_INJECT_PERSONALITY_MAX_CHARS,
  PERSONA_MAJOR_ROLE_TYPES,
  PERSONA_MINOR_ROLE_TYPES,
  type PersonaSkillMeta,
} from "@/lib/novel/persona-skill-types"
import {
  parsePersonalitySection,
  parsePersonaRelations,
  readPersonaDocumentFields,
  readPersonaSupplement,
  renderPersonalitySection,
} from "@/lib/novel/persona-skill-profile"
import { PersonaDocumentView } from "./persona-document-view"
import { PersonaPersonalityTab } from "./persona-personality-tab"

const STATUS_LABELS = { active: "活跃", dormant: "潜伏", archived: "归档" } as const
const TIER_LABELS = { major: "主要人物", minor: "次要人物" } as const

/** 演技字段：注入写正文时真正生效的 5 条。 */
const ACT_FIELDS = ["怎么说话", "怎么想", "怎么判断", "什么不做", "知道局限"] as const

/** 由「提取记忆」自动维护的四段。 */
const LIVE_FIELDS = ["当前状态", "出场组织", "认知变化", "关系变化"] as const

const ROLE_OPTIONS = [...PERSONA_MAJOR_ROLE_TYPES, ...PERSONA_MINOR_ROLE_TYPES]

/** 子页面。顺序即页签顺序，也决定用户默认落在哪一页。 */
const PAGES = [
  { key: "profile", label: "档案" },
  { key: "persona", label: "性格与灵魂" },
  { key: "act", label: "语言与行为" },
  { key: "relation", label: "关系与状态" },
  { key: "research", label: "研究文件" },
] as const
type PageKey = (typeof PAGES)[number]["key"]

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
  /** 把当前角色移回候选区（建档点错了可以撤回）。 */
  onDemote?: () => void
  /** 切换「重要人物」（绿勾）。重要人物才会生成研究文件。 */
  onToggleImportant?: (next: boolean) => void
  /** 切换「随章节自动更新」。 */
  onToggleAutoUpdate?: (next: boolean) => void
  /** 从人物列表里移除这个角色（档案文件保留）。 */
  onDeletePersona?: () => void
  /** 中栏面板模式下注入的「关闭」按钮（放在顶栏右侧，避免绝对定位压住保存按钮）。 */
  /** 当前项目路径：读角色灵魂库要用。 */
  projectPath?: string
  /** 判断某个人名有没有档案（用于关系列表的「可跳转」标记）。 */
  hasCharacter?: (name: string) => boolean
}

export function PersonaSkillProfilePanel(props: PersonaSkillProfilePanelProps) {
  const { meta, document, onDirtyChange } = props
  const [fields, setFields] = useState<Record<string, string>>(() => readPersonaDocumentFields(document))
  const [raw, setRaw] = useState(document)
  const [roleType, setRoleType] = useState(meta.roleType)
  const [dirty, setDirty] = useState(false)
  const [page, setPage] = useState<PageKey>("profile")
  /**
   * H2：表格 / 并排 / MD 三态。
   * 并排 = 左边表格、右边 MD 镜像，改哪边另一边都跟着变。
   */
  const [viewMode, setViewMode] = useState<"table" | "split" | "md">("table")
  /**
   * MD 草稿。null 表示「跟着字段自动生成」。
   * 用户在 MD 里打字后它变成自己的文本；之后一旦改表格，就重置回 null ——
   * 表格是结构化真源，MD 是它的视图，改表格就该重新生成。
   */
  const [mdDraft, setMdDraft] = useState<string | null>(null)
  /** 自动保存状态：空串 = 无变化，「保存中…」= 正在写盘。 */
  const [autosaveLabel, setAutosaveLabel] = useState("")

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

  /*
   * 自动保存：改完就写，不再需要「保存角色」按钮。
   * 800ms 去抖 —— 每敲一个字就写盘会把磁盘和版本历史打爆
   * （每次保存都会存一份历史快照），但也不能等到失焦，用户会以为丢了。
   * 只在 dirty 时触发；保存成功后上层会 +resetToken，把 dirty 复位。
   */
  useEffect(() => {
    if (!dirty) return
    const timer = window.setTimeout(() => {
      setAutosaveLabel("保存中…")
      if (mdDraft !== null) props.onSaveRaw(mdDraft)
      else props.onSaveProfile({ fields, roleType })
    }, 800)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, fields, roleType, mdDraft])

  // 保存完成后把提示收回去（resetToken 变化 = 上层已重新读盘）
  useEffect(() => {
    setAutosaveLabel("")
  }, [props.resetToken, meta.id])

  const markDirty = () => {
    setDirty(true)
    onDirtyChange(true)
  }

  function setField(name: string, value: string) {
    // 空串要**留在键上**：`applyPersonaProfileEdits` 用「键存在但为空」表示
    // 用户清空了这一格（删除该段），用「键不存在」表示没动过（保留原值）。
    // 在这里 delete 掉空键，清空就变成了「没动过」—— 用户会发现自己删不掉东西。
    setFields((previous) => ({ ...previous, [name]: value }))
    // 改了表格：MD 镜像要按新字段重新生成，丢掉之前的手改草稿。
    setMdDraft(null)
    markDirty()
  }

  const relations = useMemo(() => parsePersonaRelations(fields["关系网"] ?? ""), [fields])
  const personality = useMemo(() => parsePersonalitySection(fields["性格"] ?? ""), [fields])
  const supplement = useMemo(() => readPersonaSupplement(document), [document])
  /** 已选性格的字数合计：注入预算按字数算，不按条数。 */
  const usedChars = personality.tags.reduce((total, tag) => total + tag.length, 0)



  const roleChoices = useMemo(() => {
    const current = meta.roleType.trim()
    return current && !ROLE_OPTIONS.includes(current as (typeof ROLE_OPTIONS)[number])
      ? [...ROLE_OPTIONS, current]
      : [...ROLE_OPTIONS]
  }, [meta.roleType])

  /** 一格密排字段。span 控制占几列。 */
  function Field(input: {
    name: string
    value: string
    span?: 1 | 2 | 3 | "full"
    row?: boolean
    long?: boolean
    readOnly?: boolean
    placeholder?: string
    testId?: string
  }) {
    const spanClass =
      input.span === "full" ? " is-full" : input.span && input.span > 1 ? ` is-${input.span}` : ""
    const testId = input.testId ?? `persona-field-${input.name}`
    return (
      <div className={`ui-test-fitem${spanClass}${input.row ? " is-row" : ""}`}>
        <span>{input.name}</span>
        {input.readOnly ? (
          <div className="ui-test-fed is-readonly" style={{ cursor: "default" }}>
            {input.value || "—"}
          </div>
        ) : input.long || input.row ? (
          // 整行字段装的都是句子：用 textarea，才能换行与变高。
          <textarea
            className="ui-test-fed"
            data-testid={testId}
            value={input.value}
            placeholder={input.placeholder}
            onChange={(event) => setField(input.name, event.target.value)}
          />
        ) : (
          <input
            className="ui-test-fed"
            data-testid={testId}
            value={input.value}
            placeholder={input.placeholder}
            onChange={(event) => setField(input.name, event.target.value)}
          />
        )}
      </div>
    )
  }

  return (
    <div data-testid="persona-skill-view" className="ui-test-skills-gallery ui-test-gdoc">
      {/* 顶部紧凑栏：一行放完 */}
      <header className="ui-test-gbar">
        {/* 顶栏只留名字与显示形式：出场次数、定位、章节这些在档案页里都有，
            重复摆在顶栏只会把一条栏挤成一字一行（用户实测过）。 */}
        <b className="ui-test-gbar-name" data-testid="persona-profile-name">
          {meta.characterName}
        </b>
        {/* 重要人物：绿勾放在名字后面。点了左右两端都必须立刻一致 ——
            所以除了写索引，还要 bump 版本号让左栏重读。 */}
        <label
          className="ui-test-gbar-important"
          title="标记为重要人物：会重点分析，并在出场时生成研究文件"
        >
          <input
            type="checkbox"
            data-testid="persona-mark-important"
            checked={meta.pinned}
            onChange={(event) => props.onToggleImportant?.(event.target.checked)}
          />
          <span aria-hidden="true">
            <Check />
          </span>
          <em>重要人物</em>
        </label>
        {/* 建档点错了要能撤回：移回候选区，档案留在磁盘上，只是从活跃列表移走。 */}
        <button
          type="button"
          data-testid="persona-demote-inline"
          className="ui-test-gbar-demote"
          title="移回候选区：档案文件保留，只是从「活跃角色」移走"
          onClick={() => props.onDemote?.()}
          disabled={props.busy}
        >
          移入候选角色
        </button>

        <div className="ui-test-gbar-right">
          <span className="ui-test-gbar-autosave" data-testid="persona-autosave">
            {autosaveLabel}
          </span>
          <div className="ui-test-viewseg" role="group" aria-label="显示形式">
            {([
              { key: "table", label: "表格" },
              { key: "split", label: "并排" },
              { key: "md", label: "MD" },
            ] as const).map((item) => (
              <button
                key={item.key}
                type="button"
                data-testid={`persona-viewmode-${item.key}`}
                aria-pressed={viewMode === item.key}
                className={viewMode === item.key ? "is-on" : ""}
                onClick={() => setViewMode(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* 页签 */}
      {/* 页签只在「表格」模式出现：MD / 并排 已经是整份文档，不需要再按区块跳转。 */}
      <nav className="ui-test-gtabs" role="tablist" hidden={viewMode !== "table"}>
        {PAGES.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={page === item.key}
            data-testid={`persona-page-${item.key}`}
            className={`ui-test-gtab${page === item.key ? " is-on" : ""}`}
            onClick={() => setPage(item.key)}
          >
            {item.label}
            {item.key === "persona" && personality.tags.length > 0 ? (
              <span className="n">{personality.tags.length}</span>
            ) : null}
            {item.key === "research" && Object.keys(props.research).length > 0 ? (
              <span className="n">{Object.keys(props.research).length}</span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="ui-test-gbody">
        <div className="ui-test-gbody-inner">
          <div className={`ui-test-h2-body${viewMode === "split" ? " is-split" : ""}`}>
            {/* 只看 MD 时字段区整块不渲染：留在 DOM 里会留下隐藏的可聚焦元素。 */}
            {viewMode !== "md" ? (
            <div className="ui-test-h2-fields">

          {/* ===== 档案 ===== */}
          {page === "profile" ? (
            <>
              <section className="ui-test-fsec">
                <h5>基本</h5>
                <div className="ui-test-fgrid is-2">
                  <Field name="姓名" value={meta.characterName} readOnly />
                  <Field name="性别" value={fields["性别"] ?? ""} placeholder="留空" />
                  <Field name="年龄" value={fields["年龄"] ?? ""} placeholder="二十出头" />
                  <div className="ui-test-fitem">
                    <span>定位</span>
                    <select
                      className="ui-test-fed"
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
                  </div>
                  <Field name="状态" value={STATUS_LABELS[meta.status]} readOnly />
                </div>
              </section>


              <section className="ui-test-fsec">
                <h5>归属与出场</h5>
                <div className="ui-test-fgrid is-2">
                  <Field name="势力组织" value={fields["势力组织"] ?? ""} />
                  <Field name="出场次数" value={`${meta.appearanceCount} 次`} readOnly />
                  <Field name="首次出场" value={`第 ${meta.firstChapter} 章`} readOnly />
                  <Field name="最近出场" value={`第 ${meta.lastChapter} 章`} readOnly />
                </div>
              </section>

              <section className="ui-test-fsec">
                <h5>外形 · 能力 · 成长</h5>
                {/* 这三格装的都是整句话：两列平分后每格只剩两百来像素，
                    读起来还是被切断。所以与「语言与行为」同规格，一行一条。 */}
                <div className="ui-test-frows">
                  <Field name="外貌" value={fields["外貌"] ?? ""} row placeholder="体型、衣着、伤疤、习惯性的小动作" />
                  <Field name="能力" value={fields["能力"] ?? ""} row placeholder="擅长什么、弱点在哪" />
                  <Field name="成长轨迹" value={fields["成长轨迹"] ?? ""} row placeholder="从哪来、往哪去" />
                </div>
              </section>

              <section className="ui-test-fsec">
                <h5>背景与动机</h5>
                <div className="ui-test-frows">
                  <Field name="背景" value={fields["背景"] ?? ""} row placeholder="出身、经历、现在的处境" />
                  <Field name="动机" value={fields["动机"] ?? ""} row placeholder="他想要什么" />
                </div>
              </section>

              <section className="ui-test-fsec">
                <h5>其他</h5>
                <div className="ui-test-frows" style={{ marginBottom: 11 }}>
                  <Field name="备注" value={fields["备注"] ?? ""} row placeholder="给自己看的" />
                </div>
                <div className="ui-test-fgrid is-2">
                  <Field name="建档章节" value={`第 ${meta.createdChapter} 章`} readOnly />
                  <Field name="最近学习" value={`第 ${meta.lastLearnedChapter} 章`} readOnly />
                </div>
              </section>
              <section className="ui-test-fsec">
                <h5>危险操作</h5>
                <div className="ui-test-ptab-soul">
                  <span className="ui-test-ptab-count">
                    从人物列表移除这个角色。档案文件仍留在 .qmai/persona-skills/ 下，不会删盘。
                  </span>
                  <button
                    type="button"
                    data-testid="persona-delete"
                    className="ui-test-skills-action is-danger"
                    style={{ marginLeft: "auto" }}
                    onClick={() => props.onDeletePersona?.()}
                    disabled={props.busy}
                  >
                    删除角色
                  </button>
                </div>
              </section>
            </>
          ) : null}

          {/* ===== 性格与灵魂 ===== */}
          {page === "persona" ? (
            <>
              <section className="ui-test-fsec">
                <h5>性格 · 会进入写作注入</h5>
                <PersonaPersonalityTab
                  tags={personality.tags}
                  boundSoul={personality.boundSoul}
                  raw={personality.raw}
                  projectPath={props.projectPath}
                  characterName={meta.characterName}
                  onChange={(next) => {
                    setField("性格", renderPersonalitySection({ tags: next.tags, boundSoul: next.boundSoul }))
                  }}
                />
              </section>

              {/* 注入预览不再是独立卡片：改成贴在性格区底部的虚线细条。
                  它和「性格 / 灵魂」是同一件事的上下游，独立成卡片只会和上面那块
                  形成两个并列的浅色方框（用户描述为「双蓝」）。 */}
              <div className="ui-test-injline" data-testid="persona-inject-preview">
                <span className="k">注入预览</span>
                <span className="v">
                  {personality.tags.length > 0
                    ? `人物性格：${personality.tags.join("、")}（性格优先于灵魂基线）`
                    : "还没有选性格，这一项不会进入注入。"}
                </span>
                <span className="n">
                  {usedChars} / {PERSONA_INJECT_PERSONALITY_MAX_CHARS} 字
                </span>
              </div>
            </>
          ) : null}

          {/* ===== 语言与行为 ===== */}
          {page === "act" ? (
            <>
              <section className="ui-test-fsec">
                <h5>写正文时真正喂给模型的 5 条</h5>
                {/* 这 5 条内容都不长，一行一条比两列并排更好读：
                    两列时视线要在左右之间来回跳，且长短不齐会互相撑高。 */}
                <div className="ui-test-frows">
                  {ACT_FIELDS.map((name) => (
                    <Field key={name} name={name} value={fields[name] ?? ""} long row />
                  ))}
                </div>
              </section>

              {supplement ? (
                <section className="ui-test-fsec">
                  <h5>AI 追加观察</h5>
                  <div className="ui-test-gnote" data-testid="persona-profile-supplement">
                    <pre style={{ margin: 0, whiteSpace: "pre-wrap", font: "inherit" }}>{supplement}</pre>
                  </div>
                </section>
              ) : null}
            </>
          ) : null}

          {/* ===== 关系与状态 ===== */}
          {page === "relation" ? (
            <>
              <section className="ui-test-fsec">
                <h5>关系网 · 每行一位：对象：关系（性质）</h5>
                <div className="ui-test-fgrid is-2">
                  <Field
                    name="关系网"
                    value={fields["关系网"] ?? ""}
                    long
                    span="full"
                    placeholder={"陆云飞：竞争对手（权力斗争）\n沈砚：旧识（互相提防）"}
                  />
                </div>
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

              <section className="ui-test-fsec">
                <h5>当前状态 · 由「提取记忆」自动维护，手改会被覆盖</h5>
                <div className="ui-test-ptab-soul" style={{ marginBottom: 12 }}>
                  <label className="ui-test-switch">
                    <input
                      type="checkbox"
                      data-testid="persona-auto-update"
                      checked={meta.autoUpdate !== false}
                      onChange={(event) => props.onToggleAutoUpdate?.(event.target.checked)}
                    />
                    <span>随章节自动更新</span>
                  </label>
                  <span className="ui-test-ptab-count" style={{ marginLeft: "auto" }}>
                    {meta.autoUpdate === false
                      ? "已关闭：提取记忆仍会计出场，但不再改写这份档案"
                      : "开启：每章提取后会更新下面四段"}
                  </span>
                </div>
                <div className="ui-test-fgrid is-2">
                  {LIVE_FIELDS.map((name) => (
                    <Field
                      key={name}
                      name={name}
                      value={fields[name] ?? ""}
                      long
                      testId={`persona-live-${name}`}
                      placeholder="还没有内容。下一次「提取记忆」会自动写入。"
                    />
                  ))}
                </div>
              </section>

              <section className="ui-test-fsec">
                <h5>档案版本</h5>
                <div className="ui-test-fgrid is-5">
                  <Field
                    name="档位"
                    value={`${TIER_LABELS[meta.tier]}${meta.pinned ? " · ★重点" : ""}`}
                    readOnly
                  />
                  <Field name="版本" value={`第 ${meta.skillRevision} 版`} readOnly />
                  <Field name="可回退" value={`${props.revisionCount} 版`} readOnly />
                  <Field name="手改过" value={meta.editedByUser ? "是" : "否"} readOnly />
                  <div className="ui-test-fitem">
                    <span>操作</span>
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
                    ) : (
                      <div className="ui-test-fed is-readonly" style={{ cursor: "default" }}>
                        暂无可回退版本
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </>
          ) : null}

          {/* ===== 研究文件 ===== */}
          {page === "research" ? (
            <>
              <section className="ui-test-fsec">
                <h5>研究文件 {meta.pinned ? "" : "· 点亮绿勾后才会生成"}</h5>
                {Object.keys(props.research).length > 0 && meta.pinned ? (
                  <div data-testid="persona-skill-research" className="ui-test-persona-research">
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

              <section className="ui-test-fsec">
                <h5>原始 Markdown · 整份 SKILL.md，改了等于跳过上面的表单</h5>
                <div className="ui-test-gnote" style={{ marginBottom: 8 }}>
                  标题写错（比如把「怎么说话」写成「说话方式」）会让那一格在表单里读不出来。
                </div>
                <div className="ui-test-skills-actions" style={{ marginBottom: 8 }}>
                  <button
                    type="button"
                    data-testid="persona-raw-save"
                    className="ui-test-skills-action is-primary"
                    onClick={() => props.onSaveRaw(raw)}
                    disabled={props.busy}
                  >
                    保存原文
                  </button>
                </div>
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
            </>
          ) : null}
            </div>
            ) : null}

            {viewMode !== "table" ? (
              <div className="ui-test-h2-md">
                {/* 点开即编辑：没有页签、没有「编辑原文」、没有保存按钮。
                    文档本身就是可编辑的，改完自动保存。 */}
                <div className="ui-test-h2-md-doc" data-testid="persona-md-editor">
                  <PersonaDocumentView
                    characterName={meta.characterName}
                    roleType={roleType}
                    fields={fields}
                    research={props.research}
                    injectPreview={
                      personality.tags.length > 0
                        ? `人物性格：${personality.tags.join("、")}（性格优先于灵魂基线）`
                        : "还没有选性格，这一项不会进入注入。"
                    }
                    onCommitField={(name, value) => setField(name, value)}
                  />
                </div>
              </div>
            ) : null}
        </div>
      </div>
    </div>
    </div>
  )
}
