/** 受限数据驱动示意图：只接受坐标、区域和连线，不执行模型提供的 SVG/HTML。 */
export interface ProfileDiagramNode {
  id: string
  label: string
  x: number
  y: number
  width?: number
  height?: number
  description: string
}
export interface ProfileDiagramRegion {
  id: string
  label: string
  terrain: "land" | "water" | "mountain" | "restricted"
  points: number[][]
  description: string
}
export interface ProfileDiagramRoute {
  from: string
  to: string
  label: string
  mode: "land" | "water" | "passage"
  detail: string
}
export interface ProfileDiagram {
  kind: "map" | "floorplan"
  title: string
  note: string
  nodes: ProfileDiagramNode[]
  regions: ProfileDiagramRegion[]
  routes: ProfileDiagramRoute[]
  omitted: number
}
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value)
const text = (value: unknown): string => typeof value === "string" ? value.trim() : ""
const coordinate = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const escape = (value: string): string => value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")

export function normalizeProfileDiagram(raw: unknown): ProfileDiagram | null {
  if (!record(raw) || (raw.kind !== "map" && raw.kind !== "floorplan")) return null
  const kind = raw.kind
  const nodes: ProfileDiagramNode[] = []
  const regions: ProfileDiagramRegion[] = []
  const routes: ProfileDiagramRoute[] = []
  const ids = new Set<string>()
  let omitted = 0
  for (const item of array(raw.nodes)) {
    if (!record(item) || !text(item.id) || !text(item.label) || !coordinate(item.x) || !coordinate(item.y) || ids.has(text(item.id))) { omitted++; continue }
    // 平面图使用真实给出的房间范围，不把超出边界的尺寸截成另一间房。
    if (kind === "floorplan" && (!coordinate(item.width) || !coordinate(item.height) || item.width === 0 || item.height === 0 || item.x + item.width > 100 || item.y + item.height > 100)) { omitted++; continue }
    if (kind === "floorplan" && nodes.some(node => (item.x as number) < node.x + node.width! && (item.x as number) + (item.width as number) > node.x && (item.y as number) < node.y + node.height! && (item.y as number) + (item.height as number) > node.y)) { omitted++; continue }
    ids.add(text(item.id))
    nodes.push({id:text(item.id),label:text(item.label),x:item.x,y:item.y,description:text(item.description),...(kind === "floorplan" ? {width:item.width as number,height:item.height as number} : {})})
  }
  const regionIds = new Set<string>()
  for (const item of array(raw.regions)) {
    if (!record(item) || !text(item.id) || !text(item.label) || regionIds.has(text(item.id)) || !Array.isArray(item.points) || item.points.length < 3 || !item.points.every(point => Array.isArray(point) && point.length === 2 && point.every(coordinate))) { omitted++; continue }
    const points = item.points as number[][]
    const area = points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length]
      return sum + point[0] * next[1] - next[0] * point[1]
    }, 0)
    if (Math.abs(area) < 0.0001) { omitted++; continue }
    regionIds.add(text(item.id))
    const terrain = ["land","water","mountain","restricted"].includes(text(item.terrain)) ? item.terrain as ProfileDiagramRegion["terrain"] : "land"
    regions.push({id:text(item.id),label:text(item.label),terrain,points:item.points,description:text(item.description)})
  }
  for (const item of array(raw.routes)) {
    if (!record(item) || !ids.has(text(item.from)) || !ids.has(text(item.to)) || item.from === item.to || !text(item.label)) { omitted++; continue }
    routes.push({from:text(item.from),to:text(item.to),label:text(item.label),mode:["land","water","passage"].includes(text(item.mode)) ? item.mode as ProfileDiagramRoute["mode"] : "land",detail:text(item.detail)})
  }
  if (!nodes.length && !regions.length) return null
  return {kind,title:text(raw.title) || (kind === "map" ? "区域关系图" : "空间布局图"),note:text(raw.note) || "相对位置示意，非比例测绘；具体距离、通行条件以正文为准。",nodes,regions,routes,omitted}
}

