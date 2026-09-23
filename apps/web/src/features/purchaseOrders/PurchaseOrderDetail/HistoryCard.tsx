import {
  qd,
  qe,
  timelineAction,
  timelineDate,
  timelineDot,
} from "@/features/quotations/wizard-styles"

type HistoryCardProps = {
  entries: { date: string; action: string }[]
  isLoading: boolean
}

// PO status timeline, oldest first.
export default function HistoryCard({ entries, isLoading }: HistoryCardProps) {
  return (
    <div>
      <h2 className={`${qe.sectionTitle} mb-3`}>Riwayat Status</h2>
      <div className={qd.historyCard}>
        {entries.length === 0 ? (
          <p className="m-0 text-sm text-[#4A4455]">
            {isLoading ? "Memuat riwayat…" : "Belum ada riwayat status."}
          </p>
        ) : (
          <ol className={`${qd.timeline} m-0 list-none`}>
            {entries.map((item, i) => {
              const isLast = i === entries.length - 1
              return (
                <li key={`${item.date}-${i}`} className={qd.timelineItem}>
                  <div className={timelineDot(isLast)} />
                  <span className={timelineDate(isLast)}>{item.date}</span>
                  <span className={timelineAction(isLast)}>{item.action}</span>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </div>
  )
}
