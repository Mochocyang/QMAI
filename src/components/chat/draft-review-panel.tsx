import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDraftReviewStore } from "@/stores/draft-review-store";
import type {
  Deviation,
  DeviationType,
} from "@/lib/agent/skills/draft-review-skill";

const DEVIATION_TYPE_LABELS: Record<DeviationType, string> = {
  cognition: "角色认知",
  state: "角色状态",
  continuity: "上一章承接",
  foreshadowing: "伏笔冲突",
};

const DEVIATION_SEVERITY_LABELS: Record<
  string,
  { label: string; className: string }
> = {
  high: {
    label: "高",
    className:
      "text-red-600 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-950/30 dark:border-red-900/50",
  },
  mid: {
    label: "中",
    className:
      "text-amber-600 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-950/30 dark:border-amber-900/50",
  },
  low: {
    label: "低",
    className:
      "text-blue-600 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-950/30 dark:border-blue-900/50",
  },
};

export function DraftReviewPanel() {
  const { t } = useTranslation();
  const phase = useDraftReviewStore((s) => s.phase);
  const result = useDraftReviewStore((s) => s.result);
  const originalDraft = useDraftReviewStore((s) => s.originalDraft);
  const revisedDraft = useDraftReviewStore((s) => s.result?.revisedDraft ?? "");
  const currentRound = useDraftReviewStore((s) => s.currentRound);
  const decisionMade = useDraftReviewStore((s) => s.decisionMade);
  const acceptRevision = useDraftReviewStore((s) => s.acceptRevision);
  const rejectRevision = useDraftReviewStore((s) => s.rejectRevision);
  const reset = useDraftReviewStore((s) => s.reset);

  const isRunning =
    phase.stage === "loading" ||
    phase.stage === "reviewing" ||
    phase.stage === "repairing";
  const isDone = phase.stage === "done";
  const isError = phase.stage === "error";
  const hasDeviations = result ? result.deviations.length > 0 : false;

  // T = novel.draftReview 命名空间
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`novel.draftReview.${key}`, options);

  // 顶部状态条
  const statusContent = useMemo(() => {
    if (phase.stage === "idle" || !phase.stage) {
      return {
        icon: null,
        text: tr("idle"),
        className: "text-muted-foreground",
      };
    }
    if (phase.stage === "loading") {
      return {
        icon: (
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        ),
        text: phase.description || tr("loading"),
        className: "text-primary",
      };
    }
    if (phase.stage === "reviewing") {
      return {
        icon: (
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
        ),
        text:
          phase.description ||
          `${tr("reviewing")} (${tr("round")} ${currentRound + 1})`,
        className: "text-amber-600",
      };
    }
    if (phase.stage === "repairing") {
      return {
        icon: (
          <div className="h-4 w-4 animate-pulse rounded-full bg-amber-500" />
        ),
        text: phase.description || tr("repairing"),
        className: "text-amber-600",
      };
    }
    if (phase.stage === "done") {
      if (result?.truncated) {
        return {
          icon: <AlertCircle className="h-4 w-4 text-red-500" />,
          text: `${tr("truncated")} ${tr("remainingDeviations", { count: result.deviations.length })}`,
          className: "text-red-600",
        };
      }
      if (hasDeviations) {
        return {
          icon: <AlertCircle className="h-4 w-4 text-amber-500" />,
          text:
            phase.description ||
            tr("hasDeviations", { count: result!.deviations.length }),
          className: "text-amber-600",
        };
      }
      return {
        icon: <CheckCircle className="h-4 w-4 text-green-500" />,
        text: tr("noDeviations"),
        className: "text-green-600",
      };
    }
    if (phase.stage === "error") {
      return {
        icon: <XCircle className="h-4 w-4 text-red-500" />,
        text: phase.description || tr("error"),
        className: "text-red-600",
      };
    }
    return { icon: null, text: "", className: "" };
  }, [phase, result, hasDeviations, currentRound, t]);

  // 进度条
  const showProgressBar = isRunning;
  const progressPercent = phase.progress;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 顶部状态条 */}
      <div className="shrink-0 border-b px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-medium">
          {statusContent.icon}
          <span className={statusContent.className}>{statusContent.text}</span>
        </div>
        {showProgressBar && (
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
              style={{ width: `${Math.min(progressPercent, 100)}%` }}
            />
          </div>
        )}
      </div>

      {/* 内容区：独立滚动 */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
        {isError && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
            {phase.description || tr("errorDescription")}
          </div>
        )}

        {result && (
          <>
            {/* 修复摘要 */}
            {result.repairSummary && (
              <div className="rounded-md border bg-muted/20 p-2.5 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
                {result.repairSummary}
              </div>
            )}

            {/* 偏差报告表格 */}
            {result.deviations.length > 0 && (
              <DeviationTable deviations={result.deviations} tr={tr} />
            )}

            {/* 修订对比区 */}
            {(hasDeviations || result.revisedDraft !== originalDraft) && (
              <RevisionCompare
                original={originalDraft}
                revised={revisedDraft}
                hasDifferences={revisedDraft !== originalDraft}
                tr={tr}
              />
            )}

            {/* 无偏差提示 */}
            {result.deviations.length === 0 && !result.truncated && (
              <div className="flex flex-1 items-center justify-center">
                <div className="text-center">
                  <CheckCircle className="mx-auto mb-2 h-8 w-8 text-green-500" />
                  <p className="text-sm font-medium text-foreground">
                    {tr("allPassed")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {tr("noIssuesFound")}
                  </p>
                </div>
              </div>
            )}
          </>
        )}

        {!result && !isRunning && !isError && (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center text-sm text-muted-foreground">
              <ShieldCheck className="mx-auto mb-2 h-8 w-8 opacity-30" />
              <p>{tr("noReviewData")}</p>
            </div>
          </div>
        )}
      </div>

      {/* 底部决策按钮 */}
      {isDone && !decisionMade && (
        <div className="shrink-0 border-t bg-background px-3 py-2">
          {result?.truncated ? (
            <div className="mb-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
              {tr("truncatedWarning")}
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button
              variant="default"
              size="sm"
              className="flex-1 gap-1.5"
              onClick={acceptRevision}
              disabled={!hasDeviations && revisedDraft === originalDraft}
            >
              <CheckCircle className="h-3.5 w-3.5" />
              {tr("acceptRevision")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-1.5"
              onClick={rejectRevision}
            >
              <XCircle className="h-3.5 w-3.5" />
              {tr("rejectRevision")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 gap-1.5"
              onClick={reset}
            >
              {tr("reset")}
            </Button>
          </div>
        </div>
      )}

      {isDone && decisionMade && (
        <div className="shrink-0 border-t bg-background px-3 py-2">
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <CheckCircle className="h-3.5 w-3.5 text-green-500" />
            {tr("decisionMade")}
          </div>
        </div>
      )}
    </div>
  );
}

/** 偏差报告表格（可折叠） */
function DeviationTable({
  deviations,
  tr,
}: {
  deviations: Deviation[];
  tr: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <div className="rounded-md border">
      <div className="border-b bg-muted/30 px-2.5 py-1.5 text-xs font-medium text-foreground">
        {tr("deviationReport")} ({deviations.length})
      </div>
      <div className="max-h-[300px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/50">
            <tr className="border-b text-left text-muted-foreground">
              <th className="w-8 px-2 py-1.5 font-medium">#</th>
              <th className="w-16 px-2 py-1.5 font-medium">{tr("type")}</th>
              <th className="w-12 px-2 py-1.5 font-medium">{tr("severity")}</th>
              <th className="w-24 px-2 py-1.5 font-medium">{tr("location")}</th>
              <th className="px-2 py-1.5 font-medium">
                {tr("issueDescription")}
              </th>
            </tr>
          </thead>
          <tbody>
            {deviations.map((d, idx) => {
              const severityInfo =
                DEVIATION_SEVERITY_LABELS[d.severity] ??
                DEVIATION_SEVERITY_LABELS.mid;
              return (
                <DeviationRow
                  key={d.id}
                  deviation={d}
                  index={idx}
                  severityInfo={severityInfo}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DeviationRow({
  deviation,
  index,
  severityInfo,
}: {
  deviation: Deviation;
  index: number;
  severityInfo: { label: string; className: string };
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        className="cursor-pointer border-b last:border-b-0 hover:bg-muted/20"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="px-2 py-1.5 text-muted-foreground">{index + 1}</td>
        <td className="px-2 py-1.5">
          <span className="rounded bg-muted px-1 py-0.5 font-medium text-foreground/80">
            {DEVIATION_TYPE_LABELS[deviation.type] ?? deviation.type}
          </span>
        </td>
        <td className="px-2 py-1.5">
          <span
            className={`inline-block rounded border px-1.5 py-0.5 text-[0.625rem] font-medium ${severityInfo.className}`}
          >
            {severityInfo.label}
          </span>
        </td>
        <td className="max-w-[120px] truncate px-2 py-1.5 text-muted-foreground">
          {deviation.location}
        </td>
        <td className="px-2 py-1.5 text-muted-foreground">
          <div className="line-clamp-2">{deviation.expected}</div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b bg-muted/10 last:border-b-0">
          <td colSpan={5} className="px-3 py-2">
            <div className="space-y-1.5 text-xs">
              <div>
                <span className="font-medium text-foreground">原文摘抄：</span>
                <span className="text-muted-foreground">
                  {deviation.originalText}
                </span>
              </div>
              <div>
                <span className="font-medium text-foreground">应当如此：</span>
                <span className="text-muted-foreground">
                  {deviation.expected}
                </span>
              </div>
              <div>
                <span className="font-medium text-foreground">记忆依据：</span>
                <span className="text-muted-foreground">
                  {deviation.memoryEvidence}
                </span>
              </div>
              {deviation.repairAction && (
                <div>
                  <span className="font-medium text-foreground">
                    修复方案：
                  </span>
                  <span className="text-muted-foreground">
                    {deviation.repairAction}
                  </span>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** 修订对比区 */
function RevisionCompare({
  original,
  revised,
  hasDifferences,
  tr,
}: {
  original: string;
  revised: string;
  hasDifferences: boolean;
  tr: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [showCompare, setShowCompare] = useState(hasDifferences);

  if (!hasDifferences) {
    return (
      <div className="rounded-md border border-green-200 bg-green-50 p-2.5 text-xs text-green-700 dark:border-green-900/50 dark:bg-green-950/30 dark:text-green-400">
        {tr("noChanges")}
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 border-b bg-muted/30 px-2.5 py-1.5 text-xs font-medium text-foreground"
        onClick={() => setShowCompare(!showCompare)}
      >
        {showCompare ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {tr("revisionCompare")}
      </button>
      {showCompare && (
        <div className="flex min-h-0 gap-2 p-2">
          <div className="flex flex-1 flex-col">
            <div className="mb-1 text-[0.625rem] font-medium text-muted-foreground">
              {tr("originalDraft")}
            </div>
            <div className="max-h-[250px] overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/20 p-2 text-xs leading-relaxed text-muted-foreground">
              {original}
            </div>
          </div>
          <div className="flex flex-1 flex-col">
            <div className="mb-1 text-[0.625rem] font-medium text-muted-foreground">
              {tr("revisedDraft")}
            </div>
            <div className="max-h-[250px] overflow-y-auto whitespace-pre-wrap rounded-md bg-green-50/50 p-2 text-xs leading-relaxed text-foreground dark:bg-green-950/20">
              {revised}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
