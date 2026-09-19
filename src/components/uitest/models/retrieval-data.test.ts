import { expect, it } from "vitest"
import { validateEmbeddingDraft, validateRerankDraft } from "./retrieval-data"
import { DEFAULT_RERANK_CONFIG } from "@/stores/wiki-store"
it("向量块长和重叠必须合法，不能被静默改写",()=>{expect(validateEmbeddingDraft({enabled:true,endpoint:"http://localhost/v1",apiKey:"",model:"embed",maxChunkChars:500,overlapChunkChars:500})).toContain("重叠");expect(validateEmbeddingDraft({enabled:true,endpoint:"http://localhost/v1",apiKey:"",model:"embed",maxChunkChars:500,overlapChunkChars:0})).toBeNull()})
it("停用向量保留空配置，不需要密钥",()=>{expect(validateEmbeddingDraft({enabled:false,endpoint:"",apiKey:"",model:""})).toBeNull()})
it("重排TOPN遵守现有3到30上限，单独URL非法不能保存",()=>{expect(validateRerankDraft({...DEFAULT_RERANK_CONFIG,enabled:true,maxCandidates:99},"main")).toContain("3–30");expect(validateRerankDraft({...DEFAULT_RERANK_CONFIG,enabled:true,useMainLlm:false,customEndpoint:"invalid",model:"rerank"},"main")).toContain("地址")})
