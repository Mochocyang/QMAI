// @vitest-environment node
/*
 * 「6 个参数 × 6 层读写」这件事实本身没人守 —— 补一层元守卫。
 *
 * ── 为什么需要它 ──
 *
 * 正文字体设置这一组参数（字体/字号/行间距/字间距/左右边距/底部安全距离）
 * 在仓库里有 **5 层**各自按名字手抄了一遍：
 *
 *   1. preview-panel.tsx        现场改值 + 落全套（**含唯一的草稿映射 switch**）
 *   2. settings-view.tsx        设置页保存
 *   3. project-store.ts         app-state 的 save / load
 *   4. wiki-store.ts            初值 + 6 个 setter
 *   5. App.tsx                  启动读回
 *
 * ── 为什么从 6 层变成 5 层 ──
 *
 * 原先第 2 层是 `interface-section.tsx` 的「设置页草稿 switch」。
 * 用户要求把这 6 项**从设置页移除**（它们属于章节，不属于全局设置），
 * 那个 switch 随之搬到 preview-panel.tsx 的 `applyBodyTypographyChange`
 * —— 也就是并进了第 1 层，而不是凭空消失。
 * 所以层数减少是**真实的合并**，不是有人把守卫绕过去了；
 * 这一点必须写在这里，否则下一个人看到 5 会以为是漏登记。
 *
 * ⚠ 搬走之后新增了一条**反向**不变量：interface-section.tsx 不得再出现
 * 这 6 个 store 字段名。理由与判据见文件末尾那条用例。
 *
 * 其中两处 switch 已经被 TypeScript 的 `default: { const _never: never = key }`
 * 钉死（新增字段或漏 case 都会编译错），`body-typography-fields.tsx` 则是
 * **类型派生**的（`BodyTypographyValue extends BodyTypographySettings`
 * 外加一行编译期互兼容 pin），本来就不会漂。
 * 但剩下那几层只有"名字出现过"级别的覆盖。
 *
 * 于是新增第 7 个参数时若漏掉某一层，症状是
 * 「设置页能调、写作现场不生效」或「这次生效、重开丢失」，**且没有任何红灯**。
 *
 * ── 这个守卫做什么 ──
 *
 * 对上述各层逐个断言"6 个字段名一个都不缺"。
 * 它不能替你写出第 7 个参数的正确逻辑，但能让"漏了一层"从静默变成失败。
 *
 * ⚠ 它**不能**自动发现"新增了第 7 层"。这一层靠 LAYERS 的条数下限断言：
 * 有人加了一层却没加进这里时，他至少要面对一次"这个数字要不要改"的决策。
 * （做不到更好就别假装做到了 —— 这是元守卫的已知边界。）
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/** store 里这一组参数的 6 个字段名（唯一真源是 wiki-store.ts，这里只做副本比对）。 */
const STORE_FIELDS = [
  "uiBodyFontFamily",
  "uiBodyFontPx",
  "uiBodyLineHeight",
  "uiBodyLetterSpacing",
  "uiBodyMarginX",
  "uiBodySafeBottom",
] as const

/** 按名字手抄了这 6 个字段的层。新增一层时必须加进这里（见文件头的已知边界）。 */
const LAYERS: { label: string; file: string }[] = [
  { label: "preview-panel：现场改值 + 落全套 + 草稿 switch", file: "src/components/layout/preview-panel.tsx" },
  { label: "settings-view：设置页保存", file: "src/components/settings/settings-view.tsx" },
  { label: "project-store：app-state save/load", file: "src/lib/project-store.ts" },
  { label: "wiki-store：初值 + 6 个 setter", file: "src/stores/wiki-store.ts" },
  { label: "App：启动读回", file: "src/App.tsx" },
]

/** 本轮被移出设置页的那一层（它现在**不该**再出现这些字段名）。 */
const REMOVED_LAYER = {
  label: "interface-section：设置页草稿 switch（已移出）",
  file: "src/components/settings/sections/interface-section.tsx",
}

const REPO = resolve(__dirname, "..", "..")
const read = (p: string) => readFileSync(resolve(REPO, p), "utf8").replace(/\r\n/g, "\n")

/** 抽成纯函数，好让反向控制能拿假数据喂它（否则"没报缺"可能只是函数恒返回空）。 */
function missingFields(source: string, fields: readonly string[]): string[] {
  return fields.filter((f) => !source.includes(f))
}

