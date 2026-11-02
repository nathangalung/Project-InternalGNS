// Rupiah typed the Indonesian way.
//
// Every money input reads what people type and paste: dots group
// thousands, a comma starts the sen (two digits at most), and anything
// else, such as "Rp" or spaces, is dropped. The value kept is a plain
// decimal string ("200000.50") the API and Number() read as is, and the
// input shows it grouped again ("200.000,50").

// Typed text to the value.
// A trailing comma stays as a trailing dot, so the sen can follow.
export function moneyTyped(raw: string): string {
  const [whole, ...rest] = raw.replace(/[^\d,]/g, "").split(",")
  const digits = whole.replace(/^0+(?=\d)/, "")
  if (rest.length === 0) return digits
  return `${digits || "0"}.${rest.join("").slice(0, 2)}`
}

// Value as the input shows.
export function moneyShown(value: string): string {
  const [whole, sen] = value.split(".")
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  return sen === undefined ? grouped : `${grouped},${sen}`
}

// Stored amount to the value.
// The API sends "60000.00"; whole rupiah drop their ",00", real sen stay.
export function moneyFromStored(stored: string | number | null | undefined): string {
  if (stored === null || stored === undefined) return ""
  return String(stored).replace(/\.00$/, "")
}
