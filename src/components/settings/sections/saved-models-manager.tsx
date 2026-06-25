import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Plus, Edit, Trash2, Check, X, Download, TestTube } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { toast } from "@/lib/toast"
import type { SavedModel } from "@/stores/wiki-store"

interface SavedModelsManagerProps {
  savedModels: SavedModel[]
  onChange: (models: SavedModel[]) => void
}

interface ModelFormData {
  name: string
  model: string
  apiKey: string
  customEndpoint: string
  description: string
}

export function SavedModelsManager({ savedModels, onChange }: SavedModelsManagerProps) {
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

    const newModel: SavedModel = {
      id: editingId || `model-${Date.now()}`,
      name: formData.name.trim(),
      model: formData.model.trim(),
      apiKey: formData.apiKey.trim() || undefined,
      customEndpoint: formData.customEndpoint.trim() || undefined,
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

  function handleDelete(id: string) {
    if (confirm(t("settings.sections.llm.savedModels.confirmDelete"))) {
      onChange(savedModels.filter((m) => m.id !== id))
    }
  }

  async function handleFetchModels() {
    setFetchingModels(true)
    try {
      const endpoint = formData.customEndpoint.trim() || ""
      const apiKey = formData.apiKey.trim() || ""

      if (!endpoint) {
        toast.error("请先填写接口地址")
        return
      }

      const response = await fetch(`${endpoint}/models`, {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const data = await response.json()
      const models = data.data || []

      toast.success(`已拉取 ${models.length} 个模型`)
      console.log("Available models:", models)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "未知错误")
    } finally {
      setFetchingModels(false)
    }
  }

  async function handleTestModel(model: SavedModel) {
    setTestingModel(model.id)
    try {
      const endpoint = model.customEndpoint || ""
      const apiKey = model.apiKey || ""

      if (!endpoint) {
        toast.error("该模型未配置接口地址")
        return
      }

      const response = await fetch(`${endpoint}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: model.model,
          messages: [{ role: "user", content: "Hi" }],
          max_tokens: 10,
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const data = await response.json()

      toast.success(`模型 ${model.name} 可正常使用`)
      console.log("Test response:", data)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "未知错误")
    } finally {
      setTestingModel(null)
    }
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

              {model.customEndpoint && (
                <p className="truncate text-xs text-muted-foreground">
                  <span className="font-medium">接口：</span>
                  {model.customEndpoint}
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
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
            </div>

            <div className="space-y-2">
              <Label htmlFor="model-api-key">
                {t("settings.sections.llm.savedModels.apiKey")}
              </Label>
              <Input
                id="model-api-key"
                type="password"
                value={formData.apiKey}
                onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                placeholder={t("settings.sections.llm.savedModels.apiKeyPlaceholder")}
              />
              <p className="text-xs text-muted-foreground">
                {t("settings.sections.llm.savedModels.apiKeyHint")}
              </p>
            </div>

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
              <Button
                type="button"
                variant="outline"
                onClick={handleFetchModels}
                disabled={fetchingModels || !formData.customEndpoint.trim()}
                className="flex-1"
              >
                <Download className="mr-2 h-4 w-4" />
                {fetchingModels ? "拉取中..." : "拉取模型"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (formData.model.trim()) {
                    handleTestModel({
                      id: "temp",
                      name: formData.name,
                      model: formData.model,
                      apiKey: formData.apiKey || undefined,
                      customEndpoint: formData.customEndpoint || undefined,
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

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
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
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
