import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import * as dashboardApi from "@/features/dashboard/api"
import { queryKeys } from "@/lib/query-keys"
import { toast } from "@/lib/toast"
import type { DashboardMetric } from "@/types/api"

export function useDashboardSummary() {
  return useQuery({
    queryKey: queryKeys.dashboard.summary(),
    queryFn: dashboardApi.summary,
  })
}

export function useDashboardTimeseries(
  metric: DashboardMetric,
  from?: string,
  to?: string,
  interval?: "month" | "day",
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.dashboard.timeseries(metric, from, to, interval),
    queryFn: () => dashboardApi.timeseries(metric, from, to, interval),
    enabled,
  })
}

// XLSX export with error toast.
//
// The download error carries English status text, so the toast uses fixed
// Indonesian copy. A cancelled save picker resolves quietly and never toasts.
export function useDashboardExport() {
  const [exporting, setExporting] = useState(false)
  const exportXlsx = async (year: number) => {
    setExporting(true)
    try {
      await dashboardApi.exportXlsx(year)
    } catch {
      toast.error("Gagal mengunduh file Excel dashboard. Coba lagi.")
    } finally {
      setExporting(false)
    }
  }
  return { exporting, exportXlsx }
}
