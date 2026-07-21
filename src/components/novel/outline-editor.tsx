import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { FilePlus, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useWikiStore } from "@/stores/wiki-store";
import { writeFile, readFile, listDirectory, createDirectory } from "@/commands/fs";
import { normalizePath } from "@/lib/path-utils";
import type { OutlineType } from "@/lib/novel/chapter-meta";
import { loadPlotFrameworkLibrary } from "@/lib/novel/plot-framework-library";
import type { PlotFramework } from "@/lib/novel/plot-framework";
import { runVolumeOutlineQualityCheck, type QualityCheckItem } from "@/lib/novel/outline-quality-check";
import { buildPureOutlineMarkdown } from "@/lib/novel/outline-markdown";

const OUTLINE_TYPES: { value: OutlineType; labelKey: string }[] = [
  { value: "story-outline", labelKey: "novel.outline.type.story" },
  { value: "volume-outline", labelKey: "novel.outline.type.volume" },
  { value: "chapter-outline", labelKey: "novel.outline.type.chapter" },
];

interface OutlineCreatorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 关联的剧情框架 ID（可选，创建章纲时显示来源） */
  frameworkId?: string;
}

export function OutlineCreatorDialog({
  open,
  onOpenChange,
  frameworkId,
}: OutlineCreatorDialogProps) {
  const { t } = useTranslation();
  const project = useWikiStore((s) => s.project);
  const setFileTree = useWikiStore((s) => s.setFileTree);

  const [outlineType, setOutlineType] = useState<OutlineType>("story-outline");
  const [title, setTitle] = useState("");
  const [volumeNumber, setVolumeNumber] = useState("");
  const [chapterNumber, setChapterNumber] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [frameworks, setFrameworks] = useState<PlotFramework[]>([]);
  const [selectedFrameworkId, setSelectedFrameworkId] = useState<string>("");
  const [qualityCheckResults, setQualityCheckResults] = useState<QualityCheckItem[] | null>(null);
  const [qualityCheckLoading, setQualityCheckLoading] = useState(false);
  const [showQualityCheck, setShowQualityCheck] = useState(false);
  const [createdFilePath, setCreatedFilePath] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !project) return;
    let cancelled = false;
    void loadPlotFrameworkLibrary(project.path).then((lib) => {
      if (cancelled) return;
      setFrameworks(lib.frameworks);
      if (frameworkId) {
        setSelectedFrameworkId(frameworkId);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, project, frameworkId]);

  function reset() {
    setOutlineType("story-outline");
    setTitle("");
    setVolumeNumber("");
    setChapterNumber("");
    setSelectedFrameworkId("");
    setError(null);
    setDone(false);
    setQualityCheckResults(null);
    setQualityCheckLoading(false);
    setShowQualityCheck(false);
    setCreatedFilePath(null);
  }

  async function handleCreate() {
    if (!project) return;

    if (!title.trim()) {
      setError(t("novel.outline.titleRequired"));
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      const pp = normalizePath(project.path);
      const outlinesDir = `${pp}/wiki/outlines`;
      await createDirectory(outlinesDir);

      const effectiveFrameworkId = selectedFrameworkId || frameworkId;
      const framework = frameworks.find((item) => item.id === effectiveFrameworkId);

      let fileName = title
        .trim()
        .replace(/[\\/:*?"<>|]/g, "-")
        .replace(/\s+/g, "-")
        .toLowerCase();

      if (outlineType === "volume-outline" && volumeNumber) {
        fileName = `volume-${volumeNumber}-${fileName}`;
      } else if (outlineType === "chapter-outline" && chapterNumber) {
        fileName = `chapter-${chapterNumber}-${fileName}`;
      }

      const filePath = `${outlinesDir}/${fileName}.md`;
      const fullContent = buildPureOutlineMarkdown(
        title.trim(),
        framework && outlineType === "chapter-outline"
          ? `> 关联剧情框架：${framework.title}`
          : "",
      );
      await writeFile(filePath, fullContent);

      const tree = await listDirectory(pp);
      setFileTree(tree);
      useWikiStore.getState().bumpDataVersion();

      setCreatedFilePath(filePath);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }

  function handleClose() {
    reset();
    onOpenChange(false);
  }

  async function handleQualityCheck() {
    if (!createdFilePath || !project) return;
    setQualityCheckLoading(true);
    setQualityCheckResults(null);
    setShowQualityCheck(true);
    try {
      const content = await readFile(createdFilePath);
      const results = runVolumeOutlineQualityCheck(content);
      setQualityCheckResults(results);
    } catch (err) {
      setQualityCheckResults([
        {
          category: "读取错误",
          status: "error",
          message: err instanceof Error ? err.message : "无法读取大纲文件",
        },
      ]);
    } finally {
      setQualityCheckLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("novel.outline.createTitle")}</DialogTitle>
          <DialogDescription>
            {t("novel.outline.createDescription")}
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
              {t("novel.outline.created")}
            </div>

            {showQualityCheck ? (
              <div className="max-h-80 overflow-y-auto rounded-md border border-border bg-background p-3">
                {qualityCheckLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    <span className="text-sm text-muted-foreground">正在检查大纲质量...</span>
                  </div>
                ) : qualityCheckResults ? (
                  <div className="flex flex-col gap-2">
                    <div className="mb-1 text-sm font-medium">检查结果</div>
                    {qualityCheckResults.map((item, idx) => (
                      <div
                        key={idx}
                        className={`rounded-md border px-3 py-2 text-xs ${
                          item.status === "pass"
                            ? "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300"
                            : item.status === "warn"
                              ? "border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-300"
                              : "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
                        }`}
                      >
                        <div className="flex items-start gap-1.5">
                          <span className="mt-0.5 shrink-0">
                            {item.status === "pass" ? "✓" : item.status === "warn" ? "⚠" : "✗"}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="font-medium">{item.category}</div>
                            <div className="mt-0.5 opacity-80">{item.message}</div>
                            {item.details && item.details.length > 0 && (
                              <ul className="mt-1 list-inside list-disc space-y-0.5 pl-1 opacity-70">
                                {item.details.map((d, di) => (
                                  <li key={di}>{d}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                    <div className="mt-1 text-center text-xs text-muted-foreground">
                      共 {qualityCheckResults.length} 项检查，
                      {qualityCheckResults.filter((r) => r.status === "error").length} 项错误，
                      {qualityCheckResults.filter((r) => r.status === "warn").length} 项警告
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <DialogFooter className="gap-2 sm:gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleQualityCheck}
                disabled={qualityCheckLoading}
              >
                {qualityCheckLoading ? (
                  <>
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    检查中...
                  </>
                ) : (
                  "检查大纲质量"
                )}
              </Button>
              <Button onClick={handleClose}>{t("project.cancel")}</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>{t("novel.outline.type.label")}</Label>
                <select
                  value={outlineType}
                  onChange={(e) =>
                    setOutlineType(e.target.value as OutlineType)
                  }
                  disabled={generating}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {OUTLINE_TYPES.map((ot) => (
                    <option key={ot.value} value={ot.value}>
                      {t(ot.labelKey)}
                    </option>
                  ))}
                </select>
              </div>

              {outlineType === "chapter-outline" && frameworks.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs">关联剧情框架（可选）</Label>
                  <select
                    value={selectedFrameworkId}
                    onChange={(e) => setSelectedFrameworkId(e.target.value)}
                    disabled={generating}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">无关联</option>
                    {frameworks.map((fw) => (
                      <option key={fw.id} value={fw.id}>
                        {fw.title}（{fw.line === "main" ? "主线" : "支线"}）
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <Label>{t("novel.outline.title")}</Label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t("novel.outline.titlePlaceholder")}
                  disabled={generating}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {outlineType === "volume-outline" && (
                <div className="flex flex-col gap-1.5">
                  <Label>{t("novel.outline.volumeNumber")}</Label>
                  <input
                    type="number"
                    value={volumeNumber}
                    onChange={(e) => setVolumeNumber(e.target.value)}
                    placeholder="1"
                    min={1}
                    disabled={generating}
                    className="w-32 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              )}

              {outlineType === "chapter-outline" && (
                <div className="flex flex-col gap-1.5">
                  <Label>{t("novel.outline.chapterNumber")}</Label>
                  <input
                    type="number"
                    value={chapterNumber}
                    onChange={(e) => setChapterNumber(e.target.value)}
                    placeholder="1"
                    min={1}
                    disabled={generating}
                    className="w-32 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              )}

              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={handleClose}
                disabled={generating}
              >
                {t("project.cancel")}
              </Button>
              <Button
                onClick={handleCreate}
                disabled={generating || !title.trim()}
              >
                {generating ? (
                  <>
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    正在创建...
                  </>
                ) : (
                  <>
                    <FilePlus className="mr-1 h-4 w-4" />
                    {t("novel.outline.create")}
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
