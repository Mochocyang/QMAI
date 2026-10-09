// @vitest-environment node
/*
 * 「6 个参数 × 6 层读写」这件事实本身没人守 —— 补一层元守卫。
 *
 * ── 为什么需要它 ──
 *
 * 正文字体设置这一组参数（字体/字号/行间距/字间距/左右边距/底部安全距离）
 * 在仓库里有 **6 层**各自按名字手抄了一遍：
 *
 *   1. preview-panel.tsx        现场改值 + 落全套
 *   2. interface-section.tsx    设置页草稿 switch
 *   3. settings-view.tsx        设置页保存
 *   4. project-store.ts         app-state 的 save / load
 *   5. wiki-store.ts            初值 + 6 个 setter
 *   6. App.tsx                  启动读回
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
 * 对上述 6 层逐个断言"6 个字段名一个都不缺"。
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
  { label: "preview-panel：现场改值 + 落全套", file: "src/components/layout/preview-panel.tsx" },
  { label: "interface-section：设置页草稿 switch", file: "src/components/settings/sections/interface-section.tsx" },
  { label: "settings-view：设置页保存", file: "src/components/settings/settings-view.tsx" },
  { label: "project-store：app-state save/load", file: "src/lib/project-store.ts" },
  { label: "wiki-store：初值 + 6 个 setter", file: "src/stores/wiki-store.ts" },
  { label: "App：启动读回", file: "src/App.tsx" },
]

const REPO = resolve(__dirname, "..", "..")
const read = (p: string) => readFileSync(resolve(REPO, p), "utf8").replace(/\r\n/g, "\n")

/** 抽成纯函数，好让反向控制能拿假数据喂它（否则"没报缺"可能只是函数恒返回空）。 */
function missingFields(source: string, fields: readonly string[]): string[] {
  return fields.filter((f) => !source.includes(f))
}

describe("6 参数 × 6 层：枚举不许漏层", () => {
  it.each(LAYERS.map((l) => [l.label, l.file]))("%s 提到了全部 6 个字段", (_label, file) => {
    const missing = missingFields(read(file), STORE_FIELDS)
    expect(
      missing,
      `${file} 缺少这些正文字体字段：${missing.join(", ")}。\n` +
      `新增参数时漏掉一层，症状是"设置页能调、现场不生效"或"重开变回去"，且不会有别的红灯。`,
    ).toEqual([])
  })

  it("层数下限：这个清单本身要覆盖全部 6 层（少了说明有人把层搬走却没更新守卫）", () => {
    // 6 是当前实际层数。若有人把某一层删掉/合并，这个数字要一起改 ——
    // 强制一次"你是真的合并了，还是把守卫绕过去了"的决策。
    expect(LAYERS.length, "登记的层数变了：新增或删除层时请同步更新 LAYERS 与文件头说明").toBe(6)
    expect(STORE_FIELDS.length).toBe(6)
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
