import { timeline } from "@/components/shared/HistoryTimeline"
import { ui } from "@/lib/ui"

// Tailwind ports of the legacy qe-*/qep-* classes used by the quotation
// wizard and detail screens. Values reproduce admin.css exactly.

export const qe = {
  // Wraps below 640px
  headerSection: "flex w-full flex-wrap items-center justify-between gap-4",
  headerLeft: "flex flex-col gap-3",
  titleRow: "flex items-center gap-5",
  title: "text-2xl font-bold leading-8 tracking-tight text-dark-900",
  // Buttons split the row on phones
  headerActions: "flex items-center gap-4 max-sm:w-full max-sm:*:flex-1",
  // Solid brand submit, outline height
  submit: `inline-flex items-center justify-center gap-2 rounded-md border border-transparent bg-primary-700 px-6 py-2 text-sm font-bold text-white shadow-sm transition hover:opacity-90 motion-safe:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${ui.focusRing}`,

  stepper: "flex w-full items-start",
  stepSlot: "flex flex-col items-center gap-2",
  stepConnector: "mt-5 h-0.5 flex-1 bg-[rgba(203,213,225,0.3)]",

  stepContent: "flex w-full flex-col gap-8",
  sectionHeader: "flex flex-wrap items-end justify-between gap-4",
  // Section buttons stack on phones
  sectionActions: "flex flex-wrap items-center gap-2.5 max-sm:w-full max-sm:*:w-full",
  sectionTitle: "text-base font-bold leading-6 tracking-tight text-dark-900",
  sectionDesc: "mt-1 text-sm leading-5 text-dark-600",
  addBtn: `inline-flex items-center gap-2 rounded-lg border border-[rgba(124,58,237,0.2)] bg-white px-6 py-3 text-sm font-semibold text-primary-700 transition-colors duration-150 hover:bg-primary-50 ${ui.focusRing}`,
}

// Pill shrinks to a dot below 640px.
const stepPillBase =
  "flex h-10 w-10 items-center justify-center rounded-lg transition-all duration-300 motion-reduce:transition-none sm:w-[162px]"

export function stepPill(active: boolean): string {
  return active
    ? `${stepPillBase} bg-primary-700 opacity-100 shadow-[0px_10px_15px_-3px_rgba(109,40,217,0.2),0px_4px_6px_-4px_rgba(109,40,217,0.2)]`
    : `${stepPillBase} bg-dark-200 opacity-50`
}

export function stepNum(active: boolean): string {
  return active ? "text-sm font-bold text-white" : "text-sm font-bold text-dark-600"
}

// Only the active label shows on phones.
export function stepLabel(active: boolean): string {
  return active
    ? "text-caption font-bold uppercase tracking-[1px] text-primary-700"
    : "text-caption font-normal uppercase tracking-[1px] text-dark-600 max-sm:hidden"
}

export const qep = {
  card: "flex flex-col gap-4 rounded-xl border border-dark-200 bg-white p-5 transition-[transform,box-shadow,border-color] duration-200 hover:border-dark-300 hover:shadow-[0_4px_6px_-1px_rgba(0,0,0,0.08)]",
  cardHeader: "flex items-start justify-between",
  cardMeta: "flex flex-col gap-0.5",
  cardLabel: "text-caption font-semibold uppercase tracking-[0.05em] text-dark-500",
  cardName: "text-base font-bold tracking-tight text-[#111827]",
  cardCode: "text-caption font-semibold uppercase tracking-[0.05em] text-dark-500",
  cardBody: "flex gap-6 max-sm:flex-col",
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

// Interim aliases for invoices, PO.
//
// Their history cards still import these; each drops them when it moves to
// the shared HistoryTimeline, and the aliases go with the last one.
export {
  timelineAction,
  timelineDate,
  timelineDot,
} from "@/components/shared/HistoryTimeline"
export const qd = {
  historyCard: timeline.card,
  timeline: timeline.list,
  timelineItem: timeline.item,
}
