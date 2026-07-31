// Shared tailwind class strings for the app's primitives. One source keeps the
// buttons, panels, and tables consistent across every screen during (and after)
// the migration off admin.css.

const gradientPrimary =
  "bg-[linear-gradient(135deg,var(--color-primary-700)_0%,var(--color-primary-600)_100%)]"

export const ui = {
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

  // Form controls
  input:
    "w-full rounded-lg border-[1.5px] border-transparent bg-dark-100 px-4 py-2.5 text-sm text-dark-900 outline-none transition placeholder:text-dark-400 focus:border-primary-600 focus:shadow-[0_0_0_3px_rgba(124,58,237,0.12)]",
  label: "mb-2 block text-overline font-semibold uppercase tracking-[0.06em] text-dark-600",

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
}

// Small pill toggle used for chart metric tabs and similar.
export function pill(active: boolean): string {
  return `whitespace-nowrap rounded-full border px-3 py-1 text-caption font-medium transition ${
    active
      ? "border-primary-600 bg-primary-600 text-white hover:bg-primary-700"
      : "border-dark-200 bg-dark-100 text-dark-500 hover:bg-dark-200"
  }`
}
