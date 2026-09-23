import {
  qd,
  qe,
  timelineAction,
  timelineDate,
  timelineDot,
} from "@/features/quotations/wizard-styles"
import { formatDateTime } from "@/lib/format"
import { ui } from "@/lib/ui"
import type { HistoryItem } from "./helpers"

type HistoryCardProps = {
  items: HistoryItem[]
  onDownloadProof: () => void
}

// Status timeline, oldest first.
export default function HistoryCard({ items, onDownloadProof }: HistoryCardProps) {
  return (
    <section>
      <h2 className={`${qe.sectionTitle} mb-3`}>Riwayat Status</h2>
      <div className={qd.historyCard}>
        <ol className={`${qd.timeline} list-none`}>
          {items.map((item, i) => {
            const isLast = i === items.length - 1
            return (
              <li key={item.id} className={qd.timelineItem}>
                <div className={timelineDot(isLast)} aria-hidden="true" />
                <span className={timelineDate(isLast)}>{formatDateTime(item.changedAt)}</span>
                <span className={timelineAction(isLast)}>{item.action}</span>
                {item.note && (
                  <span className="text-sm text-[#4A4455] [overflow-wrap:anywhere]">
                    Alasan: {item.note}
                  </span>
                )}
                {item.hasProof && (
                  <button
                    type="button"
                    onClick={onDownloadProof}
                    className={`${ui.entityLink} self-start text-sm font-semibold`}
                  >
                    Unduh bukti pembayaran
                  </button>
                )}
              </li>
            )
          })}
        </ol>
      </div>
    </section>
  )
}
