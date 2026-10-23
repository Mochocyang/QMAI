import "./instrument"

import React from "react"
import ReactDOM from "react-dom/client"
import * as Sentry from "@sentry/react"
import { invoke } from "@tauri-apps/api/core"
import App from "./App"
import { ReaderWindow } from "./components/reader/reader-window"
import { resolveReaderWindowPayload } from "./lib/reader-window"
import { applyReaderWindowAppearance, resolveReaderWindowAppearance } from "./lib/reader-window-appearance"
import { isTauri } from "./lib/platform"
import "./index.css"
import "@/i18n"
import { ToastProvider } from "@/lib/toast"

/**
 * 「在独立窗口中打开」的窗口也加载同一个 index.html，靠建窗时注入的
 * 全局参数分流（浏览器验收时退回查询串）。
 *
 * 必须在这里分流、而不是在 App 里：App 的启动流程会拉最近项目、
 * 打开书架并初始化整条主界面状态 —— 一个文档窗口不该跑那一套。
 */
const readerPayload = resolveReaderWindowPayload(window.location.search)

/*
 * 外观与正文排版必须在**首帧之前**落地。
 *
 * 原因不是"快一点"：子组件（OutlineDualPreview 的 iframe 皮肤）在 useState
 * 初值里就读 `document.documentElement`，等 React 渲染完再写属性会让它们先
 * 拿到默认皮肤，再被 MutationObserver 纠一次 —— 用户看到的是"打开先白一下"。
 */
if (readerPayload) {
  applyReaderWindowAppearance(
    resolveReaderWindowAppearance(readerPayload.appearance, readerPayload.theme),
  )
}

if (readerPayload && isTauri()) {
  // 🔴 第一件事就是报到：Rust 侧拿它当"这一版 profile 是好的"的唯一判据。
  // 坏缓存的表现是模块脚本压根不执行，那种情况这里永远不会发出去，
  // 于是下次开窗会先清缓存自愈。
  void invoke("reader_window_ready").catch(() => undefined)
  // 留一行日志：Rust 侧的日志只能证明窗口建出来了，证明不了页面跑起来了。
  // 这两件事在"闪一下就没了"的场景里必须分开看。
  void invoke("reader_window_log", {
    message: `booted kind=${readerPayload.kind} path=${readerPayload.path}`,
  }).catch(() => undefined)
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement, {
  onUncaughtError: Sentry.reactErrorHandler(),
  onCaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
}).render(
  <React.StrictMode>
    <ToastProvider>
      {readerPayload ? <ReaderWindow payload={readerPayload} /> : <App />}
    </ToastProvider>
  </React.StrictMode>,
)
