import { useEffect, useState } from "react";
import {
  BookOpenCheck,
  CheckCircle2,
  Loader2,
  Play,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWikiStore } from "@/stores/wiki-store";
import { streamChat, type ChatMessage } from "@/lib/llm-client";
import { resolveNovelModel } from "@/lib/novel/model-resolver";
import {
  buildDismantlingAnalysisPrompt,
  buildDismantlingWebResearchPrompt,
  buildPlotFrameworkDraftFromAnalysis,
  extractStructureMemoryFromAnalysis,
  loadDismantlingLibrary,
  saveDismantlingLibrary,
  selectNextDismantlingBatch,
  type DismantlingAnalysis,
  type DismantlingChapter,
  type DismantlingProject,
} from "@/lib/novel/dismantling";
import {
  buildWebResearchContext,
  collectWebResearch,
} from "@/lib/web-research";
import { loadPlotFrameworkLibrary, upsertPlotFramework } from "@/lib/novel/plot-framework-library";
import { PlotFrameworkExtractDialog } from "@/components/novel/plot-framework-extract-dialog";
import { OutlineCreatorDialog } from "@/components/novel/outline-editor";
import {
  listMainLineFrameworks,
  listSubLineFrameworks,
  type PlotFramework,
} from "@/lib/novel/plot-framework";

const DEFAULT_BATCH_SIZE = 3;

