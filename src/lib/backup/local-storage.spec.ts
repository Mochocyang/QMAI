// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  BACKUP_LS_PREFIXES,
  backupPrefixGroupOf,
  planLocalStorageReplacement,
} from "./local-storage"

describe("备份 localStorage 命名空间", () => {
  it("qm-uitest- 属于备份范围（皮肤与书架索引就存在这个前缀下）", () => {
    // 这两个键是界面外观与书架列表的唯一来源，漏掉它们就等于"备份说成功、
    // 换机后皮肤回到默认、书架空了"。
    expect(backupPrefixGroupOf("qm-uitest-skin")).toBe("qm-uitest-")
    expect(backupPrefixGroupOf("qm-uitest-library")).toBe("qm-uitest-")
    expect(backupPrefixGroupOf("qmai-ui-density")).toBe("qmai")
    expect(backupPrefixGroupOf("lk-something")).toBe("lk-")
    expect(backupPrefixGroupOf("unrelated")).toBeNull()
  })

  it("备份带了某一组时整组替换", () => {
    const removed = planLocalStorageReplacement(
      ["qmai-old", "lk-old", "qm-uitest-old"],
      { "qmai-new": "1", "qm-uitest-new": "2" },
    )
    // qmai 与 qm-uitest- 组都在备份里 → 整组清掉再写回
    expect([...removed].sort()).toEqual(["qm-uitest-old", "qmai-old"])
  })

  it("备份完全没带某一组时一个键都不动", () => {
    // 旧版本备份（不含 qm-uitest-）用来恢复的场景：
    // 若照前缀表一律清空，书架索引会被删除且填不回来 —— 用户会以为所有书都丢了。
    const removed = planLocalStorageReplacement(
      ["qmai-old", "qm-uitest-library", "qm-uitest-skin"],
      { "qmai-new": "1" },
    )
    expect(removed).toEqual(["qmai-old"])
  })

  it("非备份命名空间的键永远不受影响", () => {
    const removed = planLocalStorageReplacement(["unrelated", "other-app"], {
      "qmai-new": "1",
    })
    expect(removed).toEqual([])
  })

  /*
   * 导出端与导入端必须共用同一份前缀表。
   *
   * 这条是**静态**断言而不是行为断言：两张表各自字面量维护时，只改一边会造成
   * "清掉的键备份里根本没有"（导入后偏好被清空且无法恢复），
   * 而这种漂移在单测里很难被行为用例碰到，所以直接钉住源码里不再出现第二份列表。
   */
  it("前缀表只在 local-storage.ts 里定义一次", () => {
    const files = ["export.ts", "import.ts"]
    for (const file of files) {
      const source = readFileSync(resolve(__dirname, file), "utf8")
      expect(
        source.includes('["qmai", "lk-"]'),
        `${file} 里不应再出现硬编码的前缀数组，请改用 BACKUP_LS_PREFIXES`,
      ).toBe(false)
      expect(
        /const\s+\w*PREFIXES\w*\s*=\s*\[/.test(source),
        `${file} 里不应再定义自己的前缀常量`,
      ).toBe(false)
    }
    expect(BACKUP_LS_PREFIXES).toContain("qm-uitest-")
  })
})
