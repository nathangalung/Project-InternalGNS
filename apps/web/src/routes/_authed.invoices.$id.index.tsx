import { createFileRoute } from "@tanstack/react-router"
import LoadingState from "@/components/shared/LoadingState"
import NotFoundState from "@/components/shared/NotFoundState"
import { useInvoice, useInvoiceByQuotation } from "@/features/invoices/hooks"
import InvoiceDetail from "@/features/invoices/InvoiceDetail"

// Positive integer or nothing.
function positiveInt(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : v
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : undefined
}

type InvoiceSearch = {
  // A specific invoice of this quotation
  invoiceId?: number
}

// $id is the quotation id. It names the newest invoice, the Pengganti when
// one exists; ?invoiceId reaches an older, cancelled one.
export const Route = createFileRoute("/_authed/invoices/$id/")({
  validateSearch: (search: Record<string, unknown>): InvoiceSearch => {
    const invoiceId = positiveInt(search.invoiceId)
    return invoiceId ? { invoiceId } : {}
  },
  component: InvoiceDetailRoute,
})

function InvoiceDetailRoute() {
  const { id } = Route.useParams()
  const { invoiceId } = Route.useSearch()
  const quotationId = positiveInt(id)

  // Invoices API only, so finance can open it.
  const newest = useInvoiceByQuotation(invoiceId ? undefined : quotationId)
  const exact = useInvoice(quotationId ? invoiceId : undefined)
  const query = invoiceId ? exact : newest

  if (quotationId && query.isPending) return <LoadingState label="Memuat data invoice…" />

  const inv = query.data
  if (!inv || inv.quotationId !== quotationId) {
    return (
      <NotFoundState
        title="Invoice tidak ditemukan"
        size="page"
        backTo={{ to: "/invoices", label: "Kembali ke Daftar Invoice" }}
      />
    )
  }

  return <InvoiceDetail key={inv.id} inv={inv} />
}
