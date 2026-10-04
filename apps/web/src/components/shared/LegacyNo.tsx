import { ui } from "@/lib/ui"

type LegacyNoProps = {
  value?: string
  // Meta separator after it
  separated?: boolean
}

// Old number, muted, in meta.
//
// A re-imported document's number as first issued; nothing for an
// app-created document.
export default function LegacyNo({ value, separated = true }: LegacyNoProps) {
  if (!value) return null
  return (
    <>
      <span className="text-sm font-normal text-dark-500 [overflow-wrap:anywhere]">
        No. lama: {value}
      </span>
      {separated && (
        <span className={ui.metaSep} aria-hidden="true">
          |
        </span>
      )}
    </>
  )
}
