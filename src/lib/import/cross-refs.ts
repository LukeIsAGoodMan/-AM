import type { LoadedDataset } from "./loader"

// Cross-reference validator — every slug referenced by another file/row
// must resolve to a row defined elsewhere in the dataset.
// Run AFTER per-file Zod validation, BEFORE any DB writes.

export type CrossRefError = {
  path: string // e.g. "data/cards/hsbc-red.yaml::rules[0].sourceSlug"
  message: string
}

export function checkCrossRefs(dataset: LoadedDataset): CrossRefError[] {
  const errors: CrossRefError[] = []

  const issuerSlugs = new Set(dataset.issuers.map((i) => i.slug))
  const currencySlugs = new Set(dataset.currencies.map((c) => c.slug))
  const categorySlugs = new Set(dataset.categories.map((c) => c.slug))

  // All sources and rules live inside card files, but we collect their slugs
  // globally so a rule in card A can reference (e.g.) a campaign in card B.
  const sourceSlugs = new Set<string>()
  const ruleSlugs = new Set<string>()
  const cardSlugs = new Set<string>()
  const campaignSlugs = new Set<string>()

  for (const { data } of dataset.cardFiles) {
    cardSlugs.add(data.card.slug)
    for (const s of data.sources) sourceSlugs.add(s.slug)
    for (const r of data.rules) ruleSlugs.add(r.slug)
  }
  for (const { data } of dataset.campaignFiles) {
    campaignSlugs.add(data.slug)
  }

  // Category self-references (parentSlug)
  for (const cat of dataset.categories) {
    if (cat.parentSlug && !categorySlugs.has(cat.parentSlug)) {
      errors.push({
        path: `categories/base.yaml::${cat.slug}.parentSlug`,
        message: `parentSlug=${cat.parentSlug} not found`,
      })
    }
  }

  for (const { path, data } of dataset.cardFiles) {
    // Card → issuer
    if (!issuerSlugs.has(data.issuerSlug)) {
      errors.push({
        path: `${path}::issuerSlug`,
        message: `issuerSlug=${data.issuerSlug} not found`,
      })
    }

    // Per-card slug uniqueness: source slugs and rule slugs must be unique within the file
    const sourceSlugsInFile = new Set<string>()
    for (const s of data.sources) {
      if (sourceSlugsInFile.has(s.slug)) {
        errors.push({
          path: `${path}::sources[${s.slug}]`,
          message: `duplicate source slug within file`,
        })
      }
      sourceSlugsInFile.add(s.slug)
    }

    const ruleSlugsInFile = new Set<string>()
    for (const r of data.rules) {
      if (ruleSlugsInFile.has(r.slug)) {
        errors.push({
          path: `${path}::rules[${r.slug}]`,
          message: `duplicate rule slug within file`,
        })
      }
      ruleSlugsInFile.add(r.slug)
    }

    // Rules → reference checks
    for (const r of data.rules) {
      const rulePath = `${path}::rules[${r.slug}]`

      if (!sourceSlugsInFile.has(r.sourceSlug)) {
        errors.push({
          path: `${rulePath}.sourceSlug`,
          message: `sourceSlug=${r.sourceSlug} not declared in this card's sources[]`,
        })
      }
      if (!currencySlugs.has(r.rewardCurrencySlug)) {
        errors.push({
          path: `${rulePath}.rewardCurrencySlug`,
          message: `rewardCurrencySlug=${r.rewardCurrencySlug} not found`,
        })
      }
      if (r.categorySlug && !categorySlugs.has(r.categorySlug)) {
        errors.push({
          path: `${rulePath}.categorySlug`,
          message: `categorySlug=${r.categorySlug} not found`,
        })
      }
      if (r.supersedesSlug && !ruleSlugs.has(r.supersedesSlug)) {
        errors.push({
          path: `${rulePath}.supersedesSlug`,
          message: `supersedesSlug=${r.supersedesSlug} not found in any card file`,
        })
      }
      if (r.campaignSlug && !campaignSlugs.has(r.campaignSlug)) {
        errors.push({
          path: `${rulePath}.campaignSlug`,
          message: `campaignSlug=${r.campaignSlug} not found in data/campaigns/`,
        })
      }

      // Rule integrity: exclusion rules must have non-empty appliesTo
      if (r.ruleType === "exclusion") {
        if (!r.appliesTo || r.appliesTo.length === 0) {
          errors.push({
            path: `${rulePath}.appliesTo`,
            message: `exclusion rules must declare appliesTo (the rule_types this exclusion disables)`,
          })
        }
      }

      // Rule integrity: campaign_bonus rules must reference a campaign
      if (r.ruleType === "campaign_bonus" && !r.campaignSlug) {
        errors.push({
          path: `${rulePath}.campaignSlug`,
          message: `campaign_bonus rules must reference a campaignSlug`,
        })
      }

      // Rule integrity: temporal sanity
      if (r.effectiveStart && r.effectiveEnd && r.effectiveEnd < r.effectiveStart) {
        errors.push({
          path: `${rulePath}.effectiveEnd`,
          message: `effectiveEnd (${r.effectiveEnd}) earlier than effectiveStart (${r.effectiveStart})`,
        })
      }

      // PRD §5 principle 1: approved rules need source. Zod can't express the
      // conditional, so check here. (DB also has a CHECK constraint as a safety net.)
      if (r.status === "approved" && !r.sourceSlug) {
        errors.push({
          path: `${rulePath}.sourceSlug`,
          message: `approved rules must reference a source`,
        })
      }
    }

    // Welcome offers: source must be declared in the card's own sources[]
    for (const wo of data.welcomeOffers ?? []) {
      const woPath = `${path}::welcomeOffers[${wo.slug}]`
      if (!sourceSlugsInFile.has(wo.sourceSlug)) {
        errors.push({
          path: `${woPath}.sourceSlug`,
          message: `sourceSlug=${wo.sourceSlug} not declared in this card's sources[]`,
        })
      }
      if (
        wo.effectiveStart &&
        wo.effectiveEnd &&
        wo.effectiveEnd < wo.effectiveStart
      ) {
        errors.push({
          path: `${woPath}.effectiveEnd`,
          message: `effectiveEnd (${wo.effectiveEnd}) earlier than effectiveStart (${wo.effectiveStart})`,
        })
      }
    }
  }

  // Card slug uniqueness across files
  const seenCardSlugs = new Map<string, string>()
  for (const { path, data } of dataset.cardFiles) {
    const prev = seenCardSlugs.get(data.card.slug)
    if (prev) {
      errors.push({
        path: `${path}::card.slug`,
        message: `duplicate card slug ${data.card.slug}; also defined in ${prev}`,
      })
    } else {
      seenCardSlugs.set(data.card.slug, path)
    }
  }

  // Campaigns: issuer + (optional) card + source must resolve; slug unique
  const seenCampaignSlugs = new Map<string, string>()
  for (const { path, data } of dataset.campaignFiles) {
    if (!issuerSlugs.has(data.issuerSlug)) {
      errors.push({
        path: `${path}::issuerSlug`,
        message: `issuerSlug=${data.issuerSlug} not found`,
      })
    }
    if (data.cardSlug && !cardSlugs.has(data.cardSlug)) {
      errors.push({
        path: `${path}::cardSlug`,
        message: `cardSlug=${data.cardSlug} not found`,
      })
    }
    if (data.sourceSlug && !sourceSlugs.has(data.sourceSlug)) {
      errors.push({
        path: `${path}::sourceSlug`,
        message: `sourceSlug=${data.sourceSlug} not found in any card file`,
      })
    }
    if (data.effectiveEnd < data.effectiveStart) {
      errors.push({
        path: `${path}::effectiveEnd`,
        message: `effectiveEnd (${data.effectiveEnd}) earlier than effectiveStart (${data.effectiveStart})`,
      })
    }
    const prev = seenCampaignSlugs.get(data.slug)
    if (prev) {
      errors.push({
        path: `${path}::slug`,
        message: `duplicate campaign slug ${data.slug}; also defined in ${prev}`,
      })
    } else {
      seenCampaignSlugs.set(data.slug, path)
    }
  }

  return errors
}
