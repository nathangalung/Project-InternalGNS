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
    <div style={{ marginTop: "10px", fontFamily: "'Inter', sans-serif" }}>
      <div
        style={{
          display: "flex",
          gap: "4px",
          marginBottom: "10px",
        }}
      >
        {PASSWORD_RULES.map((_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: "3px",
              borderRadius: "999px",
              background: i < passedCount ? "#10B981" : "#E2E8F0",
              transition: "background 0.2s",
            }}
          />
        ))}
      </div>

      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: "6px",
        }}
      >
        {PASSWORD_RULES.map((rule) => {
          const ok = rule.test(value)
          return (
            <li
              key={rule.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "12px",
                fontWeight: 500,
                color: ok ? "#047857" : "#94A3B8",
                transition: "color 0.15s",
              }}
            >
              {ok ? (
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 14 11"
                  fill="none"
                  style={{ flexShrink: 0 }}
                >
                  <path
                    d="M1 5.5L4.5 9L13 1"
                    stroke="#10B981"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 14 14"
                  fill="none"
                  style={{ flexShrink: 0 }}
                >
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
