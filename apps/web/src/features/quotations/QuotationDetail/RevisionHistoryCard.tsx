import EntityLink from "@/components/shared/EntityLink"
import HistoryTimeline from "@/components/shared/HistoryTimeline"
import { useQuotationRevisions } from "@/features/quotations/hooks"
import { formatNumber as formatRp } from "@/lib/format"
import { quotationStatusLabel } from "../status"

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
    <HistoryTimeline
      title="Riwayat Revisi"
      entries={data.map((rev) => {
        const isCurrent = rev.id === quotationId
        return {
          key: rev.id,
          active: isCurrent,
          date: (
            <>
              Versi {rev.version} ·{" "}
              {isCurrent ? (
                `${rev.quotationNo} (versi ini)`
              ) : (
                <EntityLink kind="quotation" id={rev.id}>
                  {rev.quotationNo}
                </EntityLink>
              )}
            </>
          ),
          action: `${quotationStatusLabel(rev.status)} · Rp ${formatRp(Number(rev.grandTotal))}`,
        }
      })}
    />
  )
}