describe("6 参数 × 各层：枚举不许漏层", () => {
  it.each(LAYERS.map((l) => [l.label, l.file]))("%s 提到了全部 6 个字段", (_label, file) => {
    const missing = missingFields(read(file), STORE_FIELDS)
    expect(
      missing,
      `${file} 缺少这些正文字体字段：${missing.join(", ")}。\n` +
      `新增参数时漏掉一层，症状是"设置页能调、现场不生效"或"重开变回去"，且不会有别的红灯。`,
    ).toEqual([])
  })

  it("层数下限：这个清单必须与真实层数一致（层搬走/合并时要显式改这里）", () => {
    /*
     * 5 是当前实际层数（原为 6，interface-section 那一层并进了 preview-panel，
     * 见文件头的说明）。若有人再搬走或合并一层，这个数字要一起改 ——
     * 强制一次"你是真的合并了，还是把守卫绕过去了"的决策。
     */
    expect(
      LAYERS.length,
      "登记的层数变了：新增/删除/合并层时请同步更新 LAYERS 与文件头说明",
    ).toBe(5)
    expect(STORE_FIELDS.length).toBe(6)
  })

  /**
   * ── 反向不变量：被移走的那一层不得复活 ──
   *
   * 用户要求把这 6 项从设置页移除。上面那些用例只保证"该有的层都提到了
   * 这些字段名"，**不保证**"不该有的层没提到" —— 把 switch 原样加回去，
   * 上面 5 条依旧全绿。
   *
   * 这条与 interface-sidebar-nav.spec.ts 里那几条是同一个意图，
   * 但落在不同的判据上（那边查 setDraft 调用点与 JSX，这边查字段名）。
   * 两处都留着是有意的：只查一边的话，"字段名还在但没人用"这类
   * 半拉子状态会从两边都漏过去。
   */
  it("被移出设置页的那一层，不得再出现这 6 个字段名", () => {
    const src = read(REMOVED_LAYER.file)
    const back = STORE_FIELDS.filter((f) => src.includes(f))
    expect(
      back,
      `${REMOVED_LAYER.file} 又出现了这些字段：${back.join(", ")}。\n` +
      `这 6 项已移到章节工具栏的「字体设置」浮层（属于章节，不属于全局设置）——`,
    ).toEqual([])

    // 反向控制：判定函数必须能识破"字段回来了"的输入，否则上面那条恒真
    expect(
      missingFields(`const x = ${STORE_FIELDS[0]}`, STORE_FIELDS),
      "反向控制：字段真的回来时必须被报出来",
    ).toEqual([...STORE_FIELDS.slice(1)])
  })

  it("反向控制：判定函数必须能识破缺字段的输入", () => {
    // 把 6 个字段只留 5 个，必须被报出恰好缺的那一个。
    const incomplete = "uiBodyFontPx uiBodyLineHeight uiBodyLetterSpacing uiBodyMarginX uiBodySafeBottom"
    expect(missingFields(incomplete, STORE_FIELDS)).toEqual(["uiBodyFontFamily"])
    // 全空必须报满 6 个（否则"缺一个"和"全缺"分不出来）
    expect(missingFields("", STORE_FIELDS)).toEqual([...STORE_FIELDS])
    // 齐全必须返回空 —— 否则这条判据是"凡输入皆红"
    expect(missingFields(STORE_FIELDS.join(" "), STORE_FIELDS)).toEqual([])
  })

  it("控件组件是类型派生的，不该自己抄一份 store 字段名", () => {
    // body-typography-fields.tsx 收的是 BodyTypographyValue（值对象），
    // 不认 store 字段名。它若开始出现 uiBody*，说明有人把"控件"和"状态"耦合了，
    // 那会让设置页与写作现场有理由各读一套值 —— 正是要避免的分叉。
    const src = read("src/components/settings/sections/body-typography-fields.tsx")
    expect(
      STORE_FIELDS.filter((f) => src.includes(f)),
      "共用控件里出现了 store 字段名：控件应当只认值对象（BodyTypographyValue），不认状态存放位置",
    ).toEqual([])
    // 但它必须仍然认这 6 个**值**键（否则控件漏了一个参数的控制项）
    for (const key of ["fontFamily", "fontPx", "lineHeight", "letterSpacing", "marginX", "safeBottom"]) {
      expect(src, `共用控件缺少 ${key} 这个参数`).toContain(key)
    }
  })
})
