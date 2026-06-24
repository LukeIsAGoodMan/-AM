import { notFound } from "next/navigation"
import { getSourceDetail } from "@/lib/queries/sources"
import { PageHeader } from "@/components/ui/page-header"
import { EditSourceForm } from "./EditSourceForm"

export const dynamic = "force-dynamic"

export default async function EditSourcePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const detail = await getSourceDetail(slug)
  if (!detail) notFound()

  const { source } = detail

  return (
    <div className="pb-12">
      <PageHeader
        title={`Edit — ${source.title}`}
        subtitle={
          <span className="font-mono text-xs text-neutral-500">
            {source.slug}
          </span>
        }
      />
      <div className="px-6 pt-4">
        <EditSourceForm
          source={{
            sourceSlug: source.slug,
            title: source.title,
            sourceType: source.sourceType,
            sourcePriority: source.sourcePriority,
            url: source.url,
            language: source.language,
            status: source.status,
            notes: source.notes,
          }}
        />
      </div>
    </div>
  )
}
