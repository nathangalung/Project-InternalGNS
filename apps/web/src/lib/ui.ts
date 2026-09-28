// Shared tailwind class recipes.
//
// Typed tv() recipes keep the buttons, panels, and tables consistent across
// every screen. A variant name the recipe does not declare fails the
// typecheck, and a `class` override replaces the conflicting utility instead
// of racing it in the stylesheet. The `ui` map below is the recipe output
// for the screens that still read class strings.
import type { VariantProps } from "tailwind-variants"
import { tv } from "./utils"

const gradientPrimary =
  "bg-[linear-gradient(135deg,var(--color-primary-700)_0%,var(--color-primary-600)_100%)]"

// Keyboard focus ring.
//
// light: a solid primary-600 ring is 5.7:1 against white, and the white
// offset keeps it distinct from the purple gradient buttons it surrounds.
// inset: menu rows, so the ring is not clipped. dark: the sidebar, where
// primary-400 is 6.6:1 against dark-900 and primary-600 only 3.1:1. It
// appears instantly: keyboard feedback is never animated.
export const focusRing = tv({
  base: "focus-visible:outline-none focus-visible:transition-none focus-visible:ring-2",
  variants: {
    tone: {
      light:
        "focus-visible:ring-primary-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
      inset: "focus-visible:ring-inset focus-visible:ring-primary-600",
      dark: "focus-visible:ring-primary-400 focus-visible:ring-offset-2 focus-visible:ring-offset-dark-900",
    },
  },
  defaultVariants: { tone: "light" },
})

const ring = focusRing()
const ringInset = focusRing({ tone: "inset" })

// Text field focus state.
//
// The solid primary-600 border carries the 3:1 contrast; the glow is extra.
const fieldFocus = "focus:border-primary-600 focus:shadow-[0_0_0_3px_rgba(124,58,237,0.12)]"

// Disabled form control treatment.
const disabledField = "disabled:cursor-not-allowed disabled:bg-[#F7F7F8] disabled:opacity-60"

// Page scaffold, one 24px gap.
export const page = tv({
  slots: {
    content: "flex flex-1 flex-col gap-6 p-[clamp(1rem,4vw,3rem)]",
    header: "flex items-center justify-between max-sm:flex-col max-sm:items-start max-sm:gap-3",
    actions: "flex items-center max-sm:w-full max-sm:flex-wrap",
    title: "text-3xl font-bold tracking-tight text-dark-900",
    panel: "rounded-lg border border-dark-200 bg-white p-6 shadow-sm",
    sectionTitle: "text-xl font-semibold text-dark-900",
  },
  variants: {
    tight: { true: { actions: "gap-2.5" }, false: { actions: "gap-3" } },
  },
  defaultVariants: { tight: false },
})

// Header action button.
//
// Every variant carries a 1px border so primary and outline buttons share
// one height when they sit side by side in a header.
export const button = tv({
  base: [
    "inline-flex items-center justify-center gap-2 rounded-md border py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-50",
    ring,
  ],
  variants: {
    variant: {
      primary: [
        "border-transparent bg-origin-border px-6 font-bold text-white shadow-sm hover:opacity-90 motion-safe:active:scale-[0.98]",
        gradientPrimary,
      ],
      outline: "border-primary-700/20 bg-white px-6 font-bold text-primary-700 hover:bg-primary-50",
    },
  },
  defaultVariants: { variant: "primary" },
})

// Modal footer button, 44px.
export const modalButton = tv({
  base: [
    "inline-flex items-center justify-center gap-2 rounded-md px-8 py-3 text-sm font-bold transition",
    ring,
  ],
  variants: {
    variant: {
      cancel: "text-dark-600 hover:bg-dark-100",
      submit: [
        gradientPrimary,
        "text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
      ],
    },
  },
  defaultVariants: { variant: "submit" },
})

// Table row icon button.
export const iconAction = tv({
  base: [
    "inline-flex items-center rounded-sm p-1 text-primary-600 transition hover:bg-primary-700/[0.08]",
    ring,
  ],
})

// Entity detail link.
export const entityLink = tv({
  base: ["rounded-sm underline-offset-2", ring],
  variants: {
    tone: {
      default:
        "text-primary-700 underline decoration-primary-700/30 transition-colors hover:text-primary-800 hover:decoration-primary-800",
      muted: "text-inherit no-underline transition-colors hover:text-primary-700 hover:underline",
    },
  },
  defaultVariants: { tone: "default" },
})

// Form field parts.
//
// Faithful to the legacy ca-* system; the trigger to ca-select-btn.
export const field = tv({
  slots: {
    root: "flex flex-col gap-2",
    label: "text-sm font-semibold leading-5 text-dark-900",
    input: [
      "w-full rounded-md border-[1.5px] border-transparent bg-dark-200 px-4 py-3 text-sm text-dark-900 outline-none transition",
      fieldFocus,
    ],
    selectTrigger: [
      "flex w-full items-center justify-between rounded-md border-[1.5px] border-transparent bg-dark-200 px-4 py-3 font-sans text-sm font-normal text-dark-900 outline-none transition-[border-color] duration-200",
      fieldFocus,
      disabledField,
    ],
    row2: "grid grid-cols-1 gap-6 sm:grid-cols-2",
  },
})