export function DismantlingView() {
  const project = useWikiStore((state) => state.project);
  const llmConfig = useWikiStore((state) => state.llmConfig);
  const novelConfig = useWikiStore((state) => state.novelConfig);
  const dataVersion = useWikiStore((state) => state.dataVersion);
  const selectedDismantlingProjectId = useWikiStore(
    (state) => state.selectedDismantlingProjectId,
  );
  const bumpDataVersion = useWikiStore((state) => state.bumpDataVersion);
  const [selectedProject, setSelectedProject] =
    useState<DismantlingProject | null>(null);
  const [selectedChapterIds, setSelectedChapterIds] = useState<string[]>([]);
  const [batchSize, setBatchSize] = useState(DEFAULT_BATCH_SIZE);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [webResearchInput, setWebResearchInput] = useState("");
  const [mainFrameworks, setMainFrameworks] = useState<PlotFramework[]>([]);
  const [subFrameworks, setSubFrameworks] = useState<PlotFramework[]>([]);

  const [extractDialogState, setExtractDialogState] = useState<{
    open: boolean;
    analysis: DismantlingAnalysis | null;
  }>({ open: false, analysis: null });

  const [outlineCreatorState, setOutlineCreatorState] = useState<{
    open: boolean;
    frameworkId: string | undefined;
  }>({ open: false, frameworkId: undefined });

  useEffect(() => {
    if (!project || !selectedDismantlingProjectId) {
      setSelectedProject(null);
      return;
    }
    let cancelled = false;
    void loadDismantlingLibrary(project.path).then((value) => {
      if (cancelled) return;
      const found = value.projects.find(
        (item) => item.id === selectedDismantlingProjectId,
      );
      setSelectedProject(found ?? null);
      setSelectedChapterIds(found?.chapters.map((chapter) => chapter.id) ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [project, dataVersion, selectedDismantlingProjectId]);

  // 加载剧情框架库
  useEffect(() => {
    if (!project) {
      setMainFrameworks([]);
      setSubFrameworks([]);
      return;
    }
    let cancelled = false;
    void loadPlotFrameworkLibrary(project.path).then((library) => {
      if (cancelled) return;
      setMainFrameworks(listMainLineFrameworks(library));
      setSubFrameworks(listSubLineFrameworks(library));
    });
    return () => {
      cancelled = true;
    };
  }, [project, dataVersion]);

  const upsertSelectedProject = async (
    updater: (current: DismantlingProject) => DismantlingProject,
  ) => {
    if (!selectedProject || !project) return;
    const updated = updater(selectedProject);
    const fullLibrary = await loadDismantlingLibrary(project.path);
    const nextProjects = fullLibrary.projects.map((item) =>
      item.id === selectedProject.id ? updated : item,
    );
    await saveDismantlingLibrary(project.path, {
      ...fullLibrary,
      projects: nextProjects,
    });
    setSelectedProject(updated);
    bumpDataVersion();
  };

  const handleRunDismantling = async () => {
    if (!project || !selectedProject || running) return;
    const batch = selectNextDismantlingBatch(selectedProject, {
      selectedChapterIds,
      batchSize,
    });
    if (batch.length === 0) {
      setStatus("当前选择范围内没有待拆章节。");
      return;
    }

    setRunning(true);
    setStatus(`正在拆文：本批 ${batch.length} 章。`);
    const runningIds = new Set(batch.map((chapter) => chapter.id));
    await upsertSelectedProject((current) => ({
      ...current,
      updatedAt: Date.now(),
      chapters: current.chapters.map((chapter) =>
        runningIds.has(chapter.id)
          ? { ...chapter, status: "running" }
          : chapter,
      ),
    }));

    let output = "";
    try {
      const messages: ChatMessage[] = [
        {
          role: "system",
          content: "你是严谨的小说拆文分析助手，必须用中文输出结构化结果。",
        },
        {
          role: "user",
          content: buildDismantlingAnalysisPrompt({
            projectTitle: selectedProject.title,
            chapters: batch,
          }),
        },
      ];
      await new Promise<void>((resolve, reject) => {
        void streamChat(
          resolveNovelModel(llmConfig, novelConfig, "extract"),
          messages,
          {
            onToken: (token) => {
              output += token;
            },
            onDone: resolve,
            onError: reject,
          },
        );
      });
      const memory = extractStructureMemoryFromAnalysis(output);
      const analysis: DismantlingAnalysis = {
        id: `analysis-${Date.now()}`,
        chapterIds: batch.map((chapter) => chapter.id),
        title: `第 ${batch[0].chapterNumber}-${batch[batch.length - 1].chapterNumber} 章拆文`,
        createdAt: Date.now(),
        markdown: output,
        structureMemory: memory,
      };
      await upsertSelectedProject((current) => ({
        ...current,
        updatedAt: Date.now(),
        chapters: current.chapters.map((chapter) =>
          runningIds.has(chapter.id)
            ? { ...chapter, status: "done", error: undefined }
            : chapter,
        ),
        analyses: [analysis, ...current.analyses],
        structureMemory: mergeUnique([
          ...memory,
          ...current.structureMemory,
        ]).slice(0, 120),
      }));
      const frameworkDraft = buildPlotFrameworkDraftFromAnalysis({
        analysisId: analysis.id,
        markdown: output,
        rangeChapterIds: analysis.chapterIds,
        sourceDismantlingProjectId: selectedProject.id,
        sourceDismantlingProjectTitle: selectedProject.title,
        createdAt: analysis.createdAt,
      });
      if (frameworkDraft) {
        await upsertPlotFramework(project.path, frameworkDraft);
        bumpDataVersion();
        setStatus(`本批拆文完成，新增 ${memory.length} 条结构记忆，并已自动生成基础剧情框架。`);
      } else {
        setStatus(`本批拆文完成，新增 ${memory.length} 条结构记忆；四段框架不完整，未自动入库。`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await upsertSelectedProject((current) => ({
        ...current,
        updatedAt: Date.now(),
        chapters: current.chapters.map((chapter) =>
          runningIds.has(chapter.id)
            ? { ...chapter, status: "failed", error: message }
            : chapter,
        ),
      }));
      setStatus(`拆文失败：${message}`);
    } finally {
      setRunning(false);
    }
  };

  const handleRunWebDismantlingResearch = async () => {
    if (!project || !selectedProject || running) return;
    const request = webResearchInput.trim();
    if (!request) {
      setStatus("请先输入要搜索的热门方向、榜单关键词或网页地址。");
      return;
    }

    setRunning(true);
    setStatus("正在联网读取网页资料并进行热门分析，请稍候。");
    let output = "";
    try {
      const webResearch = await collectWebResearch({
        text: request,
        searchApiConfig: useWikiStore.getState().searchApiConfig,
        maxSearchResults: 6,
        maxImportedDocuments: 4,
      });
      const webResearchContext = buildWebResearchContext(webResearch);
      const messages: ChatMessage[] = [
        {
          role: "system",
          content:
            "你是严谨的小说拆文和热门趋势分析助手，必须用中文输出结构化结果。",
        },
        {
          role: "user",
          content: buildDismantlingWebResearchPrompt({
            projectTitle: selectedProject.title,
            userRequest: request,
            webResearchContext: webResearchContext.markdown,
          }),
        },
      ];
      await new Promise<void>((resolve, reject) => {
        void streamChat(
          resolveNovelModel(llmConfig, novelConfig, "extract"),
          messages,
          {
            onToken: (token) => {
              output += token;
            },
            onDone: resolve,
            onError: reject,
          },
        );
      });
      const memory = extractStructureMemoryFromAnalysis(output);
      const analysis: DismantlingAnalysis = {
        id: `web-analysis-${Date.now()}`,
        chapterIds: [],
        title: "网页热门分析",
        createdAt: Date.now(),
        markdown: output,
        structureMemory: memory,
      };
      await upsertSelectedProject((current) => ({
        ...current,
        updatedAt: Date.now(),
        analyses: [analysis, ...current.analyses],
        structureMemory: mergeUnique([
          ...memory,
          ...current.structureMemory,
        ]).slice(0, 120),
      }));
      setStatus(
        `网页热门分析完成，参考来源 ${webResearchContext.sources.length} 条，新增 ${memory.length} 条结构记忆。`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`网页热门分析失败：${message}`);
    } finally {
      setRunning(false);
    }
  };

  const toggleUseInChat = async (checked: boolean) => {
    await upsertSelectedProject((current) => ({
      ...current,
      useInChat: checked,
      updatedAt: Date.now(),
    }));
    setStatus(
      checked
        ? "已启用：AI 会话会在用户写作时参考拆文结构。"
        : "已关闭：AI 会话不会读取该拆文结构。",
    );
  };

  const toggleChapter = (id: string, checked: boolean) => {
    setSelectedChapterIds((current) =>
      checked
        ? [...new Set([...current, id])]
        : current.filter((item) => item !== id),
    );
  };

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        请先打开小说项目。
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="border-b px-5 py-3">
        <div className="flex items-center gap-2 text-sm text-primary">
          <BookOpenCheck className="h-4 w-4" />
          <span>拆文库 · 独立拆文记忆库</span>
          <span className="text-muted-foreground">
            — 拆文结果独立保存，不会写入小说记忆、章节记忆或大纲记忆。
          </span>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_380px]">
        {/* 第三栏：作品详情、自动章节识别与拆文操作 */}
        <main className="min-h-0 flex flex-col overflow-hidden border-r">
          {!selectedProject ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              请从左侧选择拆文作品
            </div>
          ) : (
            <>
              <div className="border-b px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-medium text-muted-foreground">
                      作品详情
                    </div>
                    <h2 className="mt-1 text-base font-semibold">
                      {selectedProject.title}
                    </h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      已自动识别章节结构：{selectedProject.chapters.length} 章 ·{" "}
                      {selectedProject.structureMemory.length} 条结构记忆
                    </p>
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
                <section className="rounded-lg border bg-card p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    使用拆文结构
                  </div>
                  <label className="flex items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedProject.useInChat)}
                      onChange={(event) =>
                        void toggleUseInChat(event.target.checked)
                      }
                    />
                    <span>在 AI 会话写作时参考当前拆文作品的结构记忆。</span>
                  </label>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    只学习节奏、冲突推进、爽点安排和章节钩子；不得复用原作人物、设定、剧情和具体表达。
                  </p>
                </section>

                <section className="rounded-lg border bg-card p-3">
                  <div className="mb-2 text-sm font-medium">网页热门分析</div>
                  <p className="mb-2 text-xs leading-5 text-muted-foreground">
                    输入榜单关键词、题材方向或网页地址，AI
                    会联网读取资料并生成拆文结构分析；结果只写入独立拆文记忆库。
                  </p>
                  <textarea
                    value={webResearchInput}
                    onChange={(event) =>
                      setWebResearchInput(event.target.value)
                    }
                    placeholder="例如：搜索番茄都市脑洞热门开篇套路；或粘贴需要分析的网页地址"
                    className="min-h-20 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 w-full"
                    onClick={handleRunWebDismantlingResearch}
                    disabled={running || !webResearchInput.trim()}
                  >
                    {running ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="mr-2 h-4 w-4" />
                    )}
                    {running ? "分析中..." : "开始网页热门分析"}
                  </Button>
                </section>

                <section className="rounded-lg border bg-card">
                  <div className="flex items-center justify-between border-b px-4 py-2.5">
                    <div>
                      <div className="text-sm font-medium">拆分章节</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        AI
                        会按导入内容自动拆分或识别章节结构，请选择本次要拆文的章节范围。
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() =>
                            setSelectedChapterIds(
                              selectedProject.chapters.map(
                                (chapter) => chapter.id,
                              ),
                            )
                          }
                        >
                          全选
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setSelectedChapterIds([])}
                        >
                          清空
                        </Button>
                      </div>
                      <label className="flex items-center gap-1.5 text-xs">
                        <span className="text-muted-foreground">每批</span>
                        <select
                          value={batchSize}
                          onChange={(event) =>
                            setBatchSize(Number(event.target.value))
                          }
                          className="rounded border bg-background px-1.5 py-0.5 text-xs"
                        >
                          {[1, 3, 5, 10].map((size) => (
                            <option key={size} value={size}>
                              {size}章
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                  <div className="divide-y max-h-[calc(100vh-420px)] min-h-[120px] overflow-y-auto">
                    {selectedProject.chapters.map((chapter) => (
                      <label
                        key={chapter.id}
                        className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/40"
                      >
                        <input
                          type="checkbox"
                          checked={selectedChapterIds.includes(chapter.id)}
                          onChange={(event) =>
                            toggleChapter(chapter.id, event.target.checked)
                          }
                        />
                        <span className="w-14 shrink-0 text-muted-foreground">
                          第{chapter.chapterNumber}章
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {chapter.title}
                        </span>
                        <StatusBadge status={chapter.status} />
                      </label>
                    ))}
                  </div>
                  <div className="border-t px-4 py-3">
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={handleRunDismantling}
                      disabled={
                        running ||
                        !selectedProject ||
                        selectedChapterIds.length === 0
                      }
                    >
                      {running ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="mr-2 h-4 w-4" />
                      )}
                      {running
                        ? "拆文中..."
                        : selectedChapterIds.length === 0
                          ? "请先选择章节"
                          : `开始拆文（${selectedChapterIds.length} 章）`}
                    </Button>
                  </div>
                </section>
              </div>
            </>
          )}
        </main>

        {/* 第四栏：拆文结果 */}
        <aside className="min-h-0 overflow-y-auto bg-muted/20 p-4">
          {!selectedProject ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              选择作品后，拆文结果将显示在此处。
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="text-sm font-semibold">拆文结果</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  这里只展示拆文输出与结构记忆，不写入小说正文、大纲或小说记忆。
                </p>
              </div>

              <section className="rounded-lg border bg-card p-3">
                <div className="mb-2 text-sm font-medium">结构记忆</div>
                {selectedProject.structureMemory.length === 0 ? (
                  <div className="text-xs text-muted-foreground">
                    拆文完成后，这里会显示可供 AI 引用的结构记忆。
                  </div>
                ) : (
                  <ul className="space-y-1.5 text-xs leading-5">
                    {selectedProject.structureMemory
                      .slice(0, 30)
                      .map((item) => (
                        <li key={item}>- {item}</li>
                      ))}
                  </ul>
                )}
              </section>

              {/* 剧情框架库展示 */}
              {(mainFrameworks.length > 0 || subFrameworks.length > 0) && (
                <section className="rounded-lg border bg-card p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <RefreshCw className="h-4 w-4" />
                    剧情框架库
                  </div>
                  <p className="mb-2 text-xs text-muted-foreground">
                    AI
                    从拆文中提取的剧情框架（钩子→铺垫→爽点→结尾钩子），可按主线/支线查看。
                  </p>

                  {mainFrameworks.length > 0 && (
                    <div className="mb-3">
                      <div className="mb-1.5 text-xs font-semibold text-foreground">
                        主线框架（{mainFrameworks.length} 个）
                      </div>
                      <div className="space-y-2">
                        {mainFrameworks.map((fw) => (
                          <div
                            key={fw.id}
                            className="rounded border bg-background p-2.5 text-xs"
                          >
                            <div className="mb-1 flex items-center justify-between">
                              <span className="font-medium text-foreground">
                                {fw.title}
                              </span>
                              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                                {fw.pacing === "tight"
                                  ? "紧凑"
                                  : fw.pacing === "loose"
                                    ? "水型"
                                    : "标准"}
                              </span>
                            </div>
                            <div className="space-y-0.5 text-muted-foreground">
                              <div>
                                <span className="text-foreground/70">
                                  🎣 钩子：
                                </span>
                                {fw.beats.hook.slice(0, 60)}
                                {fw.beats.hook.length > 60 ? "…" : ""}
                              </div>
                              <div>
                                <span className="text-foreground/70">
                                  📦 铺垫：
                                </span>
                                {fw.beats.buildup.slice(0, 60)}
                                {fw.beats.buildup.length > 60 ? "…" : ""}
                              </div>
                              <div>
                                <span className="text-foreground/70">
                                  💥 爽点：
                                </span>
                                {fw.beats.payoff.slice(0, 60)}
                                {fw.beats.payoff.length > 60 ? "…" : ""}
                              </div>
                              <div>
                                <span className="text-foreground/70">
                                  🔄 结尾钩子：
                                </span>
                                {fw.beats.endingHook.slice(0, 60)}
                                {fw.beats.endingHook.length > 60 ? "…" : ""}
                              </div>
                            </div>
                            {fw.reusableTemplate && (
                              <div className="mt-1 text-[10px] text-muted-foreground italic">
                                模板：{fw.reusableTemplate}
                              </div>
                            )}
                            {fw.characters.length > 0 && (
                              <div className="mt-1 text-[10px] text-muted-foreground">
                                涉及角色：{fw.characters.map((c) => `${c.name}（${c.role || "未标注"}）`).join("、")}
                              </div>
                            )}
                            {fw.directionHints && (
                              <div className="mt-1 text-[10px] text-muted-foreground">
                                方向指引：{fw.directionHints.slice(0, 80)}{fw.directionHints.length > 80 ? "…" : ""}
                              </div>
                            )}
                            {fw.handcraftHints && (
                              <div className="mt-1 text-[10px] text-muted-foreground">
                                发挥空间：{fw.handcraftHints.slice(0, 80)}{fw.handcraftHints.length > 80 ? "…" : ""}
                              </div>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-2 w-full h-7 text-xs"
                              onClick={() => setOutlineCreatorState({ open: true, frameworkId: fw.id })}
                            >
                              基于此框架创建章纲
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {subFrameworks.length > 0 && (
                    <div>
                      <div className="mb-1.5 text-xs font-semibold text-foreground">
                        支线框架（{subFrameworks.length} 个）
                      </div>
                      <div className="space-y-2">
                        {subFrameworks.map((fw) => (
                          <div
                            key={fw.id}
                            className="rounded border bg-background p-2.5 text-xs"
                          >
                            <div className="mb-1 flex items-center justify-between">
                              <span className="font-medium text-foreground">
                                {fw.title}
                              </span>
                              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                                {fw.pacing === "tight"
                                  ? "紧凑"
                                  : fw.pacing === "loose"
                                    ? "水型"
                                    : "标准"}
                              </span>
                            </div>
                            <div className="space-y-0.5 text-muted-foreground">
                              <div>
                                <span className="text-foreground/70">
                                  🎣 钩子：
                                </span>
                                {fw.beats.hook.slice(0, 60)}
                                {fw.beats.hook.length > 60 ? "…" : ""}
                              </div>
                              <div>
                                <span className="text-foreground/70">
                                  📦 铺垫：
                                </span>
                                {fw.beats.buildup.slice(0, 60)}
                                {fw.beats.buildup.length > 60 ? "…" : ""}
                              </div>
                              <div>
                                <span className="text-foreground/70">
                                  💥 爽点：
                                </span>
                                {fw.beats.payoff.slice(0, 60)}
                                {fw.beats.payoff.length > 60 ? "…" : ""}
                              </div>
                              <div>
                                <span className="text-foreground/70">
                                  🔄 结尾钩子：
                                </span>
                                {fw.beats.endingHook.slice(0, 60)}
                                {fw.beats.endingHook.length > 60 ? "…" : ""}
                              </div>
                            </div>
                            {fw.reusableTemplate && (
                              <div className="mt-1 text-[10px] text-muted-foreground italic">
                                模板：{fw.reusableTemplate}
                              </div>
                            )}
                            {fw.characters.length > 0 && (
                              <div className="mt-1 text-[10px] text-muted-foreground">
                                涉及角色：{fw.characters.map((c) => `${c.name}（${c.role || "未标注"}）`).join("、")}
                              </div>
                            )}
                            {fw.directionHints && (
                              <div className="mt-1 text-[10px] text-muted-foreground">
                                方向指引：{fw.directionHints.slice(0, 80)}{fw.directionHints.length > 80 ? "…" : ""}
                              </div>
                            )}
                            {fw.handcraftHints && (
                              <div className="mt-1 text-[10px] text-muted-foreground">
                                发挥空间：{fw.handcraftHints.slice(0, 80)}{fw.handcraftHints.length > 80 ? "…" : ""}
                              </div>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-2 w-full h-7 text-xs"
                              onClick={() => setOutlineCreatorState({ open: true, frameworkId: fw.id })}
                            >
                              基于此框架创建章纲
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              )}

              <section className="rounded-lg border bg-card p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <RefreshCw className="h-4 w-4" />
                  最近拆文结果
                </div>
                {selectedProject.analyses.length === 0 ? (
                  <div className="text-xs text-muted-foreground">
                    还没有拆文结果。
                  </div>
                ) : (
                  <div className="space-y-3">
                    {selectedProject.analyses.slice(0, 5).map((analysis) => (
                      <article
                        key={analysis.id}
                        className="rounded-lg border bg-background p-3"
                      >
                        <div className="mb-2 flex items-center text-sm font-medium">
                          {analysis.title}
                          <Button
                            size="sm"
                            variant="outline"
                            className="ml-2 h-6 text-xs"
                            onClick={() => setExtractDialogState({ open: true, analysis })}
                            disabled={running}
                          >
                            提取框架
                          </Button>
                        </div>
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs leading-6 text-muted-foreground">
                          {analysis.markdown}
                        </pre>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              {status && (
                <div className="rounded-lg border bg-card p-3 text-xs leading-5 text-muted-foreground">
                  {status}
                </div>
              )}
            </div>
          )}

          {extractDialogState.analysis && (
            <PlotFrameworkExtractDialog
              open={extractDialogState.open}
              onOpenChange={(open) => setExtractDialogState((st) => ({ ...st, open }))}
              analysisMarkdown={extractDialogState.analysis.markdown}
              sourceDismantlingProjectId={selectedProject?.id ?? ""}
              sourceDismantlingProjectTitle={selectedProject?.title ?? ""}
              rangeChapterIds={extractDialogState.analysis.chapterIds}
              projectTitle={selectedProject?.title ?? ""}
              chapters={selectedProject?.chapters.filter((ch) => extractDialogState.analysis!.chapterIds.includes(ch.id)) ?? []}
              onSaved={() => { bumpDataVersion(); }}
            />
          )}

          <OutlineCreatorDialog
            open={outlineCreatorState.open}
            onOpenChange={(open) => setOutlineCreatorState((st) => ({ ...st, open }))}
            frameworkId={outlineCreatorState.frameworkId}
          />
        </aside>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: DismantlingChapter["status"] }) {
  const label =
    status === "done"
      ? "已拆"
      : status === "running"
        ? "拆文中"
        : status === "failed"
          ? "失败"
          : "待拆";
  return (
    <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
      {label}
    </span>
  );
}

function mergeUnique(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}
