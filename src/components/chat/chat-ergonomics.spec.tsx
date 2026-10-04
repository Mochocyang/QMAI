// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { UserMessageMeta } from "./user-message-meta"
import { ScrollToLatestButton } from "./scroll-to-latest-button"
let host:HTMLDivElement,root:Root
const writeText=vi.fn()
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});host=document.createElement('div');document.body.append(host);root=createRoot(host);writeText.mockReset().mockResolvedValue(undefined);Object.defineProperty(navigator,'clipboard',{value:{writeText},configurable:true})})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers()})
describe('用户消息时间和复制',()=>{
 it('显示真实本地HH:mm而非当前时间，复制不带时间',async()=>{const time=new Date(2026,9,3,17,8).getTime();await act(async()=>root.render(<UserMessageMeta content="可见正文" timestamp={time}/>));expect(host.querySelector('time')?.textContent).toBe('17:08');await act(async()=>host.querySelector('button')!.click());expect(writeText).toHaveBeenCalledWith('可见正文');expect(host.querySelector('button')?.getAttribute('aria-label')).toBe('已复制')})
 it.each([undefined,NaN,Infinity,0])('旧时间缺失或无效不编造：%s',async timestamp=>{await act(async()=>root.render(<UserMessageMeta content="旧消息" timestamp={timestamp}/>));expect(host.querySelector('time')).toBeNull();expect(host.querySelector('[aria-label="复制消息"]')).not.toBeNull()})
 it('复制失败显示错误而不是成功',async()=>{writeText.mockRejectedValue(new Error('denied'));await act(async()=>root.render(<UserMessageMeta content="正文"/>));await act(async()=>host.querySelector('button')!.click());expect(host.querySelector('[role="status"]')?.textContent).toContain('复制失败');expect(host.querySelector('[aria-label="已复制"]')).toBeNull()})
})
describe('回到底部按钮',()=>{
 it('生成时三点提示，完成后箭头，点击执行跳转',async()=>{const click=vi.fn();await act(async()=>root.render(<ScrollToLatestButton isStreaming onClick={click}/>));expect(host.querySelectorAll('[data-stream-dot]')).toHaveLength(3);expect(host.querySelector('button')?.title).toBe('下滑');await act(async()=>host.querySelector('button')!.click());expect(click).toHaveBeenCalledTimes(1);await act(async()=>root.render(<ScrollToLatestButton isStreaming={false} onClick={click}/>));expect(host.querySelectorAll('[data-stream-dot]')).toHaveLength(0);expect(host.querySelector('[aria-label="下滑"]')).not.toBeNull()})
})
