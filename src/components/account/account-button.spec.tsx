// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { resetAccountStoreForTests, useAccountStore } from "@/stores/account-store"
import { AccountButton } from "./account-button"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

function render() {
  act(() => {
    root.render(<AccountButton />)
  })
}

function accountButton(): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>('button[aria-label="账号"]')
  expect(button).not.toBeNull()
  return button!
}

beforeEach(() => {
  resetAccountStoreForTests()
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  resetAccountStoreForTests()
})

describe("AccountButton", () => {
  it("匿名时显示账号入口，点击后打开登录弹窗", async () => {
    useAccountStore.setState({ status: "anonymous", user: null, dialogOpen: false })
    render()

    const button = accountButton()
    expect(button.querySelector(".account-avatar")).toBeNull()
    expect(button.querySelector("svg")).not.toBeNull()
    expect(button.title).toBe("登录 / 注册")

    await act(async () => button.click())
    expect(useAccountStore.getState().dialogOpen).toBe(true)
  })

  it("已登录时显示显示名首字母，title 包含邮箱", () => {
    useAccountStore.setState({
      status: "authenticated",
      user: {
        id: 7,
        email: "author@example.com",
        displayName: "青禾",
        createdAt: 1_793_000_000,
      },
    })
    render()

    const button = accountButton()
    expect(button.querySelector(".account-avatar")?.textContent).toBe("青")
    expect(button.title).toBe("青禾 · author@example.com")
    expect(button.title).toContain("author@example.com")
  })
})
