// Shared tailwind class strings for the app's primitives. One source keeps the
// buttons, panels, and tables consistent across every screen.

const gradientPrimary =
  "bg-[linear-gradient(135deg,var(--color-primary-700)_0%,var(--color-primary-600)_100%)]"

// Keyboard focus ring, light surfaces.
//
// A solid primary-600 ring is 5.7:1 against white. The white offset keeps it
// distinct from the purple gradient buttons it surrounds. It appears
// instantly: keyboard feedback is never animated.
const focusRing =
  "focus-visible:outline-none focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white"

// Focus ring, menu rows.
const focusRingInset =
  "focus-visible:outline-none focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600"

// Focus ring, dark sidebar.
//
// primary-400 is 6.6:1 against dark-900, where primary-600 is only 3.1:1.
const focusRingDark =
  "focus-visible:outline-none focus-visible:transition-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 focus-visible:ring-offset-dark-900"

// Text field focus state.
//
// The solid primary-600 border carries the 3:1 contrast; the glow is extra.
const fieldFocus = "focus:border-primary-600 focus:shadow-[0_0_0_3px_rgba(124,58,237,0.12)]"

// Disabled treatment for form controls.
const disabledField = "disabled:cursor-not-allowed disabled:bg-[#F7F7F8] disabled:opacity-60"

// Page scaffold, one 24px gap
const pageContentBase = "flex flex-1 flex-col gap-6 p-[clamp(1rem,4vw,3rem)]"
const pageActionsBase = "flex items-center max-sm:w-full max-sm:flex-wrap"

// Shared button shell.
//
// Every variant carries a 1px border so primary and outline buttons
// share one height when they sit side by side in a header.
const btnBase = `inline-flex items-center justify-center gap-2 rounded-md border py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`

// Footer button shell, 44px tall.
const modalBtnBase = `inline-flex items-center justify-center gap-2 rounded-md px-8 py-3 text-sm font-bold transition ${focusRing}`

