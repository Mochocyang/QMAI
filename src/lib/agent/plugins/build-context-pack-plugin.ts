import type { PrePlugin, PrePluginInput, PrePluginOutput } from "../pipeline"
import type { ContextPack } from "@/lib/novel/context-engine"
import type { DataSourceCategory, RouteSource } from "@/lib/novel/classification"

export interface BuildContextPackPluginDeps {
  buildContextPack?: (
    projectPath: string,
    task: string,
    chapterNumber?: number,
    options?: { categories?: DataSourceCategory[] },
  ) => Promise<ContextPack>
  loadClassificationConfig?: (projectPath: string, featureName?: string) => Promise<{
    config: { routes: Array<{ intent: string; required: string[]; optional: string[]; forbidden: string[] }>; version?: string }
    source: RouteSource
    fallbackReason?: string
    versionInfo?: {
      upToDate: boolean
      currentVersion: string
      latestVersion: string
      needsUpgrade: boolean
      canUpgrade: boolean
    }
  }>
  applyRouteRules?: (pack: ContextPack, rule: { intent: string; required: string[]; optional: string[]; forbidden: string[] }) => {
    pack: ContextPack
    blockedSources: DataSourceCategory[]
    keptSources: DataSourceCategory[]
  }
  onError?: (error: Error) => void
  enableClassification?: boolean
  featureName?: string
  onVirtualTool?: (
    event: "start" | "end",
    name: string,
    data: { callId?: string; params?: Record<string, unknown>; result?: string; status?: string },
  ) => void
  onContextInfoUpdate?: (info: {
    loadedSources?: DataSourceCategory[]
    blockedSources?: DataSourceCategory[]
    routeSource?: RouteSource
    fallbackReason?: string
    classificationVersion?: {
      upToDate: boolean
      currentVersion: string
      latestVersion: string
      needsUpgrade: boolean
    }
  }) => void
}

export function createBuildContextPackPlugin(deps: BuildContextPackPluginDeps = {}): PrePlugin {
  const {
    buildContextPack: buildFn,
    onError,
    enableClassification = false,
    featureName,
    onVirtualTool,
    onContextInfoUpdate,
  } = deps

  return {
    name: "build_context_pack",
    priority: 30,
    run: async (input: PrePluginInput): Promise<PrePluginOutput> => {
      if (!input.novelMode) return {}

      const route = input.effectiveTaskRoute || input.taskRoute
      if (!route) return {}

      let callId: string | undefined
      if (onVirtualTool) {
        callId = `build_context_pack_${Date.now()}`
        onVirtualTool("start", "build_context_pack", {
          callId,
          params: {
            projectPath: input.projectPath,
            userMessage: input.userMessage,
            chapterNumber: route.chapterNumber,
          },
        })
      }

      try {
        let routeSource: RouteSource | undefined
        let blockedSources: DataSourceCategory[] = Array.isArray(input.blockedSources)
          ? input.blockedSources as DataSourceCategory[]
          : []
        let keptSources: DataSourceCategory[] = []
        let allowedCategories: DataSourceCategory[] | undefined
        let resolvedRule: { intent: string; required: string[]; optional: string[]; forbidden: string[] } | undefined
        let classificationFallbackReason: string | undefined
        let classificationVersion: {
          upToDate: boolean
          currentVersion: string
          latestVersion: string
          needsUpgrade: boolean
        } | undefined

        if (enableClassification) {
          try {
            const mod = await import("@/lib/novel/classification")
            const loadConfig = deps.loadClassificationConfig || mod.loadClassificationConfig
            const resolveRule = mod.resolveRouteRule

            const classificationResult = await loadConfig(input.projectPath, featureName)
            routeSource = classificationResult.source
            classificationFallbackReason = classificationResult.fallbackReason
            classificationVersion = classificationResult.versionInfo
              ? {
                  upToDate: classificationResult.versionInfo.upToDate,
                  currentVersion: classificationResult.versionInfo.currentVersion,
                  latestVersion: classificationResult.versionInfo.latestVersion,
                  needsUpgrade: classificationResult.versionInfo.needsUpgrade,
                }
              : undefined

            const rule = resolveRule(classificationResult.config as any, route.intent) as any
            resolvedRule = rule
            allowedCategories = Array.from(new Set([
              ...(rule.required as DataSourceCategory[]),
              ...(rule.optional as DataSourceCategory[]),
            ]))
          } catch (e) {
            routeSource = "default"
            classificationFallbackReason = `分类路由应用失败：${e instanceof Error ? e.message : String(e)}`
          }
        }

        const build = buildFn || (await import("@/lib/novel/context-engine")).buildContextPack
        const buildArgs: [
          string,
          string,
          number | undefined,
          { categories?: DataSourceCategory[] }?,
        ] = [
          input.projectPath,
          input.userMessage,
          route.chapterNumber,
        ]
        if (allowedCategories) {
          buildArgs.push({ categories: allowedCategories })
        }
        let contextPack = await build(...buildArgs)

        if (enableClassification && resolvedRule) {
          try {
            const mod = await import("@/lib/novel/classification")
            const applyRules = deps.applyRouteRules || mod.applyRouteRules
            const result = applyRules(contextPack, resolvedRule as any)
            contextPack = result.pack
            blockedSources = result.blockedSources
            keptSources = result.keptSources
          } catch (e) {
            routeSource = "default"
            classificationFallbackReason = `分类路由应用失败：${e instanceof Error ? e.message : String(e)}`
          }
        }

        if (onContextInfoUpdate) {
          onContextInfoUpdate({
            loadedSources: keptSources,
            blockedSources,
            routeSource,
            fallbackReason: classificationFallbackReason,
            classificationVersion,
          })
        }

        if (onVirtualTool && callId) {
          onVirtualTool("end", "build_context_pack", {
            callId,
            result: JSON.stringify({
              routeSource,
              blockedSources,
              keptSources,
              classificationFallbackReason,
            }),
            status: "done",
          })
        }

        return {
          contextPack,
          routeSource,
          blockedSources,
          keptSources,
          classificationFallbackReason,
        }
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error(String(error)))
        if (onVirtualTool && callId) {
          onVirtualTool("end", "build_context_pack", {
            callId,
            result: error instanceof Error ? error.message : String(error),
            status: "error",
          })
        }
        return {}
      }
    },
  }
}
