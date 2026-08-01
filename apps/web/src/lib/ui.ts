// Shared tailwind class strings for the app's primitives. One source keeps the
// buttons, panels, and tables consistent across every screen during (and after)
// the migration off admin.css.

const gradientPrimary =
  "bg-[linear-gradient(135deg,var(--color-primary-700)_0%,var(--color-primary-600)_100%)]"

// Disabled treatment for form controls.
const disabledField = "disabled:cursor-not-allowed disabled:bg-[#F7F7F8] disabled:opacity-60"

export const ui = {
  // Disabled form control treatment
  disabledField,

  // Layout
  pageTitle: "text-3xl font-bold tracking-tight text-dark-900",
  panel: "rounded-lg border border-dark-200 bg-white p-6 shadow-sm",
  sectionTitle: "text-xl font-semibold text-dark-900",

  // Buttons
  btnPrimary: `inline-flex items-center justify-center gap-2 rounded-md ${gradientPrimary} px-6 py-2 text-sm font-bold text-white shadow-sm transition hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600/40`,
  btnOutline:
    "inline-flex items-center justify-center gap-2 rounded-md border border-primary-700/20 bg-white px-6 py-2 text-sm font-bold text-primary-700 transition hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600/40",
  btnGhost:
    "inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-dark-500 transition hover:bg-dark-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600/40",
  // Table row icon button, from the list screens
  iconAction:
    "inline-flex items-center rounded-sm p-1 text-primary-600 transition hover:bg-primary-700/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600/40",

  // Form controls
  input:
    "w-full rounded-lg border-[1.5px] border-transparent bg-dark-100 px-4 py-2.5 text-sm text-dark-900 outline-none transition placeholder:text-dark-400 focus:border-primary-600 focus:shadow-[0_0_0_3px_rgba(124,58,237,0.12)]",
  label: "mb-2 block text-overline font-semibold uppercase tracking-[0.06em] text-dark-600",

  // Select trigger, faithful to ca-select-btn
  selectBtn: `flex w-full items-center justify-between rounded-md border-[1.5px] border-transparent bg-dark-200 px-4 py-3 font-sans text-sm font-normal text-dark-900 outline-none transition-[border-color] duration-200 focus:border-primary-600 focus:shadow-[0_0_0_3px_rgba(124,58,237,0.12)] ${disabledField}`,

  // Prefixed input group, from ca-phone-*
  prefixWrap:
    "flex h-11 overflow-hidden rounded-md border-[1.5px] border-transparent bg-dark-200 transition focus-within:border-primary-600 focus-within:shadow-[0_0_0_3px_rgba(124,58,237,0.12)]",
  prefixLabel:
    "flex items-center whitespace-nowrap border-r border-dark-300 px-3 text-sm font-medium text-dark-600",
  prefixInput: `min-w-0 flex-1 border-0 bg-transparent px-3 font-sans text-sm text-dark-900 outline-none placeholder:text-dark-500 ${disabledField}`,

  // Table (values kept faithful to the legacy .tbl-* classes)
  tableWrap: "overflow-x-auto rounded-md bg-white",
  theadRow: "bg-dark-100",
  th: "px-5 py-4 text-left align-middle text-overline font-bold uppercase tracking-[0.05em] whitespace-nowrap text-[#4A4455]",
  thCenter:
    "px-5 py-4 text-center align-middle text-overline font-bold uppercase tracking-[0.05em] whitespace-nowrap text-[#4A4455]",
  tr: "border-t border-dark-200 transition hover:bg-primary-50",
  td: "p-5 align-middle text-sm text-[#4A4455]",
  tdCenter: "p-5 text-center align-middle text-sm text-[#4A4455]",
  searchInput:
    "w-full rounded-md border border-[rgba(204,195,216,0.2)] bg-white py-[13px] pl-12 pr-4 text-sm text-dark-900 outline-none transition placeholder:text-dark-500 focus:border-primary-300",

  // Modal + form (faithful to the legacy ca-* system)
  modalSection: "flex flex-col gap-6",
  modalSectionHeading:
    "border-b border-[rgba(203,213,225,0.2)] pb-2 text-overline font-bold uppercase tracking-[0.06em] text-primary-600",
  field: "flex flex-col gap-2",
  fieldLabel: "text-sm font-semibold leading-5 text-dark-900",
  fieldInput:
    "w-full rounded-md border-[1.5px] border-transparent bg-dark-200 px-4 py-3 text-sm text-dark-900 outline-none transition focus:border-primary-600 focus:shadow-[0_0_0_3px_rgba(124,58,237,0.12)]",
  row2: "grid grid-cols-1 gap-6 sm:grid-cols-2",
  modalCancel:
    "rounded-md px-8 py-3 text-sm font-bold text-dark-600 transition hover:bg-dark-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600/40",
  modalSubmit: `inline-flex items-center justify-center gap-2 rounded-md ${gradientPrimary} px-8 py-3 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600/40`,

  // Detail header + breadcrumb (faithful to qd-*)
  breadcrumb: "flex items-center gap-2",
  breadcrumbLink:
    "cursor-pointer text-overline font-bold uppercase tracking-[0.12em] text-[#4A4455] transition hover:text-primary-700",
  breadcrumbSep: "text-overline font-bold text-dark-300",
  breadcrumbCurrent: "text-overline font-bold uppercase tracking-[0.12em] text-primary-700",
  detailHeader: "flex items-start justify-between gap-4",
  detailHeaderLeft: "flex items-start gap-3",
  detailActions: "flex flex-shrink-0 items-center gap-3 pt-8",
  detailTitle: "text-3xl font-bold leading-9 tracking-tight text-dark-900",
  metaRow: "mt-2 flex items-center gap-3",
  metaText: "text-sm font-medium text-[#4A4455]",
  metaSep: "text-base text-dark-300",

  // Status bar (faithful to qd-status-*)
  statusBar: "flex items-center justify-between rounded-md bg-[#F2F4F6] px-6 py-5",
  statusTrigger:
    "inline-flex min-w-[162px] items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-bold",
  statusDropdown:
    "absolute left-0 top-[calc(100%+8px)] w-[162px] rounded-md border border-[rgba(204,195,216,0.2)] bg-white py-2 shadow-[0_0_0_1px_rgba(0,0,0,0.05)]",
  statusOption:
    "flex h-8 w-full items-center justify-between px-5 py-1 text-left transition hover:bg-dark-100",
}

// Small pill toggle used for chart metric tabs and similar.
export function pill(active: boolean): string {
  return `whitespace-nowrap rounded-full border px-3 py-1 text-caption font-medium transition ${
    active
      ? "border-primary-600 bg-primary-600 text-white hover:bg-primary-700"
      : "border-dark-200 bg-dark-100 text-dark-500 hover:bg-dark-200"
  }`
}
