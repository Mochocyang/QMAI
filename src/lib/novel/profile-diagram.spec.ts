import { describe, expect, it } from "vitest"
import { normalizeProfileDocument, renderProfileDocumentHtml } from "./profile-document"
import { readFileSync } from "node:fs"
import { JSDOM } from "jsdom"
const template=readFileSync("skills/SkillHub/SheDingSkill/map-progression/profile.html","utf8")
const render=(diagram: unknown)=>renderProfileDocumentHtml(normalizeProfileDocument({name:"图形测试",diagram,sections:[{kind:"kv",heading:"地理概览",items:[{label:"规则",text:"地图不能代替具体行程"}]}]})!,template,"地理设定")
const valid=()=>({kind:"map",title:"关系图",note:"示意，非测绘",nodes:[{id:"a",label:"甲区",x:0,y:0,description:"边界位置"},{id:"b",label:"乙区",x:100,y:100,description:"右下边界"}],regions:[],routes:[{from:"a",to:"b",label:"大道",mode:"land",detail:"两日"}]})
describe("动态地理图的安全与数据边界",()=>{
 it("0和100坐标保持有效，区域与路线有实际数据才生成",()=>{
  const html=render(valid()),dom=new JSDOM(html).window.document
  expect(dom.querySelectorAll('.diagram-node')).toHaveLength(2)
  expect(dom.querySelectorAll('.diagram-route')).toHaveLength(1)
  expect(dom.querySelectorAll('.diagram-region')).toHaveLength(0)
 })
 it("拒绝非数字与越界坐标、重复ID，路线不能引用不存在的点",()=>{
  const raw=valid();raw.nodes.push({id:"c",label:"坏点",x:NaN,y:5,description:""},{id:"d",label:"越界",x:101,y:50,description:""},{id:"a",label:"重复",x:10,y:20,description:""})
  raw.routes.push({from:"a",to:"missing",label:"不存在的道路",mode:"land",detail:""})
  const html=render(raw),dom=new JSDOM(html).window.document
  expect(dom.querySelectorAll('.diagram-node')).toHaveLength(2)
  expect(dom.querySelectorAll('.diagram-route')).toHaveLength(1)
  expect(dom.querySelector('.diagram-warning')?.textContent).toContain("未绘制")
 })
 it("文字中的HTML和SVG均转义，未知图形属性不写进DOM",()=>{
  const raw=valid();raw.title='<script>alert(1)</script>';raw.nodes[0].label='<img src=x onerror=evil>';raw.routes[0].detail='"><svg onload=evil>'
  const html=render({...raw,svg:'<script>evil</script>',onload:'evil'}),dom=new JSDOM(html).window.document
  expect(dom.querySelector('script,img,[onload],[onerror]')).toBeNull()
  expect(dom.querySelector('.profile-diagram')?.textContent).toContain('<script>alert(1)</script>')
  expect(dom.querySelector('.profile-diagram')?.textContent).toContain('<img src=x onerror=evil>')
 })
 it("坏图形不影响正文，未知类型不被当成地图",()=>{
  expect(render({...valid(),kind:'html'})).not.toContain('data-profile-diagram=')
  expect(render({kind:'map',nodes:[]})).toContain('地图不能代替具体行程')
 })
 it("房间越界不能裁剪伪装为正确布局",()=>{
  const raw={...valid(),kind:'floorplan',nodes:[{id:'a',label:'资料间',x:10,y:10,width:30,height:20},{id:'b',label:'越界间',x:90,y:80,width:20,height:30}],routes:[]}
  const dom=new JSDOM(render(raw)).window.document
  expect(dom.querySelectorAll('.diagram-room')).toHaveLength(1)
  expect(dom.querySelector('.diagram-warning')).not.toBeNull()
 })
})

describe("第二版图形附加边界", () => {
  it("平面房间相交时保留第一间并明确未绘制项，接边不算重叠", () => {
    const raw = {kind:"floorplan",nodes:[
      {id:"a",label:"原件库",x:10,y:10,width:30,height:30},
      {id:"b",label:"重叠库",x:20,y:20,width:20,height:20},
      {id:"c",label:"接边门廊",x:40,y:10,width:20,height:30},
    ],regions:[],routes:[]}
    const dom=new JSDOM(render(raw)).window.document
    expect(dom.querySelectorAll('.diagram-room')).toHaveLength(2)
    expect(dom.querySelector('.diagram-warning')?.textContent).toContain("未绘制")
    expect(dom.querySelector('.diagram-legend')?.textContent).toContain("接边门廊")
  })
  it("全退化的区域轮廓不能当成有效地图", () => {
    const html=render({kind:"map",nodes:[],regions:[{id:"r",label:"坏区域",points:[[10,10],[10,10],[10,10]]}],routes:[]})
    expect(html).not.toContain('data-profile-diagram=')
    expect(html).toContain("地图不能代替具体行程")
  })
})

it("地图名称在图中可读，长名称仍在图例完整保留", () => {
  const raw=valid();raw.nodes[0].label="星陨观测站北部极地补给营地";
  const dom=new JSDOM(render(raw)).window.document
  expect(dom.querySelector('.diagram-node-label')?.textContent).toContain("星陨观测站")
  expect(dom.querySelector('.diagram-legend')?.textContent).toContain(raw.nodes[0].label)
  expect(dom.querySelector('pattern#profile-mountain')).not.toBeNull()
})
