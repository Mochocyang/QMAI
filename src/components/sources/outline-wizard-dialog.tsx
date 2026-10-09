import { useEffect, useMemo, useState, type FormEvent } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  getOutlineWizardGenres,
  getOutlineWizardValidationError,
  isFanficRequest,
  OUTLINE_WIZARD_CHANNEL_OPTIONS,
  OUTLINE_WIZARD_CREATION_OPTIONS,
  OUTLINE_WIZARD_FANFIC_DEVIATIONS,
  OUTLINE_WIZARD_FANFIC_MODE_OPTIONS,
  OUTLINE_WIZARD_LENGTH_OPTIONS,
  OUTLINE_WIZARD_MATERIAL_OPTIONS,
  OUTLINE_WIZARD_NARRATIVE_OPTIONS,
  OUTLINE_WIZARD_SELLING_POINTS,
  OUTLINE_WIZARD_TARGETS,
  OUTLINE_WIZARD_TASK_OPTIONS,
  type OutlineWizardChannel,
  type OutlineWizardCreation,
  type OutlineWizardOption,
  type OutlineWizardRequest,
  type OutlineWizardExplicitField,
} from "@/lib/novel/outline-wizard"
import { getFanficSubGenreLabels } from "@/lib/novel/outline-genres"
import { fanficCanonPath } from "@/lib/novel/fanfic-canon"
import { fileExists } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"

interface OutlineWizardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (request: OutlineWizardRequest) => void
  /** 项目路径，用于探测是否已有可复用的原作正典。 */
  projectPath?: string
}

function firstGenre(channel: OutlineWizardChannel): string {
  return getOutlineWizardGenres(channel)[0]?.value ?? "custom"
}

export function createDefaultOutlineWizardRequest(): OutlineWizardRequest {
  return {
    task: "newBook",
    length: "long",
    channel: "male",
    genre: firstGenre("male"),
    customGenre: "",
    inspiration: "",
    sellingPoints: ["AI 根据灵感推荐"],
    targets: ["完整新书规划", "章纲"],
    scale: "",
    narrative: "thirdPerson",
    materialSource: "none",
    creation: "original",
    fanficMode: "canon",
    fanficCustomMode: "",
    fanficSourceName: "",
    fanficSourceMaterial: "",
    fanficAllowedDeviations: [],
    explicit: {},
  }
}

function toggleListValue(values: string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value]
}

function OptionGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: OutlineWizardOption<T>[]
  value: T
  onChange: (value: T) => void
}) {
  return <label className="ui-test-wizard-field"><span>{label}</span><select aria-label={label} value={value} onChange={event => onChange(event.target.value as T)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
}

export function OutlineWizardDialog({
  open,
  onOpenChange,
  onSubmit,
  projectPath,
}: OutlineWizardDialogProps) {
  const [request, setRequest] = useState<OutlineWizardRequest>(() =>
    createDefaultOutlineWizardRequest(),
  )
  const [error, setError] = useState("")
  // 项目里是否已有落盘正典：决定要不要显示「复用已有正典」。
  const [hasExistingCanon, setHasExistingCanon] = useState(false)
  const genreOptions = useMemo(
    () => getOutlineWizardGenres(request.channel),
    [request.channel],
  )

  useEffect(() => {
    if (!open) return
    setRequest(createDefaultOutlineWizardRequest())
    setError("")
    let cancelled = false
    if (!projectPath) {
      setHasExistingCanon(false)
      return
    }
    void fileExists(fanficCanonPath(normalizePath(projectPath)))
      .then((exists) => {
        if (!cancelled) setHasExistingCanon(exists)
      })
      .catch(() => {
        if (!cancelled) setHasExistingCanon(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, projectPath])

  function updateRequest(
    next: Partial<OutlineWizardRequest>,
    explicitFields: OutlineWizardExplicitField[] = [],
  ) {
    setRequest((current) => ({
      ...current,
      ...next,
      explicit: {
        ...current.explicit,
        ...Object.fromEntries(explicitFields.map((field) => [field, true])),
      },
    }))
    setError("")
  }

  function handleChannelChange(channel: OutlineWizardChannel) {
    setRequest((current) => ({
      ...current,
      channel,
      genre: firstGenre(channel),
      customGenre: "",
      explicit: { ...current.explicit, channel: true, genre: undefined, customGenre: undefined },
    }))
    setError("")
  }

  function handleCreationChange(creation: OutlineWizardCreation) {
    setRequest((current) => ({
      ...current,
      creation,
      // 同人默认落在「同人衍生」题材上；切回原创时若仍停在同人衍生，回到本频道首个题材。
      genre: creation === "fanfic" ? "tongren" : current.genre === "tongren" ? firstGenre(current.channel) : current.genre,
      // 切回原创时清掉全部同人字段：虽然消费点都有 isFanficRequest 门控，
      // 但残留值一旦被别处直接读取就会误判成同人，不留这个陷阱。
      ...(creation === "fanfic"
        ? {}
        : {
            fanficMode: undefined,
            fanficCustomMode: "",
            fanficSourceName: "",
            fanficSourceMaterial: "",
            fanficAllowedDeviations: [],
            fanficReuseCanon: false,
          }),
      explicit: { ...current.explicit, creation: true },
    }))
    setError("")
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const validationError = getOutlineWizardValidationError(request)
    if (validationError) {
      setError(validationError)
      return
    }
    onSubmit(request)
    onOpenChange(false)
  }

  const fanfic = isFanficRequest(request)

  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="ui-test-outline-wizard">
        <DialogHeader><DialogTitle>生成小说大纲</DialogTitle><DialogDescription>填写本次需求，发送到当前大纲会话；确认结果后再写入小说。</DialogDescription></DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="ui-test-wizard-scroll">
            <div className="ui-test-wizard-grid">
              <OptionGroup label="生成任务" options={OUTLINE_WIZARD_TASK_OPTIONS} value={request.task} onChange={task => updateRequest({ task }, ["task"])} />
              <OptionGroup label="创作类型" options={OUTLINE_WIZARD_CREATION_OPTIONS} value={request.creation ?? "original"} onChange={handleCreationChange} />
              <OptionGroup label="篇幅类型" options={OUTLINE_WIZARD_LENGTH_OPTIONS} value={request.length} onChange={length => updateRequest({ length }, ["length"])} />
              <OptionGroup label="频道方向" options={OUTLINE_WIZARD_CHANNEL_OPTIONS} value={request.channel} onChange={handleChannelChange} />
              <OptionGroup label="题材类型" options={genreOptions} value={request.genre} onChange={genre => updateRequest({ genre }, ["genre"])} />
            </div>
            {request.genre === "custom" && <label className="ui-test-wizard-field"><span>自定义题材</span><Input aria-label="自定义题材" value={request.customGenre} placeholder="请输入你想要的题材" onChange={event => updateRequest({ customGenre: event.target.value }, ["customGenre"])} /></label>}
            {fanfic && (
              <div className="ui-test-wizard-fanfic">
                <p className="ui-test-wizard-fanfic-hint">
                  同人创作的「原作既成事实」是硬约束。请填写原作与正典素材，生成时会把它们当作不可违背的正典，
                  并要求先输出原作正典卡再写大纲。常见方向：{getFanficSubGenreLabels().join("、")}
                </p>
                <div className="ui-test-wizard-grid">
                  <label className="ui-test-wizard-field">
                    <span>原作名称（必填）</span>
                    <Input aria-label="原作名称" value={request.fanficSourceName ?? ""} placeholder="例如：斗破苍穹" onChange={event => updateRequest({ fanficSourceName: event.target.value }, ["fanficSourceName"])} />
                  </label>
                  <OptionGroup label="同人模式" options={OUTLINE_WIZARD_FANFIC_MODE_OPTIONS} value={(request.fanficMode ?? "canon") as never} onChange={fanficMode => updateRequest({ fanficMode }, ["fanficMode"])} />
                </div>
                {request.fanficMode === "custom" && (
                  <label className="ui-test-wizard-field">
                    <span>自定义模式（必填）</span>
                    <Input aria-label="自定义同人模式" value={request.fanficCustomMode ?? ""} placeholder="用一句话写清本作与原作的关系边界" onChange={event => updateRequest({ fanficCustomMode: event.target.value }, ["fanficCustomMode"])} />
                  </label>
                )}
                {hasExistingCanon && (
                  <label className="ui-test-wizard-field">
                    <span>复用已有正典</span>
                    <input
                      type="checkbox"
                      aria-label="复用已有正典"
                      checked={request.fanficReuseCanon === true}
                      onChange={event => updateRequest({ fanficReuseCanon: event.target.checked }, ["fanficReuseCanon"])}
                    />
                    <span className="ui-test-wizard-fanfic-hint">
                      项目里已有 .novel/fanfic-canon.md。勾选后直接复用它，无需重新粘贴素材，
                      也不会重复编译。
                    </span>
                  </label>
                )}
                <label className="ui-test-wizard-field">
                  <span>原作素材{request.fanficReuseCanon ? "（复用正典时可留空）" : "（必填）"}</span>
                  <Textarea aria-label="原作素材" value={request.fanficSourceMaterial ?? ""} placeholder="粘贴原作的关键设定、人物小传、时间线，或原作正文节选。超长素材会被分片编译成正典。" onChange={event => updateRequest({ fanficSourceMaterial: event.target.value }, ["fanficSourceMaterial"])} />
                </label>
                <div className="ui-test-wizard-field">
                  <span>容许偏离（不选则一切按原作正典处理）</span>
                  <div className="ui-test-wizard-chips">
                    {OUTLINE_WIZARD_FANFIC_DEVIATIONS.map(item => (
                      <button type="button" key={item} aria-pressed={(request.fanficAllowedDeviations ?? []).includes(item)} onClick={() => updateRequest({ fanficAllowedDeviations: toggleListValue(request.fanficAllowedDeviations ?? [], item) }, ["fanficAllowedDeviations"])}>{item}</button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <label className="ui-test-wizard-field"><span>故事灵感 / 处理要求</span><Textarea aria-label="故事灵感/处理要求" value={request.inspiration} placeholder={fanfic ? "写下你想在原作世界里写的新戏：谁、在什么时间点、要解决什么问题…" : "写下故事灵感、主角处境，或说明要分析、修改、补全的要求…"} onChange={event => updateRequest({ inspiration: event.target.value }, ["inspiration"])} /></label>
            <div className="ui-test-wizard-field"><span>核心卖点</span><div className="ui-test-wizard-chips">{OUTLINE_WIZARD_SELLING_POINTS.map(point => <button type="button" key={point} aria-pressed={request.sellingPoints.includes(point)} onClick={() => updateRequest({ sellingPoints: toggleListValue(request.sellingPoints, point) }, ["sellingPoints"])}>{point}</button>)}</div></div>
            <div className="ui-test-wizard-field"><span>生成目标（至少一项）</span><div className="ui-test-wizard-chips">{OUTLINE_WIZARD_TARGETS.map(target => <button type="button" key={target} aria-pressed={request.targets.includes(target)} onClick={() => updateRequest({ targets: toggleListValue(request.targets, target) }, ["targets"])}>{target}</button>)}</div></div>
            <div className="ui-test-wizard-grid">
              <label className="ui-test-wizard-field"><span>作品规模</span><Input aria-label="作品规模" value={request.scale} placeholder="例如：100章左右 / 30万字" onChange={event => updateRequest({ scale: event.target.value }, ["scale"])} /></label>
              <OptionGroup label="叙事方式" options={OUTLINE_WIZARD_NARRATIVE_OPTIONS} value={request.narrative} onChange={narrative => updateRequest({ narrative }, ["narrative"])} />
            </div>
            <OptionGroup label="已有资料来源" options={OUTLINE_WIZARD_MATERIAL_OPTIONS} value={request.materialSource} onChange={materialSource => updateRequest({ materialSource }, ["materialSource"])} />
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button type="submit">提交需求</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
