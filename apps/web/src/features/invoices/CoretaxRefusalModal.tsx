import EntityLink from "@/components/shared/EntityLink"
import Modal from "@/components/shared/Modal"
import { ui } from "@/lib/ui"
import type { CoretaxRefusal, CoretaxRefusalReason } from "@/types/api"

type CoretaxRefusalModalProps = {
  refused: CoretaxRefusal[]
  onClose: () => void
}

// Reason heading and fix
const REASONS: { reason: CoretaxRefusalReason; title: string; fix: string }[] = [
  {
    reason: "npwp_missing",
    title: "NPWP Pembeli Belum Ada",
    fix: "Lengkapi NPWP di data klien, lalu batalkan invoice dan terbitkan Pengganti.",
  },
  {
    reason: "tku_mismatch",
    title: "NPWP Klien Berubah",
    fix: "ID TKU klien tidak cocok dengan NPWP di invoice. Batalkan invoice, lalu terbitkan Pengganti.",
  },
  {
    reason: "paid",
    title: "Invoice Sudah Lunas",
    fix: "Invoice lunas tidak bisa diubah lagi. Pilih periode ekspor yang tidak memuatnya.",
  },
]

// Refused invoices by reason
export default function CoretaxRefusalModal({ refused, onClose }: CoretaxRefusalModalProps) {
  return (
    <Modal
      title="Ekspor Coretax Ditolak"
      onClose={onClose}
      footer={
        <button type="button" className={ui.modalSubmit} onClick={onClose}>
          Mengerti
        </button>
      }
    >
      <p className="m-0 text-[13px] leading-[1.5] text-[#4A4455]">
        {refused.length} invoice belum bisa diekspor ke Coretax. Buka invoice atau kliennya untuk
        memperbaiki.
      </p>
      {REASONS.map(({ reason, title, fix }) => {
        const rows = refused.filter((r) => r.reason === reason)
        if (rows.length === 0) return null
        return (
          <section
            key={reason}
            className="rounded-md border border-accent-200 bg-accent-100 px-3.5 py-3"
          >
            <h3 className="m-0 text-[13px] font-bold text-accent-900">{title}</h3>
            <p className="m-0 mt-1 text-xs leading-[1.6] text-accent-900">{fix}</p>
            <ul className="m-0 mt-2 list-disc pl-5 text-xs leading-[1.8] text-accent-900">
              {rows.map((r) => (
                <li key={r.invoiceId}>
                  <EntityLink kind="invoice" quotationId={r.quotationId}>
                    {r.invoiceNo}
                  </EntityLink>
                  {", "}
                  {reason === "npwp_missing" ? (
                    <EntityLink kind="client" id={r.clientId}>
                      {r.clientName}
                    </EntityLink>
                  ) : (
                    r.clientName
                  )}
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </Modal>
  )
}
