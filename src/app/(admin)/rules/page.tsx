import { listRules } from "@/lib/queries/rules"
import { PageHeader } from "@/components/ui/page-header"
import { RulesTable } from "./RulesTable"

export const dynamic = "force-dynamic"

export default async function RulesPage() {
  const rows = await listRules()
  const approved = rows.filter((r) => r.status === "approved").length
  const archived = rows.filter((r) => r.status === "archived").length
  const customNote = rows.filter(
    (r) => r.status === "approved" && r.rewardFormulaType === "custom_note",
  ).length
  const customNotePct = approved === 0 ? 0 : (customNote / approved) * 100

  return (
    <div>
      <PageHeader
        title="Reward rules"
        subtitle={
          <>
            <strong>{rows.length}</strong> total · <strong>{approved}</strong>{" "}
            approved · {archived} archived · custom_note{" "}
            <strong>{customNotePct.toFixed(1)}%</strong>{" "}
            <span className="text-neutral-400">(target &lt; 10%)</span>
          </>
        }
      />
      <RulesTable rows={rows} />
    </div>
  )
}
