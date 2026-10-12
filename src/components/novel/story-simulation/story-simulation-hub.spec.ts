import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8")
}

/*
 * 断言「源码里不再出现 X」之前必须先去掉注释 —— 说明「为什么删掉它」的注释里
 * 会原样写上那个标识符，不去掉的话"自己的说明"会把检查喂饱。
 * （与 memory-center-dismantling.spec.ts 同一套做法。）
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")
}

const readCode = (rel: string) => stripComments(read(rel))

const hubSource = () => read("src/components/novel/story-simulation/story-simulation-hub.tsx")
const viewSource = () => read("src/components/novel/story-simulation/story-simulation-view.tsx")
const configSource = () => readCode("src/components/novel/story-simulation/simulation-config-panel.tsx")
const sidebarSource = () => readCode("src/components/layout/sidebar-panel.tsx")

/*
 * 「剧情推演式」与「舞台情景」是两个**彼此独立**的功能。
 *
 * 改造前「舞台情景」被放在「剧情推演」配置页的最底部（SimulationConfigPanel
 * 的第 7 节，`onOpenScenario`），层级上被压在下面、经常看不到；同时
 * 剧情推演室是「左栏故事框架 + 右栏内容」的双栏结构。
 *
 * 现在：入口页把两者并列成同级入口（设计稿「方案 B」= 纵向入口列表）；
 * 剧情推演室是整窗单栏。
 * 下面几条就是钉住这两点的 —— 它们很容易在后续重构里被悄悄改回去，
 * 而改回去不会报任何编译错误。
 */
