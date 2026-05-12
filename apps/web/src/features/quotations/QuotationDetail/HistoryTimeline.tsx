interface HistoryEntry {
  date: string
  action: string
}

interface HistoryTimelineProps {
  history: HistoryEntry[]
}

// Status change timeline view.
export default function HistoryTimeline({ history }: HistoryTimelineProps) {
  return (
    <div>
      <h2 className="qe-section-title" style={{ marginBottom: "12px" }}>
        Riwayat Penawaran
      </h2>
      <div className="qd-history-card">
        <div className="qd-timeline">
          {history.map((item, i) => {
            const isLast = i === history.length - 1
            return (
              <div key={i} className="qd-timeline-item">
                <div className={`qd-timeline-dot${isLast ? " qd-timeline-dot--active" : ""}`} />
                <span className={`qd-timeline-date${isLast ? " qd-timeline-date--active" : ""}`}>
                  {item.date}
                </span>
                <span className={`qd-timeline-action${isLast ? " qd-timeline-action--bold" : ""}`}>
                  {item.action}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
