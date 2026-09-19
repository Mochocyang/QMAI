// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { confirmModelDraftLeave, useModelDraftGuard } from "./model-draft-guard"
const cleanup: Array<()=>Promise<void>>=[]
afterEach(async()=>{for(const fn of cleanup.splice(0))await fn();vi.restoreAllMocks()})
async function mount(dirty:boolean,saving=false){Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const host=document.createElement("div");document.body.append(host);const root=createRoot(host);function Draft(){useModelDraftGuard("unit-provider","模型配置",dirty,saving);return null}await act(async()=>root.render(<Draft/>));cleanup.push(async()=>{await act(async()=>root.unmount());host.remove()})}
it("干净配置不弹确认，脏配置取消离开后保留",async()=>{const confirm=vi.spyOn(window,"confirm").mockReturnValue(false);await mount(true);expect(await confirmModelDraftLeave()).toBe(false);expect(confirm).toHaveBeenCalledTimes(1);expect(confirm.mock.calls[0][0]).toContain("未保存")})
it("保存中不能离开，避免重复请求",async()=>{const alert=vi.spyOn(window,"alert").mockImplementation(()=>{});await mount(true,true);expect(await confirmModelDraftLeave()).toBe(false);expect(alert).toHaveBeenCalledWith(expect.stringContaining("保存"))})
it("组件卸载即清理登记，不保留过期拦截",async()=>{await mount(true);await cleanup.pop()!();const confirm=vi.spyOn(window,"confirm");expect(await confirmModelDraftLeave()).toBe(true);expect(confirm).not.toHaveBeenCalled()})
