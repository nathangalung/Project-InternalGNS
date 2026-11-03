import type { InputHTMLAttributes } from "react"
import { moneyShown, moneyTyped } from "@/lib/money-input"

type MoneyInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "inputMode"
> & {
  // Plain decimal string, "" for none
  value: string
  onValueChange: (value: string) => void
}

// Rupiah input, Indonesian style.
//
// Shows the value grouped ("200.000,50") and hands back the plain decimal
// ("200000.50"), whatever the user types or pastes (see lib/money-input).
export default function MoneyInput({ value, onValueChange, ...rest }: MoneyInputProps) {
  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      value={moneyShown(value)}
      onChange={(e) => onValueChange(moneyTyped(e.target.value))}
    />
  )
}
