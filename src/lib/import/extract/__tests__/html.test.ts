import { describe, it, expect } from "vitest"
import { extractFromHtmlString } from "@/lib/import/extract/html"

describe("extractFromHtmlString", () => {
  it("strips script + style + nav + footer", () => {
    const html = `
      <html><head><title>HSBC Red</title></head>
      <body>
        <nav>Home | Cards | About</nav>
        <script>alert('xss')</script>
        <style>.x { color: red }</style>
        <main>
          <h1>HSBC Red Credit Card</h1>
          <p>4% cashback on online local spending.</p>
          <p>Annual fee: HKD 1,200 (waived first year).</p>
        </main>
        <footer>© HSBC 2026</footer>
      </body></html>`
    const r = extractFromHtmlString(html)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.text).toContain("HSBC Red Credit Card")
      expect(r.text).toContain("4% cashback")
      expect(r.text).toContain("Annual fee")
      expect(r.text).not.toContain("alert")
      expect(r.text).not.toContain("color: red")
      expect(r.text).not.toContain("© HSBC 2026")
      expect(r.text).not.toContain("Home | Cards")
    }
  })

  it("captures title + lang + description in metadata", () => {
    const html = `<html lang="en-HK"><head>
      <title>Citi PremierMiles</title>
      <meta name="description" content="Premier travel rewards card.">
    </head><body><main><p>Earn 1 mile per HK$8.</p></main></body></html>`
    const r = extractFromHtmlString(html)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.metadata.title).toBe("Citi PremierMiles")
      expect(r.metadata.lang).toBe("en-HK")
      expect(r.metadata.description).toBe("Premier travel rewards card.")
    }
  })

  it("falls back to <body> when no <main>/<article>", () => {
    const html = `<html><body>
      <h1>Bare page</h1>
      <p>Content lives directly in body.</p>
    </body></html>`
    const r = extractFromHtmlString(html)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.text).toContain("Bare page")
      expect(r.text).toContain("Content lives")
    }
  })

  it("produces a stable content hash", () => {
    const html = `<html><body><p>same</p></body></html>`
    const a = extractFromHtmlString(html)
    const b = extractFromHtmlString(html)
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(a.contentHash).toBe(b.contentHash)
    }
  })
})
