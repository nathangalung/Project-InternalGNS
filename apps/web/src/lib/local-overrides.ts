// Lightweight localStorage overlay used to keep edit/save flows working when the
// matching backend endpoints are absent. Per-resource storage key holds a
// Record<id, Partial<Row>> patch; readers merge it on top of API results.

type IdMap<T> = Record<string, Partial<T>>

function read<T>(key: string): IdMap<T> {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object") return parsed as IdMap<T>
    return {}
  } catch {
    return {}
  }
}

function write<T>(key: string, store: IdMap<T>) {
  localStorage.setItem(key, JSON.stringify(store))
}

export function getOverride<T>(key: string, id: number): Partial<T> | undefined {
  return read<T>(key)[String(id)]
}

export function getAllOverrides<T>(key: string): IdMap<T> {
  return read<T>(key)
}

export function setOverride<T>(key: string, id: number, patch: Partial<T>) {
  const store = read<T>(key)
  store[String(id)] = { ...store[String(id)], ...patch }
  write(key, store)
}

export function applyOverrides<T extends { id: number }>(rows: T[], key: string): T[] {
  const store = read<T>(key)
  return rows.map(r => {
    const patch = store[String(r.id)]
    return patch ? ({ ...r, ...patch } as T) : r
  })
}

export function applyOverride<T extends { id: number }>(row: T, key: string): T {
  const patch = read<T>(key)[String(row.id)]
  return patch ? ({ ...row, ...patch } as T) : row
}
