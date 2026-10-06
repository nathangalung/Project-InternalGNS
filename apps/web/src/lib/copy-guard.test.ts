import { describe, expect, it } from "vitest"

// Copy reads as plain sentences.
//
// The owner asked for no semicolon and no dash in anything a user reads.
// The source has no statement semicolons (Biome), so a semicolon outside a
// comment is copy unless it ends a type member, sits in a for clause or
// ends an HTML entity; a dash is never code.

const files = import.meta.glob<string>(
  [
    "/src/**/*.{ts,tsx}",
    "!/src/**/*.test.{ts,tsx}",
    "!/src/test/**",
    "!/src/types/generated.ts",
    "!/src/routeTree.gen.ts",
  ],
  { query: "?raw", import: "default", eager: true },
)

// Code lines, comments blanked.
function codeLines(source: string): string[] {
  let inBlock = false
  return source.split("\n").map((line) => {
    let out = ""
    let rest = line
    while (rest.length > 0) {
      if (inBlock) {
        const end = rest.indexOf("*/")
        if (end < 0) return out
        inBlock = false
        rest = rest.slice(end + 2)
        continue
      }
      const start = rest.indexOf("/*")
      const slash = rest.search(/(^|\s)\/\//)
      if (slash >= 0 && (start < 0 || slash < start)) return out + rest.slice(0, slash)
      if (start < 0) return out + rest
      out += rest.slice(0, start)
      inBlock = true
      rest = rest.slice(start + 2)
    }
    return out
  })
}

// Semicolons that are code.
const codeSemicolon = /;\s*[A-Za-z_$][\w$]*\??:|&[a-z]+;|&#\d+;/g

const offences = Object.entries(files).flatMap(([file, source]) =>
  codeLines(source)
    .map((text, i) => ({ text, at: `${file}:${i + 1}` }))
    .filter(
      ({ text }) =>
        /[—–]/.test(text) ||
        (!/\bfor \(/.test(text) && text.replace(codeSemicolon, "").includes(";")),
    )
    .map(({ text, at }) => `${at}: ${text.trim()}`),
)

describe("copy guard", () => {
  it("reads every source file", () => {
    expect(Object.keys(files).length).toBeGreaterThan(100)
  })

  it("prints no semicolon and no dash", () => {
    expect(offences).toEqual([])
  })
})
