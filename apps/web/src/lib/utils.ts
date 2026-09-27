import { type ClassValue, clsx } from "clsx"
import { cnMerge, createTV, type TWMergeConfig } from "tailwind-variants"

// Theme-aware merge config.
//
// tailwind-variants carries its own copy of the tailwind-merge engine, and
// cn() uses it too: one engine in the bundle, one set of rules for cn() and
// tv(). The engine only knows the default type scale, so it reads the custom
// text-caption and text-overline sizes as colours and drops them next to a
// text colour; it also reads font-[Inter,sans-serif] as a weight and drops
// it next to font-bold. Registering both keeps them.
const twMergeConfig = {
  extend: {
    theme: { text: ["caption", "overline"] },
    classGroups: { "font-family": [{ font: ["[Inter,sans-serif]"] }] },
  },
} satisfies TWMergeConfig

const mergeOptions = { twMerge: true, twMergeConfig }

// Conditional classes, conflicts resolved.
export function cn(...inputs: ClassValue[]): string {
  return cnMerge(clsx(inputs))(mergeOptions) ?? ""
}

// Base UI props, string className.
//
// Base UI also accepts a state function for className; the styled wrappers
// merge a plain string with cn(), so they narrow it.
export type WithClassName<P> = Omit<P, "className"> & { className?: string }

// Recipe factory, same merge rules.
export const tv = createTV(mergeOptions)
