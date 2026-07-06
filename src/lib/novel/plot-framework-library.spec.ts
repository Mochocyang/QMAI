import { describe, it, expect, vi, beforeEach } from "vitest";

const memStore = new Map<string, string>();

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(async (path: string) => {
    if (!memStore.has(path)) throw new Error(`ENOENT: ${path}`);
    return memStore.get(path)!;
  }),
  writeFile: vi.fn(async (path: string, content: string) => {
    memStore.set(path, content);
  }),
  writeFileAtomic: vi.fn(async (path: string, content: string) => {
    memStore.set(path, content);
  }),
  createDirectory: vi.fn(async () => undefined),
  fileExists: vi.fn(async (path: string) => memStore.has(path)),
}));

import {
  getPlotFrameworkLibraryPath,
  loadPlotFrameworkLibrary,
  savePlotFrameworkLibrary,
  upsertPlotFramework,
  upsertPlotFrameworks,
  removePlotFramework,
  findPlotFramework,
  manualAdjustPlotFrameworkPacing,
} from "./plot-framework-library";
import type { PlotFramework, PlotFrameworkLibrary } from "./plot-framework";

const PROJECT = "E:/Novel";

function makeBeats() {
  return {
    hook: "穿越后觉醒双S职业",
    buildup: "配角衬托A级即顶点",
    payoff: "男主双S打破规则",
    endingHook: "所有人启程新手副本",
  };
}

function makeFramework(overrides: Partial<PlotFramework> = {}): PlotFramework {
  return {
    id: "fw-1",
    title: "双S转职反差爽点",
    beats: makeBeats(),
    rangeChapterIds: ["ch-1"],
    line: "main",
    characters: ["男主"],
    foreshadowing: [],
    reusableTemplate: "先压后扬，规则打破",
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  } as PlotFramework;
}

