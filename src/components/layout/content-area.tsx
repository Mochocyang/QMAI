import { Suspense, lazy } from "react";
import { useWikiStore } from "@/stores/wiki-store";
import { isBuiltinViewEnabled } from "@/lib/plugins/builtin-state";
import { BuiltinViewDisabledNotice } from "./builtin-view-disabled-notice";
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
 * 「插件」独立页面（插件市场 + 已安装管理）。
 *
 * 为什么是懒加载：它把插件市场、已安装卡片、手动安装弹窗整套带进来，
 * 而绝大多数会话根本不点这个图标 —— 让首屏为它付解析成本不划算。
 */
const PluginCenterView = lazy(async () => {
  const mod = await import("@/components/plugins/plugin-center-view");
  return { default: mod.PluginCenterView };
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
        /*
         * 「剧情搜索」是一个内置插件（见 `lib/plugins/builtin.ts`）。被关闭时必须渲染
         * 一个明确的"已关闭"页，而不是空壳或空白：用户可能通过上一会话恢复的
         * activeView 直接落到这里，看到空白的直觉是"软件坏了"。
         */
        content = isBuiltinViewEnabled("search") ? (
          <Suspense fallback={<LoadingView />}>
            <SearchView />
          </Suspense>
        ) : (
          <BuiltinViewDisabledNotice view="search" />
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
      // 合并说明：两侧各自追加了技能库的内部视图，取并集 —— 都渲染同一个
      // UnifiedSkillLibraryView，由组件内部按 activeView 决定显示哪个 tab。
      case "writingStyleLibrary":
      case "characterSoulLibrary":
      case "personaSkillLibrary":
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
        /*
         * 「审查中心」是一个内置插件（见 `lib/plugins/builtin.ts`）。被关闭时必须渲染
         * 一个明确的"已关闭"页，而不是空壳或空白：用户可能通过上一会话恢复的
         * activeView 直接落到这里，看到空白的直觉是"软件坏了"。
         */
        content = isBuiltinViewEnabled("reviewCenter") ? (
          <Suspense fallback={<LoadingView />}>
            <ReviewCenterView />
          </Suspense>
        ) : (
          <BuiltinViewDisabledNotice view="reviewCenter" />
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
        /*
         * 「剧情推演室」是一个内置插件（见 `lib/plugins/builtin.ts`）。被关闭时必须渲染
         * 一个明确的"已关闭"页，而不是空壳或空白：用户可能通过上一会话恢复的
         * activeView 直接落到这里，看到空白的直觉是"软件坏了"。
         */
        content = isBuiltinViewEnabled("storySimulation") ? (
          <Suspense fallback={<LoadingView />}>
            <StorySimulationView />
          </Suspense>
        ) : (
          <BuiltinViewDisabledNotice view="storySimulation" />
        );
      break;
      case "plugins":
        content = (
          <Suspense fallback={<LoadingView />}>
            <PluginCenterView />
          </Suspense>
        );
        break;
      case "maintenance":
        content = (
          <Suspense fallback={<LoadingView />}>
            {/* 独立维护页自己承担滚动和边距，正式界面与测试界面共用。 */}
            <div
              data-ui-page="maintenance"
              className="h-full min-h-0 min-w-0 overflow-y-auto overscroll-contain px-4 pt-6 pb-7 sm:px-8 [scrollbar-gutter:stable]"
            >
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
