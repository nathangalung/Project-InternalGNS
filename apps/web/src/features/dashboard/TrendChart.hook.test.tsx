import { act, useState } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { byRole, mount, press, settle, unmount } from "@/test/dom"
import TrendChart from "./TrendChart"

// Trend chart keyboard access.
//
// One tab stop for the whole chart, arrow keys move between points, the
// focused point shows the same tooltip the pointer does, and a hidden table
// carries every value for screen readers.

const LABELS = ["JAN", "FEB", "MAR", "APR"]
const SERIES = { Quotation: [3, 7, 0, 12], Invoice: [1, 2, 3, 4] }
const fmt = (v: number) => `Rp${v.toLocaleString("id-ID")}`

function points(): HTMLElement[] {
  return byRole("img")
}

function tooltipText(): string | null {
  const tip = document.querySelector('[data-slot="chart-tooltip"]')
  if (!tip) return null
  return [...tip.querySelectorAll("text")].map((t) => t.textContent).join("|")
}

async function focusPoint(i: number) {
  await act(async () => points()[i].focus())
  await settle()
}

afterEach(unmount)

describe("TrendChart keyboard access", () => {
  it("is one labelled group with a single tab stop", async () => {
    await mount(<TrendChart series={SERIES} activeKey="Quotation" monthLabels={LABELS} />)
    const [group] = byRole("group")
    expect(group.tagName.toLowerCase()).toBe("svg")
    expect(group.getAttribute("aria-label")).toBe("Grafik Quotation per periode")
    const hint = document.getElementById(group.getAttribute("aria-describedby") ?? "")
    expect(hint?.textContent).toContain("panah kiri atau kanan")
    expect(points().map((p) => p.tabIndex)).toEqual([0, -1, -1, -1])
    expect(points().map((p) => p.getAttribute("aria-label"))).toEqual([
      "JAN, Quotation: 3",
      "FEB, Quotation: 7",
      "MAR, Quotation: 0",
      "APR, Quotation: 12",
    ])
    expect(tooltipText()).toBeNull()
  })

  it("shows the tooltip for the focused point and hides it on blur", async () => {
    await mount(
      <TrendChart series={SERIES} activeKey="Quotation" monthLabels={LABELS} formatValue={fmt} />,
    )
    await focusPoint(1)
    expect(document.activeElement).toBe(points()[1])
    expect(tooltipText()).toBe("FEB|Quotation|Rp7")
    expect(points().map((p) => p.tabIndex)).toEqual([-1, 0, -1, -1])

    await act(async () => points()[1].blur())
    expect(tooltipText()).toBeNull()
    expect(points()[1].tabIndex).toBe(0)
  })

  it.each([
    { from: 0, key: "ArrowRight", to: 1 },
    { from: 1, key: "ArrowDown", to: 2 },
    { from: 3, key: "ArrowRight", to: 3 },
    { from: 2, key: "ArrowLeft", to: 1 },
    { from: 1, key: "ArrowUp", to: 0 },
    { from: 0, key: "ArrowLeft", to: 0 },
    { from: 1, key: "End", to: 3 },
    { from: 2, key: "Home", to: 0 },
  ])("$key from point $from lands on $to", async ({ from, key, to }) => {
    await mount(<TrendChart series={SERIES} activeKey="Quotation" monthLabels={LABELS} />)
    await focusPoint(from)
    await press(key)
    expect(document.activeElement).toBe(points()[to])
    expect(points()[to].tabIndex).toBe(0)
    expect(tooltipText()).toBe(`${LABELS[to]}|Quotation|${SERIES.Quotation[to]}`)
  })

  it("leaves other keys to the page", async () => {
    await mount(<TrendChart series={SERIES} activeKey="Quotation" monthLabels={LABELS} />)
    await focusPoint(0)
    let reached = 0
    document.body.addEventListener("keydown", () => reached++)
    await press("a")
    expect(reached).toBe(1)
    expect(document.activeElement).toBe(points()[0])
  })

  it("dismisses the tooltip with Escape, then lets Escape through", async () => {
    await mount(<TrendChart series={SERIES} activeKey="Quotation" monthLabels={LABELS} />)
    await focusPoint(2)
    let reached = 0
    document.body.addEventListener("keydown", (e) => {
      if (e.key === "Escape") reached++
    })

    await press("Escape")
    expect(tooltipText()).toBeNull()
    expect(document.activeElement).toBe(points()[2])
    expect(reached).toBe(0)

    await press("Escape")
    expect(reached).toBe(1)

    await press("ArrowRight")
    expect(tooltipText()).toBe("APR|Quotation|12")
  })

  it("reads the comparison series in the label, tooltip and table", async () => {
    await mount(
      <TrendChart
        series={SERIES}
        activeKey="Quotation"
        comparisonKey="Invoice"
        monthLabels={LABELS}
      />,
    )
    expect(byRole("group")[0].getAttribute("aria-label")).toBe(
      "Grafik Quotation dibanding Invoice per periode",
    )
    expect(points()[3].getAttribute("aria-label")).toBe("APR, Quotation: 12, Invoice: 4")
    await focusPoint(3)
    expect(tooltipText()).toBe("APR|Quotation|12|Invoice|4")
    const heads = [...document.querySelectorAll("table thead th")].map((th) => th.textContent)
    expect(heads).toEqual(["Periode", "Quotation", "Invoice"])
    const last = document.querySelector("table tbody tr:last-child")
    expect([...(last?.children ?? [])].map((c) => c.textContent)).toEqual(["APR", "12", "4"])
  })

  it("keeps every value in a visually hidden table", async () => {
    await mount(
      <TrendChart series={SERIES} activeKey="Quotation" monthLabels={LABELS} formatValue={fmt} />,
    )
    const table = document.querySelector("table")
    expect(table?.parentElement?.className).toBe("sr-only")
    expect(table?.querySelector("caption")?.textContent).toBe("Data Grafik Quotation per periode")
    const rows = [...document.querySelectorAll("table tbody tr")].map((tr) =>
      [...tr.children].map((c) => c.textContent),
    )
    expect(rows).toEqual([
      ["JAN", "Rp3"],
      ["FEB", "Rp7"],
      ["MAR", "Rp0"],
      ["APR", "Rp12"],
    ])
    expect(document.querySelector("tbody th")?.getAttribute("scope")).toBe("row")
  })

  it("clamps the tab stop when the series shrinks", async () => {
    let shrink = () => {}
    function Harness() {
      const [short, setShort] = useState(false)
      shrink = () => setShort(true)
      return short ? (
        <TrendChart series={{ Quotation: [5, 6] }} activeKey="Quotation" monthLabels={["1", "2"]} />
      ) : (
        <TrendChart series={SERIES} activeKey="Quotation" monthLabels={LABELS} />
      )
    }
    await mount(<Harness />)
    await focusPoint(3)
    await act(async () => points()[3].blur())
    await act(async () => shrink())
    expect(points().map((p) => p.tabIndex)).toEqual([-1, 0])
  })

  it("renders no points or table without data", async () => {
    await mount(<TrendChart series={{}} activeKey="Quotation" monthLabels={LABELS} />)
    expect(points()).toHaveLength(0)
    expect(document.querySelector("table")).toBeNull()
  })
})
