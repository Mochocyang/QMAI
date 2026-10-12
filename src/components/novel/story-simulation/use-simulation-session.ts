/**
 * 让「剧情推演」的配置在项目之间保持住（P0-6）。
 *
 * 解决的问题：用户调好的那套设置（模式、想法、字数、章节数、轮次、导演开关）
 * 在离开功能或重启应用后全部丢失，每次都要从头再调一遍。
 *
 * 存到 `.qmai/simulations/session.json`（见 simulation-session.ts 的说明：
 * 本仓库没有 `zustand/middleware` 的 `persist`，持久化一律走文件）。
 *
 * ## 时序是这个 hook 唯一的难点
 * 水合是异步的，而 store 的默认值随时可读。如果保存逻辑不设门槛，挂载瞬间就会
 * 把「默认配置」写进磁盘，把用户上次的会话覆盖掉 —— 这个竞态正是 `hydrated`
 * 挡住的东西，并已用测试钉住。
 *
 * 于是「基准」取法很关键，`baselineJson` 的分支是刻意的：
 *
 * - 磁盘上有会话：基准 = **文件里的内容**。水合刚把它灌进 store，两者相同，
 *   于是不会立刻把刚读回来的东西再写一遍。
 * - 磁盘上没有会话：基准 = **水合开始那一刻 store 的样子**。这样「用户在水合
 *   那几十毫秒里已经拖动过配置」也算真实改动、会被存下来；而全新打开且没动过
 *   任何东西时两者相同，不会平白在磁盘上创建一个文件。
 *
 * 用 state（而非 ref）记录水合完成：水合读不到文件时不会 setState，若只用 ref 就
 * 不会触发重渲染，落盘 effect 也就再没有机会运行 —— 窗口期内的那次改动会被丢掉。
 *
 * 之所以做成 hook 而不是写在 2897 行的 view 里：这样它才能被独立测试。
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { useStorySimulationStore } from "@/stores/story-simulation-store"
import {
  loadSimulationSession,
  saveSimulationSession,
  type SimulationSessionConfig,
} from "@/lib/novel/story-simulation/simulation-session"

/** 只取参与持久化的这 6 个字段，便于稳定比较。 */
function configOf(state: {
  mode: SimulationSessionConfig["mode"]
  userIdea: string
  targetWords: number
  sourceChapters: number
  simulationRounds: number
  directorEnabled: boolean
}): SimulationSessionConfig {
  return {
    mode: state.mode,
    userIdea: state.userIdea,
    targetWords: state.targetWords,
    sourceChapters: state.sourceChapters,
    simulationRounds: state.simulationRounds,
    directorEnabled: state.directorEnabled,
  }
}

export function useSimulationSession(projectPath: string | undefined): void {
  const mode = useStorySimulationStore((s) => s.mode)
  const userIdea = useStorySimulationStore((s) => s.userIdea)
  const targetWords = useStorySimulationStore((s) => s.targetWords)
  const sourceChapters = useStorySimulationStore((s) => s.sourceChapters)
  const simulationRounds = useStorySimulationStore((s) => s.simulationRounds)
  const directorEnabled = useStorySimulationStore((s) => s.directorEnabled)

  const [hydrated, setHydrated] = useState(false)
  const baselineRef = useRef<string | null>(null)

  const config = useMemo<SimulationSessionConfig>(
    () =>
      configOf({
        mode,
        userIdea,
        targetWords,
        sourceChapters,
        simulationRounds,
        directorEnabled,
      }),
    [mode, userIdea, targetWords, sourceChapters, simulationRounds, directorEnabled],
  )

  // 水合：读到什么就灌什么，读不到就保持现状。任一步失败都退回「没有会话」。
  useEffect(() => {
    if (!projectPath) {
      setHydrated(false)
      baselineRef.current = null
      return
    }

    let cancelled = false
    setHydrated(false)
    baselineRef.current = null
    // 基准兜底：水合开始那一刻 store 的样子
    const startedWith = JSON.stringify(configOf(useStorySimulationStore.getState()))

    void (async () => {
      const session = await loadSimulationSession(projectPath)
      if (cancelled) return

      if (session) {
        const store = useStorySimulationStore.getState()
        store.setMode(session.mode)
        store.setUserIdea(session.userIdea)
        store.setTargetWords(session.targetWords)
        store.setSourceChapters(session.sourceChapters)
        store.setSimulationRounds(session.simulationRounds)
        store.setDirectorEnabled(session.directorEnabled)
      }

      baselineRef.current = session
        ? JSON.stringify(configOf(session))
        : startedWith
      setHydrated(true)
    })()

    return () => {
      cancelled = true
    }
  }, [projectPath])

  // 落盘：只有水合完成后、且内容与基准不同才写。
  useEffect(() => {
    if (!projectPath || !hydrated) return

    const json = JSON.stringify(config)
    if (json === baselineRef.current) return
    // 记下已落盘的内容，让连续改动只在最后写一次
    baselineRef.current = json

    void saveSimulationSession(projectPath, config).catch((err) => {
      // 配置存不下来不该打断推演，记一条日志即可。
      console.error("保存剧情推演会话失败:", err)
    })
  }, [projectPath, hydrated, config])
}