export const ui = {
  // Focus primitives
  focusRing,
  focusRingInset,
  focusRingDark,
  fieldFocus,

  // Disabled form control treatment
  disabledField,

  // Layout; one page gap
  pageContent: pageContentBase,
  pageHeader: "flex items-center justify-between max-sm:flex-col max-sm:items-start max-sm:gap-3",
  pageActions: `${pageActionsBase} gap-3`,
  pageActionsTight: `${pageActionsBase} gap-2.5`,
  pageTitle: "text-3xl font-bold tracking-tight text-dark-900",
  panel: "rounded-lg border border-dark-200 bg-white p-6 shadow-sm",
  sectionTitle: "text-xl font-semibold text-dark-900",

  // Buttons
  btnPrimary: `${btnBase} border-transparent bg-origin-border ${gradientPrimary} px-6 font-bold text-white shadow-sm hover:opacity-90 motion-safe:active:scale-[0.98]`,
  btnOutline: `${btnBase} border-primary-700/20 bg-white px-6 font-bold text-primary-700 hover:bg-primary-50`,
  // Table row icon button, from the list screens
  iconAction: `inline-flex items-center rounded-sm p-1 text-primary-600 transition hover:bg-primary-700/[0.08] ${focusRing}`,

  // Entity detail link
  entityLink: `rounded-sm text-primary-700 underline decoration-primary-700/30 underline-offset-2 transition-colors hover:text-primary-800 hover:decoration-primary-800 ${focusRing}`,
  // Entity name link
  entityLinkMuted: `rounded-sm text-inherit no-underline underline-offset-2 transition-colors hover:text-primary-700 hover:underline ${focusRing}`,

  // Form controls
  // Select trigger, faithful to ca-select-btn
  selectBtn: `flex w-full items-center justify-between rounded-md border-[1.5px] border-transparent bg-dark-200 px-4 py-3 font-sans text-sm font-normal text-dark-900 outline-none transition-[border-color] duration-200 ${fieldFocus} ${disabledField}`,

  // Prefixed input group, from ca-phone-*
  prefixWrap:
    "flex h-11 overflow-hidden rounded-md border-[1.5px] border-transparent bg-dark-200 transition focus-within:border-primary-600 focus-within:shadow-[0_0_0_3px_rgba(124,58,237,0.12)]",
  prefixLabel:
    "flex items-center whitespace-nowrap border-r border-dark-300 px-3 text-sm font-medium text-dark-600",
  prefixInput: `min-w-0 flex-1 border-0 bg-transparent px-3 font-sans text-sm text-dark-900 outline-none placeholder:text-dark-500 ${disabledField}`,

  // Table (values kept faithful to the legacy .tbl-* classes)
  tableWrap: "overflow-x-auto rounded-md bg-white",
  theadRow: "bg-dark-100",
  thCenter:
    "px-5 py-4 text-center align-middle text-overline font-bold uppercase tracking-[0.05em] whitespace-nowrap text-[#4A4455]",
  tr: "border-t border-dark-200 transition hover:bg-primary-50",
  td: "p-5 align-middle text-sm text-[#4A4455]",
  tdCenter: "p-5 text-center align-middle text-sm text-[#4A4455]",
  searchInput:
    "w-full rounded-md border border-[rgba(204,195,216,0.2)] bg-white py-[13px] pl-12 pr-4 text-sm text-dark-900 outline-none transition placeholder:text-dark-500 focus:border-primary-600",

  // Modal + form (faithful to the legacy ca-* system)
  modalSection: "flex flex-col gap-6",
  modalSectionHeading:
    "border-b border-[rgba(203,213,225,0.2)] pb-2 text-overline font-bold uppercase tracking-[0.06em] text-primary-600",
  field: "flex flex-col gap-2",
  fieldLabel: "text-sm font-semibold leading-5 text-dark-900",
  fieldInput: `w-full rounded-md border-[1.5px] border-transparent bg-dark-200 px-4 py-3 text-sm text-dark-900 outline-none transition ${fieldFocus}`,
  row2: "grid grid-cols-1 gap-6 sm:grid-cols-2",
  modalCancel: `${modalBtnBase} text-dark-600 hover:bg-dark-100`,
  modalSubmit: `${modalBtnBase} ${gradientPrimary} text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50`,

  // Detail header + breadcrumb (faithful to qd-*)
  breadcrumb: "flex items-center gap-2",
  breadcrumbLink: `cursor-pointer rounded-sm text-overline font-bold uppercase tracking-[0.12em] text-[#4A4455] transition hover:text-primary-700 ${focusRing}`,
  breadcrumbSep: "text-overline font-bold uppercase text-dark-300",
  breadcrumbCurrent: "text-overline font-bold uppercase tracking-[0.12em] text-primary-700",
  // Stacks below 640px
  detailHeader: "flex items-start justify-between gap-4 max-sm:flex-col max-sm:gap-3",
  detailHeaderLeft: "flex min-w-0 items-start gap-3",
  detailActions: "flex flex-shrink-0 items-center gap-3 pt-8 max-sm:flex-wrap max-sm:pt-0",
  detailTitle: "text-3xl font-bold leading-9 tracking-tight text-dark-900 [overflow-wrap:anywhere]",
  metaRow: "mt-2 flex flex-wrap items-center gap-3",
  metaText: "text-sm font-medium text-[#4A4455]",
  metaSep: "text-base text-dark-300",

  // Status bar (faithful to qd-status-*)
  statusBar:
    "flex items-center justify-between rounded-md bg-[#F2F4F6] px-6 py-5 max-sm:flex-col max-sm:items-start max-sm:gap-4 max-sm:*:flex-wrap",
  statusTrigger: `inline-flex min-w-[162px] items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-bold ${focusRing}`,
  statusDropdown:
    "absolute left-0 top-[calc(100%+8px)] w-[162px] rounded-md border border-[rgba(204,195,216,0.2)] bg-white py-2 shadow-[0_0_0_1px_rgba(0,0,0,0.05)]",
  statusOption: `flex h-8 w-full items-center justify-between px-5 py-1 text-left transition hover:bg-dark-100 ${focusRingInset}`,

  // Dropdown panel and rows
  dropdownPanel:
    "absolute top-[calc(100%+4px)] right-0 left-0 z-50 flex flex-col rounded-md border border-[rgba(204,195,216,0.2)] bg-white py-2 [box-shadow:0_4px_12px_rgba(0,0,0,0.08)]",
  dropdownPanelCompact:
    "absolute top-[calc(100%+4px)] right-0 left-0 z-50 flex flex-col rounded-md border border-[rgba(204,195,216,0.4)] bg-white py-1 [box-shadow:0_4px_12px_rgba(0,0,0,0.08)]",
  dropdownItem: `flex w-full cursor-pointer items-center justify-between gap-3 border-none bg-transparent px-5 py-2.5 text-left ${focusRingInset}`,
}

// Small pill toggle used for chart metric tabs and similar.
export function pill(active: boolean): string {
  return `whitespace-nowrap rounded-full border px-3 py-1 text-caption font-medium transition ${focusRing} ${
    active
      ? "border-primary-600 bg-primary-600 text-white hover:bg-primary-700"
      : "border-dark-200 bg-dark-100 text-dark-500 hover:bg-dark-200"
  }`
}

// Dropdown row label text.
export function dropdownLabel(active: boolean): string {
  return `font-[Inter,sans-serif] text-sm leading-5 ${
    active ? "font-bold text-primary-700" : "font-medium text-[#4A4455]"
  }`
}

// Shared filter chip tone.
function chipTone(active: boolean): string {
  return `cursor-pointer font-[Inter,sans-serif] text-[13px] transition-all duration-150 ease-[ease] ${focusRing} ${
    active
      ? "border-[1.5px] border-primary-700 bg-[rgba(99,14,212,0.06)] font-semibold text-primary-700"
      : "border border-[#E5E7EB] bg-white font-medium text-[#4A4455]"
  }`
}

// Rounded status filter chip.
export function chip(active: boolean): string {
  return `rounded-[999px] px-[18px] py-2 ${chipTone(active)}`
}

// Date preset option chip.
export function presetChip(active: boolean): string {
  return `flex items-center justify-between rounded-md px-3.5 py-2.5 ${chipTone(active)}`
}
