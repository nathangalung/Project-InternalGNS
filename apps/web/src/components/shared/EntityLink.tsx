import { Link } from "@tanstack/react-router"
import type { KeyboardEvent, MouseEvent, ReactNode } from "react"
import { useMe } from "@/features/auth/hooks"
import { type EntityKind, entityTarget } from "@/lib/entity-link"
import { ui } from "@/lib/ui"

// Routes keyed by quotation id.
type QuotationKeyedKind = "purchaseOrder" | "invoice"

type Target =
  | { kind: Exclude<EntityKind, QuotationKeyedKind>; id: number | null | undefined }
  // The PO and invoice routes take the quotation id.
  | { kind: QuotationKeyedKind; quotationId: number | null | undefined }

type EntityLinkProps = Target & {
  children: ReactNode
  // doc: document numbers; name: inherited colour.
  tone?: "doc" | "name"
  className?: string
  title?: string
}

// Keeps clickable rows from also firing.
function stopClick(e: MouseEvent) {
  e.stopPropagation()
}

function stopEnter(e: KeyboardEvent) {
  if (e.key === "Enter") e.stopPropagation()
}

// Detail link, or plain text.
//
// Renders a real anchor, so ctrl-click, middle-click and hover preload work.
// Falls back to a span with the same typography when the id is missing or the
// viewer's role cannot open the target route.
export default function EntityLink(props: EntityLinkProps) {
  const { children, tone = "doc", className = "", title } = props
  const { data: me } = useMe()
  const id = "quotationId" in props ? props.quotationId : props.id
  const target = entityTarget(props.kind, id, me?.role)

  if (!target) {
    return (
      <span className={className} title={title}>
        {children}
      </span>
    )
  }

  return (
    <Link
      to={target.to}
      params={target.params}
      title={title}
      className={`${tone === "doc" ? ui.entityLink : ui.entityLinkMuted} ${className}`}
      onClick={stopClick}
      onKeyDown={stopEnter}
    >
      {children}
    </Link>
  )
}
