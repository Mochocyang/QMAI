import { Suspense, lazy } from "react";
import { useWikiStore } from "@/stores/wiki-store";
import { WritingWorkspace } from "./writing-workspace";

const SearchView = lazy(async () => {
  const mod = await import("@/components/search/search-view");
  return { default: mod.SearchView };
});

const UnifiedSkillLibraryView = lazy(async () => {
  const mod = await import("@/components/skill-library/unified-skill-library-view");
  return { default: mod.UnifiedSkillLibraryView };
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

const StorySimulationView = lazy(async () => {
  const mod =
    await import("@/components/novel/story-simulation/story-simulation-view");
  return { default: mod.StorySimulationView };
});

/**
 * 维护工具从设置里搬到这里（用户要求：放进「创作工具」）。
 *
 * 它是**项目级**的维护动作（重复资料合并、伏笔清理都作用于当前打开的书），
 * 而设置里其余分类是应用级配置 —— 之前它放在设置左侧，用户在写作时
 * 要为了清理一本书的数据离开写作现场去"设置"，语义上也别扭。
 * 现在它和记忆中心、拆书库一样是一个正常视图，从顶栏「创作工具」进入。
 */
const MaintenanceView = lazy(async () => {
  const mod = await import("@/components/settings/sections/maintenance-section");
  return { default: mod.MaintenanceSection };
});

function LoadingView() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      加载中...
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
        content = (
          <Suspense fallback={<LoadingView />}>
            <SearchView />
          </Suspense>
        );
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
      case "writingStyleLibrary":
      case "characterSoulLibrary":
      case "skillFavorites":
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
      case "storySimulation":
        content = (
          <Suspense fallback={<LoadingView />}>
            <StorySimulationView />
          </Suspense>
        );
        break;
      case "maintenance":
        content = (
          <Suspense fallback={<LoadingView />}>
            {/* data-ui-page 由外层提供：MaintenanceSection 是原设置页的区块，
                它自己的根节点没有这个属性（见 ui-test-tools.css 里
                [data-ui-page="maintenance"] 的内边距说明）。 */}
            <div data-ui-page="maintenance">
              <MaintenanceView />
            </div>
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
