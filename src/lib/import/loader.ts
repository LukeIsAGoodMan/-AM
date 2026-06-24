import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { parse as parseYaml } from "yaml"
import {
  CampaignFileSchema,
  CardFileSchema,
  CategoryFileSchema,
  IssuerFileSchema,
  RewardCurrencyFileSchema,
  type CampaignFile,
  type CardFile,
  type IssuerFile,
} from "./schemas"

// Loads all YAML files under data/ and Zod-validates each. No DB access.
// Throws on the first schema failure with the file path attached.

const DATA_ROOT = "data"

export type LoadedDataset = {
  issuers: IssuerFile[]
  currencies: ReturnType<typeof loadCurrencies>
  categories: ReturnType<typeof loadCategories>
  cardFiles: { path: string; data: CardFile }[]
  campaignFiles: { path: string; data: CampaignFile }[]
}

export function loadAll(rootDir = DATA_ROOT): LoadedDataset {
  return {
    issuers: loadIssuers(rootDir),
    currencies: loadCurrencies(rootDir),
    categories: loadCategories(rootDir),
    cardFiles: loadCardFiles(rootDir),
    campaignFiles: loadCampaignFiles(rootDir),
  }
}

function loadIssuers(rootDir: string): IssuerFile[] {
  const dir = join(rootDir, "issuers")
  if (!existsSync(dir)) return []
  const out: IssuerFile[] = []
  for (const f of yamlFiles(dir)) {
    const raw = parseFile(join(dir, f))
    out.push(parseWith(IssuerFileSchema, raw, join(dir, f)))
  }
  return out
}

function loadCurrencies(rootDir: string) {
  const path = join(rootDir, "reward_currencies", "base.yaml")
  if (!existsSync(path)) return []
  const raw = parseFile(path)
  return parseWith(RewardCurrencyFileSchema, raw, path).currencies
}

function loadCategories(rootDir: string) {
  const path = join(rootDir, "categories", "base.yaml")
  if (!existsSync(path)) return []
  const raw = parseFile(path)
  return parseWith(CategoryFileSchema, raw, path).categories
}

function loadCardFiles(rootDir: string): { path: string; data: CardFile }[] {
  const dir = join(rootDir, "cards")
  if (!existsSync(dir)) return []
  const out: { path: string; data: CardFile }[] = []
  for (const f of yamlFiles(dir)) {
    const path = join(dir, f)
    const raw = parseFile(path)
    out.push({ path, data: parseWith(CardFileSchema, raw, path) })
  }
  return out
}

function loadCampaignFiles(
  rootDir: string,
): { path: string; data: CampaignFile }[] {
  const dir = join(rootDir, "campaigns")
  if (!existsSync(dir)) return []
  const out: { path: string; data: CampaignFile }[] = []
  for (const f of yamlFiles(dir)) {
    const path = join(dir, f)
    const raw = parseFile(path)
    out.push({ path, data: parseWith(CampaignFileSchema, raw, path) })
  }
  return out
}

function yamlFiles(dir: string): string[] {
  return readdirSync(dir).filter(
    (f) => f.endsWith(".yaml") || f.endsWith(".yml"),
  )
}

function parseFile(path: string): unknown {
  const text = readFileSync(path, "utf8")
  try {
    return parseYaml(text)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`YAML parse error in ${path}: ${msg}`)
  }
}

function parseWith<T>(
  schema: { safeParse: (raw: unknown) => { success: boolean; data?: T; error?: { issues: { path: (string | number)[]; message: string }[] } } },
  raw: unknown,
  path: string,
): T {
  const result = schema.safeParse(raw)
  if (!result.success) {
    const lines = result.error?.issues.map((i) => {
      const where = i.path.length === 0 ? "(root)" : i.path.join(".")
      return `  - ${where}: ${i.message}`
    }) ?? []
    throw new Error(`Zod validation failed for ${path}:\n${lines.join("\n")}`)
  }
  return result.data as T
}
