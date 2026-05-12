import { useQuotationRevisions } from "@/features/quotations/hooks"
import { formatNumber as formatRp } from "@/lib/format"

interface RevisionHistoryCardProps {
  quotationId: number
}

// Walks the parent_id chain and lists every sibling revision.
export default function RevisionHistoryCard({ quotationId }: RevisionHistoryCardProps) {
  const { data } = useQuotationRevisions(quotationId)
  if (!data || data.length <= 1) return null

  return (
    <div>
      <h2 className="qe-section-title" style={{ marginBottom: "12px" }}>
        Riwayat Revisi
      </h2>
      <div className="qd-history-card">
        <div className="qd-timeline">
          {data.map((rev) => {
            const isCurrent = rev.id === quotationId
            return (
              <div key={rev.id} className="qd-timeline-item">
                <div className={`qd-timeline-dot${isCurrent ? " qd-timeline-dot--active" : ""}`} />
                <span className={`qd-timeline-date${isCurrent ? " qd-timeline-date--active" : ""}`}>
                  v{rev.version} · {rev.quotationNo}
                </span>
                <span
                  className={`qd-timeline-action${isCurrent ? " qd-timeline-action--bold" : ""}`}
                >
                  {rev.status} · Rp {formatRp(Number(rev.grandTotal))}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
