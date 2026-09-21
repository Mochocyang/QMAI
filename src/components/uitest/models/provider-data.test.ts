import { describe, expect, it } from "vitest"
import { mergeProviderModels, removeProviderModel, validateProviderDraft } from "./provider-data"
describe("提供方模型草稿",()=>{
 it("手输和全选合并去重，保留既有名称/备注/扩展字段",()=>{
  const old={model:"old",savedModels:[{id:"keep",model:"old",name:"自定义显示名",notes:"保留备注",createdAt:1}]}
  const result=mergeProviderModels(old,["old","new","new"," new "])
  expect(result.savedModels).toHaveLength(2);expect(result.savedModels?.[0]).toEqual(old.savedModels[0]);expect(result.model).toBe("old")
 })
 it("移除最后一个已选模型不回退到已删除ID",()=>{
  expect(removeProviderModel({model:"old",savedModels:[{id:"keep",model:"old",name:"old",createdAt:1}]},"old")).toMatchObject({model:"",savedModels:[]})
 })
 it("无效URL和过小窗口不能被静默归一化后保存",()=>{
  expect(validateProviderDraft({label:"test",baseUrl:"abc",model:"a",maxContextSize:204800,maxOutputTokens:16384})).toContain("地址")
  expect(validateProviderDraft({label:"test",baseUrl:"https://example.test/v1",model:"a",maxContextSize:1000,maxOutputTokens:2000})).toContain("204,800")
 })
 it("合法本地无key配置可保存",()=>{
  expect(validateProviderDraft({label:"test",baseUrl:"http://localhost:11434/v1",model:"a",maxContextSize:204800,maxOutputTokens:16384})).toBeNull()
 })
})

it("停用不完整旧配置无需先补齐接口，已停用草稿可以保存", () => {
 expect(validateProviderDraft({ enabled: false, baseUrl: "", model: "" })).toBeNull()
})