describe("剧情推演室 · 两个独立功能的同级入口", () => {
  it("落地页并列展示两个功能入口（纵向列表的两行）", () => {
    const src = hubSource()
    expect(src).toContain("storySimulation.hubSimulationName")
    expect(src).toContain("storySimulation.hubScenarioName")
    // 方案 B 的行式结构：一个外框 + 若干行按钮，而不是并排的双卡
    expect(src).toContain('data-ui="simulation-hub"')
    expect(src).toContain("`simulation-hub-entry-${entry.key}`")
    expect(src).toContain("<ArrowRight")
  })

  it("两行都用统一的行高，不靠等宽卡片对齐", () => {
    const src = hubSource()
    // 行高由 icon 容器 + 统一 padding 决定；文案长短不影响行高
    expect(src).toContain("h-10 w-10 shrink-0")
    expect(src).toContain("px-5 py-4")
  })

  it("每行带「流程标签」，让人点击之前就分清两个功能", () => {
    const src = hubSource()
    expect(src).toContain("hubSimulationSteps")
    expect(src).toContain("hubScenarioSteps")
    expect(src).toContain("steps.map")
  })

  it("落地页分别回调两个功能，互不嵌套", () => {
    const src = hubSource()
    expect(src).toContain("onEnterSimulation")
    expect(src).toContain("onEnterScenario")
  })

  it("「最近」把删掉左栏后丢掉的历史入口补回来", () => {
    const src = hubSource()
    // 两类数据各自取数，归并规则交给可单测的纯函数
    expect(src).toContain("loadFrameworks")
    expect(src).toContain("loadScenarios")
    expect(src).toContain("buildRecentActivity")
    expect(src).toContain('data-ui="simulation-hub-recent"')
    expect(src).toContain("hubRecent")
    // 两类记录都要能点回去
    expect(src).toContain("onResumeFramework")
    expect(src).toContain("onResumeScenario")
  })

  /*
   * 删掉左侧「故事框架」栏时，一并失去的不止「列表」——那一栏还独家承载了
   * 「删除框架」和「绑定到 AI 会话」两个操作。它们是**被斩断入口的孤儿**，
   * 不是天然死代码，所以必须搬到这里，否则就成了静默掉功能。
   */
  it("「删除框架」与「绑定到 AI 会话」两个操作搬到了落地页", () => {
    const src = hubSource()
    expect(src).toContain("deleteFramework")
    expect(src).toContain("<FrameworkBindingDialog")
    expect(src).toContain("hubDeleteFrameworkConfirm")
    expect(src).toContain("hubBind")
  })

  /*
   * 左栏的「历史推演结果」也是一列独立入口 —— 有了它才能直接回到上次那份报告，
   * 而不是先回到框架再自己翻。这里钉住它进了「最近」，且读取有上限。
   */
  it("「最近」能直接回到某一份推演报告，而不只是框架", () => {
    const src = hubSource()
    expect(src).toContain("loadLatestSimulationResult")
    expect(src).toContain("hubRecentResult")
    expect(src).toContain("onResumeResult")
    // 读结果比读框架贵得多：只扫最新的若干框架，且每个框架只读一条
    expect(src).toContain("FRAMEWORK_RESULT_SCAN_LIMIT")
    expect(src).toContain("slice(0, FRAMEWORK_RESULT_SCAN_LIMIT)")
  })

  it("主视图接上「打开某份报告」，并先把框架设成当前框架", () => {
    const src = viewSource()
    expect(src).toContain("handleResumeSimulationResult")
    expect(src).toContain("onResumeResult={handleResumeSimulationResult}")
    // 跨框架打开报告时，报告页的上下文（标题 / 重新推演 / 导出）靠它
    expect(src).toContain("setCurrentFramework(framework);")
    // savedResults 必须含这一条：报告页按 selectedResultId 回查
    expect(src).toContain("setSavedResults([mapped]);")
  })

  it("提供「查看全部框架」展开，覆盖「最近」前 5 条之外的框架", () => {
    const src = hubSource()
    expect(src).toContain('data-ui="simulation-hub-all-frameworks"')
    expect(src).toContain("hubAllFrameworks")
    // 全部框架列表的行把 testId 透传给 ListRow 的「打开」按钮
    expect(src).toContain('testId="simulation-hub-framework"')
  })

  /*
   * 删栏时留下的 store 字段也一并清了：它们只服务于那个已经删掉的组件，
   * 留着就是 write-only 状态（写着没人读），比没有更糟 —— 会让人以为
   * 改它能触发刷新。
   */
  it("只服务于已删左栏的 store 字段没有留下", () => {
    const store = readCode("src/stores/story-simulation-store.ts")
    expect(store).not.toContain("listRefreshKey")
    expect(store).not.toContain("bumpListRefresh")
    expect(store).not.toContain("setFrameworks")
    expect(store).not.toContain("selectedFrameworkId")
  })

  it("绑定相关字段保留（dialog 仍在用）", () => {
    const store = readCode("src/stores/story-simulation-store.ts")
    expect(store).toContain("setBinding")
  })

  it("主视图把两条「继续」都接上（框架走确认页，情景走房间视图）", () => {
    const src = viewSource()
    expect(src).toContain("handleResumeFramework")
    expect(src).toContain("onResumeFramework={handleResumeFramework}")
    expect(src).toContain("onResumeScenario={handleOpenSavedScenario}")
    // 回到框架落在「确认」而不是直接开跑：不该一点就消耗 token
    expect(src).toContain('setPhase("framework-confirming");')
  })

  it("主视图在 idle 阶段渲染落地页，并接通两条流程", () => {
    const src = viewSource()
    expect(src).toContain('phase === "idle"')
    expect(src).toContain("<StorySimulationHub")
    // 进入剧情推演式 = configuring；进入舞台情景 = 复用既有的 handleOpenScenario
    expect(src).toContain('onEnterSimulation={() => setPhase("configuring")}')
    expect(src).toContain("onEnterScenario={handleOpenScenario}")
    // 原有两条流程的分支必须都还在
    expect(src).toContain('phase === "scenario-setup"')
    expect(src).toContain('phase === "scenario-running"')
  })

  it("子阶段提供返回落地页的入口（否则 phase 持久化后再也回不到入口页）", () => {
    const src = viewSource()
    expect(src).toContain('setPhase("idle")')
    expect(src).toContain("storySimulation.hubBack")
  })

  it("「舞台情景」不再挂在「剧情推演」配置页底下", () => {
    const src = configSource()
    expect(src).not.toContain("onOpenScenario")
    expect(src).not.toContain("hubScenarioName")
  })

  it("剧情推演室不再有左侧「故事框架」栏（双栏已去掉）", () => {
    const src = sidebarSource()
    expect(src).not.toContain("StorySimulationSidebarPanel")
    expect(src).not.toContain("framework-list")
  })

  it("剧情推演室进了整窗视图清单，左栏不会再冒出来", () => {
    const src = read("src/lib/full-window-views.ts")
    expect(src).toContain('"storySimulation"')
  })
})

