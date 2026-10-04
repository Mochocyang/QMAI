import { beforeEach, describe, expect, it, vi } from "vitest"
import { AgentRunner } from "./runner"
import { ToolRegistry } from "./registry"
import type { AgentConfig, AgentRunCallbacks, Tool } from "./types"
import type { StreamCallbacks } from "../llm-client"

const stream = vi.hoisted(() => vi.fn())
vi.mock("../llm-client", () => ({ streamChat: (...args: unknown[]) => stream(...args), isOutputTruncatedError: (e: unknown) => e instanceof Error && e.message.includes("输出被截断") }))
const config = (): AgentConfig => ({systemPrompt:"设定生成",maxRounds:3,tools:[],llmConfig:{provider:"openai",model:"test",apiKey:"",ollamaUrl:"",customEndpoint:"",maxContextSize:8192}})
const callbacks = () => ({onText:vi.fn(),onDone:vi.fn(),onError:vi.fn(),onToolCall:vi.fn(),onToolResult:vi.fn(),onToolError:vi.fn(),onReasoningToken:vi.fn()})
const run = (cb: AgentRunCallbacks, cfg = config(), signal?: AbortSignal, registry=new ToolRegistry()) => new AgentRunner().run(cfg,registry,[{role:"system",content:"生成完整设定"},{role:"user",content:"金手指设定"}],cb,signal)
beforeEach(()=>{ stream.mockReset() })

describe("流式中断不得丢弃已经接收的正文",()=>{
 for(const kind of ["callback","throw"] as const){
  it(`${kind} 读取失败：先交付未完成正文，再报告原始错误，绝不报成功`,async()=>{
   const error=new Error("error decoding response body"),order:string[]=[]
   stream.mockImplementation(async(_c:unknown,_m:unknown,cb:StreamCallbacks)=>{cb.onToken("# 回响能力\n");cb.onToken("## 获取条件\n需要接触旧物");cb.onUsage?.({inputTokens:100,outputTokens:20,totalTokens:120});if(kind==='throw')throw error;cb.onError(error)})
   const cb=callbacks();cb.onText.mockImplementation(()=>order.push('text'));cb.onError.mockImplementation(()=>order.push('error'))
   const result=await run(cb)
   expect(result.finalText).toBe("# 回响能力\n## 获取条件\n需要接触旧物")
   expect(cb.onText).toHaveBeenCalledExactlyOnceWith(result.finalText)
   expect(cb.onError).toHaveBeenCalledExactlyOnceWith(error)
   expect(cb.onDone).not.toHaveBeenCalled()
   expect(order).toEqual(['text','error'])
   expect(stream).toHaveBeenCalledTimes(1)
   expect(result.usage?.outputTokens).toBe(20)
  })
 }
 it("取消即使被底层当成onDone，也保留正文并通知取消，不执行成功收尾",async()=>{
  const controller=new AbortController();stream.mockImplementation(async(_c:unknown,_m:unknown,cb:StreamCallbacks)=>{cb.onToken('已收到的第一节');controller.abort();cb.onDone()})
  const cb=callbacks();const result=await run(cb,config(),controller.signal)
  expect(result.finalText).toBe('已收到的第一节');expect(cb.onText).toHaveBeenCalledExactlyOnceWith('已收到的第一节');expect(cb.onError).toHaveBeenCalledWith(expect.objectContaining({message:'操作已取消'}));expect(cb.onDone).not.toHaveBeenCalled()
 })
 it("没有正文时仍失败，不用推理内容冒充生成结果",async()=>{
  stream.mockImplementation(async(_c:unknown,_m:unknown,cb:StreamCallbacks)=>{cb.onReasoningToken?.('正在分析能力体系');cb.onError(new Error('connection reset'))})
  const cb=callbacks();const result=await run(cb)
  expect(result.finalText).toBe('');expect(cb.onText).not.toHaveBeenCalled();expect(cb.onReasoningToken).toHaveBeenCalledWith('正在分析能力体系');expect(cb.onError).toHaveBeenCalledTimes(1);expect(cb.onDone).not.toHaveBeenCalled()
 })
 it("半截工具调用不执行，其解释文字不伪装成大纲正文",async()=>{
  const execute=vi.fn(),tool:Tool={name:'write_outline',description:'写入',category:'write',parameters:{},execute};const registry=new ToolRegistry();registry.register(tool)
  stream.mockImplementation(async(_c:unknown,_m:unknown,cb:StreamCallbacks)=>{cb.onToken('我将先保存草稿');cb.onToolCallDelta?.({index:0,id:'x',name:'write_outline',arguments:'{"content":"未完'});cb.onError(new Error('error decoding response body'))})
  const cb=callbacks();const result=await run(cb,{...config(),tools:[tool]},undefined,registry)
  expect(result.finalText).toBe('');expect(cb.onText).not.toHaveBeenCalled();expect(execute).not.toHaveBeenCalled();expect(cb.onError).toHaveBeenCalledTimes(1);expect(cb.onDone).not.toHaveBeenCalled()
 })
 it("必需工具未完成时，中断正文可以查看，但不能当作工具工作流成功",async()=>{
  const tool:Tool={name:'run_chapter_workflow',description:'工作流',category:'action',parameters:{},execute:vi.fn()};const registry=new ToolRegistry();registry.register(tool)
  stream.mockImplementation(async(_c:unknown,_m:unknown,cb:StreamCallbacks)=>{cb.onToken('这是未完成片段');cb.onError(new Error('网络连接中断'))})
  const cb=callbacks();await run(cb,{...config(),tools:[tool],requiredToolsOnce:[tool.name]},undefined,registry)
  expect(cb.onText).toHaveBeenCalledWith('这是未完成片段');expect(cb.onDone).not.toHaveBeenCalled();expect(tool.execute).not.toHaveBeenCalled();expect(cb.onError).toHaveBeenCalledTimes(1)
 })
 it("工具不支持回退后发生断流，应保留真实错误与本轮正文，不误报工具不支持",async()=>{
  const tool:Tool={name:'read_outline',description:'读取',category:'read',parameters:{},execute:vi.fn()}
  const error=new Error('error decoding response body');stream.mockImplementationOnce(async(_c:unknown,_m:unknown,cb:StreamCallbacks)=>cb.onError(new Error('tools are not supported'))).mockImplementationOnce(async(_c:unknown,_m:unknown,cb:StreamCallbacks)=>{cb.onToken('无工具模式的正文');cb.onError(error)})
  const cb=callbacks();const result=await run(cb,{...config(),tools:[tool]})
  expect(stream).toHaveBeenCalledTimes(2);expect(result.finalText).toBe('无工具模式的正文');expect(cb.onError).toHaveBeenCalledWith(error);expect(cb.onDone).not.toHaveBeenCalled()
 })
 it("已有输出超限仍保留一次片段，不重复发出正文",async()=>{
  stream.mockImplementation(async(_c:unknown,_m:unknown,cb:StreamCallbacks)=>{cb.onToken('长度截断片段');cb.onError(new Error('输出被截断'))})
  const cb=callbacks();await run(cb);expect(cb.onText).toHaveBeenCalledExactlyOnceWith('长度截断片段');expect(cb.onError).toHaveBeenCalledTimes(1);expect(cb.onDone).not.toHaveBeenCalled()
 })
 it("正常完成继续只交付一次最终正文",async()=>{
  stream.mockImplementation(async(_c:unknown,_m:unknown,cb:StreamCallbacks)=>{cb.onToken('完整');cb.onToken('正文');cb.onDone()})
  const cb=callbacks();const result=await run(cb);expect(result.finalText).toBe('完整正文');expect(cb.onText).toHaveBeenCalledExactlyOnceWith('完整正文');expect(cb.onDone).toHaveBeenCalledTimes(1);expect(cb.onError).not.toHaveBeenCalled()
 })
})

