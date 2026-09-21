import { describe, it, expect } from "vitest"
import { transformWikilinks } from "./wikilink-transform"

describe("transformWikilinks", () => {
  it("returns input unchanged when there are no wikilinks", () => {
    expect(transformWikilinks("just plain text")).toBe("just plain text")
    expect(transformWikilinks("# Heading\n\nparagraph")).toBe("# Heading\n\nparagraph")
  })

  it("converts a bare [[slug]] to a standard markdown link", () => {
    expect(transformWikilinks("see [[foo]] for details")).toBe(
      "see [foo](#foo) for details",
    )
  })

  it("uses the alias as label and target as href for [[slug|alias]]", () => {
    expect(transformWikilinks("see [[foo|the foo page]]")).toBe(
      "see [the foo page](#foo)",
    )
  })

  it("trims whitespace inside the wikilink", () => {
    expect(transformWikilinks("[[ foo | the alias ]]")).toBe(
      "[the alias](#foo)",
    )
  })

  it("converts multiple wikilinks on the same line", () => {
    expect(transformWikilinks("[[a]] and [[b|B]] and [[c]]")).toBe(
      "[a](#a) and [B](#b) and [c](#c)",
    )
  })

  it("encodes special characters in the href", () => {
    expect(transformWikilinks("[[hello world]]")).toBe(
      "[hello world](#hello%20world)",
    )
  })

  it("does not touch wikilinks inside fenced code blocks", () => {
    const input = "before [[a]]\n```md\ncode [[b]] block\n```\nafter [[c]]"
    expect(transformWikilinks(input)).toBe(
      "before [a](#a)\n```md\ncode [[b]] block\n```\nafter [c](#c)",
    )
  })

  it("does not touch wikilinks inside inline code spans", () => {
    expect(transformWikilinks("text `[[skip]]` and [[keep]]")).toBe(
      "text `[[skip]]` and [keep](#keep)",
    )
  })

  it("handles multiple inline-code spans correctly", () => {
    expect(transformWikilinks("[[a]] `[[b]]` [[c]] `[[d]]` [[e]]")).toBe(
      "[a](#a) `[[b]]` [c](#c) `[[d]]` [e](#e)",
    )
  })

  it("preserves [[empty alias|]] by falling back to target as label", () => {
    expect(transformWikilinks("[[foo|]]")).toBe("[foo](#foo)")
  })

  it("matches the real DPAO body wikilink density", () => {
    const input =
      "DPAOs differ from [[paos|Polyphosphate-Accumulating Organisms (PAOs)]] " +
      "and store [[pha|polyhydroxyalkanoates (PHAs)]] from [[vfa|volatile fatty acids (VFAs)]]. " +
      "[[accumulibacter]] is the most-characterized genus."
    const out = transformWikilinks(input)
    expect(out).toContain("[Polyphosphate-Accumulating Organisms (PAOs)](#paos)")
    expect(out).toContain("[polyhydroxyalkanoates (PHAs)](#pha)")
    expect(out).toContain("[volatile fatty acids (VFAs)](#vfa)")
    expect(out).toContain("[accumulibacter](#accumulibacter)")
    expect(out).not.toContain("[[")
  })

  it("does not mangle existing standard markdown links", () => {
    const input = "see [foo](https://example.com) and [[bar]]"
    expect(transformWikilinks(input)).toBe(
      "see [foo](https://example.com) and [bar](#bar)",
    )
  })

  it("leaves dangling brackets untouched", () => {
    expect(transformWikilinks("[[broken")).toBe("[[broken")
    expect(transformWikilinks("broken]]")).toBe("broken]]")
  })
})