/*
 * 自由沙盘：不绑定章节的探索路径（P2-2）。
 *
 * 先核实事实：**这条路径今天已经存在，不需要新写功能。**「舞台情景」就是它 ——
 * 角色从章节里提取，但它自己不绑定任何一章：`ScenarioSetup` 只有
 * { rules, format, rounds, participants }，全库的 `scenario-*.ts*` 里
 * 没有任何 `currentFramework` / `frameworkId` 引用。落地页进它也只是切一个
 * phase，不需要先选中章节或框架。
 *
 * 那为什么还要加护栏：另一份设计稿《功能边界整理-入口收敛方案》正在规划把入口
 * 改成「位置驱动」（从卷纲/章纲/正文选中位置直接推演），并明确写着
 * 「保留一个『自由沙盘』给确实没有位置的脑暴」。也就是说这条路径在未来会被
 * 一次入口重构正面撞上，而**把它删掉不会报任何编译错误** —— 正如本分支起点
 * 的导演 Agent 开关，坏了也没有任何测试会红。
 *
 * 所以这里钉的不是「新功能」，而是「探索路径必须一直能独立进入」。
 */
describe("自由沙盘 · 不绑定章节的探索路径", () => {
  const scenarioFiles = [
    "src/lib/novel/story-simulation/scenario-types.ts",
    "src/lib/novel/story-simulation/scenario-engine.ts",
    "src/components/novel/story-simulation/scenario-setup-panel.tsx",
  ]

  it("进入推演室不需要章节/位置上下文 —— 只切一个 phase", () => {
    const src = viewSource()
    // 两条流程都从 idle 直接进，前面没有任何「必须有 currentFramework / 选中章节」
    // 的门槛：这正是「没有位置」的含义。
    expect(src).toContain('onEnterSimulation={() => setPhase("configuring")}')
    expect(src).toContain("onEnterScenario={handleOpenScenario}")
    // handleOpenScenario 本体必须是纯粹的状态切换
    const handler = src.slice(src.indexOf("const handleOpenScenario"))
    const body = handler.slice(0, handler.indexOf("};"))
    expect(body).toContain('setPhase("scenario-setup")')
    expect(body).not.toContain("currentFramework")
    expect(body).not.toContain("frameworkId")
  })

  it("舞台情景不消费推演框架绑定（它是探索路径，不是某一章的执行）", () => {
    for (const rel of scenarioFiles) {
      expect(readCode(rel)).not.toContain("frameworkId")
    }
  })

  it("舞台情景的设置里没有章节/节点字段，只有规则与参与者", () => {
    const src = readCode("src/lib/novel/story-simulation/scenario-types.ts")
    const setup = src.slice(src.indexOf("export interface ScenarioSetup"))
    const body = setup.slice(0, setup.indexOf("}"))

    expect(body).toContain("rules")
    expect(body).toContain("participants")
    // 一旦有人给它加上章节绑定，这条探索路径就变成了「某一章的执行」
    expect(body).not.toContain("chapter")
    expect(body).not.toContain("node")
  })

  it("落地页的两条入口都还在（收敛入口时不能只剩「有位置」那条）", () => {
    const src = hubSource()
    expect(src).toContain('key: "simulation"')
    expect(src).toContain('key: "scenario"')
  })
})
