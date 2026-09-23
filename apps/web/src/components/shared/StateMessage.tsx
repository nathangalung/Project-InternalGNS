import type { ReactNode } from "react"

type StateMessageProps = {
  title: string
  children?: ReactNode
  action?: ReactNode
  // Full-page states get more height.
  size?: "page" | "section"
}

// Centered status block for routes.
export default function StateMessage({
  title,
  children,
  action,
  size = "section",
}: StateMessageProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 p-8 text-center text-[#4A4455] ${
        size === "page" ? "min-h-[60vh]" : "min-h-[40vh]"
      }`}
    >
      <h2 className="text-lg font-bold text-dark-900">{title}</h2>
      {children && <div className="max-w-[520px] text-sm">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
