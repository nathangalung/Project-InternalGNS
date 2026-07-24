# Coretax export review

Findings from the export audit, with proposed diffs. Nothing here has been
applied. The Coretax XLSX and XML go to the DJP importer, which cannot be
tested from this repo, so validate against one real import before changing the
format. The bundled template `apps/api/templates/documents/coretax/coretax_export_2026.xlsx`
carries the DJP `Keterangan` (per-column spec) and `REF` (code list) sheets;
the row citations below are from those sheets.

Most of the export is already correct: the Opt remap (Barang to A, Jasa to B),
the DPP Nilai Lain and 12 percent PPN mechanism (PMK-131/2024), the XLSX header
structure, and the TIN-buyer IDTKU fallback all match the spec.

## 1. DetailFaktur "Baris" is a per-line ordinal, spec wants the parent Faktur Baris (HIGH, validate first)

`internal/invoices/coretax_xlsx.go:165-175`. Each detail row writes `j + 1`, a
line index that restarts at 1 for every invoice. Keterangan row 22 says
DetailFaktur.Baris must equal the Baris of the parent Faktur row, which the code
writes as `i + 1` (`coretax_xlsx.go:153`). So a 3-line invoice emits detail
Baris 1, 2, 3 against Faktur Baris 1, and invoice 2's first line gets Baris 1,
pointing at invoice 1.

Proposed diff:

```go
// coretax_xlsx.go
-		for j, g := range tx.ListOfGoodSrv {
+		for _, g := range tx.ListOfGoodSrv {
 			code := g.Code
 			if code == "" {
 				code = "000000"
 			}
 			detail := []any{
-				j + 1, g.Opt, code, g.Name, g.Unit,
+				i + 1, g.Opt, code, g.Name, g.Unit,
```

Validation caveat: the template has a 15th "Nomor Invoice" column that the code
already fills with `inv.InvoiceNo` (`coretax_xlsx.go:174`), and the 14-column
Keterangan spec does not list it. If the real importer joins detail rows to
Faktur rows on that invoice number, the wrong Baris is tolerated today and this
change is a no-op; if it joins on Baris, the current output is broken. Confirm
with one import of a workbook holding two invoices, at least one with two or
more lines, before applying.

## 2. No-NPWP buyer emits spec-violating fields (MEDIUM, needs a schema field)

`internal/invoices/coretax.go:148-162`. When the client has no NPWP the code
sets `buyerDoc = "Passport"`, leaves `BuyerTin`/`BuyerIDTKU` empty, and never
sets a document number. Against the spec:

- Keterangan r13: NPWP/NIK must be `"0000000000000000"` for a non-TIN buyer, not empty.
- r20: ID TKU must be `"000000"` for a non-TIN buyer, not empty.
- r16: the document number is mandatory, but `clients.Client` has no NIK or
  passport field to source it from.
- REF r94-98: a domestic buyer without NPWP is `"National ID"` (NIK), not the
  hardcoded `"Passport"`; a foreign passport buyer also needs TrxCode `06`, not `04`.

The normal UI flow blocks this: promotion to `ON_PROGRESS` requires a complete
NPWP (`purchaseOrders/PurchaseOrderDetail/helpers.ts:64`, `index.tsx:206-229`),
so a PO cannot auto-invoice a client with a blank NPWP. But that gate is
client-side only; the backend transition and the coretax endpoints do not check.
A proper fix adds a NIK/passport field to the client model, derives the document
type from country (IDN to National ID, else Passport), and emits the r13/r20
placeholders. Because the path is already blocked in the UI, treat this as a
deliberate feature, not a hotfix.

## 3. XML output diverges from the correct XLSX (MEDIUM)

The XLSX is spec-correct on these fields; the XML in `coretax.go` is not, so the
two formats disagree for the same invoice:

- `BuyerDocumentNumber` is never set in `coretaxInvoiceFor`, so every XML emits
  it empty, while the XLSX writes `"-"` for TIN buyers (Keterangan r16 mandates
  `"-"` for TIN). Set `BuyerDocumentNumber` to `"-"` (or the real number once
  field 2 exists) in `coretaxInvoiceFor`.
- The XML `Export` guard checks only `SellerTIN` (`coretax.go:82`); the XLSX
  builder guards neither seller field. Give both endpoints the same precondition.

## 4. XML export does not guard an empty SellerIDTKU (LOW)

`internal/invoices/coretax.go:81-85` returns 503 when `SellerTIN` is empty but
not when `SellerIDTKU` is empty, so an unset `CORETAX_SELLER_IDTKU` yields XML
with an empty `<SellerIDTKU>` (Keterangan r12 requires a 22-digit NITKU).

```go
 	if h.settings.SellerTIN == "" {
 		httperr.Render(w, httperr.ServiceUnavailable("coretax seller TIN not configured"))
 		return
 	}
+	if h.settings.SellerIDTKU == "" {
+		httperr.Render(w, httperr.ServiceUnavailable("coretax seller IDTKU not configured"))
+		return
+	}
```

The XLSX builder should get the same two guards.

## 5. PPN can differ from Coretax's own recomputation by 0.01 (LOW, needs a migration)

Migration `00030_coretax_field_population.sql:66-69` computes
`ppn_amount = ROUND(subtotal * 11/12 * 0.12, 2)` from the raw subtotal, but
Keterangan r33 defines PPN for codes 01/04/09 as `rate x DPP Nilai Lain`, i.e.
from the already-rounded `dpp_nilai_lain`. At sub-cent boundaries
`ROUND(0.11 * subtotal)` can differ from `ROUND(0.12 * ROUND(subtotal * 11/12))`,
and Coretax likely validates the latter. Fix by recomputing from
`dpp_nilai_lain`. Migrations are append-only, so this is a new migration that
redefines the function and backfills existing invoices; verify the recomputed
values against a sample before applying.

## Suggested order

1. Validate the Baris behavior with a real 2-invoice, multi-line import. Apply
   finding 1 only if the importer keys on Baris.
2. Apply findings 3 and 4 (XML/XLSX consistency and the seller guards) together;
   they do not change any valid output, only reject misconfigured or fill
   already-blank fields.
3. Schedule finding 2 (client NIK/passport field) as a feature.
4. Schedule finding 5 (PPN migration) once you can diff the recomputed amounts.
