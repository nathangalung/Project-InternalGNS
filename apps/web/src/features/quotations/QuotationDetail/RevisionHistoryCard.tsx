import { useQuotationRevisions } from "@/features/quotations/hooks"
import { formatNumber as formatRp } from "@/lib/format"
import { qd, qe, timelineAction, timelineDate, timelineDot } from "../wizard-styles"

interface RevisionHistoryCardProps {
  quotationId: number
}

// Walks the parent_id chain and lists every sibling revision.
export default function RevisionHistoryCard({ quotationId }: RevisionHistoryCardProps) {
  const { data } = useQuotationRevisions(quotationId)
  if (!data || data.length <= 1) return null

  return (
    <div>
      <h2 className={`${qe.sectionTitle} mb-3`}>Riwayat Revisi</h2>
      <div className={qd.historyCard}>
        <div className={qd.timeline}>
          {data.map((rev) => {
            const isCurrent = rev.id === quotationId
            return (
              <div key={rev.id} className={qd.timelineItem}>
                <div className={timelineDot(isCurrent)} />
                <span className={timelineDate(isCurrent)}>
                  v{rev.version} · {rev.quotationNo}
                </span>
                <span className={timelineAction(isCurrent)}>
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