describe("plot-framework-library 跨作品框架库持久化", () => {
  beforeEach(() => {
    memStore.clear();
  });

  it("getPlotFrameworkLibraryPath 落在 .qmai/plot-frameworks/library.json", () => {
    expect(getPlotFrameworkLibraryPath("E:/Novel")).toBe(
      "E:/Novel/.qmai/plot-frameworks/library.json",
    );
  });

  it("load 在文件不存在时返回空库", async () => {
    const lib = await loadPlotFrameworkLibrary(PROJECT);
    expect(lib.frameworks).toEqual([]);
  });

  it("save + load 往返保持框架内容", async () => {
    const lib: PlotFrameworkLibrary = {
      version: 1,
      frameworks: [makeFramework()],
    };
    await savePlotFrameworkLibrary(PROJECT, lib);
    const loaded = await loadPlotFrameworkLibrary(PROJECT);
    expect(loaded.frameworks).toHaveLength(1);
    expect(loaded.frameworks[0].title).toBe("双S转职反差爽点");
    expect(loaded.frameworks[0].beats.hook).toContain("双S职业");
  });

  it("load 文件损坏时回退空库（不抛异常）", async () => {
    memStore.set(getPlotFrameworkLibraryPath(PROJECT), "{ not valid json");
    const lib = await loadPlotFrameworkLibrary(PROJECT);
    expect(lib.frameworks).toEqual([]);
  });

  it("upsertPlotFramework 写入新框架并应用自动节奏初判", async () => {
    const saved = await upsertPlotFramework(
      PROJECT,
      makeFramework({ rangeChapterIds: ["ch-1"] }),
    );
    expect(saved.pacing).toBe("tight");
    expect(saved.autoPacing).toBe(true);

    const loaded = await loadPlotFrameworkLibrary(PROJECT);
    expect(loaded.frameworks).toHaveLength(1);
    expect(loaded.frameworks[0].id).toBe("fw-1");
  });

  it("upsertPlotFramework 同 id 覆盖而非追加", async () => {
    await upsertPlotFramework(
      PROJECT,
      makeFramework({ id: "fw-1", title: "v1" }),
    );
    await upsertPlotFramework(
      PROJECT,
      makeFramework({ id: "fw-1", title: "v2", updatedAt: 2000 }),
    );
    const loaded = await loadPlotFrameworkLibrary(PROJECT);
    expect(loaded.frameworks).toHaveLength(1);
    expect(loaded.frameworks[0].title).toBe("v2");
  });

  it("upsertPlotFramework 拒绝写四段不完整的框架", async () => {
    await expect(
      upsertPlotFramework(
        PROJECT,
        makeFramework({ beats: { ...makeBeats(), hook: "" } }),
      ),
    ).rejects.toThrow(/四段不完整/);
    const loaded = await loadPlotFrameworkLibrary(PROJECT);
    expect(loaded.frameworks).toHaveLength(0);
  });

  it("upsertPlotFrameworks 批量入库（跳过半成品不阻断整批）", async () => {
    const accepted = await upsertPlotFrameworks(PROJECT, [
      makeFramework({ id: "fw-1" }),
      makeFramework({ id: "fw-2", beats: { ...makeBeats(), payoff: "" } }), // 半成品
      makeFramework({
        id: "fw-3",
        rangeChapterIds: ["ch-1", "ch-2", "ch-3", "ch-4", "ch-5"],
      }),
    ]);
    expect(accepted.map((f) => f.id)).toEqual(["fw-1", "fw-3"]);
    expect(accepted[1].pacing).toBe("standard"); // 5 章判 standard
  });

  it("removePlotFramework 按 id 删除", async () => {
    await upsertPlotFrameworks(PROJECT, [
      makeFramework({ id: "fw-1" }),
      makeFramework({ id: "fw-2" }),
    ]);
    await removePlotFramework(PROJECT, "fw-1");
    const loaded = await loadPlotFrameworkLibrary(PROJECT);
    expect(loaded.frameworks.map((f) => f.id)).toEqual(["fw-2"]);
  });

  it("findPlotFramework 按 id 查询，未找到返回 null", async () => {
    await upsertPlotFramework(PROJECT, makeFramework({ id: "fw-1" }));
    expect((await findPlotFramework(PROJECT, "fw-1"))?.id).toBe("fw-1");
    expect(await findPlotFramework(PROJECT, "nope")).toBeNull();
  });

  it("manualAdjustPlotFrameworkPacing 设 autoPacing=false 防止后续 AI 覆盖", async () => {
    // 初始：3 章 → tight，autoPacing=true
    await upsertPlotFramework(
      PROJECT,
      makeFramework({ id: "fw-1", rangeChapterIds: ["ch-1", "ch-2", "ch-3"] }),
    );
    expect((await findPlotFramework(PROJECT, "fw-1"))?.pacing).toBe("tight");

    // 用户手动改为 loose（水文）
    const adjusted = await manualAdjustPlotFrameworkPacing(
      PROJECT,
      "fw-1",
      "loose",
    );
    expect(adjusted?.pacing).toBe("loose");
    expect(adjusted?.autoPacing).toBe(false);

    // 调用方重新入库时，查询旧 framework 并保留用户校正状态（autoPacing=false, pacing=loose）
    // 这模拟拆文 UI 中“拆出新版本但保留用户已校正节奏”的正确调用语义
    const existing = await findPlotFramework(PROJECT, "fw-1");
    await upsertPlotFramework(
      PROJECT,
      makeFramework({
        id: "fw-1",
        rangeChapterIds: ["ch-1", "ch-2", "ch-3"],
        updatedAt: 9999,
        pacing: existing?.pacing,
        autoPacing: existing?.autoPacing,
      }),
    );
    const final = await findPlotFramework(PROJECT, "fw-1");
    expect(final?.pacing).toBe("loose");
    expect(final?.autoPacing).toBe(false);
  });

  it("manualAdjustPlotFrameworkPacing 对不存在的 id 返回 null", async () => {
    const r = await manualAdjustPlotFrameworkPacing(PROJECT, "nope", "tight");
    expect(r).toBeNull();
  });
});
