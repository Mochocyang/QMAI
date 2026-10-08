import { describe, expect, it } from "vitest"

import {
  describeUnsupportedDrop,
  dropRectFromBounds,
  filterDroppablePaths,
  isDropInsideList,
  isPointInsideDropRect,
  toLogicalDropPoint,
} from "./drop-import"

const RECT = { left: 100, top: 200, right: 400, bottom: 600 }

describe("toLogicalDropPoint", () => {
  /**
   * Tauri 原生拖拽事件给的是物理像素，DOM 矩形是 CSS 像素。
   * 不换算的话高分屏上判定框整体偏移，用户看到的就是"拖上去了没反应"。
   */
  it("按 devicePixelRatio 把物理像素换算成 CSS 像素", () => {
    expect(toLogicalDropPoint({ x: 300, y: 400 }, 2)).toEqual({ x: 150, y: 200 })
    expect(toLogicalDropPoint({ x: 150, y: 300 }, 1.5)).toEqual({ x: 100, y: 200 })
  })

  it("DPR 为 1 时原样返回", () => {
    expect(toLogicalDropPoint({ x: 12, y: 34 }, 1)).toEqual({ x: 12, y: 34 })
  })

  it("DPR 异常时按 1 处理，绝不产出 NaN 坐标", () => {
    for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      const point = toLogicalDropPoint({ x: 10, y: 20 }, bad)
      expect(Number.isNaN(point.x)).toBe(false)
      expect(Number.isNaN(point.y)).toBe(false)
      expect(point).toEqual({ x: 10, y: 20 })
    }
  })
})

describe("isPointInsideDropRect", () => {
  it("矩形内部为真", () => {
    expect(isPointInsideDropRect({ x: 250, y: 400 }, RECT)).toBe(true)
  })

  it("边界算命中（拖到列表边缘也该算）", () => {
    expect(isPointInsideDropRect({ x: 100, y: 200 }, RECT)).toBe(true)
    expect(isPointInsideDropRect({ x: 400, y: 600 }, RECT)).toBe(true)
  })

  it("四个方向的外侧都不算命中", () => {
    expect(isPointInsideDropRect({ x: 99, y: 400 }, RECT)).toBe(false)
    expect(isPointInsideDropRect({ x: 401, y: 400 }, RECT)).toBe(false)
    expect(isPointInsideDropRect({ x: 250, y: 199 }, RECT)).toBe(false)
    expect(isPointInsideDropRect({ x: 250, y: 601 }, RECT)).toBe(false)
  })
})

describe("dropRectFromBounds", () => {
  it("正常矩形原样取出", () => {
    expect(dropRectFromBounds(RECT)).toEqual(RECT)
  })

  /*
   * 列表没挂载 / 被折叠 / 宽度为 0 时矩形是退化的。此时如果还拿它去判定，
   * 0x0 的矩形配上">= left && <= right"会退化成"点必须正好等于零点"，
   * 不如直接判定为"没法作为投放目标"，语义更清楚。
   */
  it("零尺寸矩形返回 null", () => {
    expect(dropRectFromBounds({ left: 0, top: 0, right: 0, bottom: 0 })).toBeNull()
    expect(dropRectFromBounds({ left: 10, top: 10, right: 10, bottom: 50 })).toBeNull()
    expect(dropRectFromBounds({ left: 10, top: 10, right: 50, bottom: 10 })).toBeNull()
  })
})

describe("isDropInsideList", () => {
  it("换算后再判定：DPR=2 的物理坐标落在列表内为真", () => {
    // 物理 500x800 → CSS 250x400，在 RECT 内
    expect(isDropInsideList({ x: 500, y: 800 }, RECT, 2)).toBe(true)
  })

  it("同一个物理坐标在 DPR=2 下命中、在 DPR=1 下落到右侧外面", () => {
    const position = { x: 500, y: 800 }
    expect(isDropInsideList(position, RECT, 2)).toBe(true)
    expect(isDropInsideList(position, RECT, 1)).toBe(false)
  })

  it("矩形为 null（没布局）时一律不命中", () => {
    expect(isDropInsideList({ x: 250, y: 400 }, null, 1)).toBe(false)
  })
})

describe("filterDroppablePaths", () => {
  it("章节只接受章节文档扩展名", () => {
    expect(filterDroppablePaths(
      ["E:/a/第1章.md", "E:/a/第2章.txt", "E:/a/封面.png", "E:/a/资料.pdf"],
      "chapter",
    )).toEqual(["E:/a/第1章.md", "E:/a/第2章.txt"])
  })

  it("大纲接受大纲的文档扩展名", () => {
    const kept = filterDroppablePaths(
      ["E:/a/主线.md", "E:/a/设定.docx", "E:/a/图.png", "E:/a/表.xlsx"],
      "outline",
    )
    expect(kept).toContain("E:/a/主线.md")
    expect(kept).toContain("E:/a/设定.docx")
    expect(kept).not.toContain("E:/a/图.png")
  })

  it("扩展名大小写不敏感", () => {
    expect(filterDroppablePaths(["E:/a/第1章.MD", "E:/a/第2章.DocX"], "chapter"))
      .toEqual(["E:/a/第1章.MD", "E:/a/第2章.DocX"])
  })

  it("点开头的隐藏文件被挡掉", () => {
    expect(filterDroppablePaths(["E:/a/.DS_Store.md", "E:/a/.hidden.txt"], "chapter")).toEqual([])
  })

  it("没有扩展名的文件和文件夹名被挡掉", () => {
    expect(filterDroppablePaths(["E:/a/某个文件夹", "E:/a/README"], "chapter")).toEqual([])
  })

  it("空串与非法项被丢掉，不会让 filter 抛错", () => {
    expect(filterDroppablePaths(["", "E:/a/第1章.md"], "chapter")).toEqual(["E:/a/第1章.md"])
  })

  it("一个都不匹配时返回空数组", () => {
    expect(filterDroppablePaths(["E:/a/图.png"], "chapter")).toEqual([])
  })
})

describe("describeUnsupportedDrop", () => {
  it("章节与大纲给出各自的文案", () => {
    expect(describeUnsupportedDrop(["a.png", "b.png"], "chapter")).toContain("章节文档")
    expect(describeUnsupportedDrop(["a.png"], "outline")).toContain("大纲文档")
  })

  it("带上数量，用户知道这次拖了几个", () => {
    expect(describeUnsupportedDrop(["a.png", "b.png", "c.pdf"], "chapter")).toContain("3")
  })
})
