import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "node:fs"
import { dirname, join } from "node:path"
import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import { execFileSync } from "node:child_process"

// One-off bulk seed from the master xlsx into draft card YAMLs.
//
// Idempotent: any existing YAML file (by absolute path) is left untouched.
// This means hand-authored / hand-promoted cards are never overwritten by
// re-running the script — only NEW xlsx rows produce new files.
//
// Produces:
//   data/issuers/<slug>.yaml           for any issuer not already on disk
//   data/cards/<slug>.yaml             as status='draft' with rules=[] and
//                                       qualitativeFeatures populated from
//                                       Summary + 最佳使用場景
//
// After running this once, `pnpm import:data` loads everything; reviewers
// then upgrade individual draft cards to approved with real rules over time.

const XLSX_PATH =
  "/Users/hq/Library/Mobile Documents/com~apple~CloudDocs/AM/HK_credit_card_master_with_best_use_case.xlsx"
const DATA_DIR = "data"

// Known issuer → slug + Chinese name. Anything not here is slug-only,
// derived from the xlsx Issuer column.
const KNOWN_ISSUERS: Record<string, { slug: string; nameZh?: string }> = {
  HSBC: { slug: "hsbc", nameZh: "滙豐" },
  AEON: { slug: "aeon" },
  "American Express": { slug: "american-express", nameZh: "美國運通" },
  Citibank: { slug: "citi", nameZh: "花旗" },
  Citi: { slug: "citi", nameZh: "花旗" },
  "Standard Chartered": { slug: "standard-chartered", nameZh: "渣打" },
  "Hang Seng": { slug: "hang-seng", nameZh: "恒生" },
  "Bank of China (BOC)": { slug: "boc-hk", nameZh: "中銀香港" },
  CNCBI: { slug: "cncbi", nameZh: "信銀國際" },
  "Dah Sing": { slug: "dah-sing", nameZh: "大新" },
  DBS: { slug: "dbs", nameZh: "星展" },
  PrimeCredit: { slug: "primecredit", nameZh: "安信" },
  "WeLab Bank": { slug: "welab-bank", nameZh: "WeLab" },
  "ZA Bank": { slug: "za-bank" },
  "Livi Bank": { slug: "livi-bank", nameZh: "理慧銀行" },
}

type Row = Record<string, string | number | null>

async function main() {
  const rows = readXlsx(XLSX_PATH)
  console.log(`xlsx rows: ${rows.length}`)

  // Dedup by normalized card name against existing YAMLs so the script
  // doesn't double-create a card we've already hand-curated under a
  // different slug.
  const existingByName = buildExistingNameIndex()
  console.log(`existing curated cards: ${existingByName.size}`)

  const newIssuers = new Map<
    string,
    { slug: string; nameEn: string; nameZh?: string }
  >()
  let cardsWritten = 0
  let cardsSkippedExisting = 0
  let cardsSkippedSlugCollision = 0

  for (const row of rows) {
    const issuerName = String(row["Issuer"] ?? "").trim()
    const cardName = String(row["Card Name"] ?? "").trim()
    if (!issuerName || !cardName) continue

    const issuerInfo = resolveIssuer(issuerName)
    if (!existsSync(issuerPath(issuerInfo.slug))) {
      newIssuers.set(issuerInfo.slug, issuerInfo)
    }

    if (existingByName.has(normalizeName(cardName))) {
      cardsSkippedExisting++
      continue
    }

    const cardSlug = makeCardSlug(issuerInfo.slug, cardName)
    const path = cardPath(cardSlug)
    if (existsSync(path)) {
      cardsSkippedSlugCollision++
      continue
    }

    const file = buildCardFile(issuerInfo.slug, cardSlug, cardName, row)
    writeYaml(path, file)
    cardsWritten++
  }

  for (const i of newIssuers.values()) {
    const p = issuerPath(i.slug)
    writeYaml(p, i)
    console.log(`  + ${p}`)
  }

  console.log("")
  console.log(`Issuers added: ${newIssuers.size}`)
  console.log(`Cards written: ${cardsWritten}`)
  console.log(
    `Cards skipped (already curated under another slug): ${cardsSkippedExisting}`,
  )
  console.log(`Cards skipped (slug already on disk): ${cardsSkippedSlugCollision}`)
}

function buildExistingNameIndex(): Map<string, string> {
  const dir = join(DATA_DIR, "cards")
  if (!existsSync(dir)) return new Map()
  const out = new Map<string, string>()
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".yaml")) continue
    try {
      const raw = parseYaml(readFileSync(join(dir, f), "utf8")) as {
        card?: { cardNameEn?: string }
      }
      const name = raw?.card?.cardNameEn
      if (name) out.set(normalizeName(name), f)
    } catch {
      // ignore malformed YAML — validate:data will catch it
    }
  }
  return out
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function resolveIssuer(name: string): {
  slug: string
  nameEn: string
  nameZh?: string
} {
  const known = KNOWN_ISSUERS[name]
  if (known) return { ...known, nameEn: name }
  return { slug: slugify(name), nameEn: name }
}