/** SVG 仅做空间总览，完整名称、说明、行程在相同文档的图例中保留。 */
export function renderProfileDiagram(raw: ProfileDiagram): string {
  const diagram = normalizeProfileDiagram(raw)
  if (!diagram) return ""
  const omitted = diagram.omitted + (Number.isSafeInteger(raw.omitted) && raw.omitted > 0 ? raw.omitted : 0)
  const x = (v: number) => 56 + v * 8.88
  const y = (v: number) => 48 + v * 4.44
  const pos = (node: ProfileDiagramNode) => [x(node.x + (node.width ?? 0) / 2), y(node.y + (node.height ?? 0) / 2)]
  const byId = new Map(diagram.nodes.map(node => [node.id,node]))
  const regions = diagram.regions.map((region,index) => `<polygon class="diagram-region terrain-${region.terrain}" points="${region.points.map(p=>`${x(p[0])},${y(p[1])}`).join(" ")}"><title>${escape(region.label)}</title></polygon><text class="diagram-region-number" x="${x(region.points.reduce((s,p)=>s+p[0],0)/region.points.length)}" y="${y(region.points.reduce((s,p)=>s+p[1],0)/region.points.length)}">区${index+1}</text>`).join("")
  const rooms = diagram.kind === "floorplan" ? diagram.nodes.map(node=>`<rect class="diagram-room" x="${x(node.x)}" y="${y(node.y)}" width="${node.width! * 8.88}" height="${node.height! * 4.44}"><title>${escape(node.label)}</title></rect>`).join("") : ""
  const routes = diagram.routes.map((route,index)=>{
    const [x1,y1]=pos(byId.get(route.from)!),[x2,y2]=pos(byId.get(route.to)!)
    return `<path class="diagram-route route-${route.mode}" d="M${x1} ${y1} L${x2} ${y2}"><title>${escape(route.label)}：${escape(route.detail)}</title></path><text class="diagram-route-number" x="${(x1+x2)/2}" y="${(y1+y2)/2-8}">路${index+1}</text>`
  }).join("")
  const shortLabel = (label: string) => Array.from(label).length > 12 ? Array.from(label).slice(0, 11).join("") + "…" : label
  const nodes = diagram.nodes.map((node,index)=>{
    const [cx,cy]=pos(node)
    // 地图标签依据左右边界排布；平面图小房间只标编号，完整名称始终保留在图例。
    const label = diagram.kind === "map" ? `<text class="diagram-node-label" x="${cx + (node.x > 70 ? -24 : 24)}" y="${cy + 5}" text-anchor="${node.x > 70 ? "end" : "start"}">${escape(shortLabel(node.label))}</text>` : ""
    return `<g class="diagram-node"><title>${escape(node.label)}：${escape(node.description)}</title><circle cx="${cx}" cy="${cy}" r="16"/><text x="${cx}" y="${cy+5}" text-anchor="middle">${index+1}</text>${label}</g>`
  }).join("")
  const legend = diagram.nodes.map((node,index)=>`<article class="diagram-key"><h4><b>${index+1}</b>${escape(node.label)}</h4><p>${escape(node.description || "位置见图，详细规则见正文。")}</p></article>`).join("")
  const regionLegend = diagram.regions.map((region,index)=>`<article class="diagram-key"><h4><b>区${index+1}</b>${escape(region.label)}</h4><p>${escape(region.description || "区域范围按给定点位示意。")}</p></article>`).join("")
  const routeLegend = diagram.routes.map((route,index)=>`<article class="diagram-key"><h4><b>路${index+1}</b>${escape(route.label)}</h4><p>${escape(byId.get(route.from)!.label)} → ${escape(byId.get(route.to)!.label)}</p><p>${escape(route.detail || "通行时间与条件未提供，不能从图上推算。")}</p></article>`).join("")
  return `<figure class="profile-diagram" id="profile-diagram"><header><span class="diagram-eyebrow">${diagram.kind === "map" ? "地理总览" : "空间总览"}</span><h2>${escape(diagram.title)}</h2></header><div class="diagram-canvas"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 560" role="img" aria-label="${escape(diagram.title)}；完整名称与说明见下方图例" data-profile-diagram="${diagram.kind}"><defs><pattern id="profile-diagram-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" class="diagram-grid-line"/></pattern><pattern id="profile-mountain" width="40" height="36" patternUnits="userSpaceOnUse"><rect width="40" height="36" class="diagram-mountain-bg"/><path d="M5 29L19 8 34 29M14 16L19 8 24 17" class="diagram-mountain-mark"/></pattern></defs><rect width="1000" height="560" class="diagram-sea"/><rect x="24" y="24" width="952" height="512" fill="url(#profile-diagram-grid)" class="diagram-border"/>${regions}${rooms}${routes}${nodes}<text class="diagram-north" x="951" y="22" text-anchor="end">${diagram.kind === "map" ? "北 ↑" : "上方 ↑"}</text><text class="diagram-scale-note" x="38" y="527">相对位置示意 · 非比例测绘 · 编号见图例</text></svg></div><figcaption>${escape(diagram.note)}</figcaption>${omitted ? `<p class="diagram-warning">${omitted} 项无效或重复的图形数据未绘制，请核对坐标、范围与节点引用；不要从缺失的图形推断正文事实。</p>` : ""}<div class="diagram-legend">${legend}${regionLegend}${routeLegend}</div></figure>`
}
/** 给生成模型的受限绘图契约，与 profile-diagram.ts 的解析字段一致。 */
export function buildProfileDiagramOutputRules(kind: "map" | "floorplan"): string {
  const example = {
    kind,
    title: kind === "map" ? "当前世界的区域关系图" : "当前地点的空间布局图",
    note: "设计提案；相对位置示意，非比例测绘；具体距离和通行条件以正文为准。",
    nodes: kind === "map"
      ? [{ id: "a", label: "填正文中的节点名称", x: 25, y: 30, description: "位置、作用和知情范围与正文相符" }, { id: "b", label: "填另一个真实节点名称", x: 70, y: 65, description: "不要照抄示例位置，按当前设定安排" }]
      : [{ id: "a", label: "填正文中的空间名称", x: 10, y: 15, width: 25, height: 25, description: "填该空间实际用途与出入条件" }, { id: "b", label: "填另一个空间名称", x: 50, y: 15, width: 35, height: 45, description: "房间尺寸仅表达示意比例，不虚构精确测量" }],
    regions: kind === "map" ? [{ id: "region-a", label: "正文中已描述的区域", terrain: "land", points: [[5,5],[45,5],[45,50],[5,50]], description: "该形状仅表达相对范围，不能与正文方位冲突" }] : [],
    routes: [{ from: "a", to: "b", label: "实际路线名称", mode: kind === "map" ? "land" : "passage", detail: "逐条写距离口径、交通方式、正常耗时、通行限制与补给；未明确的标为待确认" }],
  }
  return [
    "【第二版图形与正文对应规则】",
    `本类具备空间信息时，在档案对象内增加 diagram 对象（不是另一个顶层JSON），kind=${kind}。结构示例如下，必须换成当前设定，不照抄示例实体、坐标和数值：`,
    JSON.stringify(example),
    "软件据此绘制SVG，不输出原始SVG、HTML、脚本、图片链接或任意path。diagram只补充阅读，不代替任何正文分区。",
    "坐标x、y为0—100的有限数字，左上角为(0,0)；地图上方是北。nodes.id必须唯一，label与正文实体逐字对应，description保留说明与知情范围。",
    "regions可为空；地图区域提供至少3个二维points，terrain只能是land/water/mountain/restricted。只有在正文确有范围关系时才给轮廓，不随意虚构山脉、海岸与禁区。",
    "平面图nodes需提供width、height，均大于0；x+width和y+height不超过100。坐标是房间左上角；同层房间不得无解释重叠。只有明确存在的空间和通路才能绘制，不能为逃脱剧情额外创造门或暗道。",
    "routes.from/to必须引用nodes.id，mode只能是land/water/passage。detail保留完整距离、耗时、条件、代价和必要假设，不能根据图形屏幕距离反推真实行程。没有交通联系就不添加连线。",
    "note必须说明信息性质（已确认/设计提案/待确认）、作者层或角色认知层与非比例示意。新增创作允许设计内部一致的位置，但需标设计提案；补全已有文档若无足够空间依据则省略diagram，并在正文列待确认问题，禁止伪造测绘。",
    "所有图形实体、关系与行程也须完整写入MD相关分区；批量档案每个对象自带自己的diagram，不能借用另一对象的地图。",
  ].join("\n")
}
