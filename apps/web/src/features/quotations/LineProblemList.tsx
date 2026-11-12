import { entityLink } from "@/lib/ui"
import { describeLine, type LineProblem } from "./lines"

type LineProblemListProps = {
  lines: LineProblem[]
  // Opens the line to fix
  onOpen?: (line: LineProblem) => void
  // Button text per line
  action?: string
  // Lines named before counting
  limit?: number
}

// Named list of short lines
export default function LineProblemList({
  lines,
  onOpen,
  action = "Lengkapi",
  limit = 5,
}: LineProblemListProps) {
  const shown = lines.slice(0, limit)
  const rest = lines.length - shown.length
  return (
    <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
      {shown.map((line) => (
        <li key={line.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
          <span>{describeLine(line)}</span>
          {onOpen && (
            <button
              type="button"
              onClick={() => onOpen(line)}
              aria-label={`${action} produk ${line.position}`}
              className={`cursor-pointer border-0 bg-transparent p-0 text-sm font-semibold ${entityLink()}`}
            >
              {action}
            </button>
          )}
        </li>
      ))}
      {rest > 0 && <li className="text-sm">dan {rest} produk lainnya.</li>}
    </ul>
  )
}
