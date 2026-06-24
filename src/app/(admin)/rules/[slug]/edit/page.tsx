import { notFound } from "next/navigation"
import { getRuleDetail } from "@/lib/queries/rules"
import { loadRuleEditLookups } from "@/lib/queries/edit-lookups"
import { PageHeader } from "@/components/ui/page-header"
import { EditRuleForm } from "./EditRuleForm"

export const dynamic = "force-dynamic"

export default async function EditRulePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const detail = await getRuleDetail(slug)
  if (!detail) notFound()

  const lookups = await loadRuleEditLookups(detail.card.slug)

  return (
    <div className="pb-12">
      <PageHeader
        title={`Edit — ${detail.rule.ruleName}`}
        subtitle={
          <>
            <span className="font-mono text-xs text-neutral-500">
              {detail.rule.slug}
            </span>{" "}
            · <span className="text-neutral-600">{detail.card.cardNameEn}</span>
          </>
        }
      />
      <div className="px-6 pt-4">
        <EditRuleForm
          rule={{
            ruleSlug: detail.rule.slug,
            ruleName: detail.rule.ruleName,
            status: detail.rule.status as "draft" | "approved" | "archived",
            ruleType: detail.rule.ruleType,
            rewardFormulaPayloadJson: JSON.stringify(
              detail.rule.rewardFormulaPayload,
              null,
              2,
            ),
            rewardCurrencySlug: detail.rewardCurrency?.slug ?? null,
            categorySlug: detail.category?.slug ?? null,
            campaignSlug: detail.campaign?.slug ?? null,
            sourceSlug: detail.source?.slug ?? null,
            isOnline: detail.rule.isOnline,
            isOverseas: detail.rule.isOverseas,
            isForeignCurrency: detail.rule.isForeignCurrency,
            requiresActivation: detail.rule.requiresActivation,
            requiresRegistration: detail.rule.requiresRegistration,
            requiresSelectedCategory: detail.rule.requiresSelectedCategory,
            capAmountHkd: detail.rule.capAmountHkd,
            capRewardAmount: detail.rule.capRewardAmount,
            capPeriod: detail.rule.capPeriod,
            capBasis: detail.rule.capBasis,
            appliesTo: detail.rule.appliesTo,
            stackingPolicy: detail.rule.stackingPolicy as
              | "additive"
              | "max_only_in_group"
              | "replaces_base",
            exclusiveGroup: detail.rule.exclusiveGroup,
            priority: detail.rule.priority,
            effectiveStart: detail.rule.effectiveStart,
            effectiveEnd: detail.rule.effectiveEnd,
            confidenceScore: Number(detail.rule.confidenceScore),
            notes: detail.rule.notes,
          }}
          lookups={lookups}
        />
      </div>
    </div>
  )
}
