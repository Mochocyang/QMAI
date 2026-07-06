/**
 * 剧情框架提取预览对话框
 *
 * 流程：阶段0（从已有拆文结果提取四段）→ 阶段1-4（并行拆解角色/方向/发挥/伏笔）
 *      → 阶段5（合并 agent 输出 JSON）→ 预览编辑 → 入库
 *
 * 各阶段共享 buildDismantlingCachePrefix 章节前缀，命中 API 供应商前缀缓存。
 * 任一阶段失败 → 硬失败，显示原因，不回退、不留空、不降级。
 */

import { useEffect, useRef, useState } from "react"
import { Loader2, AlertCircle, Plus, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useWikiStore } from "@/stores/wiki-store";
import { streamChat, type ChatMessage } from "@/lib/llm-client";
import type { ContentBlock } from "@/lib/llm-providers";
import { resolveNovelModel } from "@/lib/novel/model-resolver";
import { hasUsableLlm } from "@/lib/has-usable-llm";
import {
  buildDismantlingCachePrefix,
  extractPlotFrameworkBeatsFromAnalysis,
  extractPlotFrameworkLineageFromAnalysis,
  type DismantlingChapter,
} from "@/lib/novel/dismantling";
import {
  buildDismantlingCharacterPrompt,
  buildDismantlingDirectionPrompt,
  buildDismantlingHandcraftPrompt,
  buildDismantlingForeshadowingPrompt,
  buildFrameworkMergePrompt,
  extractCharactersFromStage,
  extractDirectionHintsFromStage,
  extractHandcraftHintsFromStage,
  extractForeshadowingFromStage,
  parseFrameworkMergeOutput,
  type ParsedFrameworkMerge,
} from "@/lib/novel/dismantling-stages";
import { upsertPlotFramework } from "@/lib/novel/plot-framework-library";
import type { PlotFrameworkCharacter } from "@/lib/novel/plot-framework";

interface PlotFrameworkExtractDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  analysisMarkdown: string;
  sourceDismantlingProjectId: string;
  sourceDismantlingProjectTitle: string;
  rangeChapterIds: string[];
  projectTitle: string;
  chapters: DismantlingChapter[];
  onSaved?: () => void;
}

type ExtractPhase =
  "idle" | "stage0" | "stages1-4" | "merge" | "preview" | "saving" | "error";

/** 把以 cachePrefix 开头的 user 提示词拆成 [前缀块(cacheControl), 余下块]，命中 API 前缀缓存 */
function buildCachedMessages(
  prompt: string,
  cachePrefix: string,
): ChatMessage[] {
  const rest = prompt.startsWith(cachePrefix)
    ? prompt.slice(cachePrefix.length)
    : prompt;
  const blocks: ContentBlock[] = [
    { type: "text", text: cachePrefix, cacheControl: true },
    ...(rest ? [{ type: "text" as const, text: rest }] : []),
  ];
  return [{ role: "user", content: blocks }];
}

/** 用 streamChat 收集一次完整输出（非流式语义，收集所有 token 拼成字符串） */
async function collectStageOutput(
  prompt: string,
  cachePrefix: string,
  llmConfig: Parameters<typeof streamChat>[0],
  signal?: AbortSignal,
): Promise<string> {
  const messages = buildCachedMessages(prompt, cachePrefix);
  let output = "";
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    void streamChat(llmConfig, messages, {
      onToken: (token) => {
        if (signal?.aborted) return;
        output += token;
      },
      onDone: resolve,
      onError: reject,
    });
    if (signal) {
      signal.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true });
    }
  });
  return output;
}

const PHASE_LABELS: Record<ExtractPhase, string> = {
  idle: "",
  stage0: "正在提取四段框架...",
  "stages1-4": "正在并行拆解角色/方向/发挥/伏笔...",
  merge: "正在合并框架...",
  preview: "预览编辑，确认后入库",
  saving: "正在入库...",
  error: "失败",
};

