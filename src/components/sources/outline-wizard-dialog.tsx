import { IS_UI_TEST_BUILD } from "@/lib/ui-test"
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
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  getOutlineWizardGenres,
  getOutlineWizardValidationError,
  OUTLINE_WIZARD_CHANNEL_OPTIONS,
  OUTLINE_WIZARD_LENGTH_OPTIONS,
  OUTLINE_WIZARD_MATERIAL_OPTIONS,
  OUTLINE_WIZARD_NARRATIVE_OPTIONS,
  OUTLINE_WIZARD_SELLING_POINTS,
  OUTLINE_WIZARD_TARGETS,
  OUTLINE_WIZARD_TASK_OPTIONS,
  type OutlineWizardChannel,
  type OutlineWizardOption,
  type OutlineWizardRequest,
  type OutlineWizardExplicitField,
} from "@/lib/novel/outline-wizard"

interface OutlineWizardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (request: OutlineWizardRequest) => void
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
  if (IS_UI_TEST_BUILD) return <label className="ui-test-wizard-field"><span>{label}</span><select aria-label={label} value={value} onChange={event => onChange(event.target.value as T)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Button
            key={option.value}
            type="button"
            variant={value === option.value ? "default" : "outline"}
            size="sm"
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  )
}

export function OutlineWizardDialog({
  open,
  onOpenChange,
  onSubmit,
}: OutlineWizardDialogProps) {
  const [request, setRequest] = useState<OutlineWizardRequest>(() =>
    createDefaultOutlineWizardRequest(),
  )
  const [error, setError] = useState("")
  const genreOptions = useMemo(
    () => getOutlineWizardGenres(request.channel),
    [request.channel],
  )

  useEffect(() => {
    if (!open) return
    setRequest(createDefaultOutlineWizardRequest())
    setError("")
  }, [open])

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

  if (!open) return null

  if (IS_UI_TEST_BUILD) return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="ui-test-outline-wizard">
        <DialogHeader><DialogTitle>生成小说大纲</DialogTitle><DialogDescription>填写本次需求，发送到当前大纲会话；确认结果后再写入小说。</DialogDescription></DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="ui-test-wizard-scroll">
            <div className="ui-test-wizard-grid">
              <OptionGroup label="生成任务" options={OUTLINE_WIZARD_TASK_OPTIONS} value={request.task} onChange={task => updateRequest({ task }, ["task"])} />
              <OptionGroup label="篇幅类型" options={OUTLINE_WIZARD_LENGTH_OPTIONS} value={request.length} onChange={length => updateRequest({ length }, ["length"])} />
              <OptionGroup label="频道方向" options={OUTLINE_WIZARD_CHANNEL_OPTIONS} value={request.channel} onChange={handleChannelChange} />
              <OptionGroup label="题材类型" options={genreOptions} value={request.genre} onChange={genre => updateRequest({ genre }, ["genre"])} />
            </div>
            {request.genre === "custom" && <label className="ui-test-wizard-field"><span>自定义题材</span><Input aria-label="自定义题材" value={request.customGenre} placeholder="请输入你想要的题材" onChange={event => updateRequest({ customGenre: event.target.value }, ["customGenre"])} /></label>}
            <label className="ui-test-wizard-field"><span>故事灵感 / 处理要求</span><Textarea aria-label="故事灵感/处理要求" value={request.inspiration} placeholder="写下故事灵感、主角处境，或说明要分析、修改、补全的要求…" onChange={event => updateRequest({ inspiration: event.target.value }, ["inspiration"])} /></label>
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[85vh] w-[920px] max-w-[calc(100vw-32px)] overflow-hidden p-0 sm:max-w-[920px]"
      >
        <form onSubmit={handleSubmit} className="flex max-h-[85vh] flex-col">
          <DialogHeader className="border-b px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <DialogTitle>选择生成你想要的小说</DialogTitle>
                <DialogDescription className="mt-1">
                  先填写固定生成条件，再发送给 AI 大纲进行分析、追问和生成。
                </DialogDescription>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                关闭
              </Button>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <OptionGroup
              label="生成任务"
              options={OUTLINE_WIZARD_TASK_OPTIONS}
              value={request.task}
              onChange={(task) => updateRequest({ task }, ["task"])}
            />

            <OptionGroup
              label="篇幅类型"
              options={OUTLINE_WIZARD_LENGTH_OPTIONS}
              value={request.length}
              onChange={(length) => updateRequest({ length }, ["length"])}
            />

            <OptionGroup
              label="频道方向"
              options={OUTLINE_WIZARD_CHANNEL_OPTIONS}
              value={request.channel}
              onChange={handleChannelChange}
            />

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="outline-wizard-genre">题材类型</Label>
                <select
                  id="outline-wizard-genre"
                  value={request.genre}
                  onChange={(event) => updateRequest({ genre: event.target.value }, ["genre"])}
                  className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {genreOptions.map((genre) => (
                    <option key={genre.value} value={genre.value}>
                      {genre.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="outline-wizard-scale">作品规模</Label>
                <Input
                  id="outline-wizard-scale"
                  value={request.scale}
                  placeholder="例如：100章左右、30万字、AI 根据题材判断"
                  onChange={(event) => updateRequest({ scale: event.target.value }, ["scale"])}
                />
              </div>
            </div>

            {request.genre === "custom" && (
              <div className="space-y-2">
                <Label htmlFor="outline-wizard-custom-genre">自定义题材</Label>
                <Input
                  id="outline-wizard-custom-genre"
                  value={request.customGenre}
                  placeholder="请输入你想要的题材"
                  onChange={(event) =>
                    updateRequest({ customGenre: event.target.value }, ["customGenre"])
                  }
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="outline-wizard-inspiration">
                故事灵感/处理要求
              </Label>
              <Textarea
                id="outline-wizard-inspiration"
                value={request.inspiration}
                placeholder="写下故事灵感、主角处境、爽点方向，或说明要分析/修改/补全的处理要求"
                className="min-h-28 resize-y"
                onChange={(event) =>
                  updateRequest({ inspiration: event.target.value }, ["inspiration"])
                }
              />
            </div>

            <div className="space-y-2">
              <Label>核心卖点</Label>
              <div className="flex flex-wrap gap-2">
                {OUTLINE_WIZARD_SELLING_POINTS.map((sellingPoint) => (
                  <Button
                    key={sellingPoint}
                    type="button"
                    variant={
                      request.sellingPoints.includes(sellingPoint)
                        ? "default"
                        : "outline"
                    }
                    size="sm"
                    onClick={() =>
                      updateRequest({
                        sellingPoints: toggleListValue(
                          request.sellingPoints,
                          sellingPoint,
                        ),
                      }, ["sellingPoints"])
                    }
                  >
                    {sellingPoint}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>生成目标</Label>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {OUTLINE_WIZARD_TARGETS.map((target) => (
                  <label
                    key={target}
                    className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent"
                  >
                    <input
                      type="checkbox"
                      checked={request.targets.includes(target)}
                      onChange={() =>
                        updateRequest({
                          targets: toggleListValue(request.targets, target),
                        }, ["targets"])
                      }
                      className="h-4 w-4 accent-primary"
                    />
                    <span>{target}</span>
                  </label>
                ))}
              </div>
            </div>

            <OptionGroup
              label="叙事方式"
              options={OUTLINE_WIZARD_NARRATIVE_OPTIONS}
              value={request.narrative}
              onChange={(narrative) => updateRequest({ narrative }, ["narrative"])}
            />

            <OptionGroup
              label="已有资料来源"
              options={OUTLINE_WIZARD_MATERIAL_OPTIONS}
              value={request.materialSource}
              onChange={(materialSource) => updateRequest({ materialSource }, ["materialSource"])}
            />

            {error ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            ) : null}
          </div>

          <DialogFooter className="mx-0 mb-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit">确定生成</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
