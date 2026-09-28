// Pre-recipe class strings.
//
// Dumped from the string-based ui.ts at 8846416, the last commit before the
// tv() recipes. The recipes must produce exactly these class sets. Since
// then only pill(false) changed, from text-dark-500 (4.34:1 on dark-100)
// to text-dark-600 for 4.5:1 contrast.
export const legacyClasses: Record<string, string> = {
  focusRing:
    "focus-visible:outline-none focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
  focusRingInset:
    "focus-visible:outline-none focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600",
  focusRingDark:
    "focus-visible:outline-none focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 focus-visible:ring-offset-dark-900",
  fieldFocus: "focus:border-primary-600 focus:shadow-[0_0_0_3px_rgba(124,58,237,0.12)]",
  disabledField: "disabled:cursor-not-allowed disabled:bg-[#F7F7F8] disabled:opacity-60",
  pageContent: "flex flex-1 flex-col gap-6 p-[clamp(1rem,4vw,3rem)]",
  pageHeader: "flex items-center justify-between max-sm:flex-col max-sm:items-start max-sm:gap-3",
  pageActions: "flex items-center max-sm:w-full max-sm:flex-wrap gap-3",
  pageActionsTight: "flex items-center max-sm:w-full max-sm:flex-wrap gap-2.5",
  pageTitle: "text-3xl font-bold tracking-tight text-dark-900",
  panel: "rounded-lg border border-dark-200 bg-white p-6 shadow-sm",
  sectionTitle: "text-xl font-semibold text-dark-900",
  btnPrimary:
    "inline-flex items-center justify-center gap-2 rounded-md border py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white border-transparent bg-origin-border bg-[linear-gradient(135deg,var(--color-primary-700)_0%,var(--color-primary-600)_100%)] px-6 font-bold text-white shadow-sm hover:opacity-90 motion-safe:active:scale-[0.98]",
  btnOutline:
    "inline-flex items-center justify-center gap-2 rounded-md border py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white border-primary-700/20 bg-white px-6 font-bold text-primary-700 hover:bg-primary-50",
  iconAction:
    "inline-flex items-center rounded-sm p-1 text-primary-600 transition hover:bg-primary-700/[0.08] focus-visible:outline-none focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
  entityLink:
    "rounded-sm text-primary-700 underline decoration-primary-700/30 underline-offset-2 transition-colors hover:text-primary-800 hover:decoration-primary-800 focus-visible:outline-none focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
  entityLinkMuted:
    "rounded-sm text-inherit no-underline underline-offset-2 transition-colors hover:text-primary-700 hover:underline focus-visible:outline-none focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
  selectBtn:
    "flex w-full items-center justify-between rounded-md border-[1.5px] border-transparent bg-dark-200 px-4 py-3 font-sans text-sm font-normal text-dark-900 outline-none transition-[border-color] duration-200 focus:border-primary-600 focus:shadow-[0_0_0_3px_rgba(124,58,237,0.12)] disabled:cursor-not-allowed disabled:bg-[#F7F7F8] disabled:opacity-60",
  prefixWrap:
    "flex h-11 overflow-hidden rounded-md border-[1.5px] border-transparent bg-dark-200 transition focus-within:border-primary-600 focus-within:shadow-[0_0_0_3px_rgba(124,58,237,0.12)]",
  prefixLabel:
    "flex items-center whitespace-nowrap border-r border-dark-300 px-3 text-sm font-medium text-dark-600",
  prefixInput:
    "min-w-0 flex-1 border-0 bg-transparent px-3 font-sans text-sm text-dark-900 outline-none placeholder:text-dark-500 disabled:cursor-not-allowed disabled:bg-[#F7F7F8] disabled:opacity-60",
  tableWrap: "overflow-x-auto rounded-md bg-white",
  theadRow: "bg-dark-100",
  thCenter:
    "px-5 py-4 text-center align-middle text-overline font-bold uppercase tracking-[0.05em] whitespace-nowrap text-[#4A4455]",
  tr: "border-t border-dark-200 transition hover:bg-primary-50",
  td: "p-5 align-middle text-sm text-[#4A4455]",
  tdCenter: "p-5 text-center align-middle text-sm text-[#4A4455]",
  searchInput:
    "w-full rounded-md border border-[rgba(204,195,216,0.2)] bg-white py-[13px] pl-12 pr-4 text-sm text-dark-900 outline-none transition placeholder:text-dark-500 focus:border-primary-600",
  modalSection: "flex flex-col gap-6",
  modalSectionHeading:
    "border-b border-[rgba(203,213,225,0.2)] pb-2 text-overline font-bold uppercase tracking-[0.06em] text-primary-600",
  field: "flex flex-col gap-2",
  fieldLabel: "text-sm font-semibold leading-5 text-dark-900",
  fieldInput:
    "w-full rounded-md border-[1.5px] border-transparent bg-dark-200 px-4 py-3 text-sm text-dark-900 outline-none transition focus:border-primary-600 focus:shadow-[0_0_0_3px_rgba(124,58,237,0.12)]",
  row2: "grid grid-cols-1 gap-6 sm:grid-cols-2",
  modalCancel:
    "inline-flex items-center justify-center gap-2 rounded-md px-8 py-3 text-sm font-bold transition focus-visible:outline-none focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white text-dark-600 hover:bg-dark-100",
  modalSubmit:
    "inline-flex items-center justify-center gap-2 rounded-md px-8 py-3 text-sm font-bold transition focus-visible:outline-none focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white bg-[linear-gradient(135deg,var(--color-primary-700)_0%,var(--color-primary-600)_100%)] text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
  breadcrumb: "flex items-center gap-2",
  breadcrumbLink:
    "cursor-pointer rounded-sm text-overline font-bold uppercase tracking-[0.12em] text-[#4A4455] transition hover:text-primary-700 focus-visible:outline-none focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
  breadcrumbSep: "text-overline font-bold uppercase text-dark-300",
  breadcrumbCurrent: "text-overline font-bold uppercase tracking-[0.12em] text-primary-700",
  detailHeader: "flex items-start justify-between gap-4 max-sm:flex-col max-sm:gap-3",
  detailHeaderLeft: "flex min-w-0 items-start gap-3",
  detailActions: "flex flex-shrink-0 items-center gap-3 pt-8 max-sm:flex-wrap max-sm:pt-0",
  detailTitle: "text-3xl font-bold leading-9 tracking-tight text-dark-900 [overflow-wrap:anywhere]",
  metaRow: "mt-2 flex flex-wrap items-center gap-3",
  metaText: "text-sm font-medium text-[#4A4455]",
  metaSep: "text-base text-dark-300",
  statusBar:
    "flex items-center justify-between rounded-md bg-[#F2F4F6] px-6 py-5 max-sm:flex-col max-sm:items-start max-sm:gap-4 max-sm:*:flex-wrap",
  statusTrigger:
    "inline-flex min-w-[162px] items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-bold focus-visible:outline-none focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
  statusDropdown:
    "absolute left-0 top-[calc(100%+8px)] w-[162px] rounded-md border border-[rgba(204,195,216,0.2)] bg-white py-2 shadow-[0_0_0_1px_rgba(0,0,0,0.05)]",
  statusOption:
    "flex h-8 w-full items-center justify-between px-5 py-1 text-left transition hover:bg-dark-100 focus-visible:outline-none focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600",
  dropdownPanel:
    "absolute top-[calc(100%+4px)] right-0 left-0 z-50 flex flex-col rounded-md border border-[rgba(204,195,216,0.2)] bg-white py-2 [box-shadow:0_4px_12px_rgba(0,0,0,0.08)]",
  dropdownPanelCompact:
    "absolute top-[calc(100%+4px)] right-0 left-0 z-50 flex flex-col rounded-md border border-[rgba(204,195,216,0.4)] bg-white py-1 [box-shadow:0_4px_12px_rgba(0,0,0,0.08)]",
  dropdownItem:
    "flex w-full cursor-pointer items-center justify-between gap-3 border-none bg-transparent px-5 py-2.5 text-left focus-visible:outline-none focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600",
  "pill(true)":
    "whitespace-nowrap rounded-full border px-3 py-1 text-caption font-medium transition focus-visible:outline-none focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white border-primary-600 bg-primary-600 text-white hover:bg-primary-700",
  "pill(false)":
    "whitespace-nowrap rounded-full border px-3 py-1 text-caption font-medium transition focus-visible:outline-none focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white border-dark-200 bg-dark-100 text-dark-600 hover:bg-dark-200",
  "chip(true)":
    "rounded-[999px] px-[18px] py-2 cursor-pointer font-[Inter,sans-serif] text-[13px] transition-all duration-150 ease-[ease] focus-visible:outline-none focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white border-[1.5px] border-primary-700 bg-[rgba(99,14,212,0.06)] font-semibold text-primary-700",
  "chip(false)":
    "rounded-[999px] px-[18px] py-2 cursor-pointer font-[Inter,sans-serif] text-[13px] transition-all duration-150 ease-[ease] focus-visible:outline-none focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white border border-[#E5E7EB] bg-white font-medium text-[#4A4455]",
  "presetChip(true)":
    "flex items-center justify-between rounded-md px-3.5 py-2.5 cursor-pointer font-[Inter,sans-serif] text-[13px] transition-all duration-150 ease-[ease] focus-visible:outline-none focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white border-[1.5px] border-primary-700 bg-[rgba(99,14,212,0.06)] font-semibold text-primary-700",
  "presetChip(false)":
    "flex items-center justify-between rounded-md px-3.5 py-2.5 cursor-pointer font-[Inter,sans-serif] text-[13px] transition-all duration-150 ease-[ease] focus-visible:outline-none focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white border border-[#E5E7EB] bg-white font-medium text-[#4A4455]",
  "dropdownLabel(true)": "font-[Inter,sans-serif] text-sm leading-5 font-bold text-primary-700",
  "dropdownLabel(false)": "font-[Inter,sans-serif] text-sm leading-5 font-medium text-[#4A4455]",
}
