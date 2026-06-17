import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Plus, Edit, Trash2, Check, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { SavedModel } from "@/stores/wiki-store"

interface SavedModelsManagerProps {
  savedModels: SavedModel[]
  presetId: string
  onChange: (models: SavedModel[]) => void
}

interface ModelFormData {
  name: string
  model: string
  apiKey: string
  customEndpoint: string
  description: string
}

export function SavedModelsManager({ savedModels, presetId, onChange }: SavedModelsManagerProps) {
  const { t } = useTranslation()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
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
        <div className="space-y-2">
          {savedModels.map((model) => (
            <div
              key={model.id}
              className="flex items-start gap-2 rounded-md border bg-background/50 p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{model.name}</span>
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                    {model.model}
                  </code>
                </div>
                {model.description && (
                  <p className="mt-1 text-xs text-muted-foreground">{model.description}</p>
                )}
                {model.customEndpoint && (
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {t("settings.sections.llm.savedModels.endpoint")}: {model.customEndpoint}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => openEditDialog(model)}
                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  title={t("settings.sections.llm.savedModels.edit")}
                >
                  <Edit className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(model.id)}
                  className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  title={t("settings.sections.llm.savedModels.delete")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
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
