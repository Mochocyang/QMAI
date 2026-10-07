import { useState, useMemo, useRef, useEffect } from "react";
import {
  Trash2,
  Edit3,
  Eye,
  AlertTriangle,
  GitBranch,
  GitCompare,
  GitBranchPlus,
} from "lucide-react";
import type { SimulationBranch } from "@/lib/novel/story-simulation/types";
import { MODE_VISUAL_INFO } from "@/lib/novel/story-simulation/types";
import { Button } from "@/components/ui/button";

interface BranchManagerPanelProps {
  branches: SimulationBranch[];
  activeBranchId: string | null;
  compareBranchIds: string[];
  isCompareMode: boolean;
  onSaveBranch: (name: string) => void;
  onDeleteBranch: (id: string) => void;
  onRenameBranch: (id: string, name: string) => void;
  onSwitchBranch: (id: string) => void;
  onToggleCompareBranch: (branchId: string) => void;
  onSetCompareMode: (enabled: boolean) => void;
  onClearCompareSelection: () => void;
}

export function BranchManagerPanel({
  branches,
  activeBranchId,
  compareBranchIds,
  isCompareMode,
  onSaveBranch,
  onDeleteBranch,
  onRenameBranch,
  onSwitchBranch,
  onToggleCompareBranch,
  onSetCompareMode,
  onClearCompareSelection,
}: BranchManagerPanelProps) {
  const [newBranchName, setNewBranchName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const sortedBranches = useMemo(() => {
    return [...branches].sort((a, b) => b.overallScore - a.overallScore);
  }, [branches]);

  const isMaxBranches = branches.length >= 10;

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const handleSave = () => {
    const name = newBranchName.trim();
    if (!name || isMaxBranches) return;
    onSaveBranch(name);
    setNewBranchName("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSave();
    }
  };

  const handleStartRename = (branch: SimulationBranch) => {
    setEditingId(branch.id);
    setEditingName(branch.name);
  };

  const handleFinishRename = () => {
    if (!editingId) return;
    const name = editingName.trim();
    if (name) {
      onRenameBranch(editingId, name);
    }
    setEditingId(null);
    setEditingName("");
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleFinishRename();
    } else if (e.key === "Escape") {
      setEditingId(null);
      setEditingName("");
    }
  };

  const handleDelete = (id: string, name: string) => {
    if (confirm(`确定要删除分支「${name}」吗？`)) {
      onDeleteBranch(id);
    }
  };

  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border bg-muted/30">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <GitBranch className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">分支管理</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {branches.length}/10
        </span>
      </div>

      {compareBranchIds.length > 0 && !isCompareMode && (
        <div className="flex items-center gap-2 border-b bg-primary/5 px-3 py-2">
          <span className="text-xs text-muted-foreground">
            已选 {compareBranchIds.length}/3 个分支
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClearCompareSelection}
            className="h-6 px-2 text-xs"
          >
            清空
          </Button>
        </div>
      )}

      <div className="space-y-2 p-3">
        <div className="text-[0.6875rem] text-muted-foreground">
          为当前推演状态命名，点击「创建分支」保存快照
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={newBranchName}
            onChange={(e) => setNewBranchName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入分支名称..."
            disabled={isMaxBranches}
            className="h-8 flex-1 rounded border border-input bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          />
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={!newBranchName.trim() || isMaxBranches}
            className="h-8"
          >
            <GitBranchPlus className="h-3.5 w-3.5 mr-1" />
            创建分支
          </Button>
        </div>

        {isMaxBranches && (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>分支数量已达上限（10个），请先删除部分分支</span>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {sortedBranches.length === 0 ? (
          <div className="flex h-full items-center justify-center py-8 text-center text-xs text-muted-foreground">
            <div>
              <GitBranch className="mx-auto mb-2 h-8 w-8 opacity-30" />
              <div>暂无保存的分支</div>
              <div className="mt-1">
                输入分支名称 → 点击「创建分支」保存当前推演状态
              </div>
              <div className="mt-0.5">后续可在分支间切换对比</div>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {sortedBranches.map((branch, index) => {
              const isActive = activeBranchId === branch.id;
              const isSelected = compareBranchIds.includes(branch.id);
              const modeInfo = MODE_VISUAL_INFO[branch.mode];
              return (
                <div
                  key={branch.id}
                  className={`relative rounded-md border p-2.5 transition-colors ${
                    isSelected
                      ? "border-primary ring-2 ring-primary/20"
                      : isActive
                        ? "border-primary bg-primary/5"
                        : "bg-background/70 hover:bg-muted/30"
                  }`}
                >
                  <label className="absolute left-2 top-2 z-10 flex h-4 w-4 cursor-pointer items-center justify-center">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleCompareBranch(branch.id)}
                      className="h-3.5 w-3.5 cursor-pointer accent-primary"
                    />
                  </label>

                  <div className="flex items-start gap-2 pl-5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {index === 0 && (
                          <span className="shrink-0 rounded bg-gradient-to-r from-amber-500 to-orange-500 px-1.5 py-0.5 text-[0.625rem] font-medium text-white">
                            推荐
                          </span>
                        )}
                        {editingId === branch.id ? (
                          <input
                            ref={inputRef}
                            type="text"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onBlur={handleFinishRename}
                            onKeyDown={handleRenameKeyDown}
                            className="h-6 w-full rounded border border-input bg-background px-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                          />
                        ) : (
                          <span className="truncate text-sm font-medium">
                            {branch.name}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem] text-muted-foreground">
                        <span className="font-semibold text-primary">
                          {branch.overallScore.toFixed(1)} 分
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 ${modeInfo?.color || "bg-gray-100 text-gray-700"}`}
                        >
                          {modeInfo?.name || branch.mode}
                        </span>
                        <span>{formatDate(branch.createdAt)}</span>
                      </div>
                      <div className="mt-1.5 grid grid-cols-4 gap-1 text-[0.625rem] text-muted-foreground">
                        <div className="text-center">
                          <div className="font-medium text-foreground">
                            {branch.scoreDetails.avgDirectorScore.toFixed(1)}
                          </div>
                          <div>导演评分</div>
                        </div>
                        <div className="text-center">
                          <div className="font-medium text-foreground">
                            {branch.scoreDetails.eventCount}
                          </div>
                          <div>事件数</div>
                        </div>
                        <div className="text-center">
                          <div className="font-medium text-foreground">
                            {Math.round(
                              branch.scoreDetails.characterDiversity * 100,
                            )}
                            %
                          </div>
                          <div>角色活跃</div>
                        </div>
                        <div className="text-center">
                          <div className="font-medium text-foreground">
                            {Math.round(
                              branch.scoreDetails.plotProgression * 100,
                            )}
                            %
                          </div>
                          <div>剧情推进</div>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onSwitchBranch(branch.id)}
                        className="h-7 w-7 p-0"
                        title="查看此分支"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleStartRename(branch)}
                        className="h-7 w-7 p-0"
                        title="重命名"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(branch.id, branch.name)}
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                        title="删除"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  {isActive && (
                    <div className="mt-1.5 border-t pt-1.5 text-[0.6875rem] text-primary">
                      ● 当前显示此分支
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {sortedBranches.length >= 2 && (
        <div className="border-t p-3">
          <Button
            type="button"
            size="sm"
            onClick={() => onSetCompareMode(true)}
            disabled={
              compareBranchIds.length < 2 || compareBranchIds.length > 3
            }
            className="w-full"
          >
            <GitCompare className="h-3.5 w-3.5 mr-1.5" />
            对比选中的分支
          </Button>
          {compareBranchIds.length > 0 && compareBranchIds.length < 2 && (
            <div className="mt-1.5 text-center text-[0.6875rem] text-muted-foreground">
              请再选择 {2 - compareBranchIds.length} 个分支
            </div>
          )}
          {compareBranchIds.length > 3 && (
            <div className="mt-1.5 text-center text-[0.6875rem] text-amber-600">
              最多选择 3 个分支进行对比
            </div>
          )}
        </div>
      )}
    </div>
  );
}
