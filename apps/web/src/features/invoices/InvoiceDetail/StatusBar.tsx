import { Link } from "@tanstack/react-router"
import { useId } from "react"
import { formatDateTime } from "@/lib/format"
import { ui } from "@/lib/ui"
import type { InvoiceDetail } from "@/types/api"
import type { InvoiceDisplayStatus } from "../types"
import { INVOICE_LABEL, INVOICE_STATUS_STYLE } from "../types"
import { cancelReason, type InvoiceAction, type InvoiceActionKind } from "./helpers"

type StatusBarProps = {
  inv: InvoiceDetail
  status: InvoiceDisplayStatus
  actions: InvoiceAction[]
  busy: boolean
  onAction: (kind: InvoiceActionKind | "replace") => void
}

// One line on the current state.
function describe(inv: InvoiceDetail, status: InvoiceDisplayStatus): string {
  if (inv.status === "paid") {
    return inv.paidAt ? `Dibayar pada ${formatDateTime(inv.paidAt)}.` : "Invoice sudah dibayar."
  }
  if (inv.status === "cancelled") {
    const reason = cancelReason(inv)
    return reason ? `Dibatalkan. Alasan: ${reason}` : "Invoice ini sudah dibatalkan."
  }
  if (status === "TERLAMBAT") {
    return "Terlambat ditentukan otomatis dari tanggal jatuh tempo."
  }
  return "Ubah status invoice sesuai dengan kondisi aktual."
}

// Status, offered steps, Pengganti links.
//
// The buttons come from the server's allowedTransitions, so only moves the
// database accepts are offered and Terlambat is never one of them.
export default function StatusBar({ inv, status, actions, busy, onAction }: StatusBarProps) {
  const titleId = useId()
  const badge = INVOICE_STATUS_STYLE[status]
  const quotationId = String(inv.quotationId)
  return (
    <section className={ui.statusBar} aria-labelledby={titleId}>
      <div className="min-w-0">
        <h2 id={titleId} className="text-sm font-bold text-dark-900">
          Status Invoice
        </h2>
        <p className="mt-0.5 text-caption text-[#4A4455] [overflow-wrap:anywhere]">
          {describe(inv, status)}
        </p>
        {inv.replacesInvoiceId && (
          <p className="mt-1 text-caption text-[#4A4455]">
            Menggantikan{" "}
            <Link
              to="/invoices/$id"
              params={{ id: quotationId }}
              search={{ invoiceId: inv.replacesInvoiceId }}
              className={ui.entityLink}
            >
              {inv.replacesInvoiceNo ?? "invoice sebelumnya"}
            </Link>
          </p>
        )}
        {inv.replacedByInvoiceId && (
          <p className="mt-1 text-caption text-[#4A4455]">
            Diganti oleh{" "}
            <Link
              to="/invoices/$id"
              params={{ id: quotationId }}
              search={{ invoiceId: inv.replacedByInvoiceId }}
              className={ui.entityLink}
            >
              invoice pengganti
            </Link>
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`${ui.statusTrigger} cursor-default justify-center whitespace-nowrap`}
          style={{ background: badge.bg, color: badge.color }}
        >
          {INVOICE_LABEL[status]}
        </span>
        {actions.map((a) => (
          <button
            key={a.kind}
            type="button"
            className={a.kind === "cancel" ? ui.btnOutline : ui.btnPrimary}
            onClick={() => onAction(a.kind)}
            disabled={busy}
          >
            {a.label}
          </button>
        ))}
        {inv.canReplace && (
          <button
            type="button"
            className={ui.btnPrimary}
            onClick={() => onAction("replace")}
            disabled={busy}
          >
            Terbitkan Pengganti
          </button>
        )}
      </div>
    </section>
  )
}