// Prefixed input group.
//
// From ca-phone-*.
export const prefixField = tv({
  slots: {
    wrap: "flex h-11 overflow-hidden rounded-md border-[1.5px] border-transparent bg-dark-200 transition focus-within:border-primary-600 focus-within:shadow-[0_0_0_3px_rgba(124,58,237,0.12)]",
    label:
      "flex items-center whitespace-nowrap border-r border-dark-300 px-3 text-sm font-medium text-dark-600",
    input: [
      "min-w-0 flex-1 border-0 bg-transparent px-3 font-sans text-sm text-dark-900 outline-none placeholder:text-dark-500",
      disabledField,
    ],
  },
})

// List table parts.
//
// Values kept faithful to the legacy .tbl-* classes.
export const table = tv({
  slots: {
    wrap: "overflow-x-auto rounded-md bg-white",
    headRow: "bg-dark-100",
    th: "px-5 py-4 text-center align-middle text-overline font-bold uppercase tracking-[0.05em] whitespace-nowrap text-[#4A4455]",
    tr: "border-t border-dark-200 transition hover:bg-primary-50",
    td: "p-5 align-middle text-sm text-[#4A4455]",
  },
  variants: {
    align: { start: {}, center: { td: "text-center" } },
  },
  defaultVariants: { align: "start" },
})

// List search input.
export const searchInput = tv({
  base: "w-full rounded-md border border-[rgba(204,195,216,0.2)] bg-white py-[13px] pl-12 pr-4 text-sm text-dark-900 outline-none transition placeholder:text-dark-500 focus:border-primary-600",
})

// Modal form section.
export const modalForm = tv({
  slots: {
    section: "flex flex-col gap-6",
    heading:
      "border-b border-[rgba(203,213,225,0.2)] pb-2 text-overline font-bold uppercase tracking-[0.06em] text-primary-600",
  },
})

// Detail breadcrumb parts.
//
// Faithful to qd-*.
export const breadcrumb = tv({
  slots: {
    root: "flex items-center gap-2",
    link: [
      "cursor-pointer rounded-sm text-overline font-bold uppercase tracking-[0.12em] text-[#4A4455] transition hover:text-primary-700",
      ring,
    ],
    sep: "text-overline font-bold uppercase text-dark-300",
    current: "text-overline font-bold uppercase tracking-[0.12em] text-primary-700",
  },
})

// Detail header parts.
//
// Stacks below 640px.
export const detailHeader = tv({
  slots: {
    root: "flex items-start justify-between gap-4 max-sm:flex-col max-sm:gap-3",
    left: "flex min-w-0 items-start gap-3",
    actions: "flex flex-shrink-0 items-center gap-3 pt-8 max-sm:flex-wrap max-sm:pt-0",
    title: "text-3xl font-bold leading-9 tracking-tight text-dark-900 [overflow-wrap:anywhere]",
    metaRow: "mt-2 flex flex-wrap items-center gap-3",
    metaText: "text-sm font-medium text-[#4A4455]",
    metaSep: "text-base text-dark-300",
  },
})

// Status bar parts.
//
// Faithful to qd-status-*.
export const statusMenu = tv({
  slots: {
    bar: "flex items-center justify-between rounded-md bg-[#F2F4F6] px-6 py-5 max-sm:flex-col max-sm:items-start max-sm:gap-4 max-sm:*:flex-wrap",
    trigger: [
      "inline-flex min-w-[162px] items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-bold",
      ring,
    ],
    panel:
      "w-[162px] rounded-md border border-[rgba(204,195,216,0.2)] bg-white py-2 shadow-[0_0_0_1px_rgba(0,0,0,0.05)]",
    option: [
      "flex h-8 w-full items-center justify-between px-5 py-1 text-left transition hover:bg-dark-100",
      ringInset,
    ],
  },
  variants: {
    // inline: under a relative parent; floating: a Base UI positioner
    placement: { inline: { panel: "absolute left-0 top-[calc(100%+8px)]" }, floating: {} },
  },
  defaultVariants: { placement: "inline" },
})

// Dropdown panel and rows.
export const dropdown = tv({
  slots: {
    panel: "flex flex-col rounded-md border bg-white [box-shadow:0_4px_12px_rgba(0,0,0,0.08)]",
    item: [
      "flex w-full cursor-pointer items-center justify-between gap-3 border-none bg-transparent px-5 py-2.5 text-left",
      ringInset,
    ],
    label: "font-[Inter,sans-serif] text-sm leading-5",
  },
  variants: {
    // inline: under a relative parent; floating: a Base UI positioner
    placement: {
      inline: { panel: "absolute top-[calc(100%+4px)] right-0 left-0 z-50" },
      floating: {},
    },
    density: {
      default: { panel: "border-[rgba(204,195,216,0.2)] py-2" },
      compact: { panel: "border-[rgba(204,195,216,0.4)] py-1" },
    },
    active: {
      true: { label: "font-bold text-primary-700" },
      false: { label: "font-medium text-[#4A4455]" },
    },
  },
  defaultVariants: { placement: "inline", density: "default", active: false },
})

