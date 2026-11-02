/**
 * 条款正文的块级类型。
 *
 * 为什么单独一个类型文件、而不是直接用 `legal-content.ts` 里推论出来的类型：
 * `legal-content.ts` 是生成产物，每次重新生成都是一个巨大的字面量数组，
 * TypeScript 会把它推断成极深的字面量类型，编译开销很大，而且客户端组件
 * 也不该依赖生成产物的内部形状。这里给一个稳定的公共契约，两边解耦。
 */

export type LegalBlock =
  | { type: "h1"; text: string }
  | { type: "h2"; id: string; text: string }
  | { type: "h3"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string }
  | { type: "list"; items: string[] }
  | { type: "table"; head: string[]; body: string[][] }
