import { describe, it, expect } from "vitest"
import { extractPdf } from "@/lib/import/extract/pdf"

describe("extractPdf", () => {
  it("invalid PDF bytes → ok:false with error message", async () => {
    const garbage = Buffer.from("this is not a pdf", "utf8")
    const r = await extractPdf(garbage)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.method).toBe("pdf-parse")
      expect(r.error).toBeTruthy()
    }
  })

  it("non-existent file path → ok:false", async () => {
    const r = await extractPdf("/tmp/does-not-exist-am-test.pdf")
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBeTruthy()
    }
  })

  // Happy path tested via extract:sources against a real bank PDF (M8.8 /
  // ongoing M9 source ingestion). Mocking pdf-parse's internals adds no
  // confidence here — the library either parses real PDFs correctly or
  // doesn't, and we'll find out when we point it at one.
})
