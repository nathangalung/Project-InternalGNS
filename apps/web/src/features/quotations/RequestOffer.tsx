import type { ReactNode } from "react"

type Side = { kode: string; nama: ReactNode }

type RequestOfferProps = {
  request: Side
  offer: Side
  // Offer is not what was asked
  differs: boolean
  // Tidak Ditawarkan, shown on the offer
  noOffer?: boolean
  // Table cells instead of a card row
  asCells?: boolean
  // Offer cell only, for billing pages
  hideRequest?: boolean
}

const label = "mb-1 text-[10px] font-bold uppercase tracking-[0.6px] text-[#6B7280]"
const value = "text-sm font-semibold text-[#111827]"
const differsCell = "bg-[rgba(245,158,11,0.10)]"
const differsText = "text-[#B45309]"
const chip =
  "ml-2 rounded-[4px] bg-[rgba(245,158,11,0.18)] px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-[#B45309]"
const noOfferChip =
  "mt-1 inline-block rounded-[4px] bg-[#F3F4F6] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.4px] text-[#374151]"

// Code, then the name.
function Line({ side, tone }: { side: Side; tone: string }) {
  return (
    <div className={`${value} ${tone} break-words`}>
      {side.kode && <span className="mr-1.5 font-bold">{side.kode}</span>}
      <span>{side.nama || "-"}</span>
    </div>
  )
}

// Request and offer, side by side.
//
// Both read at the same size in one row, so nobody mistakes which is which;
// an offer that is not what the client asked for turns orange.
export default function RequestOffer({
  request,
  offer,
  differs,
  noOffer = false,
  asCells = false,
  hideRequest = false,
}: RequestOfferProps) {
  const offerTone = differs ? differsText : ""
  const offerBody = (
    <>
      <Line side={offer} tone={offerTone} />
      {noOffer && <span className={noOfferChip}>Tidak Ditawarkan</span>}
    </>
  )
  if (asCells) {
    return (
      <>
        {!hideRequest && (
          <td className="p-5 align-middle">
            <Line side={request} tone="" />
          </td>
        )}
        <td className={`p-5 align-middle ${differs ? differsCell : ""}`}>{offerBody}</td>
      </>
    )
  }
  return (
    <div className="grid grid-cols-2 border-b border-[rgba(204,195,216,0.2)] max-sm:grid-cols-1">
      <div className="px-5 py-3">
        <div className={label}>Permintaan Klien</div>
        <Line side={request} tone="" />
      </div>
      <div className={`px-5 py-3 ${differs ? differsCell : ""}`}>
        <div className={`${label} ${offerTone}`}>
          Penawaran
          {differs && <span className={chip}>Berbeda dari permintaan</span>}
        </div>
        {offerBody}
      </div>
    </div>
  )
}
