import { useState } from "react"
import {
  useDeleteQuotationRequest,
  useQuotationRequests,
  useUpsertQuotationRequest,
} from "@/features/quotations/hooks"
import type {
  QuotationItemRequestRow,
  QuotationMatchStatus,
  QuotationRequestSource,
} from "@/types/api"

interface QuotationReviewCardProps {
  quotationId: number
}

interface DraftRow {
  id?: number
  lineNo: number
  requestText: string
  requestImpa: string
  requestedQty: string
  requestedUom: string
  matchStatus: QuotationMatchStatus
  sourceType: QuotationRequestSource
  notes: string
}

function emptyDraft(nextLineNo: number): DraftRow {
  return {
    lineNo: nextLineNo,
    requestText: "",
    requestImpa: "",
    requestedQty: "",
    requestedUom: "",
    matchStatus: "pending",
    sourceType: "manual",
    notes: "",
  }
}

function rowToDraft(r: QuotationItemRequestRow): DraftRow {
  return {
    id: r.id,
    lineNo: r.lineNo,
    requestText: r.requestText,
    requestImpa: r.requestImpa ?? "",
    requestedQty: r.requestedQty ?? "",
    requestedUom: r.requestedUom ?? "",
    matchStatus: r.matchStatus,
    sourceType: r.sourceType,
    notes: r.notes ?? "",
  }
}

const STATUS_LABEL: Record<QuotationMatchStatus, string> = {
  pending: "Belum Direview",
  matched: "Cocok",
  substituted: "Substitusi",
  unavailable: "Tidak Tersedia",
}

const STATUS_COLOR: Record<QuotationMatchStatus, { bg: string; fg: string }> = {
  pending: { bg: "rgba(245, 158, 11, 0.1)", fg: "#B45309" },
  matched: { bg: "rgba(16, 185, 129, 0.1)", fg: "#059669" },
  substituted: { bg: "rgba(59, 130, 246, 0.1)", fg: "#1D4ED8" },
  unavailable: { bg: "rgba(239, 68, 68, 0.1)", fg: "#DC2626" },
}

