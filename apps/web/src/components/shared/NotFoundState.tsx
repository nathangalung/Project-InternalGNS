import { Link } from "@tanstack/react-router"
import { ui } from "@/lib/ui"
import StateMessage from "./StateMessage"

// Back link targets.
export type BackPath =
  | "/"
  | "/clients"
  | "/vendors"
  | "/products"
  | "/quotations"
  | "/purchase-orders"
  | "/invoices"
  | "/users"

type NotFoundStateProps = {
  // e.g. "Klien tidak ditemukan"
  title: string
  description?: string
  backTo?: { to: BackPath; label: string }
  size?: "page" | "section"
}

// Missing record or page.
export default function NotFoundState({
  title,
  description = "Data mungkin sudah dihapus atau tautannya salah.",
  backTo,
  size,
}: NotFoundStateProps) {
  return (
    <StateMessage
      title={title}
      size={size}
      action={
        backTo && (
          <Link to={backTo.to} className={`${ui.btnPrimary} no-underline`}>
            {backTo.label}
          </Link>
        )
      }
    >
      {description}
    </StateMessage>
  )
}
