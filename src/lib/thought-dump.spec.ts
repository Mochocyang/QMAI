import { describe, expect, it } from "vitest"
import {
  isThoughtDumpText,
  stripThoughtDumpFromText,
} from "./thought-dump"

const GEMINI_THOUGHT_DUMP = [
  "**Defining the Request**",
  "",
  "The user wants the full text for Chapter 14, World Truth and Body Forging Limits.",
  "",
  "**Pinpointing Chapter Details**",
  "",
  "I need to keep Black Water Alley, Ye Ren, and Hakimi, and hit the requested word count.",
  "",
  "**Analyzing Chapter Content**",
  "",
  "The setting still has tech decay, lifeform classifications, and the cultivation system.",
  "",
  "**Refining Plot Elements**",
  "",
  "The investigative thread should stay on Jin Yulan and Zhao Chongshan.",
  "",
  "**Detailing Scene Progression**",
  "",
  "The opening scene starts in the rain outside Black Water Alley.",
].join("\n")

describe("isThoughtDumpText", () => {
  it("recognizes Gemini thought-summary dumps", () => {
    expect(isThoughtDumpText(GEMINI_THOUGHT_DUMP)).toBe(true)
  })

  it("does not treat Chinese chapter text as a dump", () => {
    expect(isThoughtDumpText("雨还在下。黑水巷7号的铁门没有关严。")).toBe(false)
  })

  it("does not treat ordinary English prose without dump headers as a dump", () => {
    expect(isThoughtDumpText("It was a dark and stormy night.\n\nThe detective walked into the alley.")).toBe(false)
  })
})

describe("stripThoughtDumpFromText", () => {
  it("drops a leading Gemini thought dump and keeps the Chinese chapter", () => {
    const chapter = [
      GEMINI_THOUGHT_DUMP,
      "",
      "第14章 世界真相与淬体破限",
      "",
      "雨还在下。黑水巷7号的铁门没有关严，门缝里渗出一截湿冷的灯光。",
    ].join("\n")

    expect(stripThoughtDumpFromText(chapter)).toBe([
      "第14章 世界真相与淬体破限",
      "",
      "雨还在下。黑水巷7号的铁门没有关严，门缝里渗出一截湿冷的灯光。",
    ].join("\n"))
  })

  it("returns empty when the whole payload is a thought dump", () => {
    expect(stripThoughtDumpFromText(GEMINI_THOUGHT_DUMP)).toBe("")
  })

  it("strips a dump glued to Chinese without blank-line section breaks", () => {
    const glued = [
      "**Defining the Request**",
      "The user wants the full text for Chapter 14.",
      "**Pinpointing Chapter Details**",
      "I need to keep Ye Ren in Black Water Alley.",
      "雨还在下。叶刃把伞骨收紧。",
    ].join("\n")

    expect(stripThoughtDumpFromText(glued)).toBe("雨还在下。叶刃把伞骨收紧。")
  })

  it("keeps a Chinese chapter that uses bold emphasis", () => {
    const chapter = "**夜雨**\n\n他走进巷子，没有回头。"
    expect(stripThoughtDumpFromText(chapter)).toBe(chapter)
  })
})
