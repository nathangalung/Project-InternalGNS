import { PASSWORD_RULES } from "./password"

interface PasswordChecklistProps {
  value: string
  /** When true, render the checklist regardless of length. Default: only when value.length > 0. */
  alwaysShow?: boolean
}

export default function PasswordChecklist({ value, alwaysShow = false }: PasswordChecklistProps) {
  if (!alwaysShow && value.length === 0) return null

  const passedCount = PASSWORD_RULES.filter((r) => r.test(value)).length

  return (
    <div className="mt-2.5">
      <div className="mb-2.5 flex gap-1">
        {PASSWORD_RULES.map((_, i) => (
          <div
            key={i}
            className={`h-[3px] flex-1 rounded-full transition-colors duration-200 ${
              i < passedCount ? "bg-[#10B981]" : "bg-dark-200"
            }`}
          />
        ))}
      </div>

      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {PASSWORD_RULES.map((rule) => {
          const ok = rule.test(value)
          return (
            <li
              key={rule.key}
              className={`flex items-center gap-2 text-[12px] font-medium transition-colors duration-150 ${
                ok ? "text-[#047857]" : "text-dark-400"
              }`}
            >
              {ok ? (
                <svg width="12" height="12" viewBox="0 0 14 11" fill="none" className="shrink-0">
                  <path
                    d="M1 5.5L4.5 9L13 1"
                    stroke="#10B981"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none" className="shrink-0">
                  <line
                    x1="3"
                    y1="7"
                    x2="11"
                    y2="7"
                    stroke="#CBD5E1"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              )}
              {rule.label}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
