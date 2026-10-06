import type { CashDirection, CashEntryInput, CashEntryRow } from "@/types/api"
import type { CashEntryParams } from "./api"

// Direction names.
export const DIRECTION_LABEL: Record<CashDirection, string> = { in: "Masuk", out: "Keluar" }

export type DirectionFilter = CashDirection | "all"

// List filters.
export type CashFilterValues = {
  direction: DirectionFilter
  category: string
  dateFrom: string
  dateTo: string
}

// Filters with nothing applied.
export const CASH_FILTERS: CashFilterValues = {
  direction: "all",
  category: "",
  dateFrom: "",
  dateTo: "",
}

// List query from screen state.
export function cashParams(
  search: string,
  f: CashFilterValues,
  page?: { limit: number; offset: number },
): CashEntryParams {
  return {
    q: search || undefined,
    direction: f.direction === "all" ? undefined : f.direction,
    category: f.category || undefined,
    dateFrom: f.dateFrom || undefined,
    dateTo: f.dateTo || undefined,
    ...page,
  }
}

// The entry form.
export type CashForm = {
  entryDate: string
  direction: CashDirection | ""
  category: string
  // Digits, a dot for sen
  amount: string
  description: string
}

// A blank form dated today.
export function emptyCashForm(today: string): CashForm {
  return { entryDate: today, direction: "", category: "", amount: "", description: "" }
}

// Form for a stored entry.
// Whole rupiah drop their ",00"; any sen stay.
export function cashFormFromRow(row: CashEntryRow): CashForm {
  return {
    entryDate: row.entryDate,
    direction: row.direction,
    category: row.category,
    amount: row.amount.replace(/\.00$/, ""),
    description: row.description,
  }
}

// Body for the API.
export function cashInput(form: CashForm): CashEntryInput {
  return {
    entryDate: form.entryDate,
    direction: form.direction as CashDirection,
    category: form.category.trim(),
    amount: form.amount.trim(),
    description: form.description.trim(),
  }
}

export type CashFieldErrors = Partial<Record<keyof CashForm, string>>

const MAX_CATEGORY = 60
const MAX_DESCRIPTION = 500

// Form rules.
// Mirrors apps/api/internal/cashentries/validate.go, which has the last word.
export function cashFieldErrors(form: CashForm): CashFieldErrors {
  const out: CashFieldErrors = {}
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.entryDate)) {
    out.entryDate = "Tanggal wajib diisi dengan format yang benar."
  }
  if (form.direction === "") out.direction = "Pilih Masuk atau Keluar."
  const category = form.category.trim()
  if (category === "") out.category = "Kategori wajib diisi."
  else if ([...category].length > MAX_CATEGORY) {
    out.category = `Kategori paling banyak ${MAX_CATEGORY} karakter.`
  }
  const amount = Number(form.amount)
  if (form.amount.trim() === "" || !Number.isFinite(amount) || Math.round(amount * 100) <= 0) {
    out.amount = "Jumlah harus berupa angka lebih dari 0."
  }
  const description = form.description.trim()
  if (description === "") out.description = "Keterangan wajib diisi."
  else if ([...description].length > MAX_DESCRIPTION) {
    out.description = `Keterangan paling banyak ${MAX_DESCRIPTION} karakter.`
  }
  return out
}

// Typed amount to canonical.
// The input reads Indonesian: dots group thousands and a comma starts the
// sen, which stop at two digits. The result is digits with an optional dot.
export function amountTyped(raw: string): string {
  const [whole, ...rest] = raw.replace(/[^\d,]/g, "").split(",")
  if (rest.length === 0) return whole
  return `${whole}.${rest.join("").slice(0, 2)}`
}

// Canonical amount for the input.
// The inverse of amountTyped, so a trailing comma survives while typing.
export function amountShown(canonical: string): string {
  const [whole, sen] = canonical.split(".")
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  return sen === undefined ? grouped : `${grouped},${sen}`
}