// Small pill toggle.
//
// Used for chart metric tabs and similar.
export const pillRecipe = tv({
  base: [
    "whitespace-nowrap rounded-full border px-3 py-1 text-caption font-medium transition",
    ring,
  ],
  variants: {
    active: {
      true: "border-primary-600 bg-primary-600 text-white hover:bg-primary-700",
      false: "border-dark-200 bg-dark-100 text-dark-600 hover:bg-dark-200",
    },
  },
  defaultVariants: { active: false },
})

// Filter chip, two shapes.
export const chipRecipe = tv({
  base: [
    "cursor-pointer font-[Inter,sans-serif] text-[13px] transition-all duration-150 ease-[ease]",
    ring,
  ],
  variants: {
    shape: {
      // Rounded status filter
      pill: "rounded-[999px] px-[18px] py-2",
      // Date preset option
      preset: "flex items-center justify-between rounded-md px-3.5 py-2.5",
    },
    active: {
      true: "border-[1.5px] border-primary-700 bg-[rgba(99,14,212,0.06)] font-semibold text-primary-700",
      false: "border border-[#E5E7EB] bg-white font-medium text-[#4A4455]",
    },
  },
  defaultVariants: { shape: "pill", active: false },
})

export type ButtonVariants = VariantProps<typeof button>
export type DropdownVariants = VariantProps<typeof dropdown>

const pg = page()
const fld = field()
const pre = prefixField()
const tbl = table()
const mf = modalForm()
const bc = breadcrumb()
const dh = detailHeader()
const sm = statusMenu()
const dd = dropdown()

// Recipe output as class strings.
export const ui = {
  // Focus primitives
  focusRing: ring,
  focusRingInset: ringInset,
  focusRingDark: focusRing({ tone: "dark" }),
  fieldFocus,

  // Disabled form control treatment
  disabledField,

  // Layout; one page gap
  pageContent: pg.content(),
  pageHeader: pg.header(),
  pageActions: pg.actions(),
  pageActionsTight: pg.actions({ tight: true }),
  pageTitle: pg.title(),
  panel: pg.panel(),
  sectionTitle: pg.sectionTitle(),

  // Buttons
  btnPrimary: button({ variant: "primary" }),
  btnOutline: button({ variant: "outline" }),
  iconAction: iconAction(),

  // Entity links
  entityLink: entityLink(),
  entityLinkMuted: entityLink({ tone: "muted" }),

  // Form controls
  selectBtn: fld.selectTrigger(),
  prefixWrap: pre.wrap(),
  prefixLabel: pre.label(),
  prefixInput: pre.input(),

  // Table
  tableWrap: tbl.wrap(),
  theadRow: tbl.headRow(),
  thCenter: tbl.th(),
  tr: tbl.tr(),
  td: tbl.td(),
  tdCenter: tbl.td({ align: "center" }),
  searchInput: searchInput(),

  // Modal and form
  modalSection: mf.section(),
  modalSectionHeading: mf.heading(),
  field: fld.root(),
  fieldLabel: fld.label(),
  fieldInput: fld.input(),
  row2: fld.row2(),
  modalCancel: modalButton({ variant: "cancel" }),
  modalSubmit: modalButton({ variant: "submit" }),

  // Detail header and breadcrumb
  breadcrumb: bc.root(),
  breadcrumbLink: bc.link(),
  breadcrumbSep: bc.sep(),
  breadcrumbCurrent: bc.current(),
  detailHeader: dh.root(),
  detailHeaderLeft: dh.left(),
  detailActions: dh.actions(),
  detailTitle: dh.title(),
  metaRow: dh.metaRow(),
  metaText: dh.metaText(),
  metaSep: dh.metaSep(),

  // Status bar
  statusBar: sm.bar(),
  statusTrigger: sm.trigger(),
  statusDropdown: sm.panel(),
  statusOption: sm.option(),

  // Dropdown panel and rows
  dropdownPanel: dd.panel(),
  dropdownPanelCompact: dd.panel({ density: "compact" }),
  dropdownItem: dd.item(),
}

// Pill toggle classes.
export function pill(active: boolean): string {
  return pillRecipe({ active })
}

// Dropdown row label text.
export function dropdownLabel(active: boolean): string {
  return dd.label({ active })
}

// Rounded status filter chip.
export function chip(active: boolean): string {
  return chipRecipe({ shape: "pill", active })
}

// Date preset option chip.
export function presetChip(active: boolean): string {
  return chipRecipe({ shape: "preset", active })
}
