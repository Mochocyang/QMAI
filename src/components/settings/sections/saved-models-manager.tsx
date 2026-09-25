import { confirmModelAction } from "@/components/uitest/models/model-confirm"
import { useEffect, useId, useRef, useState } from "react"
import { fetchLlmModelList } from "@/lib/settings-model-list"
import { safeModelError, validateModelEndpoint } from "@/components/uitest/models/model-feedback"
import { useModelDraftGuard } from "@/components/uitest/models/model-draft-guard"
import { ModelSecretInput } from "@/components/uitest/models/model-secret-input"
import { useTranslation } from "react-i18next"
import { Plus, Edit, Trash2, Download, TestTube, Check, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { toast } from "@/lib/toast"
import { testSettingsLlmModel } from "@/lib/settings-model-test"
import type { LlmConfig, SavedModel } from "@/stores/wiki-store"

interface SavedModelsManagerProps {
  savedModels: SavedModel[]
  onChange: (models: SavedModel[]) => void
  /** Build a full LlmConfig for connectivity tests (provider + live endpoint). */
  buildTestConfig: (model: SavedModel) => LlmConfig
  /** Hide per-model endpoint UI (e.g. Cursor CLI uses a managed local proxy). */
  hideEndpoint?: boolean
}

interface ModelFormData {
  name: string
  model: string
  apiKey: string
  customEndpoint: string
  description: string
}

export function SavedModelsManager({
  savedModels,
  onChange,
  buildTestConfig,
  hideEndpoint = false,
}: SavedModelsManagerProps) {
  const { t } = useTranslation()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [fetchingModels, setFetchingModels] = useState(false)
  const [testingModel, setTestingModel] = useState<string | null>(null)
  const [formData, setFormData] = useState<ModelFormData>({
    name: "",
    model: "",
    apiKey: "",
    customEndpoint: "",
    description: "",
  })

  const [uiTestModelOptions, setUiTestModelOptions] = useState<string[]>([])
  const uiTestAlive = useRef(true), uiTestRevision = useRef(0)
  const uiTestSignature = JSON.stringify([formData, dialogOpen, savedModels])
  const uiTestPrevious = useRef(uiTestSignature)
  if (uiTestPrevious.current !== uiTestSignature) { uiTestPrevious.current = uiTestSignature; uiTestRevision.current++ }
  useEffect(() => { uiTestAlive.current = true; return () => { uiTestAlive.current = false; uiTestRevision.current++ } }, [])
  useEffect(() => { setFetchingModels(false); setTestingModel(null) }, [uiTestSignature])
  useEffect(() => { setUiTestModelOptions([]) }, [formData.apiKey, formData.customEndpoint, dialogOpen])
  const uiTestEditorId = useId()
  const original = savedModels.find(model => model.id === editingId)
  const uiTestDirty = dialogOpen && (Object.keys(formData) as Array<keyof ModelFormData>).some(key => formData[key] !== (original?.[key] ?? ""))
  useModelDraftGuard(`model-editor:${uiTestEditorId}`, "模型编辑", uiTestDirty)
  async function closeDialog() {
    if (uiTestDirty && !(await confirmModelAction("模型编辑还有未应用的修改，确定放弃并关闭？"))) return
    setDialogOpen(false)
  }

  function openAddDialog() {
    setEditingId(null)
    setFormData({
      name: "",
      model: "",
      apiKey: "",
      customEndpoint: "",
      description: "",
    })
    setDialogOpen(true)
  }

  function openEditDialog(model: SavedModel) {
    setEditingId(model.id)
    setFormData({
      name: model.name,
      model: model.model,
      apiKey: model.apiKey || "",
      customEndpoint: model.customEndpoint || "",
      description: model.description || "",
    })
    setDialogOpen(true)
  }

  function handleSave() {
    if (!formData.name.trim() || !formData.model.trim()) {
      return
    }

    const error = !hideEndpoint && formData.customEndpoint.trim() ? validateModelEndpoint(formData.customEndpoint) : null
    if (error) { toast.error(error); return }
    if (savedModels.some(model => model.id !== editingId && model.model === formData.model.trim())) { toast.error("此模型 ID 已在列表中，请编辑原模型，避免重复添加。"); return }
    const newModel: SavedModel = {
      ...original,
      id: editingId || `model-${Date.now()}`,
      name: formData.name.trim(),
      model: formData.model.trim(),
      apiKey: formData.apiKey.trim() || undefined,
      customEndpoint: hideEndpoint
        ? undefined
        : (formData.customEndpoint.trim() || undefined),
      description: formData.description.trim() || undefined,
      createdAt: editingId
        ? savedModels.find((m) => m.id === editingId)?.createdAt || Date.now()
        : Date.now(),
    }

    if (editingId) {
      onChange(savedModels.map((m) => (m.id === editingId ? newModel : m)))
    } else {
      onChange([...savedModels, newModel])
    }

    setDialogOpen(false)
  }

  async function handleDelete(id: string) {
    const confirmed = await confirmModelAction(t("settings.sections.llm.savedModels.confirmDelete"))
    if (confirmed) {
      onChange(savedModels.filter((m) => m.id !== id))
    }
  }

  async function handleFetchModels() {
    const error = formData.customEndpoint.trim() ? validateModelEndpoint(formData.customEndpoint) : null
    if (error) { toast.error(error); return }
    const config = buildTestConfig({ id: "draft", ...formData, createdAt: 0 })
    const generation = ++uiTestRevision.current
    const current = () => uiTestAlive.current && uiTestRevision.current === generation
    setFetchingModels(true)
    try { const result = await fetchLlmModelList(config); if (current()) { setUiTestModelOptions(result.models); toast.success(`已拉取 ${result.models.length} 个模型，请从列表中选择。`) } }
    catch (error) { if (current()) toast.error(safeModelError(error, [config.apiKey, formData.apiKey])) }
    finally { if (current()) setFetchingModels(false) }
    return
  }

  async function handleTestModel(model: SavedModel) {
    if (!(await confirmModelAction(`将测试“${model.name}”，可能消耗 token 和费用；不会保存配置。是否继续？`))) return
    const config = buildTestConfig(model), generation = ++uiTestRevision.current
    const current = () => uiTestAlive.current && uiTestRevision.current === generation
    setTestingModel(model.id)
    try { await testSettingsLlmModel(config); if (current()) toast.success(`模型“${model.name}”测试通过，配置仍需单独保存。`) }
    catch (error) { if (current()) toast.error(safeModelError(error, [config.apiKey, model.apiKey ?? ""])) }
    finally { if (current()) setTestingModel(null) }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">
          {t("settings.sections.llm.savedModels.title")}
        </Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={openAddDialog}
          className="h-7 gap-1 text-xs"
        >
          <Plus className="h-3 w-3" />
          {t("settings.sections.llm.savedModels.addModel")}
        </Button>
      </div>

      {savedModels.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
          {t("settings.sections.llm.savedModels.empty")}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {savedModels.map((model) => (
            <div
              key={model.id}
              className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{model.name}</span>
                  </div>
                  <code className="mt-1 block truncate text-xs font-mono text-muted-foreground">
                    {model.model}
                  </code>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => openEditDialog(model)}
                    className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    title={t("settings.sections.llm.savedModels.edit")}
                  >
                    <Edit className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(model.id)}
                    className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    title={t("settings.sections.llm.savedModels.delete")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {model.description && (
                <p className="text-xs text-muted-foreground line-clamp-2">{model.description}</p>
              )}

              {!hideEndpoint && model.customEndpoint && (
                <p className="truncate text-xs text-muted-foreground">
                  <span className="font-medium">接口：</span>
                  {safeModelError(model.customEndpoint, [model.apiKey ?? ""])}
                </p>
              )}

              <div className="flex gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleTestModel(model)}
                  disabled={testingModel === model.id}
                  className="flex-1 h-8 text-xs"
                >
                  <TestTube className="mr-1.5 h-3.5 w-3.5" />
                  {testingModel === model.id ? "测试中..." : "测试模型"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => open ? setDialogOpen(true) : closeDialog()}>
        <DialogContent className="max-w-2xl model-editor-dialog">
          <DialogHeader>
            <DialogTitle>
              {editingId
                ? t("settings.sections.llm.savedModels.editModel")
                : t("settings.sections.llm.savedModels.addModel")}
            </DialogTitle>
            <DialogDescription>
              {t("settings.sections.llm.savedModels.dialogDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="model-name">
                {t("settings.sections.llm.savedModels.modelName")}
                <span className="text-destructive"> *</span>
              </Label>
              <Input
                id="model-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder={t("settings.sections.llm.savedModels.modelNamePlaceholder")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="model-id">
                {t("settings.sections.llm.savedModels.modelId")}
                <span className="text-destructive"> *</span>
              </Label>
              <Input
                id="model-id"
                value={formData.model}
                onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                placeholder={t("settings.sections.llm.savedModels.modelIdPlaceholder")}
              />
              {uiTestModelOptions.length > 0 && <select aria-label="已拉取模型" value={formData.model} onChange={event => setFormData({ ...formData, model: event.target.value, name: formData.name || event.target.value })} className="w-full min-w-0 rounded-md bg-muted px-3 py-2"><option value="">请选择模型</option>{formData.model && !uiTestModelOptions.includes(formData.model) && <option value={formData.model}>当前：{formData.model}</option>}{uiTestModelOptions.map(model => <option key={model} value={model}>{model}</option>)}</select>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="model-api-key">
                {t("settings.sections.llm.savedModels.apiKey")}
              </Label>
              <ModelSecretInput id="model-api-key" label="模型 API 密钥" value={formData.apiKey} onChange={apiKey => setFormData({ ...formData, apiKey })} />
              <p className="text-xs text-muted-foreground">
                {t("settings.sections.llm.savedModels.apiKeyHint")}
              </p>
            </div>

            {!hideEndpoint && (
              <div className="space-y-2">
                <Label htmlFor="model-endpoint">
                  {t("settings.sections.llm.savedModels.customEndpoint")}
                </Label>
                <Input
                  id="model-endpoint"
                  value={formData.customEndpoint}
                  onChange={(e) => setFormData({ ...formData, customEndpoint: e.target.value })}
                  placeholder={t("settings.sections.llm.savedModels.customEndpointPlaceholder")}
                />
                <p className="text-xs text-muted-foreground">
                  {t("settings.sections.llm.savedModels.customEndpointHint")}
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="model-description">
                {t("settings.sections.llm.savedModels.description")}
              </Label>
              <Input
                id="model-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder={t("settings.sections.llm.savedModels.descriptionPlaceholder")}
              />
            </div>

            <div className="flex gap-2">
              {!hideEndpoint && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleFetchModels}
                  disabled={fetchingModels}
                  className="flex-1"
                >
                  <Download className="mr-2 h-4 w-4" />
                  {fetchingModels ? "拉取中..." : "拉取模型"}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (formData.model.trim()) {
                    void handleTestModel({
                      id: "temp",
                      name: formData.name || formData.model,
                      model: formData.model,
                      apiKey: formData.apiKey || undefined,
                      customEndpoint: hideEndpoint
                        ? undefined
                        : (formData.customEndpoint || undefined),
                      createdAt: Date.now(),
                    })
                  }
                }}
                disabled={testingModel === "temp" || !formData.model.trim()}
                className="flex-1"
              >
                <TestTube className="mr-2 h-4 w-4" />
                {testingModel === "temp" ? "测试中..." : "测试模型"}
              </Button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">应用到配置后，还需点击提供方的“保存配置”才会生效。</p>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeDialog}
            >
              <X className="mr-2 h-4 w-4" />
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={!formData.name.trim() || !formData.model.trim()}
            >
              <Check className="mr-2 h-4 w-4" />
应用到配置
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