export function PlotFrameworkExtractDialog({
  open,
  onOpenChange,
  analysisMarkdown,
  sourceDismantlingProjectId,
  sourceDismantlingProjectTitle,
  rangeChapterIds,
  projectTitle,
  chapters,
  onSaved,
}: PlotFrameworkExtractDialogProps) {
  const project = useWikiStore((state) => state.project);
  const llmConfig = useWikiStore((state) => state.llmConfig);
  const novelConfig = useWikiStore((state) => state.novelConfig);
  const providerConfigs = useWikiStore((state) => state.providerConfigs);

  const [phase, setPhase] = useState<ExtractPhase>("idle");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const startedRef = useRef(false);
  const cancelledRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // 预览态表单字段
  const [title, setTitle] = useState("");
  const [hook, setHook] = useState("");
  const [buildup, setBuildup] = useState("");
  const [payoff, setPayoff] = useState("");
  const [endingHook, setEndingHook] = useState("");
  const [characters, setCharacters] = useState<PlotFrameworkCharacter[]>([]);
  const [foreshadowing, setForeshadowing] = useState<string[]>([]);
  const [line, setLine] = useState<"main" | "sub">("main");
  const [reusableTemplate, setReusableTemplate] = useState("");
  const [directionHints, setDirectionHints] = useState("");
  const [handcraftHints, setHandcraftHints] = useState("");
  const [prevConnector, setPrevConnector] = useState("");
  const [nextConnector, setNextConnector] = useState("");

  // 对话框打开时自动启动提取流程
  useEffect(() => {
    if (!open || startedRef.current) return;
    startedRef.current = true;
    void runExtraction();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 对话框关闭时重置状态
  useEffect(() => {
    if (!open) {
      startedRef.current = false;
      setPhase("idle");
      setError("");
      setProgress("");
    }
  }, [open]);

  async function runExtraction() {
    try {
      cancelledRef.current = false;
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      // ── 前置校验 ──
      if (!project) {
        throw new Error("未打开项目，无法提取框架");
      }
      if (!hasUsableLlm(llmConfig, providerConfigs)) {
        throw new Error("AI 模型未配置或不可用，请先在设置中配置 LLM");
      }
      const modelConfig = resolveNovelModel(llmConfig, novelConfig, "extract");
      const cachePrefix = buildDismantlingCachePrefix(projectTitle, chapters);

      // ── 阶段0：从已有拆文结果提取四段框架（不调 AI） ──
      setPhase("stage0");
      setProgress("●○○○○ 正在提取四段框架...");
      const beats = extractPlotFrameworkBeatsFromAnalysis(analysisMarkdown);
      if (
        !beats ||
        !beats.hook ||
        !beats.buildup ||
        !beats.payoff ||
        !beats.endingHook
      ) {
        throw new Error(
          "阶段0 失败：拆文结果中四段框架不完整（钩子/铺垫/爽点/结尾钩子缺一不可）",
        );
      }
      if (cancelledRef.current) throw new DOMException("Aborted", "AbortError");
      const lineage = extractPlotFrameworkLineageFromAnalysis(analysisMarkdown);

      // ── 阶段1-4：并行拆解 ──
      setPhase("stages1-4");
      setProgress("●●○○○ 正在并行拆解角色/方向/发挥/伏笔...");
      const [charRaw, dirRaw, craftRaw, foresRaw] = await Promise.all([
        collectStageOutput(
          buildDismantlingCharacterPrompt({ projectTitle, chapters }),
          cachePrefix,
          modelConfig,
          signal,
        ),
        collectStageOutput(
          buildDismantlingDirectionPrompt({ projectTitle, chapters }),
          cachePrefix,
          modelConfig,
          signal,
        ),
        collectStageOutput(
          buildDismantlingHandcraftPrompt({ projectTitle, chapters }),
          cachePrefix,
          modelConfig,
          signal,
        ),
        collectStageOutput(
          buildDismantlingForeshadowingPrompt({ projectTitle, chapters }),
          cachePrefix,
          modelConfig,
          signal,
        ),
      ]);

      if (cancelledRef.current) throw new DOMException("Aborted", "AbortError");
      const stageCharacters = extractCharactersFromStage(charRaw);
      const stageDirection = extractDirectionHintsFromStage(dirRaw);
      const stageHandcraft = extractHandcraftHintsFromStage(craftRaw);
      const stageForeshadowing = extractForeshadowingFromStage(foresRaw);

      // ── 阶段5：合并 agent ──
      setPhase("merge");
      setProgress("●●●●○ 正在合并框架...");
      const mergePrompt = buildFrameworkMergePrompt({
        projectTitle,
        chapters,
        stageOutputs: {
          beats: `## 开局钩子\n${beats.hook}\n## 铺垫\n${beats.buildup}\n## 爽点\n${beats.payoff}\n## 结尾钩子\n${beats.endingHook}`,
          characters: charRaw,
          direction: dirRaw,
          handcraft: craftRaw,
          foreshadowing: foresRaw,
        },
      });
      const mergeRaw = await collectStageOutput(
        mergePrompt,
        cachePrefix,
        modelConfig,
        signal,
      );
      if (cancelledRef.current) throw new DOMException("Aborted", "AbortError");
      const merged = parseFrameworkMergeOutput(mergeRaw);

      // ── 预览态：预填表单 ──
      setPhase("preview");
      setProgress("●●●●● 预览编辑，确认后入库");
      fillFormFromMerged(
        merged,
        beats.hook,
        beats.buildup,
        beats.payoff,
        beats.endingHook,
        lineage,
        stageCharacters,
        stageDirection,
        stageHandcraft,
        stageForeshadowing,
      );
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") {
        setPhase("idle");
        setError("");
        setProgress("");
        onOpenChange(false);
        return;
      }
      setPhase("error");
      setError(err instanceof Error ? err.message : String(err));
      setProgress("✋ 失败");
    } finally {
      abortControllerRef.current = null;
    }
  }

  function fillFormFromMerged(
    merged: ParsedFrameworkMerge,
    fallbackHook: string,
    fallbackBuildup: string,
    fallbackPayoff: string,
    fallbackEndingHook: string,
    lineage: ReturnType<typeof extractPlotFrameworkLineageFromAnalysis>,
    stageCharacters: PlotFrameworkCharacter[],
    stageDirection: string,
    stageHandcraft: string,
    stageForeshadowing: string[],
  ) {
    setTitle(merged.title || "未命名剧情框架");
    setHook(merged.beats.hook || fallbackHook);
    setBuildup(merged.beats.buildup || fallbackBuildup);
    setPayoff(merged.beats.payoff || fallbackPayoff);
    setEndingHook(merged.beats.endingHook || fallbackEndingHook);
    setCharacters(
      merged.characters.length > 0 ? merged.characters : stageCharacters,
    );
    setForeshadowing(
      merged.foreshadowing.length > 0
        ? merged.foreshadowing
        : stageForeshadowing,
    );
    setLine(merged.line);
    setReusableTemplate(merged.reusableTemplate);
    setDirectionHints(merged.directionHints || stageDirection);
    setHandcraftHints(merged.handcraftHints || stageHandcraft);
    setPrevConnector(merged.prevConnector || lineage?.prevConnector || "");
    setNextConnector(merged.nextConnector || lineage?.nextConnector || "");
  }

  function handleRetry() {
    setPhase("idle");
    setError("");
    setProgress("");
    startedRef.current = false;
    void runExtraction();
  }

  function handleCancel() {
    if (!executing) {
      onOpenChange(false);
      return;
    }
    cancelledRef.current = true;
    abortControllerRef.current?.abort();
  }

  async function handleSave() {
    if (!project) return;
    setPhase("saving");
    setProgress("正在入库...");
    try {
      const now = Date.now();
      await upsertPlotFramework(project.path, {
        id: `framework-${now}`,
        title: title.trim() || "未命名剧情框架",
        beats: {
          hook: hook.trim(),
          buildup: buildup.trim(),
          payoff: payoff.trim(),
          endingHook: endingHook.trim(),
        },
        rangeChapterIds,
        line,
        characters,
        foreshadowing,
        reusableTemplate: reusableTemplate.trim(),
        directionHints: directionHints.trim(),
        handcraftHints: handcraftHints.trim(),
        prevConnector: prevConnector.trim() || undefined,
        nextConnector: nextConnector.trim() || undefined,
        sourceDismantlingProjectId,
        sourceDismantlingProjectTitle,
        createdAt: now,
        updatedAt: now,
      });
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function updateCharacter(
    index: number,
    field: "name" | "role",
    value: string,
  ) {
    setCharacters((prev) =>
      prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)),
    );
  }
  function addCharacter() {
    setCharacters((prev) => [...prev, { name: "", role: "" }]);
  }
  function removeCharacter(index: number) {
    setCharacters((prev) => prev.filter((_, i) => i !== index));
  }
  function updateForeshadowing(index: number, value: string) {
    setForeshadowing((prev) => prev.map((f, i) => (i === index ? value : f)));
  }
  function addForeshadowing() {
    setForeshadowing((prev) => [...prev, ""]);
  }
  function removeForeshadowing(index: number) {
    setForeshadowing((prev) => prev.filter((_, i) => i !== index));
  }

  const executing =
    phase === "stage0" ||
    phase === "stages1-4" ||
    phase === "merge" ||
    phase === "saving";
  const inError = phase === "error";
  const inPreview = phase === "preview";

  return (
    <Dialog open={open} onOpenChange={(open) => {
      if (!open && executing) {
        handleCancel();
      } else if (!executing) {
        onOpenChange(open);
      }
    }}>
      <DialogContent className="sm:max-w-[700px]">
        <DialogHeader>
          <DialogTitle>提取剧情框架</DialogTitle>
        </DialogHeader>

        <div className="max-h-[85vh] overflow-y-auto space-y-4 py-2">
          {/* 执行中进度 */}
          {executing && (
            <div className="flex items-center gap-2 p-3 bg-muted rounded-md text-sm">
              <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
              <span>{progress || PHASE_LABELS[phase]}</span>
            </div>
          )}

          {/* 错误态 */}
          {inError && (
            <div className="flex items-start gap-2 p-3 bg-destructive/10 text-destructive rounded-md">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium">提取失败</p>
                <p className="text-sm whitespace-pre-wrap">{error}</p>
              </div>
            </div>
          )}

          {/* 预览编辑表单 */}
          {inPreview && (
            <>
              <div className="space-y-2">
                <Label>框架标题</Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="一句话总结方向"
                />
              </div>

              <div className="grid grid-cols-1 gap-3">
                <div className="space-y-2">
                  <Label>开局钩子</Label>
                  <Textarea
                    value={hook}
                    onChange={(e) => setHook(e.target.value)}
                    rows={2}
                    className={!hook.trim() ? "border-destructive" : ""}
                  />
                </div>
                <div className="space-y-2">
                  <Label>铺垫</Label>
                  <Textarea
                    value={buildup}
                    onChange={(e) => setBuildup(e.target.value)}
                    rows={2}
                    className={!buildup.trim() ? "border-destructive" : ""}
                  />
                </div>
                <div className="space-y-2">
                  <Label>爽点</Label>
                  <Textarea
                    value={payoff}
                    onChange={(e) => setPayoff(e.target.value)}
                    rows={2}
                    className={!payoff.trim() ? "border-destructive" : ""}
                  />
                </div>
                <div className="space-y-2">
                  <Label>结尾钩子</Label>
                  <Textarea
                    value={endingHook}
                    onChange={(e) => setEndingHook(e.target.value)}
                    rows={2}
                    className={!endingHook.trim() ? "border-destructive" : ""}
                  />
                </div>
              </div>

              {/* 涉及角色 */}
              <div className="space-y-2">
                <Label>涉及角色</Label>
                {characters.map((c, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <Input
                      value={c.name}
                      onChange={(e) =>
                        updateCharacter(i, "name", e.target.value)
                      }
                      placeholder="角色名"
                      className="flex-1"
                    />
                    <Input
                      value={c.role}
                      onChange={(e) =>
                        updateCharacter(i, "role", e.target.value)
                      }
                      placeholder="在该框架中的作用"
                      className="flex-[2]"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeCharacter(i)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addCharacter}>
                  <Plus className="h-4 w-4 mr-1" /> 添加角色
                </Button>
              </div>

              {/* 伏笔 */}
              <div className="space-y-2">
                <Label>伏笔</Label>
                {foreshadowing.map((f, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <Input
                      value={f}
                      onChange={(e) => updateForeshadowing(i, e.target.value)}
                      placeholder="伏笔描述"
                      className="flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeForeshadowing(i)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addForeshadowing}>
                  <Plus className="h-4 w-4 mr-1" /> 添加伏笔
                </Button>
              </div>

              {/* 归属 */}
              <div className="space-y-2">
                <Label>归属</Label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={line === "main"}
                      onChange={() => setLine("main")}
                    />
                    <span className="text-sm">主线</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={line === "sub"}
                      onChange={() => setLine("sub")}
                    />
                    <span className="text-sm">支线</span>
                  </label>
                </div>
              </div>

              <div className="space-y-2">
                <Label>一句话可复用模板</Label>
                <Input
                  value={reusableTemplate}
                  onChange={(e) => setReusableTemplate(e.target.value)}
                  placeholder="如 先压后扬，规则打破"
                />
              </div>

              <div className="space-y-2">
                <Label>方向指引</Label>
                <Textarea
                  value={directionHints}
                  onChange={(e) => setDirectionHints(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label>作者发挥空间提示</Label>
                <Textarea
                  value={handcraftHints}
                  onChange={(e) => setHandcraftHints(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>与上一框架衔接</Label>
                  <Input
                    value={prevConnector}
                    onChange={(e) => setPrevConnector(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>与下一框架衔接</Label>
                  <Input
                    value={nextConnector}
                    onChange={(e) => setNextConnector(e.target.value)}
                  />
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          {inError && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                关闭
              </Button>
              <Button onClick={handleRetry}>
                重试
              </Button>
            </>
          )}
          {inPreview && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button
                onClick={handleSave}
                disabled={
                  !hook.trim() ||
                  !buildup.trim() ||
                  !payoff.trim() ||
                  !endingHook.trim() ||
                  !directionHints.trim() ||
                  !handcraftHints.trim()
                }
              >
                确认入库
              </Button>
            </>
          )}
          {executing && (
            <Button variant="outline" onClick={handleCancel}>
              取消
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