function makeCardSlug(issuerSlug: string, cardName: string): string {
  const stripPattern = new RegExp(
    `^(${KNOWN_ISSUERS_NAMES_FOR_STRIP.join("|")})\\s+`,
    "i",
  )
  const trimmed = cardName.replace(stripPattern, "").trim()
  return `${issuerSlug}-${slugify(trimmed)}`
}

const KNOWN_ISSUERS_NAMES_FOR_STRIP = [
  "HSBC",
  "AEON",
  "American Express",
  "Citibank",
  "Citi",
  "Standard Chartered",
  "Hang Seng",
  "Bank of China",
  "BOC",
  "BOCHK",
  "CNCBI",
  "Dah Sing",
  "DBS",
  "PrimeCredit",
  "WeLab Bank",
  "ZA Bank",
  "Livi Bank",
]

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function buildCardFile(
  issuerSlug: string,
  cardSlug: string,
  cardName: string,
  row: Row,
) {
  const annualFee = parseNumber(row["Annual Fee (HKD)"])
  const network = normalizeNetwork(String(row["Network"] ?? ""))
  const cardCategory = String(row["Card Category"] ?? "").trim()
  const baseReward = String(row["Base Reward Structure"] ?? "").trim()
  const specialty = String(row["Specialty"] ?? "").trim()
  const summary = String(row["Summary"] ?? "").trim()
  const bestUseCase = String(row["最佳使用場景"] ?? "").trim()
  const sourceUrl = String(row["Source URL"] ?? "").trim() || undefined

  const welcomeSpend = String(
    row["Spending Requirement (Welcome Offer)"] ?? "",
  ).trim()
  const welcomeType = String(row["Welcome Bonus Type"] ?? "").trim()
  const welcomeValue = String(row["Bonus Value"] ?? "").trim()
  const welcomePeriod = parseNumber(row["Welcome Period (days)"])

  const features: Record<string, unknown> = {}
  if (cardCategory) features.xlsxCategory = cardCategory
  if (specialty) features.xlsxSpecialty = specialty
  if (baseReward) features.xlsxBaseRewardText = baseReward
  if (summary) features.summaryZh = summary
  if (bestUseCase) features.bestUseCaseZh = bestUseCase
  if (welcomeSpend || welcomeType || welcomeValue || welcomePeriod !== undefined) {
    features.welcomeOfferDraft = {
      ...(welcomeSpend && { spendRequirementText: welcomeSpend }),
      ...(welcomeType && { bonusType: welcomeType }),
      ...(welcomeValue && { bonusValueText: welcomeValue }),
      ...(welcomePeriod !== undefined && { periodDays: welcomePeriod }),
    }
  }

  const notes = [
    `Seeded from HK_credit_card_master_with_best_use_case.xlsx on ${new Date().toISOString().slice(0, 10)}.`,
    `Rules NOT modeled — status=draft. Phase 2 LLM extraction + reviewer approval will populate rules.`,
    `Hand-promote to approved by adding rules[] and changing status above.`,
  ].join("\n")

  return {
    issuerSlug,
    card: {
      slug: cardSlug,
      cardNameEn: cardName,
      ...(network && { network }),
      ...(annualFee !== undefined && { annualFeeHkd: annualFee }),
      status: "draft",
      ...(sourceUrl && { officialUrl: sourceUrl }),
      notes,
      qualitativeFeatures: features,
    },
    sources: [],
    rules: [],
  }
}

function parseNumber(v: unknown): number | undefined {
  if (v == null || v === "") return undefined
  if (typeof v === "number") return v
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[, ]/g, ""))
    if (!Number.isNaN(n)) return n
  }
  return undefined
}

function normalizeNetwork(s: string): string | undefined {
  const t = s.trim()
  if (!t) return undefined
  // Pick first if "Visa / Mastercard"
  return t.split(/[\/,]/)[0]?.trim() || undefined
}

function issuerPath(slug: string): string {
  return join(DATA_DIR, "issuers", `${slug}.yaml`)
}

function cardPath(slug: string): string {
  return join(DATA_DIR, "cards", `${slug}.yaml`)
}

function writeYaml(path: string, data: unknown) {
  mkdirSync(dirname(path), { recursive: true })
  const text = stringifyYaml(data, { lineWidth: 100 })
  writeFileSync(path, text, "utf8")
}

function readXlsx(path: string): Row[] {
  // Use the Python sidecar to parse — sticks with the existing openpyxl
  // approach we used to probe the file rather than adding a Node xlsx
  // dep just for one one-off script. Returns JSON via stdout.
  const json = execFileSync(
    "python3",
    [
      "-c",
      `
import openpyxl, json, sys
wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
out = []
for sh in wb.sheetnames:
    ws = wb[sh]
    headers = [c.value for c in ws[1]]
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row[1]: continue
        out.append(dict(zip(headers, row)))
sys.stdout.write(json.dumps(out, ensure_ascii=False, default=str))
`,
      path,
    ],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  )
  return JSON.parse(json) as Row[]
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
