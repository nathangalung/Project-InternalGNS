import EntityLink from "@/components/shared/EntityLink"
import { useQuotationRevisions } from "@/features/quotations/hooks"
import { formatNumber as formatRp } from "@/lib/format"
import { quotationStatusLabel } from "../status"
import { qd, qe, timelineAction, timelineDate, timelineDot } from "../wizard-styles"

type RevisionHistoryCardProps = {
  quotationId: number
}

// Revision chain, other versions linked.
//
// The server walks the parent_id chain; the open version is marked and
// stays plain text.
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
                  Versi {rev.version} ·{" "}
                  {isCurrent ? (
                    `${rev.quotationNo} (versi ini)`
                  ) : (
                    <EntityLink kind="quotation" id={rev.id}>
                      {rev.quotationNo}
                    </EntityLink>
                  )}
                </span>
                <span className={timelineAction(isCurrent)}>
                  {quotationStatusLabel(rev.status)} · Rp {formatRp(Number(rev.grandTotal))}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
