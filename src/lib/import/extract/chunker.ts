// Split extracted text into ~500-token chunks for future RAG indexing.
// "Token" here is approximated as 4 chars (a common heuristic for English;
// shorter for CJK). The chunker prefers paragraph breaks, falls back to
// sentence boundaries, and only mid-sentence when nothing else fits.
//
// No embedding happens here. Phase 2 adds `embedding vector(1536)` to the
// source_chunks table and a separate embed-and-store pass.

const TARGET_TOKENS = 500
const APPROX_CHARS_PER_TOKEN = 4
const TARGET_CHARS = TARGET_TOKENS * APPROX_CHARS_PER_TOKEN // 2000
const MAX_CHARS = Math.floor(TARGET_CHARS * 1.3) // 2600 hard ceiling

export type Chunk = {
  index: number
  text: string
  charCount: number
  approxTokenCount: number
}

export function chunkText(text: string): Chunk[] {
  if (!text || text.trim().length === 0) return []

  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim().length > 0)

  const chunks: string[] = []
  let buf = ""

  for (const para of paragraphs) {
    if (para.length > MAX_CHARS) {
      // Single paragraph too large — flush buf, then split this paragraph
      // by sentences (or hard slice as last resort).
      if (buf) {
        chunks.push(buf)
        buf = ""
      }
      for (const piece of splitOversizedParagraph(para)) chunks.push(piece)
      continue
    }
    if (buf.length + para.length + 2 > TARGET_CHARS && buf.length > 0) {
      chunks.push(buf)
      buf = para
    } else {
      buf = buf ? `${buf}\n\n${para}` : para
    }
  }
  if (buf) chunks.push(buf)

  return chunks.map((text, index) => ({
    index,
    text,
    charCount: text.length,
    approxTokenCount: Math.ceil(text.length / APPROX_CHARS_PER_TOKEN),
  }))
}

function splitOversizedParagraph(para: string): string[] {
  // Split on sentence terminators first.
  const sentences = para.split(/(?<=[.!?。！？])\s+/)
  const pieces: string[] = []
  let buf = ""
  for (const s of sentences) {
    if (s.length > MAX_CHARS) {
      if (buf) {
        pieces.push(buf)
        buf = ""
      }
      // Hard slice — last resort, no natural boundary found.
      for (let i = 0; i < s.length; i += TARGET_CHARS) {
        pieces.push(s.slice(i, i + TARGET_CHARS))
      }
      continue
    }
    if (buf.length + s.length + 1 > TARGET_CHARS && buf.length > 0) {
      pieces.push(buf)
      buf = s
    } else {
      buf = buf ? `${buf} ${s}` : s
    }
  }
  if (buf) pieces.push(buf)
  return pieces
}
