// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { OutlineWizardDialog } from "@/components/sources/outline-wizard-dialog"
vi.mock("@/lib/ui-test",()=>({IS_UI_TEST_BUILD:true}))
it("测试版生成向导按图提供紧凑选择字段并保持原校验",async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const host=document.createElement("div");document.body.append(host);const root=createRoot(host);const submit=vi.fn()
 await act(async()=>root.render(<OutlineWizardDialog open onOpenChange={()=>{}} onSubmit={submit}/>))
 expect(document.body.textContent).toContain("生成小说大纲")
 expect(document.querySelector('select[aria-label="生成任务"]')).not.toBeNull()
 expect(document.querySelector('select[aria-label="篇幅类型"]')).not.toBeNull()
 const button=[...document.querySelectorAll("button")].find(b=>b.textContent==="提交需求")!
 await act(async()=>button.click())
 expect(submit).not.toHaveBeenCalled()
 await act(async()=>root.unmount());host.remove()
})
