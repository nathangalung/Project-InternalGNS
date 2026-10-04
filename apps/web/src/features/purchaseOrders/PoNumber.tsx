import { PO_NUMBER_MISSING } from "./PurchaseOrderDetail/helpers"

// PO number or muted placeholder.
export default function PoNumber({ value }: { value?: string }) {
  if (value) return <>{value}</>
  return <span className="font-normal text-dark-500">{PO_NUMBER_MISSING}</span>
}
