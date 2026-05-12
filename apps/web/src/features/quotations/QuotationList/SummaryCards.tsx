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
    <div className="summary-cards">
      <div className="card-violet">
        <div className="card-label">Total Quotation</div>
        <div className="card-value">{formatNumber(total)}</div>
      </div>
      <div className="card-gold">
        <div
          className="card-overlay"
          style={{
            background:
              "linear-gradient(82.48deg, rgba(217,119,6,.5) 6.42%, rgba(245,158,11,.1) 93.58%)",
            opacity: 0.5,
          }}
        />
        <div className="card-label">Draf</div>
        <div className="card-value">{formatNumber(draft)}</div>
      </div>
      <div className="card-blue">
        <div
          className="card-overlay"
          style={{
            background: "linear-gradient(82.48deg, rgba(63,86,255,.5) 6.42%, #DBEAFE 93.58%)",
            opacity: 0.5,
          }}
        />
        <div className="card-label">Dikirim</div>
        <div className="card-value">{formatNumber(sent)}</div>
      </div>
      <div className="card-green">
        <div className="card-glow" style={{ background: "rgba(52,211,153,.2)" }} />
        <div className="card-label">Disetujui</div>
        <div className="card-value">{formatNumber(accepted)}</div>
      </div>
      <div className="card-red">
        <div className="card-glow" style={{ background: "rgba(239,94,94,.3)" }} />
        <div className="card-label">Ditolak</div>
        <div className="card-value">{formatNumber(rejected)}</div>
      </div>
    </div>
  )
}
