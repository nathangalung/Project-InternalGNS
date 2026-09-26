import { type ClassValue, clsx } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"
import { createTV, type TWMergeConfig } from "tailwind-variants"

// Theme-aware merge config.
//
// tailwind-merge only knows the default type scale, so it reads the custom
// text-caption and text-overline sizes as colours and drops them next to a
// text colour. It also reads font-[Inter,sans-serif] as a weight and drops
// it next to font-bold. Registering both keeps them. One config serves cn()
// and tv().
const twMergeConfig = {
  extend: {
    theme: { text: ["caption", "overline"] },
    classGroups: { "font-family": [{ font: ["[Inter,sans-serif]"] }] },
  },
} satisfies TWMergeConfig

const twMerge = extendTailwindMerge(twMergeConfig)

// Conditional classes, conflicts resolved.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

// Base UI props, string className.
//
// Base UI also accepts a state function for className; the styled wrappers
// merge a plain string with cn(), so they narrow it.
export type WithClassName<P> = Omit<P, "className"> & { className?: string }

// Recipe factory, same merge rules.
export const tv = createTV({ twMerge: true, twMergeConfig })
