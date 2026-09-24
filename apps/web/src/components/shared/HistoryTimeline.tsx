import type { ReactNode } from "react"

// Timeline class primitives.
export const timeline = {
  card: "rounded-md border border-dark-100 bg-[rgba(242,244,246,0.5)] p-8",
  // Preflight is off, so the list drops its markers here
  list: "relative flex list-none flex-col gap-8 pl-10 before:absolute before:bottom-2 before:left-[11px] before:top-2 before:w-0.5 before:bg-dark-200 before:content-['']",
  item: "relative flex flex-col gap-1",
}

const title = "mb-3 text-base font-bold leading-6 tracking-tight text-dark-900"
const dotBase = "absolute -left-10 top-1 h-6 w-6 rounded-full"

export function timelineDot(active: boolean): string {
  return active
    ? `${dotBase} border-[4px] border-primary-600 bg-primary-700`
    : `${dotBase} border-[6px] border-dark-200 bg-white`
}

export function timelineDate(active: boolean): string {
  const base = "text-overline font-bold uppercase tracking-[0.06em]"
  return active ? `${base} text-primary-700` : `${base} text-[#4A4455]`
}

export function timelineAction(active: boolean): string {
  return active ? "text-sm font-bold text-dark-900" : "text-sm font-semibold text-dark-900"
}

export type TimelineEntry = {
  // Defaults to the position
  key?: string | number
  date: ReactNode
  action: ReactNode
  // Defaults to the last entry
  active?: boolean
  // Lines under the action
  extra?: ReactNode
}

// Highlighted entry, else the newest.
export function isActiveEntry(entry: TimelineEntry, index: number, count: number): boolean {
  return entry.active ?? index === count - 1
}

type HistoryTimelineProps = {
  title: string
  entries: TimelineEntry[]
  // Shown in place of no entries
  empty?: ReactNode
}

// Titled timeline, oldest first.
export default function HistoryTimeline({ title: heading, entries, empty }: HistoryTimelineProps) {
  return (
    <section>
      <h2 className={title}>{heading}</h2>
      <div className={timeline.card}>
        {entries.length === 0 && empty ? (
          <p className="text-sm text-[#4A4455]">{empty}</p>
        ) : (
          <ol className={timeline.list}>
            {entries.map((entry, i) => {
              const active = isActiveEntry(entry, i, entries.length)
              return (
                <li key={entry.key ?? i} className={timeline.item}>
                  <div className={timelineDot(active)} aria-hidden="true" />
                  <span className={timelineDate(active)}>{entry.date}</span>
                  <span className={timelineAction(active)}>{entry.action}</span>
                  {entry.extra}
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </section>
  )
}
