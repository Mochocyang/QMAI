/**
 * 上下文数据源抽象层
 * 用于统一管理和加载各种上下文数据源
 */

/**
 * 上下文加载配置
 */
export interface ContextLoadContext {
  projectPath: string
  task: string
  chapterNumber?: number
  config: {
    recentSummaryWindow: number
    searchTopK: number
    snapshotLookback: number
    revisionFeedbackWindowConfig: any
  }
}

/**
 * 数据源接口
 */
export interface DataSource<T> {
  name: string
  priority: number
  load(context: ContextLoadContext): Promise<T>
  fallback?(context: ContextLoadContext): Promise<T>
}

/**
 * 数据源加载结果
 */
interface DataSourceResult {
  name: string
  value: any
  error: Error | null
}

/**
 * 数据源注册器
 * 负责管理所有数据源的注册、加载和错误处理
 */
export class DataSourceRegistry {
  private sources: Map<string, DataSource<any>> = new Map()

  /**
   * 注册数据源
   */
  register<T>(source: DataSource<T>): void {
    this.sources.set(source.name, source)
  }

  /**
   * 批量注册数据源
   */
  registerAll(sources: DataSource<any>[]): void {
    for (const source of sources) {
      this.register(source)
    }
  }

  /**
   * 并发加载所有数据源
   * 单个数据源失败不会影响整体加载
   */
  async loadAll(context: ContextLoadContext): Promise<Record<string, any>> {
    const sources = Array.from(this.sources.values())
    return this.loadSources(sources, context)
  }

  async loadOnly(sourceNames: string[], context: ContextLoadContext): Promise<Record<string, any>> {
    const allowed = new Set(sourceNames)
    const sources = Array.from(this.sources.values()).filter((source) => allowed.has(source.name))
    return this.loadSources(sources, context)
  }

  private async loadSources(sources: DataSource<any>[], context: ContextLoadContext): Promise<Record<string, any>> {

    const promises = sources.map(async (source): Promise<DataSourceResult> => {
      try {
        const loadedValue = await source.load(context)
        const value = loadedValue === undefined || loadedValue === null
          ? this.getDefaultValue(source.name)
          : loadedValue
        return { name: source.name, value, error: null }
      } catch (error) {
        console.warn(`[DataSource] ${source.name} failed to load:`, error)
        
        // 尝试使用降级策略
        try {
          const fallbackValue = source.fallback 
            ? await source.fallback(context) 
            : this.getDefaultValue(source.name)
          return { name: source.name, value: fallbackValue, error: error as Error }
        } catch (fallbackError) {
          console.warn(`[DataSource] ${source.name} fallback also failed:`, fallbackError)
          return { 
            name: source.name, 
            value: this.getDefaultValue(source.name), 
            error: fallbackError as Error 
          }
        }
      }
    })

    const results = await Promise.all(promises)

    // 转换为记录对象
    return results.reduce((acc, { name, value }) => {
      acc[name] = value
      return acc
    }, {} as Record<string, any>)
  }

  /**
   * 获取数据源的默认值
   */
  private getDefaultValue(sourceName: string): any {
    const defaults: Record<string, any> = {
      outline: "",
      chapterOutline: "",
      volumeContext: "",
      snapshots: {
        recentSummaries: [],
        previousChapterEnding: "",
        characterStates: "",
        foreshadowingSignals: [],
        timeline: "",
      },
      recentChapterContents: [],
      fallbackRecentSummaries: [],
      fallbackPreviousEnding: "",
      fallbackCharacterStates: "",
      fallbackForeshadowingStates: "",
      fallbackTimeline: "",
      relatedSettings: "",
      canonRules: "",
      writingStyle: "",
      searchResults: "",
      graphSearchResults: "",
      revisionFeedback: [],
      cognitionText: "",
      soulDoc: "",
      characterAuras: "",
    }
    return defaults[sourceName] ?? null
  }

  /**
   * 获取已注册的数据源数量
   */
  size(): number {
    return this.sources.size
  }

  /**
   * 清空所有数据源
   */
  clear(): void {
    this.sources.clear()
  }
}