export default function QuotationReviewCard({ quotationId }: QuotationReviewCardProps) {
  const requestsQuery = useQuotationRequests(quotationId)
  const upsert = useUpsertQuotationRequest()
  const remove = useDeleteQuotationRequest()

  const [expanded, setExpanded] = useState(false)
  const [draft, setDraft] = useState<DraftRow | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  const rows = requestsQuery.data ?? []
  const nextLineNo = rows.reduce((m, r) => Math.max(m, r.lineNo), 0) + 1

  function startCreate() {
    setErrMsg(null)
    setDraft(emptyDraft(nextLineNo))
  }

  function startEdit(r: QuotationItemRequestRow) {
    setErrMsg(null)
    setDraft(rowToDraft(r))
  }

  async function submitDraft() {
    if (!draft) return
    if (!draft.requestText.trim()) {
      setErrMsg("Nama/Deskripsi permintaan wajib diisi.")
      return
    }
    if (draft.lineNo <= 0) {
      setErrMsg("Nomor baris harus > 0.")
      return
    }
    const base = {
      lineNo: draft.lineNo,
      requestText: draft.requestText.trim(),
      requestImpa: draft.requestImpa.trim() || undefined,
      requestedQty: draft.requestedQty.trim() || undefined,
      requestedUom: draft.requestedUom.trim() || undefined,
      notes: draft.notes.trim() || undefined,
    }
    try {
      if (draft.id === undefined) {
        await upsert.mutateAsync({
          quotationId,
          input: {
            ...base,
            matchStatus: draft.matchStatus,
            sourceType: draft.sourceType,
          },
        })
      } else {
        await upsert.mutateAsync({
          quotationId,
          requestId: draft.id,
          input: {
            ...base,
            matchStatus: draft.matchStatus,
            sourceType: draft.sourceType,
          },
        })
      }
      setDraft(null)
    } catch (e) {
      setErrMsg((e as Error).message)
    }
  }

  async function deleteRow(id: number) {
    if (!confirm("Hapus permintaan ini?")) return
    try {
      await remove.mutateAsync({ quotationId, requestId: id })
    } catch (e) {
      setErrMsg((e as Error).message)
    }
  }

  async function changeStatus(r: QuotationItemRequestRow, next: QuotationMatchStatus) {
    if (next === r.matchStatus) return
    try {
      await upsert.mutateAsync({
        quotationId,
        requestId: r.id,
        input: {
          lineNo: r.lineNo,
          requestText: r.requestText,
          requestImpa: r.requestImpa,
          requestedQty: r.requestedQty,
          requestedUom: r.requestedUom,
          matchedItemId: r.matchedItemId,
          matchStatus: next,
          sourceType: r.sourceType,
          sourceRef: r.sourceRef,
          notes: r.notes,
        },
      })
    } catch (e) {
      setErrMsg((e as Error).message)
    }
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 20px",
          background: "#FFFFFF",
          border: "1px solid rgba(204,195,216,0.2)",
          borderRadius: expanded ? "12px 12px 0 0" : "12px",
          borderBottom: expanded
            ? "1px solid rgba(204,195,216,0.15)"
            : "1px solid rgba(204,195,216,0.2)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.4px",
              textTransform: "uppercase",
              color: "#4A4455",
            }}
          >
            Permintaan Klien Awal
          </span>
          <span style={{ fontSize: 12, color: "#6B7280" }}>({rows.length} permintaan)</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {expanded && (
            <button
              type="button"
              onClick={startCreate}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid #630ED4",
                background: "#fff",
                color: "#630ED4",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
                fontFamily: "'Inter', sans-serif",
              }}
            >
              + Tambah Permintaan
            </button>
          )}
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              background: "none",
              border: "1px solid rgba(204,195,216,0.5)",
              borderRadius: 6,
              padding: "5px 10px",
              cursor: "pointer",
              fontSize: 12,
              color: "#6B7280",
              fontFamily: "'Inter', sans-serif",
              fontWeight: 500,
            }}
          >
            {expanded ? "Sembunyikan" : "Tampilkan"}
            <svg
              width="10"
              height="6"
              viewBox="0 0 10 6"
              fill="none"
              style={{ transform: expanded ? "rotate(0deg)" : "rotate(180deg)" }}
            >
              <path
                d="M1 5L5 1L9 5"
                stroke="#6B7280"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {expanded && (
        <div
          style={{
            background: "#FFFFFF",
            border: "1px solid rgba(204,195,216,0.2)",
            borderTop: "none",
            borderRadius: "0 0 12px 12px",
            padding: 16,
          }}
        >
          {errMsg && (
            <div
              style={{
                padding: "8px 12px",
                marginBottom: 10,
                borderRadius: 6,
                background: "rgba(239,68,68,0.08)",
                color: "#DC2626",
                fontSize: 12,
                border: "1px solid rgba(239,68,68,0.2)",
              }}
            >
              {errMsg}
            </div>
          )}

          {requestsQuery.isLoading && (
            <div style={{ padding: 16, color: "#9CA3AF", fontSize: 13, textAlign: "center" }}>
              Memuat permintaan…
            </div>
          )}

          {!requestsQuery.isLoading && rows.length === 0 && draft === null && (
            <div style={{ padding: 16, color: "#9CA3AF", fontSize: 13, textAlign: "center" }}>
              Belum ada permintaan klien. Klik "+ Tambah Permintaan" untuk mulai.
            </div>
          )}

          {rows.length > 0 && (
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr
                  style={{ textAlign: "left", color: "#6B7280", borderBottom: "1px solid #E5E7EB" }}
                >
                  <th style={{ padding: 8 }}>#</th>
                  <th style={{ padding: 8 }}>Deskripsi</th>
                  <th style={{ padding: 8 }}>IMPA</th>
                  <th style={{ padding: 8 }}>Qty</th>
                  <th style={{ padding: 8 }}>UOM</th>
                  <th style={{ padding: 8 }}>Status</th>
                  <th style={{ padding: 8, textAlign: "right" }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const color = STATUS_COLOR[r.matchStatus]
                  return (
                    <tr key={r.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                      <td style={{ padding: 8, fontWeight: 600 }}>{r.lineNo}</td>
                      <td style={{ padding: 8 }}>{r.requestText}</td>
                      <td style={{ padding: 8, color: "#6B7280" }}>{r.requestImpa ?? "-"}</td>
                      <td style={{ padding: 8 }}>{r.requestedQty ?? "-"}</td>
                      <td style={{ padding: 8, color: "#6B7280" }}>{r.requestedUom ?? "-"}</td>
                      <td style={{ padding: 8 }}>
                        <select
                          value={r.matchStatus}
                          onChange={(e) => changeStatus(r, e.target.value as QuotationMatchStatus)}
                          style={{
                            padding: "4px 8px",
                            border: "1px solid #E5E7EB",
                            borderRadius: 4,
                            background: color.bg,
                            color: color.fg,
                            fontWeight: 600,
                            fontSize: 11,
                          }}
                        >
                          {(Object.keys(STATUS_LABEL) as QuotationMatchStatus[]).map((s) => (
                            <option key={s} value={s}>
                              {STATUS_LABEL[s]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: 8, textAlign: "right" }}>
                        <button
                          type="button"
                          onClick={() => startEdit(r)}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "#630ED4",
                            cursor: "pointer",
                            marginRight: 8,
                            fontSize: 12,
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteRow(r.id)}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "#EF4444",
                            cursor: "pointer",
                            fontSize: 12,
                          }}
                        >
                          Hapus
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          {draft && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                background: "#F9FAFB",
                border: "1px solid #E5E7EB",
                borderRadius: 8,
              }}
            >
              <div style={{ display: "grid", gridTemplateColumns: "60px 1fr 1fr", gap: 8 }}>
                <input
                  type="number"
                  min={1}
                  value={draft.lineNo}
                  onChange={(e) => setDraft({ ...draft, lineNo: Number(e.target.value) || 1 })}
                  placeholder="#"
                  style={{
                    padding: 6,
                    border: "1px solid #E5E7EB",
                    borderRadius: 4,
                    fontSize: 12,
                  }}
                />
                <input
                  value={draft.requestText}
                  onChange={(e) => setDraft({ ...draft, requestText: e.target.value })}
                  placeholder="Deskripsi (wajib)"
                  style={{
                    padding: 6,
                    border: "1px solid #E5E7EB",
                    borderRadius: 4,
                    fontSize: 12,
                  }}
                />
                <input
                  value={draft.requestImpa}
                  onChange={(e) => setDraft({ ...draft, requestImpa: e.target.value })}
                  placeholder="IMPA"
                  style={{
                    padding: 6,
                    border: "1px solid #E5E7EB",
                    borderRadius: 4,
                    fontSize: 12,
                  }}
                />
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 8,
                  marginTop: 8,
                }}
              >
                <input
                  value={draft.requestedQty}
                  onChange={(e) => setDraft({ ...draft, requestedQty: e.target.value })}
                  placeholder="Qty"
                  style={{
                    padding: 6,
                    border: "1px solid #E5E7EB",
                    borderRadius: 4,
                    fontSize: 12,
                  }}
                />
                <input
                  value={draft.requestedUom}
                  onChange={(e) => setDraft({ ...draft, requestedUom: e.target.value })}
                  placeholder="UOM"
                  style={{
                    padding: 6,
                    border: "1px solid #E5E7EB",
                    borderRadius: 4,
                    fontSize: 12,
                  }}
                />
                <select
                  value={draft.matchStatus}
                  onChange={(e) =>
                    setDraft({ ...draft, matchStatus: e.target.value as QuotationMatchStatus })
                  }
                  style={{
                    padding: 6,
                    border: "1px solid #E5E7EB",
                    borderRadius: 4,
                    fontSize: 12,
                  }}
                >
                  {(Object.keys(STATUS_LABEL) as QuotationMatchStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
              <input
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                placeholder="Catatan (opsional)"
                style={{
                  marginTop: 8,
                  width: "100%",
                  padding: 6,
                  border: "1px solid #E5E7EB",
                  borderRadius: 4,
                  fontSize: 12,
                  boxSizing: "border-box",
                }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setDraft(null)}
                  style={{
                    padding: "6px 12px",
                    border: "1px solid #E5E7EB",
                    borderRadius: 6,
                    background: "#fff",
                    color: "#4A4455",
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={submitDraft}
                  disabled={upsert.isPending}
                  style={{
                    padding: "6px 12px",
                    border: "none",
                    borderRadius: 6,
                    background: "#630ED4",
                    color: "#fff",
                    cursor: upsert.isPending ? "wait" : "pointer",
                    fontSize: 12,
                    fontWeight: 600,
                    opacity: upsert.isPending ? 0.7 : 1,
                  }}
                >
                  {upsert.isPending ? "Menyimpan…" : "Simpan"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
