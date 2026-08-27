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

const SCREENSHOT_STYLE_THOUGHT_DUMP = [
  "I'm currently focused on defining the project scope, prioritizing the objective: refining the novel snippet to align with the \"去 AI 味\" skill's instructions. The crucial requirement is to modify the text, producing solely the revised narrative without any extraneous explanations.",
  "",
  "**Examining the Narrative Details**",
  "",
  "I'm now diving deep into analyzing the source text, identifying critical plot points and stylistic nuances. I'm preserving the dark fantasy setting while pinpointing the \"爽文打脸\" elements I need to tone down.",
  "",
  "**Analyzing the Conflict's Dynamics**",
  "",
  "I've been mapping out the escalating conflict within the narrative's framework and checking the characters' power dynamics.",
  "",
  "**Detailing the Confrontation**",
  "",
  "I'm now detailing the confrontation and ensuring that the revised output contains no extraneous explanation.",
].join("\n")

describe("isThoughtDumpText", () => {
  it("recognizes Gemini thought-summary dumps", () => {
    expect(isThoughtDumpText(GEMINI_THOUGHT_DUMP)).toBe(true)
  })

  it("recognizes an unlabelled first-person Gemini dump that quotes a few Chinese terms", () => {
    expect(isThoughtDumpText(SCREENSHOT_STYLE_THOUGHT_DUMP)).toBe(true)
  })

  it("keeps recognizing legacy unlabelled planning prefixes", () => {
    for (const dump of [
      "I need to analyze the source text and return only the revised chapter.",
      "I'll review the narrative constraints before producing the final chapter.",
      "Let me examine the source text and rewrite the dialogue.",
    ]) {
      expect(isThoughtDumpText(dump)).toBe(true)
      expect(stripThoughtDumpFromText(dump)).toBe("")
    }
  })

  it("does not discard an unfinished thought fragment before its SSE continuation arrives", () => {
    expect(isThoughtDumpText("I'm currently focused on defining the project scope, prioritizing ")).toBe(false)
  })

  it("does not treat Chinese chapter text as a dump", () => {
    expect(isThoughtDumpText("雨还在下。黑水巷7号的铁门没有关严。")).toBe(false)
  })

  it("does not treat ordinary English prose without dump headers as a dump", () => {
    expect(isThoughtDumpText("It was a dark and stormy night.\n\nThe detective walked into the alley.")).toBe(false)
  })

  it("does not treat ordinary first-person English prose as a dump", () => {
    const prose = [
      "I'm currently focused on the road ahead, where the storm has swallowed every landmark.",
      "",
      "I've been mapping out each turn since dawn, but the river keeps erasing my tracks.",
    ].join("\n")

    expect(isThoughtDumpText(prose)).toBe(false)
    expect(stripThoughtDumpFromText(prose)).toBe(prose)
  })

  it("does not treat ordinary English story headings as thought headers", () => {
    const prose = [
      "**Chapter One**",
      "",
      "It was a dark and stormy night.",
      "",
      "**A Narrow Escape**",
      "",
      "The detective crossed the alley before the gate closed.",
    ].join("\n")

    expect(isThoughtDumpText(prose)).toBe(false)
    expect(stripThoughtDumpFromText(prose)).toBe(prose)
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

  it("returns empty for a screenshot-style payload containing only thoughts", () => {
    expect(stripThoughtDumpFromText(SCREENSHOT_STYLE_THOUGHT_DUMP)).toBe("")
  })

  it("keeps Chinese body after a screenshot-style thought dump", () => {
    const body = [
      "地下暗轨深处，空气沉得像一汪死水。",
      "",
      "叶刃停在防爆门前，指节轻敲门框。",
    ].join("\n")

    expect(stripThoughtDumpFromText(`${SCREENSHOT_STYLE_THOUGHT_DUMP}\n\n${body}`)).toBe(body)
  })

  it("keeps whole-dump detection and stripping consistent", () => {
    for (const dump of [GEMINI_THOUGHT_DUMP, SCREENSHOT_STYLE_THOUGHT_DUMP]) {
      expect(isThoughtDumpText(dump)).toBe(true)
      expect(stripThoughtDumpFromText(dump)).toBe("")
    }
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

  it("strips an unlabelled first-person dump glued to Chinese by line breaks", () => {
    const glued = [
      "I'm currently focused on analyzing the source text and refining the chapter output.",
      "**Examining the Narrative Details**",
      "I'm now reviewing the narrative constraints and character conflict.",
      "雨还在下。叶刃把伞骨收紧。",
    ].join("\n")

    expect(stripThoughtDumpFromText(glued)).toBe("雨还在下。叶刃把伞骨收紧。")
  })

  it("keeps a Chinese chapter that uses bold emphasis", () => {
    const chapter = "**夜雨**\n\n他走进巷子，没有回头。"
    expect(stripThoughtDumpFromText(chapter)).toBe(chapter)
  })
})
