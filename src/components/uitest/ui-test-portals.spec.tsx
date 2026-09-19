// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
vi.mock("@/lib/ui-test",()=>({IS_UI_TEST_BUILD:true}))
let cleanup: (() => Promise<void>) | undefined
afterEach(async()=>{await cleanup?.()})
it("测试版Portal关闭按钮使用中文名称而不是英文Close",async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
 const host=document.createElement("div");document.body.append(host);const root=createRoot(host)
 cleanup=async()=>{await act(async()=>root.unmount());host.remove()}
 await act(async()=>root.render(<Dialog defaultOpen><DialogContent><DialogTitle>测试弹窗</DialogTitle><p>长内容</p></DialogContent></Dialog>))
 expect(document.querySelector('[data-slot="dialog-close"]')?.textContent).toContain("关闭")
})
