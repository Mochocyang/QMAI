import { describe, expect, it } from "vitest"
import { buildReportMarkdown } from "@/lib/novel/story-simulation/report-export"
import type {
  SimulationReport,
  StoryFramework,
} from "@/lib/novel/story-simulation/types"

function framework(): StoryFramework {
  return {
    id: "fw",
    title: "测试框架",
    premise: "测试前提",
    targetWords: 10000,
    simulationMode: "hybrid",
    sourceChapters: 1,
    createdAt: "2026-07-06T00:00:00.000Z",
    nodes: [],
  }
}

function report(overrides: Partial<SimulationReport> = {}): SimulationReport {
  return {
    frameworkId: "fw",
    mode: "hybrid",
    characterAnalyses: [
      {
        characterId: "a",
        name: "甲",
        behaviors: [],
        stateChanges: [],
        consistencyScore: 80,
        evidence: ["我要走了。"],
      },
    ],
    branches: [
      {
        title: "分支一",
        summary: "摘要",
        keyEvents: [],
        probability: "high",
        pros: "优点",
        cons: "缺点",
        recommendation: true,
        evidence: ["那你走吧。"],
      },
    ],
    recommendation: "推荐分支一",
    createdAt: "2026-07-06T00:00:00.000Z",
    ...overrides,
  }
}

const NOW = new Date("2026-07-06T00:00:00.000Z")

/**
 * 导出的 Markdown 是报告离开应用后的唯一载体，引文与审计必须一起带走 ——
 * 否则拿到文件的人无法判断哪句话真有出处。
 */
describe("buildReportMarkdown 引文与审计", () => {
  it("角色与分支的原话依据都写进正文", () => {
    const md = buildReportMarkdown(framework(), report(), undefined, NOW)

    expect(md).toContain("原话依据")
    expect(md).toContain("我要走了。")
    expect(md).toContain("那你走吧。")
  })

  it("导出取证审计结论", () => {
    const md = buildReportMarkdown(
      framework(),
      report({
        evidenceAudit: { total: 2, verified: 2, unverified: [], toolCalls: 4 },
      }),
      undefined,
      NOW,
    )

    expect(md).toContain("## 取证审计")
    expect(md).toContain("引文共 2 条，逐字核对通过 2 条")
    expect(md).toContain("调用工具 4 次")
    expect(md).not.toContain("警告")
  })

  it("有未通过的引文时在导出文件里明确警告并列出原文", () => {
    const md = buildReportMarkdown(
      framework(),
      report({
        evidenceAudit: {
          total: 3,
          verified: 2,
          unverified: ["我从来没有爱过你。"],
          toolCalls: 5,
        },
      }),
      undefined,
      NOW,
    )

    expect(md).toContain("警告")
    expect(md).toContain("我从来没有爱过你。")
  })

  it("单次生成（未用工具）也说明取证方式", () => {
    const md = buildReportMarkdown(
      framework(),
      report({
        evidenceAudit: { total: 0, verified: 0, unverified: [], toolCalls: 0 },
      }),
      undefined,
      NOW,
    )

    expect(md).toContain("未使用取证工具")
  })

  it("旧报告没有引文与审计字段，导出照常且不出现空区块", () => {
    const md = buildReportMarkdown(
      framework(),
      report({
        characterAnalyses: [
          {
            characterId: "a",
            name: "甲",
            behaviors: [],
            stateChanges: [],
            consistencyScore: 80,
          },
        ],
        branches: [
          {
            title: "分支一",
            summary: "摘要",
            keyEvents: [],
            probability: "high",
            pros: "优点",
            cons: "缺点",
            recommendation: true,
          },
        ],
      }),
      undefined,
      NOW,
    )

    expect(md).toContain("推荐分支一")
    expect(md).not.toContain("原话依据")
    expect(md).not.toContain("## 取证审计")
  })
})
