import { describe, expect, it, vi } from "vitest"
import { checkPersonality, enforcePersonality } from "./personality-guard"
import { personality } from "@/test-helpers/portable-personality-fixture"
import { parsePortablePersonality } from "./portable-personality"

const bindings = [{ characterName: "陆衡", personality: parsePortablePersonality(personality) }]
const valid = JSON.stringify({ checks: [
  { characterName: "陆衡", ruleId: "R1", status: "pass", reason: "保留疑问" },
  { characterName: "陆衡", ruleId: "R2", status: "not_applicable", reason: "本场无亲人" },
  { characterName: "陆衡", ruleId: "boundary", status: "pass", reason: "未继承原型身份" },
] })

describe("人格执行完成门槛", () => {
  it("前检只判断性格冲突，不把职业不同当冲突；检查结果必须逐条完整", async () => {
    const call = vi.fn(async (_prompt: string) => valid)
    await expect(checkPersonality(bindings, "陆衡是账房，不是警察", "", call)).resolves.toEqual([])
    expect(call.mock.calls[0][0]).toContain("职业不同不是冲突")
    await expect(checkPersonality(bindings, "", "", async () => '{"checks":[]}')).rejects.toThrow("不完整")
  })
  it("人格矛盾提示用户选择，不擅自修改小传", async () => {
    const conflict = valid.replace('"status":"pass"', '"status":"conflict"')
    const issues = await checkPersonality(bindings, "小传禁止核验", "", async () => conflict)
    expect(issues[0]).toContain("陆衡")
    expect(issues[0]).toContain("R1")
  })
  it("不合格只返修一次，仍不合格抛错而不是返回最终正文", async () => {
    const fail = valid.replace('"status":"pass"', '"status":"fail"')
    const repair = vi.fn(async () => "返修草稿")
    await expect(enforcePersonality(bindings, "场景", "初稿", async () => fail, repair))
      .rejects.toThrow("未通过")
    expect(repair).toHaveBeenCalledTimes(1)
  })
  it("返修通过才返回成稿，空结果或检查异常不得放行", async () => {
    let n = 0
    const check = async () => n++ === 0 ? valid.replace('"status":"pass"', '"status":"fail"') : valid
    await expect(enforcePersonality(bindings, "", "初稿", check, async () => "修复完成")).resolves.toBe("修复完成")
    await expect(enforcePersonality(bindings, "", "初稿", async () => "[]", async () => ""))
      .rejects.toThrow()
  })
})
