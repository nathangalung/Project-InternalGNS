import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useId,
  useMemo,
  useRef,
  useState,
} from "react"

const W = 1000
const H = 300
const PAD = { top: 24, right: 32, bottom: 40, left: 70 }

const LINE_COLOR = "#7C3AED"
const DASHED_COLOR = "#94A3B8"

export const CHART_MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MEI",
  "JUN",
  "JUL",
  "AGS",
  "SEP",
  "OKT",
  "NOV",
  "DES",
]

function defaultComputeMax(values: number[]): number {
  const m = Math.max(...values, 0)
  if (m <= 10) return 10
  const step = 10 ** Math.floor(Math.log10(m))
  return Math.ceil(m / step) * step
}

type TrendChartProps = {
  series: Record<string, number[]>
  activeKey: string
  comparisonKey?: string
  monthLabels?: string[]
  formatValue?: (v: number) => string
  formatAxisTick?: (v: number) => string
  computeMax?: (values: number[]) => number
}

export default function TrendChart({
  series,
  activeKey,
  comparisonKey,
  monthLabels = CHART_MONTHS,
  formatValue = (v) => v.toLocaleString("id-ID"),
  formatAxisTick,
  computeMax = defaultComputeMax,
}: TrendChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [focusIdx, setFocusIdx] = useState<number | null>(null)
  const [rovingIdx, setRovingIdx] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const pointRefs = useRef<(SVGGElement | null)[]>([])
  const hintId = useId()

  const activeData = series[activeKey] ?? []
  const comparisonData = comparisonKey ? (series[comparisonKey] ?? []) : []

  const maxVal = useMemo(
    () => computeMax([...activeData, ...comparisonData]),
    [activeData, comparisonData, computeMax],
  )

  const cW = W - PAD.left - PAD.right
  const cH = H - PAD.top - PAD.bottom
  const gx = (i: number) => PAD.left + (i / (monthLabels.length - 1)) * cW
  const gy = (v: number) => PAD.top + cH - (maxVal === 0 ? 0 : (v / maxVal) * cH)
  const makePath = (data: number[]) =>
    data.map((v, i) => `${i === 0 ? "M" : "L"} ${gx(i).toFixed(1)} ${gy(v).toFixed(1)}`).join(" ")
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => maxVal * f)

  // Tooltip index and labels.
  //
  // The pointer wins over keyboard focus, and Escape hides the focus
  // tooltip until the next move. A point's name repeats its tooltip.
  const shownIdx = hoverIdx ?? (dismissed ? null : focusIdx)
  const tabIdx = Math.min(rovingIdx, Math.max(activeData.length - 1, 0))
  const comparisonAt = (i: number) =>
    comparisonKey && comparisonData[i] !== undefined ? formatValue(comparisonData[i]) : undefined
  const pointLabel = (i: number) => {
    const comparison = comparisonAt(i)
    return `${monthLabels[i]}, ${activeKey}: ${formatValue(activeData[i])}${
      comparison !== undefined ? `, ${comparisonKey}: ${comparison}` : ""
    }`
  }

  // Roving focus across points.
  function handlePointKey(e: ReactKeyboardEvent<SVGGElement>, i: number) {
    const last = activeData.length - 1
    const next: Record<string, number> = {
      ArrowRight: Math.min(i + 1, last),
      ArrowDown: Math.min(i + 1, last),
      ArrowLeft: Math.max(i - 1, 0),
      ArrowUp: Math.max(i - 1, 0),
      Home: 0,
      End: last,
    }
    if (e.key === "Escape") {
      if (shownIdx === null) return
      e.preventDefault()
      e.stopPropagation()
      setDismissed(true)
      setHoverIdx(null)
      return
    }
    const target = next[e.key]
    if (target === undefined) return
    e.preventDefault()
    setRovingIdx(target)
    setDismissed(false)
    pointRefs.current[target]?.focus()
  }

  // Hovered month from pointer.
  function handleMouseMove(e: ReactMouseEvent<SVGSVGElement>) {
    const box = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - box.left) / box.width) * W
    const fraction = (x - PAD.left) / cW
    if (fraction < 0 || fraction > 1) {
      setHoverIdx(null)
      return
    }
    const idx = Math.round(fraction * (monthLabels.length - 1))
    setHoverIdx(Math.max(0, Math.min(monthLabels.length - 1, idx)))
  }

  const chartLabel = `Grafik ${activeKey}${comparisonKey ? ` dibanding ${comparisonKey}` : ""} per periode`

  // Positioned for the table.
  //
  // Without a positioned parent the absolute sr-only wrapper escapes main's
  // scroll box and grows the document.
  return (
    <div className="relative">
      {/* biome-ignore lint/a11y/useSemanticElements: an SVG cannot be a fieldset */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full"
        role="group"
        aria-label={chartLabel}
        aria-describedby={hintId}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <desc id={hintId}>
          Tekan panah kiri atau kanan untuk berpindah periode, Home atau End untuk periode pertama
          atau terakhir. Data lengkap ada di tabel setelah grafik.
        </desc>
        {/* biome-ignore lint/a11y/noAriaHiddenOnFocusable: nothing in this group takes focus */}
        <g aria-hidden="true">
          {yTicks.map((tick, i) => (
            <g key={i}>
              <line
                x1={PAD.left}
                y1={gy(tick)}
                x2={W - PAD.right}
                y2={gy(tick)}
                stroke="#F1F5F9"
                strokeWidth="1"
              />
              {i > 0 && (
                <text
                  x={PAD.left - 8}
                  y={gy(tick) + 4}
                  textAnchor="end"
                  fontSize="11"
                  fontWeight="700"
                  fill="#94A3B8"
                >
                  {formatAxisTick ? formatAxisTick(tick) : Math.round(tick).toLocaleString("id-ID")}
                </text>
              )}
            </g>
          ))}

          {monthLabels.map((m, i) => (
            <text
              key={m}
              x={gx(i)}
              y={H - 12}
              textAnchor="middle"
              fontSize="11"
              fontWeight="700"
              fill="#64748B"
            >
              {m}
            </text>
          ))}

          {comparisonData.length > 0 && (
            <path
              d={makePath(comparisonData)}
              fill="none"
              stroke={DASHED_COLOR}
              strokeWidth="2"
              strokeDasharray="6 5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          <path
            d={makePath(activeData)}
            fill="none"
            stroke={LINE_COLOR}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>

        {activeData.map((v, i) => (
          // biome-ignore lint/a11y/noInteractiveElementToNoninteractiveRole: a focusable data point reads as an image
          <g
            key={i}
            ref={(el) => {
              pointRefs.current[i] = el
            }}
            role="img"
            aria-label={pointLabel(i)}
            tabIndex={i === tabIdx ? 0 : -1}
            className="group outline-none"
            pointerEvents="none"
            onFocus={() => {
              setFocusIdx(i)
              setRovingIdx(i)
              setDismissed(false)
            }}
            onBlur={() => setFocusIdx(null)}
            onKeyDown={(e) => handlePointKey(e, i)}
          >
            <circle
              cx={gx(i)}
              cy={gy(v)}
              r={11}
              fill="none"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              className="stroke-primary-600 opacity-0 group-focus-visible:opacity-100"
            />
            <circle cx={gx(i)} cy={gy(v)} r={4} fill={LINE_COLOR} />
          </g>
        ))}

        <rect x={PAD.left} y={PAD.top} width={cW} height={cH} fill="transparent" />

        {shownIdx !== null && activeData[shownIdx] !== undefined && (
          <Tooltip
            monthLabel={monthLabels[shownIdx]}
            activeLabel={activeKey}
            activeValue={formatValue(activeData[shownIdx])}
            comparisonLabel={comparisonKey}
            comparisonValue={comparisonAt(shownIdx)}
            x={gx(shownIdx)}
            y={gy(activeData[shownIdx])}
          />
        )}
      </svg>
      {activeData.length > 0 && (
        // A table ignores sr-only sizing, so a div wraps it.
        <div className="sr-only">
          <table>
            <caption>Data {chartLabel}</caption>
            <thead>
              <tr>
                <th scope="col">Periode</th>
                <th scope="col">{activeKey}</th>
                {comparisonKey && <th scope="col">{comparisonKey}</th>}
              </tr>
            </thead>
            <tbody>
              {activeData.map((v, i) => (
                <tr key={i}>
                  <th scope="row">{monthLabels[i]}</th>
                  <td>{formatValue(v)}</td>
                  {comparisonKey && <td>{comparisonAt(i) ?? "-"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

interface TooltipProps {
  monthLabel: string
  activeLabel: string
  activeValue: string
  comparisonLabel?: string
  comparisonValue?: string
  x: number
  y: number
}

function Tooltip({
  monthLabel,
  activeLabel,
  activeValue,
  comparisonLabel,
  comparisonValue,
  x,
  y,
}: TooltipProps) {
  const padX = 14
  const padY = 12
  const lineGap = 6
  const monthFontSize = 11
  const valueFontSize = 14
  const labelFontSize = 11

  const showComparison = comparisonLabel !== undefined && comparisonValue !== undefined
  const longestText = Math.max(
    monthLabel.length,
    activeLabel.length + activeValue.length,
    showComparison ? (comparisonLabel ?? "").length + (comparisonValue ?? "").length : 0,
  )
  const tooltipW = Math.max(160, longestText * 7 + 60)
  const rowHeight = valueFontSize + lineGap
  const tooltipH = padY * 2 + monthFontSize + lineGap + rowHeight + (showComparison ? rowHeight : 0)

  let tx = x - tooltipW / 2
  let ty = y - tooltipH - 14
  if (tx < PAD.left) tx = PAD.left
  if (tx + tooltipW > W - PAD.right) tx = W - PAD.right - tooltipW
  if (ty < PAD.top) ty = y + 18

  let cursorY = ty + padY + monthFontSize
  const monthY = cursorY
  cursorY += lineGap + valueFontSize
  const activeY = cursorY
  const comparisonY = cursorY + rowHeight

  return (
    // biome-ignore lint/a11y/noAriaHiddenOnFocusable: the tooltip takes no focus
    <g data-slot="chart-tooltip" pointerEvents="none" aria-hidden="true">
      <line
        x1={x}
        y1={PAD.top}
        x2={x}
        y2={PAD.top + (H - PAD.top - PAD.bottom)}
        stroke="#CBD5E1"
        strokeWidth="1"
        strokeDasharray="3 3"
      />
      <circle cx={x} cy={y} r={6} fill="#fff" stroke={LINE_COLOR} strokeWidth="3" />

      <rect
        x={tx}
        y={ty}
        width={tooltipW}
        height={tooltipH}
        rx={8}
        fill="#0F172A"
        stroke="rgba(124, 58, 237, 0.4)"
        strokeWidth="1"
      />
      <text
        x={tx + padX}
        y={monthY}
        fontSize={monthFontSize}
        fontWeight={600}
        fill="#94A3B8"
        letterSpacing="0.5"
      >
        {monthLabel.toUpperCase()}
      </text>
      <text x={tx + padX} y={activeY} fontSize={labelFontSize} fontWeight={500} fill="#A78BFA">
        {activeLabel}
      </text>
      <text
        x={tx + tooltipW - padX}
        y={activeY}
        fontSize={valueFontSize}
        fontWeight={700}
        fill="#fff"
        textAnchor="end"
      >
        {activeValue}
      </text>
      {showComparison && (
        <>
          <text
            x={tx + padX}
            y={comparisonY}
            fontSize={labelFontSize}
            fontWeight={500}
            fill="#94A3B8"
          >
            {comparisonLabel}
          </text>
          <text
            x={tx + tooltipW - padX}
            y={comparisonY}
            fontSize={valueFontSize}
            fontWeight={700}
            fill="#CBD5E1"
            textAnchor="end"
          >
            {comparisonValue}
          </text>
        </>
      )}
    </g>
  )
}