it("读取工具已经完成、最终生成断流时，只保留生成轮正文且不重复执行工具",async()=>{
 const execute=vi.fn().mockResolvedValue('已读取技能'),tool:Tool={name:'read_skill',description:'读取',category:'read',parameters:{},execute};const registry=new ToolRegistry();registry.register(tool)
 stream.mockImplementationOnce(async(_c:unknown,_m:unknown,cb:StreamCallbacks)=>{cb.onToken('正在读取资料');cb.onToolCallDelta?.({index:0,id:'read1',name:'read_skill',arguments:'{}'});cb.onDone()}).mockImplementationOnce(async(_c:unknown,_m:unknown,cb:StreamCallbacks)=>{cb.onToken('# 金手指\n');cb.onToken('第一部分已写出');cb.onError(new Error('error decoding response body'))})
 const cb=callbacks();const result=await run(cb,{...config(),tools:[tool]},undefined,registry)
 expect(execute).toHaveBeenCalledTimes(1);expect(stream).toHaveBeenCalledTimes(2)
 expect(result.toolCalls[0].status).toBe('done');expect(result.finalText).toBe('# 金手指\n第一部分已写出')
 expect(cb.onText).toHaveBeenCalledExactlyOnceWith(result.finalText);expect(cb.onText).not.toHaveBeenCalledWith('正在读取资料');expect(cb.onDone).not.toHaveBeenCalled()
})

it("思考重试后的正文断流也进入统一失败路径，不丢重试已接收文本",async()=>{
 stream.mockImplementationOnce(async(_c:unknown,_m:unknown,cb:StreamCallbacks)=>cb.onError(new Error('模型只输出了思考内容，没有输出正文'))).mockImplementationOnce(async(_c:unknown,_m:unknown,cb:StreamCallbacks)=>{cb.onToken('重试后的部分正文');throw new Error('connection reset')})
 const cb=callbacks();const result=await run(cb)
 expect(stream).toHaveBeenCalledTimes(2);expect(result.finalText).toBe('重试后的部分正文');expect(cb.onText).toHaveBeenCalledExactlyOnceWith(result.finalText);expect(cb.onError).toHaveBeenCalledWith(expect.objectContaining({message:'connection reset'}));expect(cb.onDone).not.toHaveBeenCalled()
})

it("取消后即使返回工具不支持错误，也不能再发起回退请求",async()=>{
 const controller=new AbortController(),tool:Tool={name:'read_skill',description:'读取',category:'read',parameters:{},execute:vi.fn()}
 stream.mockImplementation(async(_c:unknown,_m:unknown,cb:StreamCallbacks)=>{controller.abort();cb.onError(new Error('tools are not supported'))})
 const cb=callbacks();await run(cb,{...config(),tools:[tool]},controller.signal)
 expect(stream).toHaveBeenCalledTimes(1);expect(cb.onError).toHaveBeenCalledWith(expect.objectContaining({message:'操作已取消'}));expect(cb.onDone).not.toHaveBeenCalled()
})
