// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { useWikiStore } from "@/stores/wiki-store"
import { useOutlineGenerationStore } from "@/stores/outline-generation-store"
import { restoreUiTestWorkspace } from "./ui-test-workspace-preferences"
vi.mock("@/commands/fs",()=>({ fileExists:vi.fn().mockResolvedValue(true) }))
describe("仅测试版恢复本书工作区",()=>{
 it("恢复最后大纲及AI偏好，保持其他书与正式模型配置不变",async()=>{
  const project={id:"a",name:"测试小说",path:"D:/QM-BOOK-UI-TEST/a"}
  useWikiStore.setState({project,activeView:"wiki",selectedFile:null,chatExpanded:true})
  await restoreUiTestWorkspace(project,{version:1,lastView:"sources",files:{sources:"wiki/outlines/故事.md"},assistant:{sources:false}})
  expect(useWikiStore.getState().activeView).toBe("sources")
  expect(useWikiStore.getState().selectedFile).toBe(project.path+"/wiki/outlines/故事.md")
  expect(useOutlineGenerationStore.getState().panelOpen).toBe(false)
 })
 it("异步恢复到达时已切换小说则不写入新书",async()=>{
  const old={id:"a",name:"旧书",path:"/a"},next={id:"b",name:"新书",path:"/b"}
  useWikiStore.setState({project:next,activeView:"soul",selectedFile:null})
  await restoreUiTestWorkspace(old,{version:1,lastView:"sources",files:{sources:"wiki/outlines/旧书.md"}})
  expect(useWikiStore.getState().activeView).toBe("soul")
  expect(useWikiStore.getState().selectedFile).toBeNull()
 })
})
