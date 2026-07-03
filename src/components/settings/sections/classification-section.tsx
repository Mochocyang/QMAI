import { useState, useEffect, useCallback, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { FileText, AlertTriangle, CheckCircle2, RefreshCw, RotateCcw, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ModifyConfirmDialog } from "@/components/chat/modify-confirm-dialog"
import {
  initProjectClassification,
  loadProjectClassification,
  readProjectClassificationRaw,
  writeProjectClassification,
  checkClassificationVersion,
  DEFAULT_CLASSIFICATION_CONFIG,
  deserializeClassificationFromMarkdown,
  serializeClassificationToMarkdown,
} from "@/lib/novel/classification"
import { normalizePath } from "@/lib/path-utils"

interface Props {
  projectPath?: string
}

export function ClassificationSection({ projectPath }: Props) {
  const { t } = useTranslation()
  const [classificationStatus, setClassificationStatus] = useState<
    "loading" | "not_created" | "valid" | "invalid"
  >("loading")
  const [statusMessage, setStatusMessage] = useState("")
  const [editingContent, setEditingContent] = useState("")
  const [saveStatus, setSaveStatus] = useState("")
  const [isBusy, setIsBusy] = useState(false)
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false)

  const defaultClassificationMarkdown = useMemo(
    () => serializeClassificationToMarkdown(DEFAULT_CLASSIFICATION_CONFIG),
    []
  )

  const checkStatus = useCallback(async () => {
    if (!projectPath) {
      setClassificationStatus("not_created")
      setStatusMessage(t("classification.noProject", "请先打开一个项目"))
      return
    }
    setClassificationStatus("loading")
    setStatusMessage(t("classification.checking", "正在检查状态..."))
    try {
      const pp = normalizePath(projectPath)
      const config = await loadProjectClassification(pp)
      if (!config) {
        setClassificationStatus("not_created")
        setEditingContent("")
        setStatusMessage(t("classification.notFound", "未找到 classification.md"))
      } else {
        const rawContent = await readProjectClassificationRaw(pp)
        const versionInfo = checkClassificationVersion(config)
        setClassificationStatus("valid")
        setEditingContent(rawContent || serializeClassificationToMarkdown(config))
        setStatusMessage(
          versionInfo.upToDate
            ? t("classification.valid", "classification.md 配置有效")
            : t("classification.needsUpgrade", `配置版本较旧（${versionInfo.currentVersion}），建议升级`)
        )
      }
    } catch (e) {
      setClassificationStatus("invalid")
      setEditingContent("")
      setStatusMessage(
        t("classification.error", `加载失败：${e instanceof Error ? e.message : String(e)}`)
      )
    }
  }, [projectPath, t])

  useEffect(() => {
    checkStatus()
  }, [checkStatus])

  const handleCreate = useCallback(async () => {
    if (!projectPath || isBusy) return
    setIsBusy(true)
    try {
      const pp = normalizePath(projectPath)
      await initProjectClassification(pp)
      setEditingContent(defaultClassificationMarkdown)
      setStatusMessage(t("classification.created", "已创建默认 classification.md"))
      setClassificationStatus("valid")
    } catch (e) {
      setStatusMessage(
        t("classification.createError", `创建失败：${e instanceof Error ? e.message : String(e)}`)
      )
    } finally {
      setIsBusy(false)
    }
  }, [projectPath, isBusy, t, defaultClassificationMarkdown])

  const handleUpgrade = useCallback(async () => {
    if (!projectPath || isBusy) return
    setIsBusy(true)
    try {
      const pp = normalizePath(projectPath)
      const config = await loadProjectClassification(pp)
      if (config) {
        const latestVersion = DEFAULT_CLASSIFICATION_CONFIG.version || "1.0.0"
        const existingIntents = new Set(config.routes.map((r) => r.intent))
        const newRoutes = [...config.routes]
        for (const defaultRoute of DEFAULT_CLASSIFICATION_CONFIG.routes) {
          if (!existingIntents.has(defaultRoute.intent)) {
            newRoutes.push({ ...defaultRoute })
          }
        }
        const upgraded = { ...config, routes: newRoutes, version: latestVersion }
        await writeProjectClassification(pp, upgraded)
        setEditingContent(serializeClassificationToMarkdown(upgraded))
        setStatusMessage(t("classification.upgraded", "已升级到最新版本"))
      }
    } catch (e) {
      setStatusMessage(
        t("classification.upgradeError", `升级失败：${e instanceof Error ? e.message : String(e)}`)
      )
    } finally {
      setIsBusy(false)
    }
  }, [projectPath, isBusy, t])

  const handleSave = useCallback(async () => {
    if (!projectPath || isBusy) return
    const parsed = deserializeClassificationFromMarkdown(editingContent)
    if (!parsed) {
      setSaveStatus(
        t(
          "classification.saveInvalid",
          "格式错误：请保留自动生成路由区块，并至少包含一条有效路由规则"
        )
      )
      return
    }

    setIsBusy(true)
    try {
      const pp = normalizePath(projectPath)
      await writeProjectClassification(pp, parsed)
      setEditingContent(serializeClassificationToMarkdown(parsed))
      setClassificationStatus("valid")
      setSaveStatus(t("classification.saved", "已保存 classification.md"))
      setStatusMessage(t("classification.valid", "classification.md 配置有效"))
    } catch (e) {
      setSaveStatus(
        t("classification.saveError", `保存失败：${e instanceof Error ? e.message : String(e)}`)
      )
    } finally {
      setIsBusy(false)
    }
  }, [projectPath, isBusy, editingContent, t])

  const handleRestoreDefault = useCallback(async () => {
    if (!projectPath || isBusy) return
    setIsBusy(true)
    try {
      const pp = normalizePath(projectPath)
      await writeProjectClassification(pp, DEFAULT_CLASSIFICATION_CONFIG)
      setEditingContent(defaultClassificationMarkdown)
      setClassificationStatus("valid")
      setSaveStatus(t("classification.restored", "已恢复默认 classification.md"))
      setStatusMessage(t("classification.valid", "classification.md 配置有效"))
    } catch (e) {
      setSaveStatus(
        t("classification.restoreError", `恢复失败：${e instanceof Error ? e.message : String(e)}`)
      )
    } finally {
      setIsBusy(false)
      setRestoreConfirmOpen(false)
    }
  }, [projectPath, isBusy, defaultClassificationMarkdown, t])

  if (!projectPath) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold">
            {t("settings.sections.classification.title", "意图路由配置")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("classification.noProject", "请先打开一个项目")}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">
          {t("settings.sections.classification.title", "意图路由配置")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sections.classification.description", "管理分类路由配置，控制 AI 会话的数据源加载策略")}
        </p>
      </div>

      <div className="rounded-md border bg-muted/20 p-4">
        <div className="flex items-center gap-2">
          {classificationStatus === "loading" && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />}
          {classificationStatus === "valid" && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
          {classificationStatus === "invalid" && <AlertTriangle className="h-4 w-4 text-red-500" />}
          {classificationStatus === "not_created" && <FileText className="h-4 w-4 text-muted-foreground" />}
          <span className="text-sm">{statusMessage}</span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {classificationStatus === "not_created" && (
            <Button onClick={handleCreate} disabled={isBusy}>
              {t("classification.create", "创建默认配置")}
            </Button>
          )}
          {classificationStatus === "valid" && (
            <Button onClick={handleUpgrade} disabled={isBusy}>
              {t("classification.upgrade", "升级配置版本")}
            </Button>
          )}
          <Button variant="outline" onClick={checkStatus} disabled={isBusy}>
            {t("classification.refresh", "重新检查")}
          </Button>
        </div>
      </div>

      {classificationStatus === "valid" && (
        <div className="rounded-md border bg-muted/10 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">classification.md</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("classification.editorHint", "编辑后保存前会先校验格式")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleSave} disabled={isBusy} size="sm">
                <Save className="mr-1.5 h-4 w-4" />
                {t("classification.save", "保存")}
              </Button>
              <Button
                variant="outline"
                onClick={() => setRestoreConfirmOpen(true)}
                disabled={isBusy}
                size="sm"
              >
                <RotateCcw className="mr-1.5 h-4 w-4" />
                {t("classification.restoreDefault", "恢复默认")}
              </Button>
            </div>
          </div>
          <textarea
            value={editingContent}
            onChange={(e) => setEditingContent(e.target.value)}
            className="min-h-[320px] w-full resize-y rounded-md border bg-background p-3 font-mono text-xs leading-relaxed outline-none focus:ring-2 focus:ring-ring"
            spellCheck={false}
          />
          {saveStatus && (
            <p className="mt-2 text-xs text-muted-foreground">{saveStatus}</p>
          )}
        </div>
      )}

      <div className="rounded-md border bg-muted/10 p-4">
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">
          {t("classification.faq", "常见问题")}
        </h3>
        <ul className="space-y-1 text-xs text-muted-foreground">
          <li>classification.md 位于项目目录下的 classification/ 文件夹中</li>
          <li>创建后将设置 AI 会话的数据源加载规则</li>
          <li>格式错误时软件会回退到默认路由，不会中断聊天</li>
          <li>编辑后需重新加载项目使更改生效</li>
        </ul>
      </div>

      <ModifyConfirmDialog
        open={restoreConfirmOpen}
        originalContent={editingContent}
        modifiedContent={defaultClassificationMarkdown}
        itemName="classification.md"
        intentLabel="确认恢复默认配置"
        type="classification"
        editable={false}
        onConfirm={handleRestoreDefault}
        onCancel={() => setRestoreConfirmOpen(false)}
      />
    </div>
  )
}
