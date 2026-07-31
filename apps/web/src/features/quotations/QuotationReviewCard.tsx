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

const draftInput = "rounded-[4px] border border-[#E5E7EB] p-1.5 text-xs"

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
    <div className="mb-4">
      <div
        className={`flex items-center justify-between border border-[rgba(204,195,216,0.2)] bg-white px-5 py-3 ${
          expanded ? "rounded-t-lg border-b-[rgba(204,195,216,0.15)]" : "rounded-lg"
        }`}
      >
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-bold uppercase tracking-[0.4px] text-[#4A4455]">
            Permintaan Klien Awal
          </span>
          <span className="text-xs text-[#6B7280]">({rows.length} permintaan)</span>
        </div>
        <div className="flex items-center gap-3">
          {expanded && (
            <button
              type="button"
              onClick={startCreate}
              className="rounded-sm border border-[#630ED4] bg-white px-3 py-1.5 text-xs font-semibold text-[#630ED4]"
            >
              + Tambah Permintaan
            </button>
          )}
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="flex items-center gap-[5px] rounded-sm border border-[rgba(204,195,216,0.5)] px-2.5 py-[5px] text-xs font-medium text-[#6B7280]"
          >
            {expanded ? "Sembunyikan" : "Tampilkan"}
            <svg
              width="10"
              height="6"
              viewBox="0 0 10 6"
              fill="none"
              className={expanded ? "" : "rotate-180"}
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
        <div className="rounded-b-lg border border-t-0 border-[rgba(204,195,216,0.2)] bg-white p-4">
          {errMsg && (
            <div className="mb-2.5 rounded-sm border border-[rgba(239,68,68,0.2)] bg-[rgba(239,68,68,0.08)] px-3 py-2 text-xs text-[#DC2626]">
              {errMsg}
            </div>
          )}

          {requestsQuery.isLoading && (
            <div className="p-4 text-center text-[13px] text-[#9CA3AF]">Memuat permintaan…</div>
          )}

          {!requestsQuery.isLoading && rows.length === 0 && draft === null && (
            <div className="p-4 text-center text-[13px] text-[#9CA3AF]">
              Belum ada permintaan klien. Klik "+ Tambah Permintaan" untuk mulai.
            </div>
          )}

          {rows.length > 0 && (
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#E5E7EB] text-left text-[#6B7280]">
                  <th className="p-2">#</th>
                  <th className="p-2">Deskripsi</th>
                  <th className="p-2">IMPA</th>
                  <th className="p-2">Qty</th>
                  <th className="p-2">UOM</th>
                  <th className="p-2">Status</th>
                  <th className="p-2 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const color = STATUS_COLOR[r.matchStatus]
                  return (
                    <tr key={r.id} className="border-b border-[#F3F4F6]">
                      <td className="p-2 font-semibold">{r.lineNo}</td>
                      <td className="p-2">{r.requestText}</td>
                      <td className="p-2 text-[#6B7280]">{r.requestImpa ?? "-"}</td>
                      <td className="p-2">{r.requestedQty ?? "-"}</td>
                      <td className="p-2 text-[#6B7280]">{r.requestedUom ?? "-"}</td>
                      <td className="p-2">
                        <select
                          value={r.matchStatus}
                          onChange={(e) => changeStatus(r, e.target.value as QuotationMatchStatus)}
                          className="rounded-[4px] border border-[#E5E7EB] px-2 py-1 text-[11px] font-semibold"
                          style={{ background: color.bg, color: color.fg }}
                        >
                          {(Object.keys(STATUS_LABEL) as QuotationMatchStatus[]).map((s) => (
                            <option key={s} value={s}>
                              {STATUS_LABEL[s]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2 text-right">
                        <button
                          type="button"
                          onClick={() => startEdit(r)}
                          className="mr-2 text-xs text-[#630ED4]"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteRow(r.id)}
                          className="text-xs text-error"
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
            <div className="mt-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-3">
              <div className="grid grid-cols-[60px_1fr_1fr] gap-2">
                <input
                  type="number"
                  min={1}
                  value={draft.lineNo}
                  onChange={(e) => setDraft({ ...draft, lineNo: Number(e.target.value) || 1 })}
                  placeholder="#"
                  className={draftInput}
                />
                <input
                  value={draft.requestText}
                  onChange={(e) => setDraft({ ...draft, requestText: e.target.value })}
                  placeholder="Deskripsi (wajib)"
                  className={draftInput}
                />
                <input
                  value={draft.requestImpa}
                  onChange={(e) => setDraft({ ...draft, requestImpa: e.target.value })}
                  placeholder="IMPA"
                  className={draftInput}
                />
              </div>
              <div className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-2">
                <input
                  value={draft.requestedQty}
                  onChange={(e) => setDraft({ ...draft, requestedQty: e.target.value })}
                  placeholder="Qty"
                  className={draftInput}
                />
                <input
                  value={draft.requestedUom}
                  onChange={(e) => setDraft({ ...draft, requestedUom: e.target.value })}
                  placeholder="UOM"
                  className={draftInput}
                />
                <select
                  value={draft.matchStatus}
                  onChange={(e) =>
                    setDraft({ ...draft, matchStatus: e.target.value as QuotationMatchStatus })
                  }
                  className={draftInput}
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
                className={`${draftInput} mt-2 box-border w-full`}
              />
              <div className="mt-2.5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDraft(null)}
                  className="rounded-sm border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs text-[#4A4455]"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={submitDraft}
                  disabled={upsert.isPending}
                  className="rounded-sm bg-[#630ED4] px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-wait disabled:opacity-70"
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
