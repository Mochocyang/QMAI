// @vitest-environment jsdom
/**
 * 左下角头像入口：
 * - 点它展开菜单（头像 + 外观设置 + 维护工具），不再直接弹账号信息；
 * - 菜单里点头像 → 「设置 → 账号」；
 * - 点「维护工具」→ 维护视图。
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  setActiveView: vi.fn(),
  setActiveSettingsCategory: vi.fn(),
  setSearchPanelOpen: vi.fn(),
  selectSkin: vi.fn(),
  accountUser: { id: 1, email: "a@b.com", displayName: "青幕作者", createdAt: 1, avatarUpdatedAt: null, displayNameUpdatedAt: null } as
    | null
    | { id: number; email: string; displayName: string; createdAt: number; avatarUpdatedAt: number | null; displayNameUpdatedAt: number | null },
}))

vi.mock("@/stores/wiki-store", () => {
  const state = {
    activeView: "wiki",
    setActiveView: mocks.setActiveView,
    setActiveSettingsCategory: mocks.setActiveSettingsCategory,
    setSearchPanelOpen: mocks.setSearchPanelOpen,
  }
  const useWikiStore = (selector: (value: typeof state) => unknown) => selector(state)
  useWikiStore.getState = () => state
  return { useWikiStore }
})

vi.mock("@/stores/account-store", () => {
  const state = {
    // 用 getter 读 mocks，避免模块求值时就把 user 固定住
    get user() {
      return mocks.accountUser
    },
    session: { baseUrl: "https://account.qmai.pro" },
  }
  return { useAccountStore: (selector: (value: typeof state) => unknown) => selector(state) }
})

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? (key === "sidebarActions.appearance" ? "外观设置" : key),
  }),
}))

vi.mock("@/components/layout/appearance-context", () => ({
  useAppearanceSkin: () => ({ skin: "jing", selectSkin: mocks.selectSkin }),
}))

vi.mock("@/components/layout/announcement-bell", () => ({
  AnnouncementBell: () => <span data-ui="announcement-bell" />,
}))

vi.mock("@/components/account/account-avatar", () => ({
  AccountAvatar: () => <span data-ui="account-avatar" />,
}))

import { SidebarBottomActions } from "./sidebar-bottom-actions"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  mocks.setActiveView.mockReset()
  mocks.setActiveSettingsCategory.mockReset()
  mocks.setSearchPanelOpen.mockReset()
  mocks.accountUser = {
    id: 1,
    email: "a@b.com",
    displayName: "青幕作者",
    createdAt: 1,
    avatarUpdatedAt: null,
    displayNameUpdatedAt: null,
  }
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.querySelectorAll(".ui-test-menu-pop").forEach((node) => node.remove())
})

function render() {
  act(() => root.render(<SidebarBottomActions />))
}

function trigger() {
  return host.querySelector<HTMLButtonElement>('[data-ui="sidebar-account-avatar"]')!
}

function menu() {
  return document.querySelector<HTMLElement>(".ui-test-avatar-menu")
}

describe("左下角头像入口", () => {
  it("默认不展开菜单；点头像才展开，且含外观设置与维护工具", () => {
    render()
    expect(menu()).toBeNull()

    act(() => trigger().click())

    const panel = menu()!
    expect(panel).toBeTruthy()
    expect(panel.textContent).toContain("外观设置")
    expect(panel.textContent).toContain("维护工具")
    expect(panel.querySelector('[data-ui="sidebar-avatar-account-entry"]')).toBeTruthy()
  })

  it("菜单里点头像 → 跳到「设置 → 账号」", () => {
    render()
    act(() => trigger().click())
    const entry = menu()!.querySelector<HTMLButtonElement>('[data-ui="sidebar-avatar-account-entry"]')!
    act(() => entry.click())

    expect(mocks.setActiveSettingsCategory).toHaveBeenCalledWith("account")
    expect(mocks.setActiveView).toHaveBeenCalledWith("settings")
    // 菜单应关闭
    expect(menu()).toBeNull()
  })

  it("点「维护工具」→ 打开维护视图", () => {
    render()
    act(() => trigger().click())
    const entry = menu()!.querySelector<HTMLButtonElement>('[data-ui="sidebar-maintenance-entry"]')!
    act(() => entry.click())

    expect(mocks.setActiveView).toHaveBeenCalledWith("maintenance")
    expect(menu()).toBeNull()
  })

  it("未登录时头像位显示占位图标，菜单里提示点击登录", () => {
    mocks.accountUser = null
    render()
    act(() => trigger().click())
    expect(menu()!.textContent).toContain("点击登录账号")
  })
})

describe("账号菜单里的设置类入口", () => {
  it("点「设置」→ 打开设置视图（该功能曾丢失）", () => {
    render()
    act(() => trigger().click())
    const entry = menu()!.querySelector<HTMLButtonElement>('[data-ui="sidebar-settings-entry"]')!
    act(() => entry.click())
    expect(mocks.setActiveView).toHaveBeenCalledWith("settings")
    expect(menu()).toBeNull()
  })

  it("外观默认折叠，点开后列出三个主题并可切换", () => {
    render()
    act(() => trigger().click())
    const panel = menu()!
    const sub = panel.querySelector<HTMLElement>(".ui-avatar-appearance-sub")!
    // 默认折叠
    expect(sub.getAttribute("data-open")).toBe("false")

    const entry = panel.querySelector<HTMLButtonElement>('[data-ui="sidebar-appearance-entry"]')!
    act(() => entry.click())
    expect(panel.querySelector<HTMLElement>(".ui-avatar-appearance-sub")!.getAttribute("data-open")).toBe("true")

    const skins = panel.querySelectorAll('[role="menuitemradio"]')
    expect(skins.length).toBeGreaterThanOrEqual(3)
    act(() => (skins[0] as HTMLButtonElement).click())
    expect(mocks.selectSkin).toHaveBeenCalled()
  })

  it("底栏不再有独立齿轮：设置入口只在账号菜单里", () => {
    render()
    expect(host.querySelector('[data-ui="sidebar-settings-gear"]')).toBeNull()
    // 底栏里应该能看到用户名
    expect(host.textContent).toContain("青幕作者")
  })

  it("底栏入口同时显示用户名", () => {
    render()
    expect(host.textContent).toContain("青幕作者")
  })
})