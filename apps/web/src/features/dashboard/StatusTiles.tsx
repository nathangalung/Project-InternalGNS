import { useId } from "react"
import StatCard from "@/components/shared/StatCard"
import { formatNumber } from "@/lib/format"
import type { DashboardStatusCount } from "@/types/api"

type StatusTilesProps = {
  title: string
  items: DashboardStatusCount[] | undefined
  // Tiles held while loading
  slots: number
}

// One tile per status.
//
// Order and labels come from the API, so a new status needs no web change.
// Until the summary arrives, slots blank tiles hold the grid's height, so
// the chart below does not jump when the counts land.
// Below 360px one column keeps the longest label (Kedaluwarsa) whole.
export default function StatusTiles({ title, items, slots }: StatusTilesProps) {
  const headingId = useId()
  if (items && items.length === 0) return null
  const count = items?.length ?? slots
  const cols =
    count > 5
      ? "min-[360px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7"
      : "min-[360px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-base font-semibold text-dark-900">
        {title}
      </h2>
      <div className={`grid grid-cols-1 gap-4 ${cols}`}>
        {items
          ? items.map((s) => (
              <StatCard key={s.status} label={s.label} value={formatNumber(s.count)} />
            ))
          : Array.from({ length: slots }, (_, i) => <StatCard key={i} label="&nbsp;" value="–" />)}
      </div>
    </section>
  )
}
