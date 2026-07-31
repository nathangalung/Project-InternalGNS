import { qd, qe, timelineAction, timelineDate, timelineDot } from "../wizard-styles"

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
      <h2 className={`${qe.sectionTitle} mb-3`}>Riwayat Penawaran</h2>
      <div className={qd.historyCard}>
        <div className={qd.timeline}>
          {history.map((item, i) => {
            const isLast = i === history.length - 1
            return (
              <div key={i} className={qd.timelineItem}>
                <div className={timelineDot(isLast)} />
                <span className={timelineDate(isLast)}>{item.date}</span>
                <span className={timelineAction(isLast)}>{item.action}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
