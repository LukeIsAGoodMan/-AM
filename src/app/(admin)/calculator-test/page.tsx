import { PageHeader } from "@/components/ui/page-header"
import { loadCalculatorTestData } from "@/lib/queries/calculator-test"
import { CalculatorTestClient } from "./CalculatorTestClient"

export const dynamic = "force-dynamic" // YAML import + reload → instant feedback

export default async function CalculatorTestPage() {
  const data = await loadCalculatorTestData()

  return (
    <div>
      <PageHeader
        title="Calculator test"
        subtitle={
          <>
            <strong>{data.cards.length}</strong> active cards ·{" "}
            <strong>
              {data.cards.reduce((sum, c) => sum + c.rules.length, 0)}
            </strong>{" "}
            approved rules · <strong>{data.categories.length}</strong> categories
            · <strong>{data.campaigns.length}</strong> active campaigns
          </>
        }
      />
      <CalculatorTestClient data={data} />
    </div>
  )
}
