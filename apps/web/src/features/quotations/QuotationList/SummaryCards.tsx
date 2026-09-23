import StatCard, { type StatTone } from "@/components/shared/StatCard"
import { useQuotationStats } from "@/features/quotations/hooks"
import { formatNumber } from "@/lib/format"
import { statTiles } from "../status"

// Tile colour per status.
const TONE: Record<string, StatTone> = {
  draft: "gold",
  sent: "blue",
  accepted: "green",
  rejected: "red",
}

// Total and status tiles.
//
// Tiles follow the server's stats array: its order, its labels, zero
// counts included, so a new status shows up without a code change.
export default function SummaryCards() {
  const { data } = useQuotationStats()
  const { total, tiles } = statTiles(data)

  return (
    <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
      <StatCard tone="violet" label="Total Quotation" value={formatNumber(total)} />
      {tiles.map((t) => (
        <StatCard
          key={t.status}
          tone={TONE[t.status] ?? "neutral"}
          label={t.label}
          value={formatNumber(t.count)}
        />
      ))}
    </div>
  )
}
