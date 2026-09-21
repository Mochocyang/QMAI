import { describe, expect, it } from "vitest"
import { safeModelError, validateModelEndpoint } from "./model-feedback"
describe("模型配置错误反馈",()=>{
 it("不回显服务端错误中的密钥、编码密钥与Authorization",()=>{
  const key="secret-value+/token"
  const text=safeModelError(new Error(`失败 ${key} ${encodeURIComponent(key)} Authorization: Bearer other-token`),[key])
  expect(text).not.toContain(key);expect(text).not.toContain(encodeURIComponent(key));expect(text).not.toContain("other-token");expect(text).toContain("失败")
 })
 it("隐藏URL中的认证查询及账号密码，保留可读状态",()=>{
  const text=safeModelError(new Error("401 at https://user:pass@api.example.test/v1?api_key=badsecret&token=othertoken"))
  expect(text).not.toContain("badsecret");expect(text).not.toContain("othertoken");expect(text).not.toContain("user:pass");expect(text).toContain("401")
 })
 it.each(["", "api.example.test/v1", "file:///local", "https://user:secret@api.example.test/v1"])('拒绝无效地址 %s',value=>{expect(validateModelEndpoint(value)).not.toBeNull()})
 it.each(["https://api.example.test/v1", "http://localhost:11434/v1"])("允许远端HTTPS及本地HTTP：%s",value=>expect(validateModelEndpoint(value)).toBeNull())
})
