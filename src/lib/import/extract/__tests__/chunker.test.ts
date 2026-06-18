import { describe, it, expect } from "vitest"
import { chunkText } from "@/lib/import/extract/chunker"

describe("chunkText", () => {
  it("empty string → 0 chunks", () => {
    expect(chunkText("")).toEqual([])
    expect(chunkText("   ")).toEqual([])
  })

  it("short text → 1 chunk", () => {
    const text = "This is a short T&C with one paragraph only."
    const chunks = chunkText(text)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.text).toBe(text)
    expect(chunks[0]?.index).toBe(0)
  })

  it("multiple short paragraphs roll into one chunk under target", () => {
    const text = ["Para 1.", "Para 2.", "Para 3."].join("\n\n")
    const chunks = chunkText(text)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.text).toContain("Para 1.")
    expect(chunks[0]?.text).toContain("Para 3.")
  })

  it("text over target rolls into multiple chunks at paragraph boundaries", () => {
    // 5 paragraphs of ~600 chars each = 3000 chars total, target 2000.
    const para = "x".repeat(580) + " end."
    const text = Array(5).fill(para).join("\n\n")
    const chunks = chunkText(text)
    expect(chunks.length).toBeGreaterThan(1)
    // Each chunk should be near or below the target ceiling.
    for (const c of chunks) {
      expect(c.charCount).toBeLessThanOrEqual(2600)
    }
    // Total content preserved
    const joined = chunks.map((c) => c.text).join("\n\n")
    expect(joined).toContain("end.")
  })

  it("oversized single paragraph is hard-split", () => {
    const huge = "a".repeat(8000)
    const chunks = chunkText(huge)
    expect(chunks.length).toBeGreaterThan(1)
    const total = chunks.reduce((sum, c) => sum + c.charCount, 0)
    expect(total).toBe(huge.length)
  })

  it("approxTokenCount tracks roughly chars/4", () => {
    const text = "x".repeat(400)
    const chunks = chunkText(text)
    expect(chunks[0]?.approxTokenCount).toBe(100)
  })
})
