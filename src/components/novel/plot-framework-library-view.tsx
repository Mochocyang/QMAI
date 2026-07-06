import { useEffect, useState, useMemo, useRef } from "react";
import {
  Search,
  Trash2,
  Edit3,
  Save,
  X,
  BookOpen,
  GitBranch,
  Clock,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  History,
  Download,
  Upload,
  CheckSquare,
  Square,
  Layers,
  Tag as TagIcon,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useWikiStore } from "@/stores/wiki-store";
import {
  loadPlotFrameworkLibrary,
  removePlotFramework,
  upsertPlotFramework,
  manualAdjustPlotFrameworkPacing,
  removePlotFrameworks,
  exportPlotFrameworks,
  importPlotFrameworks,
  collectAllTags,
  rollbackPlotFramework,
  deletePlotFrameworkSnapshot,
} from "@/lib/novel/plot-framework-library";
import {
  listMainLineFrameworks,
  listSubLineFrameworks,
  type PlotFramework,
  type PlotFrameworkCharacter,
} from "@/lib/novel/plot-framework";

const PACING_LABELS: Record<string, string> = {
  tight: "紧凑",
  standard: "标准",
  loose: "舒展",
};

const TABS = [
  { id: "main", label: "主线", icon: BookOpen },
  { id: "sub", label: "支线", icon: GitBranch },
  { id: "timeline", label: "主线时间线", icon: History },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function PlotFrameworkLibraryView() {
  const project = useWikiStore((state) => state.project);
  const dataVersion = useWikiStore((state) => state.dataVersion);
  const bumpDataVersion = useWikiStore((state) => state.bumpDataVersion);

  const [mainFrameworks, setMainFrameworks] = useState<PlotFramework[]>([]);
  const [subFrameworks, setSubFrameworks] = useState<PlotFramework[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [pacingFilter, setPacingFilter] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<TabId>("main");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [historyViewId, setHistoryViewId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [editForm, setEditForm] = useState<{
    title: string;
    hook: string;
    buildup: string;
    payoff: string;
    endingHook: string;
    directionHints: string;
    handcraftHints: string;
    reusableTemplate: string;
    prevConnector: string;
    nextConnector: string;
    line: "main" | "sub";
    characters: PlotFrameworkCharacter[];
    foreshadowing: string[];
    tags: string[];
  } | null>(null);

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

  const allTags = useMemo(
    () => collectAllTags([...mainFrameworks, ...subFrameworks]),
    [mainFrameworks, subFrameworks],
  );

  const filteredMain = useMemo(() => {
    let list = mainFrameworks;
    if (pacingFilter !== "all") {
      list = list.filter((fw) => fw.pacing === pacingFilter);
    }
    if (tagFilter) {
      list = list.filter((fw) => (fw.tags || []).includes(tagFilter));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (fw) =>
          fw.title.toLowerCase().includes(q) ||
          fw.beats.hook.toLowerCase().includes(q) ||
          fw.beats.buildup.toLowerCase().includes(q) ||
          fw.beats.payoff.toLowerCase().includes(q) ||
          fw.beats.endingHook.toLowerCase().includes(q) ||
          fw.directionHints.toLowerCase().includes(q) ||
          fw.handcraftHints.toLowerCase().includes(q) ||
          (fw.tags || []).some((t) => t.toLowerCase().includes(q)) ||
          fw.characters.some((c) => c.name.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [mainFrameworks, searchQuery, pacingFilter, tagFilter]);

  const filteredSub = useMemo(() => {
    let list = subFrameworks;
    if (pacingFilter !== "all") {
      list = list.filter((fw) => fw.pacing === pacingFilter);
    }
    if (tagFilter) {
      list = list.filter((fw) => (fw.tags || []).includes(tagFilter));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (fw) =>
          fw.title.toLowerCase().includes(q) ||
          fw.beats.hook.toLowerCase().includes(q) ||
          fw.beats.buildup.toLowerCase().includes(q) ||
          fw.beats.payoff.toLowerCase().includes(q) ||
          fw.beats.endingHook.toLowerCase().includes(q) ||
          fw.directionHints.toLowerCase().includes(q) ||
          fw.handcraftHints.toLowerCase().includes(q) ||
          (fw.tags || []).some((t) => t.toLowerCase().includes(q)) ||
          fw.characters.some((c) => c.name.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [subFrameworks, searchQuery, pacingFilter, tagFilter]);

  function startEdit(fw: PlotFramework) {
    setEditingId(fw.id);
    setEditForm({
      title: fw.title,
      hook: fw.beats.hook,
      buildup: fw.beats.buildup,
      payoff: fw.beats.payoff,
      endingHook: fw.beats.endingHook,
      directionHints: fw.directionHints,
      handcraftHints: fw.handcraftHints,
      reusableTemplate: fw.reusableTemplate || "",
      prevConnector: fw.prevConnector || "",
      nextConnector: fw.nextConnector || "",
      line: fw.line,
      characters: [...fw.characters],
      foreshadowing: [...fw.foreshadowing],
      tags: [...(fw.tags || [])],
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(null);
  }

  async function saveEdit(fw: PlotFramework) {
    if (!project || !editForm) return;
    try {
      await upsertPlotFramework(project.path, {
        ...fw,
        title: editForm.title.trim() || "未命名剧情框架",
        beats: {
          hook: editForm.hook.trim(),
          buildup: editForm.buildup.trim(),
          payoff: editForm.payoff.trim(),
          endingHook: editForm.endingHook.trim(),
        },
        directionHints: editForm.directionHints.trim(),
        handcraftHints: editForm.handcraftHints.trim(),
        reusableTemplate: editForm.reusableTemplate.trim(),
        prevConnector: editForm.prevConnector.trim() || undefined,
        nextConnector: editForm.nextConnector.trim() || undefined,
        line: editForm.line,
        characters: editForm.characters.filter((c) => c.name.trim()),
        foreshadowing: editForm.foreshadowing.filter((f) => f.trim()),
        tags: Array.from(new Set(editForm.tags.map((t) => t.trim()).filter(Boolean))),
        updatedAt: Date.now(),
      });
      bumpDataVersion();
      setEditingId(null);
      setEditForm(null);
    } catch (err) {
      console.error("保存失败:", err);
    }
  }

  async function handleDelete(fw: PlotFramework) {
    if (!project) return;
    if (!confirm(`确定删除框架「${fw.title}」吗？此操作不可撤销。`)) return;
    try {
      await removePlotFramework(project.path, fw.id);
      bumpDataVersion();
    } catch (err) {
      console.error("删除失败:", err);
    }
  }

  async function handlePacingChange(fw: PlotFramework, pacing: string) {
    if (!project) return;
    try {
      await manualAdjustPlotFrameworkPacing(project.path, fw.id, pacing as any);
      bumpDataVersion();
    } catch (err) {
      console.error("调整节奏失败:", err);
    }
  }

  function toggleSelect(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function handleBatchDelete() {
    if (!project || selectedIds.size === 0) return;
    if (!confirm(`确定删除选中的 ${selectedIds.size} 个框架吗？此操作不可撤销。`)) return;
    try {
      await removePlotFrameworks(project.path, Array.from(selectedIds));
      bumpDataVersion();
      setSelectedIds(new Set());
    } catch (err) {
      console.error("批量删除失败:", err);
    }
  }

  function handleExport(frameworks: PlotFramework[]) {
    const json = exportPlotFrameworks(frameworks);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `plot-frameworks-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleExportSelected() {
    const all = [...mainFrameworks, ...subFrameworks];
    const selected = all.filter((f) => selectedIds.has(f.id));
    if (selected.length === 0) {
      alert("请先选择要导出的框架");
      return;
    }
    handleExport(selected);
  }

  function handleExportAll() {
    handleExport([...mainFrameworks, ...subFrameworks]);
  }

  function triggerImport() {
    fileInputRef.current?.click();
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    if (!project) return;
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const result = await importPlotFrameworks(project.path, text);
      alert(`导入完成：成功导入 ${result.imported} 个，跳过 ${result.skipped} 个不完整的框架`);
      bumpDataVersion();
    } catch (err: any) {
      alert(`导入失败：${err.message}`);
    }
    e.target.value = "";
  }

  function toggleExpand(id: string) {
    setExpandedId(expandedId === id ? null : id);
  }

  function updateEditCharacter(index: number, field: "name" | "role", value: string) {
    if (!editForm) return;
    setEditForm({
      ...editForm,
      characters: editForm.characters.map((c, i) =>
        i === index ? { ...c, [field]: value } : c,
      ),
    });
  }

  function addEditCharacter() {
    if (!editForm) return;
    setEditForm({
      ...editForm,
      characters: [...editForm.characters, { name: "", role: "" }],
    });
  }

  function removeEditCharacter(index: number) {
    if (!editForm) return;
    setEditForm({
      ...editForm,
      characters: editForm.characters.filter((_, i) => i !== index),
    });
  }

  function updateEditForeshadowing(index: number, value: string) {
    if (!editForm) return;
    setEditForm({
      ...editForm,
      foreshadowing: editForm.foreshadowing.map((f, i) =>
        i === index ? value : f,
      ),
    });
  }

  function addEditForeshadowing() {
    if (!editForm) return;
    setEditForm({
      ...editForm,
      foreshadowing: [...editForm.foreshadowing, ""],
    });
  }

  function removeEditForeshadowing(index: number) {
    if (!editForm) return;
    setEditForm({
      ...editForm,
      foreshadowing: editForm.foreshadowing.filter((_, i) => i !== index),
    });
  }

  function addEditTag(value: string) {
    if (!editForm) return;
    const tag = value.trim();
    if (!tag || editForm.tags.includes(tag)) return;
    setEditForm({ ...editForm, tags: [...editForm.tags, tag] });
  }

  function removeEditTag(tag: string) {
    if (!editForm) return;
    setEditForm({ ...editForm, tags: editForm.tags.filter((t) => t !== tag) });
  }

  async function handleRollback(fw: PlotFramework, snapshotIndex: number) {
    if (!project) return;
    if (!confirm("确定回滚到该历史版本吗？当前版本会作为新快照存入历史。")) return;
    try {
      await rollbackPlotFramework(project.path, fw.id, snapshotIndex);
      bumpDataVersion();
      setHistoryViewId(null);
    } catch (err) {
      console.error("回滚失败:", err);
    }
  }

  async function handleDeleteSnapshot(fw: PlotFramework, snapshotIndex: number) {
    if (!project) return;
    if (!confirm("确定删除该历史版本吗？")) return;
    try {
      await deletePlotFrameworkSnapshot(project.path, fw.id, snapshotIndex);
      bumpDataVersion();
    } catch (err) {
      console.error("删除历史版本失败:", err);
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
            <Layers className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">剧情框架库</h2>
            <p className="text-sm text-muted-foreground">
              共 {mainFrameworks.length + subFrameworks.length} 个框架（主线 {mainFrameworks.length} / 支线 {subFrameworks.length}）
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleImportFile}
            className="hidden"
          />
          <Button variant="outline" size="sm" onClick={triggerImport}>
            <Upload className="h-4 w-4 mr-2" />
            导入
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportAll}>
            <Download className="h-4 w-4 mr-2" />
            导出全部
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 px-4 py-3 border-b">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索框架标题、内容、角色..."
            className="pl-8"
          />
        </div>
        <select
          value={pacingFilter}
          onChange={(e) => setPacingFilter(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">全部节奏</option>
          <option value="tight">紧凑</option>
          <option value="standard">标准</option>
          <option value="loose">舒展</option>
        </select>
      </div>

      {allTags.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 border-b overflow-x-auto">
          <TagIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <button
            type="button"
            onClick={() => setTagFilter(null)}
            className={`flex-shrink-0 rounded-md px-2 py-0.5 text-xs transition-colors ${
              tagFilter === null
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent"
            }`}
          >
            全部
          </button>
          {allTags.map(({ tag, count }) => (
            <button
              key={tag}
              type="button"
              onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
              className={`flex-shrink-0 rounded-md px-2 py-0.5 text-xs transition-colors ${
                tagFilter === tag
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent"
              }`}
            >
              {tag} ({count})
            </button>
          ))}
        </div>
      )}

      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/50">
          <span className="text-sm">
            已选择 <span className="font-medium">{selectedIds.size}</span> 个框架
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={clearSelection}>
              取消选择
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportSelected}>
              <Download className="h-4 w-4 mr-2" />
              导出选中
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleBatchDelete}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              批量删除
            </Button>
          </div>
        </div>
      )}

      <div className="flex shrink-0 items-center gap-1 border-b px-4 py-2">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const count =
            tab.id === "main"
              ? filteredMain.length
              : tab.id === "sub"
              ? filteredSub.length
              : null;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
                activeTab === tab.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
              {count !== null && (
                <span
                  className={`rounded px-1.5 py-0.5 text-xs ${
                    activeTab === tab.id
                      ? "bg-primary-foreground/20"
                      : "bg-muted"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {activeTab === "main" && (
          <div className="space-y-3">
            {filteredMain.length === 0 ? (
              <EmptyState text="暂无主线剧情框架" />
            ) : (
              filteredMain.map((fw) => (
                <FrameworkCard
                  key={fw.id}
                  fw={fw}
                  expanded={expandedId === fw.id}
                  editing={editingId === fw.id}
                  editForm={editingId === fw.id ? editForm : null}
                  selected={selectedIds.has(fw.id)}
                  historyOpen={historyViewId === fw.id}
                  onToggleExpand={() => toggleExpand(fw.id)}
                  onEdit={() => startEdit(fw)}
                  onCancelEdit={cancelEdit}
                  onSaveEdit={() => saveEdit(fw)}
                  onDelete={() => handleDelete(fw)}
                  onToggleSelect={() => toggleSelect(fw.id)}
                  onToggleHistory={() => setHistoryViewId(historyViewId === fw.id ? null : fw.id)}
                  onRollback={(idx) => handleRollback(fw, idx)}
                  onDeleteSnapshot={(idx) => handleDeleteSnapshot(fw, idx)}
                  onPacingChange={(p) => handlePacingChange(fw, p)}
                  onEditFormChange={setEditForm}
                  onUpdateCharacter={updateEditCharacter}
                  onAddCharacter={addEditCharacter}
                  onRemoveCharacter={removeEditCharacter}
                  onUpdateForeshadowing={updateEditForeshadowing}
                  onAddForeshadowing={addEditForeshadowing}
                  onRemoveForeshadowing={removeEditForeshadowing}
                  onAddTag={addEditTag}
                  onRemoveTag={removeEditTag}
                />
              ))
            )}
          </div>
        )}

        {activeTab === "sub" && (
          <div className="space-y-3">
            {filteredSub.length === 0 ? (
              <EmptyState text="暂无支线剧情框架" />
            ) : (
              filteredSub.map((fw) => (
                <FrameworkCard
                  key={fw.id}
                  fw={fw}
                  expanded={expandedId === fw.id}
                  editing={editingId === fw.id}
                  editForm={editingId === fw.id ? editForm : null}
                  selected={selectedIds.has(fw.id)}
                  historyOpen={historyViewId === fw.id}
                  onToggleExpand={() => toggleExpand(fw.id)}
                  onEdit={() => startEdit(fw)}
                  onCancelEdit={cancelEdit}
                  onSaveEdit={() => saveEdit(fw)}
                  onDelete={() => handleDelete(fw)}
                  onToggleSelect={() => toggleSelect(fw.id)}
                  onToggleHistory={() => setHistoryViewId(historyViewId === fw.id ? null : fw.id)}
                  onRollback={(idx) => handleRollback(fw, idx)}
                  onDeleteSnapshot={(idx) => handleDeleteSnapshot(fw, idx)}
                  onPacingChange={(p) => handlePacingChange(fw, p)}
                  onEditFormChange={setEditForm}
                  onUpdateCharacter={updateEditCharacter}
                  onAddCharacter={addEditCharacter}
                  onRemoveCharacter={removeEditCharacter}
                  onUpdateForeshadowing={updateEditForeshadowing}
                  onAddForeshadowing={addEditForeshadowing}
                  onRemoveForeshadowing={removeEditForeshadowing}
                  onAddTag={addEditTag}
                  onRemoveTag={removeEditTag}
                />
              ))
            )}
          </div>
        )}

        {activeTab === "timeline" && (
          <div>
            {mainFrameworks.length === 0 ? (
              <EmptyState text="暂无主线剧情框架，无法生成时间线" />
            ) : (
              <MainTimelineView frameworks={mainFrameworks} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
      <BookOpen className="h-12 w-12 mb-3 opacity-50" />
      <p>{text}</p>
    </div>
  );
}

interface FrameworkCardProps {
  fw: PlotFramework;
  expanded: boolean;
  editing: boolean;
  editForm: any;
  selected: boolean;
  historyOpen: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete: () => void;
  onToggleSelect: () => void;
  onToggleHistory: () => void;
  onRollback: (snapshotIndex: number) => void;
  onDeleteSnapshot: (snapshotIndex: number) => void;
  onPacingChange: (pacing: string) => void;
  onEditFormChange: (form: any) => void;
  onUpdateCharacter: (index: number, field: "name" | "role", value: string) => void;
  onAddCharacter: () => void;
  onRemoveCharacter: (index: number) => void;
  onUpdateForeshadowing: (index: number, value: string) => void;
  onAddForeshadowing: () => void;
  onRemoveForeshadowing: (index: number) => void;
  onAddTag: (value: string) => void;
  onRemoveTag: (tag: string) => void;
}

function FrameworkCard({
  fw,
  expanded,
  editing,
  editForm,
  selected,
  historyOpen,
  onToggleExpand,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onToggleSelect,
  onToggleHistory,
  onRollback,
  onDeleteSnapshot,
  onPacingChange,
  onEditFormChange,
  onUpdateCharacter,
  onAddCharacter,
  onRemoveCharacter,
  onUpdateForeshadowing,
  onAddForeshadowing,
  onRemoveForeshadowing,
  onAddTag,
  onRemoveTag,
}: FrameworkCardProps) {
  const updatedStr = new Date(fw.updatedAt).toLocaleDateString("zh-CN");
  const chapterCount = fw.rangeChapterIds?.length || 0;

  return (
    <div
      className={`rounded-lg border bg-card text-card-foreground shadow-sm ${
        selected ? "ring-2 ring-primary" : ""
      }`}
    >
      <div className="flex p-4 pb-2">
        <div className="flex items-start justify-between w-full">
          <div className="flex items-start gap-2 flex-1">
            {!editing && (
              <button
                type="button"
                onClick={onToggleSelect}
                className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent"
              >
                {selected ? (
                  <CheckSquare className="h-4 w-4 text-primary" />
                ) : (
                  <Square className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-semibold leading-none tracking-tight">
                  {editing ? (
                    <Input
                      value={editForm.title}
                      onChange={(e) =>
                        onEditFormChange({ ...editForm, title: e.target.value })
                      }
                      className="font-semibold"
                    />
                  ) : (
                    fw.title
                  )}
                </h3>
                <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium">
                  {PACING_LABELS[fw.pacing || "standard"] || "标准"}
                </span>
                {chapterCount > 0 && (
                  <span className="inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                    {chapterCount} 章
                  </span>
                )}
              </div>
              <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                更新于 {updatedStr}
                {fw.sourceDismantlingProjectTitle && (
                  <span>· 来源：{fw.sourceDismantlingProjectTitle}</span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {!editing && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onToggleHistory}
                  title="版本历史"
                >
                  <History className={`h-4 w-4 ${historyOpen ? "text-primary" : ""}`} />
                </Button>
                <Button variant="ghost" size="icon" onClick={onEdit}>
                  <Edit3 className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={onDelete}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
                <Button variant="ghost" size="icon" onClick={onToggleExpand}>
                  {expanded ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {!editing && (fw.tags || []).length > 0 && (
        <div className="flex items-center gap-1 flex-wrap px-4 pb-2">
          {(fw.tags || []).map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs text-primary"
            >
              <TagIcon className="h-3 w-3" />
              {tag}
            </span>
          ))}
        </div>
      )}

      {historyOpen && !editing && (
        <HistoryPanel
          fw={fw}
          onRollback={onRollback}
          onDeleteSnapshot={onDeleteSnapshot}
        />
      )}

      {(expanded || editing) && (
        <div className="p-4 pt-2 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <BeatSection
              label="钩子"
              value={editing ? editForm.hook : fw.beats.hook}
              editing={editing}
              onChange={(v) => onEditFormChange({ ...editForm, hook: v })}
            />
            <BeatSection
              label="发展"
              value={editing ? editForm.buildup : fw.beats.buildup}
              editing={editing}
              onChange={(v) => onEditFormChange({ ...editForm, buildup: v })}
            />
            <BeatSection
              label="爽点"
              value={editing ? editForm.payoff : fw.beats.payoff}
              editing={editing}
              onChange={(v) => onEditFormChange({ ...editForm, payoff: v })}
            />
            <BeatSection
              label="结尾钩子"
              value={editing ? editForm.endingHook : fw.beats.endingHook}
              editing={editing}
              onChange={(v) => onEditFormChange({ ...editForm, endingHook: v })}
            />
          </div>

          {(fw.prevConnector || fw.nextConnector || editing) && (
            <div className="grid grid-cols-2 gap-3 pt-2 border-t">
              <BeatSection
                label="衔接上一框架"
                value={editing ? editForm.prevConnector : fw.prevConnector || ""}
                editing={editing}
                onChange={(v) => onEditFormChange({ ...editForm, prevConnector: v })}
              />
              <BeatSection
                label="衔接下一框架"
                value={editing ? editForm.nextConnector : fw.nextConnector || ""}
                editing={editing}
                onChange={(v) => onEditFormChange({ ...editForm, nextConnector: v })}
              />
            </div>
          )}

          <div className="space-y-2 pt-2 border-t">
            <div className="flex items-center justify-between">
              <Label>节奏</Label>
              {!editing && (
                <select
                  value={fw.pacing || "standard"}
                  onChange={(e) => onPacingChange(e.target.value)}
                  className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                >
                  <option value="tight">紧凑</option>
                  <option value="standard">标准</option>
                  <option value="loose">舒展</option>
                </select>
              )}
              {editing && (
                <select
                  value={editForm.line}
                  onChange={(e) =>
                    onEditFormChange({ ...editForm, line: e.target.value as "main" | "sub" })
                  }
                  className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                >
                  <option value="main">主线</option>
                  <option value="sub">支线</option>
                </select>
              )}
            </div>
            {!editing && fw.autoPacing && (
              <p className="text-xs text-muted-foreground">
                （AI 自动判定，可手动调整）
              </p>
            )}
          </div>

          {(fw.directionHints || fw.handcraftHints || fw.reusableTemplate || editing) && (
            <div className="space-y-3 pt-2 border-t">
              <BeatSection
                label="方向提示"
                value={editing ? editForm.directionHints : fw.directionHints}
                editing={editing}
                onChange={(v) => onEditFormChange({ ...editForm, directionHints: v })}
              />
              <BeatSection
                label="手工提示"
                value={editing ? editForm.handcraftHints : fw.handcraftHints}
                editing={editing}
                onChange={(v) => onEditFormChange({ ...editForm, handcraftHints: v })}
              />
              <BeatSection
                label="可复用模板"
                value={editing ? editForm.reusableTemplate : fw.reusableTemplate || ""}
                editing={editing}
                onChange={(v) => onEditFormChange({ ...editForm, reusableTemplate: v })}
              />
            </div>
          )}

          {(fw.characters.length > 0 || editing) && (
            <div className="space-y-2 pt-2 border-t">
              <Label>角色</Label>
              {(editing ? editForm.characters : fw.characters).map((c: any, i: number) => (
                <div key={i} className="flex gap-2 items-center">
                  <Input
                    value={c.name}
                    onChange={(e) => onUpdateCharacter(i, "name", e.target.value)}
                    placeholder="角色名"
                    className="flex-1"
                    readOnly={!editing}
                  />
                  <Input
                    value={c.role}
                    onChange={(e) => onUpdateCharacter(i, "role", e.target.value)}
                    placeholder="在该框架中的作用"
                    className="flex-[2]"
                    readOnly={!editing}
                  />
                  {editing && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onRemoveCharacter(i)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              {editing && (
                <Button variant="outline" size="sm" onClick={onAddCharacter}>
                  添加角色
                </Button>
              )}
            </div>
          )}

          {(fw.foreshadowing.length > 0 || editing) && (
            <div className="space-y-2 pt-2 border-t">
              <Label>伏笔</Label>
              {(editing ? editForm.foreshadowing : fw.foreshadowing).map((f: string, i: number) => (
                <div key={i} className="flex gap-2 items-center">
                  <Input
                    value={f}
                    onChange={(e) => onUpdateForeshadowing(i, e.target.value)}
                    placeholder="伏笔描述"
                    className="flex-1"
                    readOnly={!editing}
                  />
                  {editing && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onRemoveForeshadowing(i)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              {editing && (
                <Button variant="outline" size="sm" onClick={onAddForeshadowing}>
                  添加伏笔
                </Button>
              )}
            </div>
          )}

          {editing && (
            <div className="space-y-2 pt-2 border-t">
              <Label>标签</Label>
              <div className="flex items-center gap-1 flex-wrap">
                {editForm.tags.map((tag: string) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs text-primary"
                  >
                    <TagIcon className="h-3 w-3" />
                    {tag}
                    <button
                      type="button"
                      onClick={() => onRemoveTag(tag)}
                      className="ml-0.5 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {editForm.tags.length === 0 && (
                  <span className="text-xs text-muted-foreground">暂无标签</span>
                )}
              </div>
              <TagInput onAdd={onAddTag} />
            </div>
          )}

          {editing && (
            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" size="sm" onClick={onCancelEdit}>
                <X className="h-4 w-4 mr-2" />
                取消
              </Button>
              <Button size="sm" onClick={onSaveEdit}>
                <Save className="h-4 w-4 mr-2" />
                保存
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BeatSection({
  label,
  value,
  editing,
  onChange,
}: {
  label: string;
  value: string;
  editing: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {editing ? (
        <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} />
      ) : (
        <p className="text-sm whitespace-pre-wrap">{value}</p>
      )}
    </div>
  );
}

function MainTimelineView({ frameworks }: { frameworks: PlotFramework[] }) {
  const sorted = [...frameworks].sort((a, b) => a.createdAt - b.createdAt);

  return (
    <div className="relative">
      <div className="absolute left-[22px] top-2 bottom-2 w-0.5 bg-border" />

      <div className="space-y-4">
        {sorted.map((fw, index) => (
          <div key={fw.id} className="relative flex gap-4">
            <div className="relative z-10 flex h-[44px] w-[44px] flex-shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">
              {index + 1}
            </div>

            <div className="flex-1 min-w-0">
              <div className="rounded-lg border bg-card p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <h4 className="font-medium text-sm">{fw.title}</h4>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium">
                        {PACING_LABELS[fw.pacing || "standard"] || "标准"}
                      </span>
                      {fw.rangeChapterIds?.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {fw.rangeChapterIds.length} 章
                        </span>
                      )}
                    </div>
                  </div>
                  {index < sorted.length - 1 && (
                    <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-1" />
                  )}
                </div>

                <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                  <span className="text-muted-foreground/70">钩子：</span>
                  {fw.beats.hook}
                </p>
                <p className="text-sm text-muted-foreground line-clamp-2">
                  <span className="text-muted-foreground/70">爽点：</span>
                  {fw.beats.payoff}
                </p>

                {(fw.prevConnector || fw.nextConnector) && (
                  <div className="mt-3 pt-3 border-t grid grid-cols-2 gap-3 text-xs">
                    {fw.prevConnector && (
                      <div>
                        <span className="text-muted-foreground">↩ 衔接上一框架：</span>
                        <p className="mt-0.5">{fw.prevConnector}</p>
                      </div>
                    )}
                    {fw.nextConnector && (
                      <div>
                        <span className="text-muted-foreground">↪ 衔接下一框架：</span>
                        <p className="mt-0.5">{fw.nextConnector}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {index < sorted.length - 1 && <div className="h-4" />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TagInput({ onAdd }: { onAdd: (value: string) => void }) {
  const [value, setValue] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    onAdd(value);
    setValue("");
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="输入标签后回车添加"
        className="flex-1"
      />
      <Button type="submit" variant="outline" size="sm">
        添加
      </Button>
    </form>
  );
}

function HistoryPanel({
  fw,
  onRollback,
  onDeleteSnapshot,
}: {
  fw: PlotFramework;
  onRollback: (snapshotIndex: number) => void;
  onDeleteSnapshot: (snapshotIndex: number) => void;
}) {
  const history = fw.history || [];

  return (
    <div className="mx-4 mb-3 rounded-md border bg-muted/30 p-3">
      <div className="flex items-center gap-2 mb-2">
        <History className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">版本历史</span>
        <span className="text-xs text-muted-foreground">({history.length})</span>
      </div>

      {history.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">
          暂无历史版本。编辑保存框架后，上一版本会自动存入历史。
        </p>
      ) : (
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {history.map((snap, idx) => (
            <div
              key={idx}
              className="rounded-md border bg-card p-2 text-xs"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium">{snap.title}</span>
                <span className="text-muted-foreground">
                  {new Date(snap.savedAt).toLocaleString("zh-CN")}
                </span>
              </div>
              <p className="text-muted-foreground line-clamp-1 mb-1">
                钩子：{snap.beats.hook}
              </p>
              <p className="text-muted-foreground line-clamp-1 mb-2">
                爽点：{snap.beats.payoff}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onRollback(idx)}
                  className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs text-primary hover:bg-primary/20"
                >
                  <RotateCcw className="h-3 w-3" />
                  回滚到此版本
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteSnapshot(idx)}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-3 w-3" />
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
