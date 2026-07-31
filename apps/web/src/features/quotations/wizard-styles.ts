// Tailwind ports of the legacy qe-*/qep-*/qd-timeline-* classes used by the
// quotation wizard and detail screens. Values reproduce admin.css exactly.

export const qe = {
  headerSection: "flex w-full items-center justify-between",
  headerLeft: "flex flex-col gap-3",
  titleRow: "flex items-center gap-5",
  title: "text-2xl font-bold leading-8 tracking-tight text-dark-900",
  headerActions: "flex items-center gap-4",

  stepper: "flex w-full items-start",
  stepSlot: "flex flex-col items-center gap-2",
  stepConnector: "mt-5 h-0.5 flex-1 bg-[rgba(203,213,225,0.3)]",

  stepContent: "flex w-full flex-col gap-8",
  sectionHeader: "flex items-end justify-between",
  sectionTitle: "text-base font-bold leading-6 tracking-tight text-dark-900",
  sectionDesc: "mt-1 text-sm leading-5 text-dark-600",
  addBtn:
    "inline-flex items-center gap-2 rounded-lg border border-[rgba(124,58,237,0.2)] bg-white px-6 py-3 text-sm font-semibold text-primary-700 transition-colors duration-150 hover:bg-primary-50",
}

const stepPillBase =
  "flex h-10 w-[162px] items-center justify-center rounded-lg transition-all duration-300"

export function stepPill(active: boolean): string {
  return active
    ? `${stepPillBase} bg-primary-700 opacity-100 shadow-[0px_10px_15px_-3px_rgba(109,40,217,0.2),0px_4px_6px_-4px_rgba(109,40,217,0.2)]`
    : `${stepPillBase} bg-dark-200 opacity-50`
}

export function stepNum(active: boolean): string {
  return active ? "text-sm font-bold text-white" : "text-sm font-bold text-dark-600"
}

export function stepLabel(active: boolean): string {
  return active
    ? "text-caption font-bold uppercase tracking-[1px] text-primary-700"
    : "text-caption font-normal uppercase tracking-[1px] text-dark-600"
}

export const qep = {
  card: "flex flex-col gap-4 rounded-xl border border-dark-200 bg-white p-5 transition-[transform,box-shadow,border-color] duration-200 hover:border-dark-300 hover:shadow-[0_4px_6px_-1px_rgba(0,0,0,0.08)]",
  cardHeader: "flex items-start justify-between",
  cardMeta: "flex flex-col gap-0.5",
  cardLabel: "text-caption font-semibold uppercase tracking-[0.05em] text-dark-500",
  cardName: "text-base font-bold tracking-tight text-[#111827]",
  cardCode: "text-caption font-semibold uppercase tracking-[0.05em] text-dark-500",
  cardBody: "flex gap-6",
  col: "flex min-w-0 flex-1 flex-col gap-3",
  field: "flex flex-col gap-1.5",
  fieldLabel: "text-overline font-bold uppercase tracking-[0.06em] text-dark-500",
  fieldInput:
    "flex items-center gap-1 rounded-md bg-[#F8F9FA] px-4 py-2.5 text-caption font-bold leading-4 text-dark-900",
  rp: "mr-0.5 text-dark-500",
  profitPct: "font-bold text-primary-600",

  summaryCard: "flex flex-col gap-5 rounded-[24px] bg-dark-100 p-8",
  summaryTitle: "text-base font-bold leading-6 tracking-tight text-dark-900",
  summaryRow: "flex flex-col gap-1",
  summaryLabel: "text-overline font-bold uppercase tracking-[0.06em] text-dark-500",
  summaryValue: "text-base font-bold leading-6 tracking-tight text-dark-900",
  summaryValueGrand: "text-xl font-bold leading-6 tracking-tight text-primary-700",
}

// Detail-screen timeline (legacy qd-history-card / qd-timeline-*).
export const qd = {
  historyCard: "rounded-md border border-dark-100 bg-[rgba(242,244,246,0.5)] p-8",
  timeline:
    "relative flex flex-col gap-8 pl-10 before:absolute before:bottom-2 before:left-[11px] before:top-2 before:w-0.5 before:bg-dark-200 before:content-['']",
  timelineItem: "relative flex flex-col gap-1",
}

const timelineDotBase = "absolute -left-10 top-1 h-6 w-6 rounded-full"

export function timelineDot(active: boolean): string {
  return active
    ? `${timelineDotBase} border-[4px] border-primary-600 bg-primary-700`
    : `${timelineDotBase} border-[6px] border-dark-200 bg-white`
}

export function timelineDate(active: boolean): string {
  const base = "text-overline font-bold uppercase tracking-[0.06em]"
  return active ? `${base} text-primary-700` : `${base} text-[#4A4455]`
}

export function timelineAction(bold: boolean): string {
  return bold ? "text-sm font-bold text-dark-900" : "text-sm font-semibold text-dark-900"
}
