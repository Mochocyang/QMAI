/**
 * 皮肤（外观）上下文。
 *
 * 背景：外观切换器原本在顶栏（UiTestShell）里，皮肤状态也由外壳持有；
 * 现在它被移到侧栏底部的「外观」（components/layout/sidebar-bottom-actions.tsx）。
 * 侧栏在组件树里比外壳低很多层（外壳 → SidebarPanel → 各侧栏面板 → 底栏），
 * 逐层传 props 太啰嗦，所以用 context 把皮肤状态透传下去。
 *
 * 未包裹在 Provider 内时（例如单测里单独渲染某个侧栏面板），
 * `useAppearanceSkin()` 返回 null，底栏据此隐藏「外观」入口而不是报错。
 */

import { createContext, useContext, type ReactNode } from "react"
import type { UiTestSkin } from "@/lib/ui-test"

export interface AppearanceSkinValue {
  /** 当前皮肤 */
  skin: UiTestSkin
  /** 切换皮肤（持久化与主题联动由外壳的 effect 负责） */
  selectSkin: (skin: UiTestSkin) => void
}

const AppearanceSkinContext = createContext<AppearanceSkinValue | null>(null)

export function AppearanceSkinProvider({
  value,
  children,
}: {
  value: AppearanceSkinValue
  children: ReactNode
}) {
  return (
    <AppearanceSkinContext.Provider value={value}>
      {children}
    </AppearanceSkinContext.Provider>
  )
}

/** 读取皮肤上下文；不在外壳内时返回 null。 */
export function useAppearanceSkin(): AppearanceSkinValue | null {
  return useContext(AppearanceSkinContext)
}
