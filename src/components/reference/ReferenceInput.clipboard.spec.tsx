// @vitest-environment jsdom
import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { ReferenceInput } from "./ReferenceInput"
let host: HTMLDivElement, root: Root
const token = { id:"one", category:"chapter" as const, title:"第一章", displayTitle:"第一章", path:"/one.md" }
const writeText=vi.fn(), readText=vi.fn(), onChange=vi.fn()
function Harness({ enabled=true, disabled=false, scope="a" }: { enabled?:boolean;disabled?:boolean;scope?:string }) {
 const [value,setValue]=useState("甲乙丙丁")
 return <ReferenceInput clipboardScope={scope} enableClipboardMenu={enabled} value={value} disabled={disabled} tokens={[token]} onSubmit={()=>{}} onChange={(text,tokens)=>{setValue(text);onChange(text,tokens)}}/>
}
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});host=document.createElement('div');document.body.append(host);root=createRoot(host);writeText.mockReset().mockResolvedValue(undefined);readText.mockReset().mockResolvedValue('粘贴');onChange.mockReset();Object.defineProperty(navigator,'clipboard',{value:{writeText,readText},configurable:true})})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks()})
async function open(start=1,end=3,enabled=true,disabled=false){await act(async()=>root.render(<Harness enabled={enabled} disabled={disabled}/>));const input=host.querySelector('textarea')!;input.focus();input.setSelectionRange(start,end);await act(async()=>input.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:300,clientY:300})));return input}
function item(label:string){return [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(n=>n.textContent===label)!}
async function click(label:string){expect(item(label)).toBeTruthy();await act(async()=>item(label).click())}
describe('对话输入框剪贴板菜单',()=>{
 it('只列出复制剪切粘贴，复制选中正文且引用保持不变',async()=>{const input=await open();expect([...document.querySelectorAll('[role="menuitem"]')].map(n=>n.textContent)).toEqual(['复制','剪切','粘贴']);await click('复制');expect(writeText).toHaveBeenCalledWith('乙丙');expect(input.value).toBe('甲乙丙丁');expect(onChange).not.toHaveBeenCalled();expect(host.textContent).toContain('第一章')})
 it('剪切成功后才移除选区并恢复光标',async()=>{const input=await open();await click('剪切');expect(input.value).toBe('甲丁');expect(input.selectionStart).toBe(1);expect(onChange).toHaveBeenCalledWith('甲丁',[token])})
 it('粘贴替换选区并将光标放在新文本后',async()=>{const input=await open();await click('粘贴');expect(input.value).toBe('甲粘贴丁');expect(input.selectionStart).toBe(3);expect(onChange).toHaveBeenCalledWith('甲粘贴丁',[token])})
 it('无选区禁用复制剪切但允许光标处粘贴',async()=>{const input=await open(2,2);expect(item('复制').disabled).toBe(true);expect(item('剪切').disabled).toBe(true);await click('粘贴');expect(input.value).toBe('甲乙粘贴丙丁')})
 it('剪切权限失败保留原文并提示中文',async()=>{writeText.mockRejectedValue(new Error('denied'));const input=await open();await click('剪切');expect(input.value).toBe('甲乙丙丁');expect(host.querySelector('[role="status"]')?.textContent).toContain('剪切失败')})
 it('粘贴权限失败不修改草稿',async()=>{readText.mockRejectedValue(new Error('denied'));const input=await open();await click('粘贴');expect(input.value).toBe('甲乙丙丁');expect(host.textContent).toContain('粘贴失败')})
 it('等待剪贴板时草稿已改变不得覆盖新输入',async()=>{let resolve!:(s:string)=>void;readText.mockReturnValue(new Promise<string>(r=>resolve=r));const input=await open();await click('粘贴');await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'新草稿');input.dispatchEvent(new Event('input',{bubbles:true}))});await act(async()=>resolve('旧粘贴'));expect(input.value).toBe('新草稿');expect(host.textContent).toContain('已变化')})
 it('禁用或未启用菜单的输入不增加菜单',async()=>{await open(1,3,false);expect(item('复制')).toBeUndefined();await act(async()=>root.unmount());root=createRoot(host);await open(1,3,true,true);expect(item('复制')).toBeUndefined()})
 it('等待粘贴时切换到同文案会话也不能误写',async()=>{let resolve!:(s:string)=>void;readText.mockReturnValue(new Promise<string>(r=>resolve=r));const input=await open();await click('粘贴');await act(async()=>root.render(<Harness scope="b"/>));await act(async()=>resolve('不应插入'));expect(input.value).toBe('甲乙丙丁')})
 it('键盘Shift+F10打开，箭头键可选择菜单',async()=>{await act(async()=>root.render(<Harness/>));const input=host.querySelector('textarea')!;input.focus();input.setSelectionRange(0,2);await act(async()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true})));expect(item('复制')).toBeTruthy();expect(document.activeElement).toBe(item('复制'));await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})));expect(document.activeElement).toBe(item('剪切'))})
 it('原生粘贴发出输入事件时仍通过原onChange更新',async()=>{const input=await open();Object.defineProperty(document,'execCommand',{configurable:true,value:vi.fn((_command, _show, value)=>{input.setRangeText(value,input.selectionStart,input.selectionEnd,'end');input.dispatchEvent(new Event('input',{bubbles:true}));return true})});await click('粘贴');expect(input.value).toBe('甲粘贴丁');expect(onChange).toHaveBeenCalledWith('甲粘贴丁',[token]);Reflect.deleteProperty(document,'execCommand')})
 it('Esc关闭菜单并归还输入焦点',async()=>{const input=await open();expect(item('复制')).toBeTruthy();await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));expect(item('复制')).toBeUndefined();expect(document.activeElement).toBe(input)})
})
