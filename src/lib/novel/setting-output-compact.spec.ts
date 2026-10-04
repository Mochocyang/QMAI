import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { buildSettingProfileOutputRules, SETTING_PROFILE_SECTIONS, type SettingProfileKey } from "./setting-profile-contracts"
import { parseOutlineSaveRequests } from "./outline-save-request"
const fence=(value:unknown)=>'```json\n'+JSON.stringify(value)+'\n```'
const request=(name:string,content='')=>({targetFolder:'金手指设定',fileName:name+'.md',fileType:'setting',writeMode:'create',referencedSkills:[],sourceIntent:'金手指设定',content})

describe("完整设定不必在保存协议里重复第三遍正文",()=>{
 for(const key of Object.keys(SETTING_PROFILE_SECTIONS) as SettingProfileKey[]){
  it(`${key} 保留完整分区，限制单轮对象数并使用空content回填`,()=>{
   const prompt=buildSettingProfileOutputRules(key)
   expect(prompt).toContain('每轮最多生成一个完整对象')
   expect(prompt).toContain('content=""')
   expect(prompt).toContain('不要在保存请求中重复抄写')
   expect(prompt).not.toContain('content保留完整MD正文')
   for(const section of SETTING_PROFILE_SECTIONS[key]){expect(prompt).toContain(section.heading);expect(prompt).toContain(section.hint)}
  })
 }
 it("完整MD + 完整能力JSON + 空content仍得到原正文和第二版HTML",()=>{
  const md='# 金手指设定：回响\n\n## 能力概述\n- 触发：接触旧物。\n\n## 边界与代价\n- 限制：读取后失去听觉九十息。'
  const profile={goldenFingerProfileData:{name:'回响',tag:'能力',sections:[{kind:'kv',heading:'能力概述',items:[{label:'触发',text:'接触旧物。'}]},{kind:'kv',heading:'边界与代价',items:[{label:'限制',text:'读取后失去听觉九十息。'}]}]}}
  const parsed=parseOutlineSaveRequests(md+'\n\n'+fence(profile)+'\n\n'+fence({outlineSaveRequest:request('金手指-回响')}))
  expect(parsed.errors).toEqual([]);expect(parsed.requests).toHaveLength(1);expect(parsed.requests[0].content).toBe(md)
  expect(parsed.requests[0].htmlContent).toContain('data-qmai-layout="editorial-v2"');expect(parsed.requests[0].htmlContent).toContain('九十息')
 })
 it("只收到半截协议时不能误创建保存请求",()=>{
  expect(parseOutlineSaveRequests('# 金手指\n已收到的内容\n```json\n{"outlineSaveRequest":{"content":"').requests).toEqual([])
 })
 it("旧协议明确content仍优先，不被正文回填覆盖",()=>{
  const md='# 金手指设定：甲\n正文A',explicit='# 金手指设定：乙\n必须保留的明确正文'
  const result=parseOutlineSaveRequests(md+'\n'+fence({outlineSaveRequest:request('金手指-乙',explicit)}))
  expect(result.requests[0].content).toBe(explicit)
 })
 it("旧多对象空content仍按一级标题拆分，不能全部复制成同一对象",()=>{
  const body='# 金手指设定：甲\n\n## 能力\n甲的条件\n\n# 金手指设定：乙\n\n## 能力\n乙的条件'
  const result=parseOutlineSaveRequests(body+'\n'+fence({outlineSaveRequests:[request('金手指-甲'),request('金手指-乙')]}))
  expect(result.requests).toHaveLength(2);expect(result.requests[0].content).toContain('甲的条件');expect(result.requests[0].content).not.toContain('乙的条件');expect(result.requests[1].content).toContain('乙的条件')
 })
 it("八类入口不再要求同一轮生成两个完整对象",()=>{
  const source=readFileSync('src/components/sources/outline-chat-panel.tsx','utf8')
  expect(source).not.toContain('本次回复最多完整生成 2 个对象')
  expect(source).toContain('本次回复最多完整生成 1 个对象')
 })
})

it("正文回填不会污染为能力JSON或保存协议", () => {
 const md='# 金手指设定：留痕\n\n## 获取与绑定\n- 获取：触碰有来历的旧航具。'
 const parsed=parseOutlineSaveRequests(md+'\n'+fence({goldenFingerProfileData:{name:'留痕',sections:[{kind:'kv',heading:'获取与绑定',items:[{label:'获取',text:'触碰有来历的旧航具。'}]}]}})+'\n'+fence({outlineSaveRequest:request('金手指-留痕')}))
 expect(parsed.requests[0].content).toBe(md)
 expect(parsed.requests[0].content).not.toContain('goldenFingerProfileData')
 expect(parsed.requests[0].content).not.toContain('outlineSaveRequest')
})

it("技能和总协议允许省略重复正文，但保留全部详细字段",()=>{
 for(const path of ['AI_OUTLINE_OUTPUT_PROTOCOL.md','JueseSkill/CHARACTER_PROFILE_STANDARD.md','SheDingSkill/SETTING_PROFILE_STANDARD.md','JueseSkill/character-design/SKILL.md','SheDingSkill/faction-system/SKILL.md','SheDingSkill/power-system/SKILL.md','SheDingSkill/world-rules/SKILL.md','SheDingSkill/map-progression/SKILL.md','SheDingSkill/foreshadowing-suspense/SKILL.md']){
  const s=readFileSync('skills/SkillHub/'+path,'utf8');expect(s).toContain('content=""');expect(s).toContain('每轮最多生成一个完整对象');expect(s).toContain('保留全部分区')
 }
 expect(readFileSync('skills/SkillHub/AI_OUTLINE_OUTPUT_PROTOCOL.md','utf8')).not.toContain('代码块（必须含完整 `content`）')
})
