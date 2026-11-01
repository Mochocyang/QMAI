// @vitest-environment jsdom
/**
 * 账号菜单的行为验收（真渲染，不是源码字符串断言）：
 *
 *   · 已登录 → 菜单里有「退出账号」，点它调 store 的 logout()
 *   · 未登录 → 底栏显示「未登录」、菜单里没有「退出账号」
 *   · 未登录点账号条目 → 直接弹登录窗（openDialog("login")），**不跳设置页**
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { AccountUser } from "@/lib/account/types"
import { useAccountStore } from "@/stores/account-store"
import { useWikiStore } from "@/stores/wiki-store"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}))

vi.mock("@/components/layout/appearance-context", () => ({
  useAppearanceSkin: () => ({ skin: "jing", selectSkin: vi.fn() }),
}))

vi.mock("@/components/layout/announcement-bell", () => ({
  AnnouncementBell: () => null,
}))

vi.mock("@/components/account/account-avatar", () => ({
  AccountAvatar: () => null,
}))

import { SidebarBottomActions } from "@/components/layout/sidebar-bottom-actions"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const USER: AccountUser = {
  id: 1,
  email: "pairy0@sina.com",
  displayName: "Moc",
  createdAt: 1_793_000_000,
  avatarUpdatedAt: null,
  displayNameUpdatedAt: null,
}

describe("左下角账号菜单", () => {
  let container: HTMLDivElement
  let root: Root
  const logout = vi.fn(async () => {})
  const openDialog = vi.fn()

  beforeEach(() => {
    logout.mockClear()
    openDialog.mockClear()
    useWikiStore.setState({ activeView: "sources", activeSettingsCategory: null, searchPanelOpen: false })
    useAccountStore.setState({ user: USER, logout, openDialog })
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    useAccountStore.setState({ user: null })
  })

  async function render() {
    await act(async () => root.render(<SidebarBottomActions />))
  }

  async function openMenu() {
    const trigger = container.querySelector<HTMLButtonElement>('[data-ui="sidebar-account-avatar"]')!
    await act(async () => trigger.click())
  }

  it("已登录：底栏显示名字，菜单最后一项是「退出账号」并会调 logout", async () => {
    await render()
    expect(container.textContent).toContain("Moc")

    await openMenu()
    // 外观子菜单里的皮肤项也带 data-ui（sidebar-skin-*），这里只看顶层入口
    const entries = [...document.querySelectorAll<HTMLElement>(".ui-test-avatar-menu [data-ui]")]
      .map((item) => item.dataset.ui)
      .filter((id): id is string => !!id && !id.startsWith("sidebar-skin-"))
    // 顺序：账号 → 外观 → 设置 → 维护工具 → 退出账号
    expect(entries).toEqual([
      "sidebar-avatar-account-entry",
      "sidebar-appearance-entry",
      "sidebar-settings-entry",
      "sidebar-maintenance-entry",
      "sidebar-logout-entry",
    ])

    const logoutEntry = document.querySelector<HTMLButtonElement>('[data-ui="sidebar-logout-entry"]')!
    expect(logoutEntry.textContent).toContain("退出账号")
    await act(async () => logoutEntry.click())
    expect(logout).toHaveBeenCalledTimes(1)
  })

  it("未登录：底栏显示「未登录」，菜单里没有「退出账号」", async () => {
    useAccountStore.setState({ user: null })
    await render()
    expect(container.textContent).toContain("未登录")

    await openMenu()
    expect(document.querySelector('[data-ui="sidebar-logout-entry"]')).toBeNull()
    // 账号条目仍提示可以登录
    expect(document.querySelector('[data-ui="sidebar-avatar-account-entry"]')?.textContent).toContain("点击登录账号")
  })

  it("未登录点账号条目：直接弹登录窗，不跳设置页", async () => {
    useAccountStore.setState({ user: null })
    await render()
    await openMenu()

    const entry = document.querySelector<HTMLButtonElement>('[data-ui="sidebar-avatar-account-entry"]')!
    await act(async () => entry.click())

    expect(openDialog).toHaveBeenCalledWith("login")
    // 关键：视图没有被切到设置
    expect(useWikiStore.getState().activeView).toBe("sources")
    expect(useWikiStore.getState().activeSettingsCategory).toBeNull()
  })

  it("已登录点账号条目：仍进设置的「账号」分区（改密码/头像在那里）", async () => {
    await render()
    await openMenu()

    const entry = document.querySelector<HTMLButtonElement>('[data-ui="sidebar-avatar-account-entry"]')!
    await act(async () => entry.click())

    expect(openDialog).not.toHaveBeenCalled()
    expect(useWikiStore.getState().activeView).toBe("settings")
    expect(useWikiStore.getState().activeSettingsCategory).toBe("account")
  })
})
