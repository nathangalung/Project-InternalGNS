import SummaryCard from "@/components/shared/SummaryCard"
import { useQuotationStats } from "@/features/quotations/hooks"
import { formatNumber } from "@/lib/format"
import type { CanonicalStatus } from "@/types/api"

function pickCount(
  rows: { status: CanonicalStatus; count: number }[] | undefined,
  status: CanonicalStatus,
): number {
  return rows?.find((r) => r.status === status)?.count ?? 0
}

// Five colored stat tiles.
export default function SummaryCards() {
  const { data } = useQuotationStats()
  const total = data ? data.reduce((s, r) => s + r.count, 0) : 0
  const draft = pickCount(data, "draft")
  const sent = pickCount(data, "sent")
  const accepted = pickCount(data, "accepted")
  const rejected = pickCount(data, "rejected") + pickCount(data, "expired")

  return (
    <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
      <SummaryCard variant="violet" label="Total Quotation" value={formatNumber(total)} />
      <SummaryCard variant="gold" label="Draf" value={formatNumber(draft)} />
      <SummaryCard variant="blue" label="Dikirim" value={formatNumber(sent)} />
      <SummaryCard variant="green" label="Disetujui" value={formatNumber(accepted)} />
      <SummaryCard variant="red" label="Ditolak" value={formatNumber(rejected)} />
    </div>
  )
}
