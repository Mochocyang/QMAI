// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { ReferencePickerDialog } from "@/components/reference/ReferencePickerDialog"
vi.mock("@/lib/ui-test",()=>({IS_UI_TEST_BUILD:true}))
it("引用按图使用横向分类、已选chips，Esc关闭且回焦",async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
 const host=document.createElement("div");document.body.append(host);const root=createRoot(host);const trigger=document.createElement("button");document.body.append(trigger);trigger.focus();const close=vi.fn()
 await act(async()=>root.render(<ReferencePickerDialog open providers={[{category:"chapter",fetchItems:async()=>[{id:"a",category:"chapter",title:"雨停之前",displayTitle:"雨停之前"}]}]} projectPath="/ui-test" onConfirm={()=>{}} onClose={close}/>))
 expect(host.querySelector('[data-ui-reference="tabs"]')).not.toBeNull()
 const checkbox=host.querySelector<HTMLInputElement>('input[type="checkbox"]')!
 await act(async()=>checkbox.click())
 expect(host.querySelector('[data-ui-reference="selected"]')?.textContent).toContain("雨停之前")
 expect(host.textContent).toContain("确认引用 1 项")
 await act(async()=>document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})))
 expect(close).toHaveBeenCalledTimes(1)
 await act(async()=>root.unmount());expect(document.activeElement).toBe(trigger);host.remove();trigger.remove()
})
