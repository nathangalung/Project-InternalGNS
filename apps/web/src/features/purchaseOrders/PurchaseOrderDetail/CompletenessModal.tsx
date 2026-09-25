import { Link } from "@tanstack/react-router"
import EntityLink from "@/components/shared/EntityLink"
import Modal from "@/components/shared/Modal"
import { ui } from "@/lib/ui"
import type { CompletenessIssue } from "./helpers"

type CompletenessModalProps = {
  issues: CompletenessIssue[]
  // Route key of the PO edit screen
  quotationId: number
  onClose: () => void
}

const SCOPE: Record<CompletenessIssue["kind"], string> = {
  client: "Klien",
  vendor: "Vendor",
  line: "Pengiriman",
}

// Server-reported gaps before Dalam Progres.
export default function CompletenessModal({
  issues,
  quotationId,
  onClose,
}: CompletenessModalProps) {
  return (
    <Modal
      title="Data Belum Lengkap"
      onClose={onClose}
      footer={
        <button type="button" className={ui.modalSubmit} onClick={onClose}>
          Mengerti
        </button>
      }
    >
      <p className="m-0 text-[13px] leading-[1.5] text-[#4A4455]">
        Sebelum mengubah status menjadi <strong className="text-[#6B21A8]">Dalam Progres</strong>,
        data berikut harus dilengkapi terlebih dahulu. Buka nama klien atau vendor, atau baris
        pengiriman untuk mengubah PO, lalu lengkapi datanya.
      </p>

      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {issues.map((issue) => (
          <li
            key={`${issue.kind}-${issue.id}`}
            className="rounded-md border border-accent-200 bg-accent-100 px-3.5 py-3"
          >
            <div className="mb-1 text-[13px] font-bold text-accent-900">
              {SCOPE[issue.kind]}:{" "}
              {issue.kind === "line" ? (
                <Link
                  to="/purchase-orders/$id/edit"
                  params={{ id: String(quotationId) }}
                  className={`${ui.entityLink} font-bold`}
                >
                  {issue.name ?? "Ubah PO"}
                </Link>
              ) : (
                <EntityLink kind={issue.kind} id={issue.id} className="font-bold">
                  {issue.name ?? `#${issue.id}`}
                </EntityLink>
              )}
            </div>
            {issue.missing.length > 0 ? (
              <ul className="m-0 list-disc pl-5 text-xs leading-[1.6] text-accent-900">
                {issue.missing.map((field) => (
                  <li key={field}>{field}</li>
                ))}
              </ul>
            ) : (
              <p className="m-0 text-xs leading-[1.6] text-accent-900">{issue.message}</p>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  )
}
