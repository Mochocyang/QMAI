import { Suspense, lazy } from "react";
import { useWikiStore } from "@/stores/wiki-store";
import { WritingWorkspace } from "./writing-workspace";
import { SearchView } from "@/components/search/search-view";
import { UnifiedSkillLibraryView } from "@/components/skill-library/unified-skill-library-view";

const ChatPanel = lazy(async () => {
  const mod = await import("@/components/chat/chat-panel");
  return { default: mod.ChatPanel };
});

const AIChatTabContainer = lazy(async () => {
  const mod = await import("@/components/chat/ai-chat-tab-container");
  return { default: mod.AIChatTabContainer };
});

const SettingsView = lazy(async () => {
  const mod = await import("@/components/settings/settings-view");
  return { default: mod.SettingsView };
});

const SourcesView = lazy(async () => {
  const mod = await import("@/components/sources/sources-view");
  return { default: mod.SourcesView };
});

const LintView = lazy(async () => {
  const mod = await import("@/components/lint/lint-view");
  return { default: mod.LintView };
});

const MemoryCenterView = lazy(async () => {
  const mod = await import("@/components/novel/memory-center-view");
  return { default: mod.MemoryCenterView };
});

const GraphView = lazy(async () => {
  const mod = await import("@/components/graph/graph-view");
  return { default: mod.GraphView };
});

const SoulView = lazy(async () => {
  const mod = await import("@/components/novel/soul-view");
  return { default: mod.SoulView };
});

const ReviewCenterView = lazy(async () => {
  const mod = await import("@/components/review/review-center-view");
  return { default: mod.ReviewCenterView };
});

const BookAnalysisView = lazy(async () => {
  const mod = await import("@/components/novel/book-analysis-view");
  return { default: mod.BookAnalysisView };
});

const DismantlingView = lazy(async () => {
  const mod = await import("@/components/novel/dismantling-view")
  return { default: mod.DismantlingView }
})

const PlotFrameworkLibraryView = lazy(async () => {
  const mod = await import("@/components/novel/plot-framework-library-view")
  return { default: mod.PlotFrameworkLibraryView }
})

const StorySimulationView = lazy(async () => {
  const mod =
    await import("@/components/novel/story-simulation/story-simulation-view");
  return { default: mod.StorySimulationView };
});

function LoadingView() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Loading...
    </div>
  );
}

export function ContentArea() {
  const activeView = useWikiStore((s) => s.activeView);
  const novelMode = useWikiStore((s) => s.novelMode);
  const showWritingWorkspace = activeView === "wiki" || activeView === "trash";

  let content = null;
  if (showWritingWorkspace) {
    content = <WritingWorkspace />;
  } else {
    switch (activeView) {
      case "settings":
        content = (
          <Suspense fallback={<LoadingView />}>
            <SettingsView />
          </Suspense>
        );
        break;
      case "sources":
        content = (
          <Suspense fallback={<LoadingView />}>
            <SourcesView />
          </Suspense>
        );
        break;
      case "search":
        content = <SearchView />;
        break;
      case "soul":
        content = (
          <Suspense fallback={<LoadingView />}>
            <SoulView />
          </Suspense>
        );
        break;
      case "skillLibrary":
      case "writingSkillLibrary":
        content = (
          <Suspense fallback={<LoadingView />}>
            <UnifiedSkillLibraryView />
          </Suspense>
        );
        break;
      case "lint":
        content = (
          <Suspense fallback={<LoadingView />}>
            {novelMode ? <MemoryCenterView /> : <LintView />}
          </Suspense>
        );
        break;
      case "graph":
        content = (
          <Suspense fallback={<LoadingView />}>
            <GraphView />
          </Suspense>
        );
        break;
      case "reviewCenter":
        content = (
          <Suspense fallback={<LoadingView />}>
            <ReviewCenterView />
          </Suspense>
        );
        break;
      case "bookAnalysis":
        content = (
          <Suspense fallback={<LoadingView />}>
            <BookAnalysisView />
          </Suspense>
        );
        break;
      case "dismantling":
        content = (
          <Suspense fallback={<LoadingView />}>
            <DismantlingView />
          </Suspense>
        );
        break;
      case "plotFrameworkLibrary":
        content = (
          <Suspense fallback={<LoadingView />}>
            <PlotFrameworkLibraryView />
          </Suspense>
        );
        break;
      case "storySimulation":
        content = (
          <Suspense fallback={<LoadingView />}>
            <StorySimulationView />
          </Suspense>
        );
        break;
      default:
        content = (
          <Suspense fallback={<LoadingView />}>
            <AIChatTabContainer />
          </Suspense>
        );
        break;
    }
  }

  return <div className="h-full">{content}</div>;
}
