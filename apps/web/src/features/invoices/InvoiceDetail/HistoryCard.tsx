import HistoryTimeline from "@/components/shared/HistoryTimeline"
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
    <HistoryTimeline
      title="Riwayat Status"
      entries={items.map((item) => ({
        key: item.id,
        date: formatDateTime(item.changedAt),
        action: item.action,
        extra: (
          <>
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
          </>
        ),
      }))}
    />
  )
}
