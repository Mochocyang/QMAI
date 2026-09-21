import { describe, expect, it } from "vitest"
import { resolveDraftDefaultModel } from "./default-data"
import { useWikiStore } from "@/stores/wiki-store"
const base=useWikiStore.getState().llmConfig
const configs={"custom-a":{enabled:true,apiKey:"test-only",baseUrl:"https://example.test/v1",model:"main"},"custom-b":{enabled:true,apiKey:"test-only",baseUrl:"https://example.test/v1",model:"review"}}
describe("默认模型草稿解析",()=>{
 it("四环节草稿覆盖优先于通用，跟随不改聊天模型",()=>{const result=resolveDraftDefaultModel("custom-b/review","custom-a/main","custom-a/main",base,configs);expect(result.key).toBe("custom-b/review");expect(result.config?.model).toBe("review")})
 it("未单独指定时跟随通用，再跟随聊天",()=>{expect(resolveDraftDefaultModel("","custom-b/review","custom-a/main",base,configs).key).toBe("custom-b/review");expect(resolveDraftDefaultModel("","","custom-a/main",base,configs).key).toBe("custom-a/main")})
 it("不可用显式选择仍明确回退，不测试不存在模型",()=>{const result=resolveDraftDefaultModel("deleted/model","custom-a/main","custom-b/review",base,configs);expect(result.key).toBe("custom-a/main");expect(result.fallback).toBe(true)})
})
