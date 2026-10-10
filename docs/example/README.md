# Export examples

One file of every document and spreadsheet the app exports, made by
`make examples` from a single invented sale on a throwaway database
(`gns_examples_test`). Every company, person, number and amount is made
up; nothing comes from `Data/` or production.

The sale: PT Samudra Contoh Nusantara asks for five products (COIL, PACK,
TIN, PCS and MTR lines from two vendors), with a 5% discount, a shipping
charge and 12% PPN. Quotation Q-00001/GNS/X/2026 is sent and accepted, the PO
gets its file and the client's PO number, goes to ON_PROGRESS and
DELIVERED, and invoice INV-00001/GNS/X/2026 is sent. Kas Lain holds one Masuk and
one Keluar entry.

| File | Route | What it is |
| --- | --- | --- |
| `quotation.pdf` | `GET /api/v1/quotations/{id}/pdf` | Quotation PDF |
| `delivery-note.pdf` | `GET /api/v1/purchase-orders/{id}/delivery-note.pdf` | Surat Jalan (delivery note) PDF |
| `invoice.pdf` | `GET /api/v1/invoices/{id}/pdf` | Invoice PDF |
| `coretax-faktur.xml` | `GET /api/v1/invoices/{id}/coretax.xml` | Coretax XML of one invoice |
| `quotation-export.xlsx` | `GET /api/v1/quotations/export.xlsx` | Quotation list (Ekspor Excel) |
| `delivery-note-export.xlsx` | `GET /api/v1/purchase-orders/export.xlsx` | PO and delivery note list (Ekspor Excel) |
| `invoice-export.xlsx` | `GET /api/v1/invoices/export.xlsx` | Invoice list (Ekspor Excel), the payment reminder source |
| `coretax-export.xlsx` | `GET /api/v1/invoices/coretax.xlsx` | Coretax bulk import workbook |
| `dashboard-export.xlsx` | `GET /api/v1/dashboard/export.xlsx` | Financial dashboard (Ekspor Excel) |
| `kas-lain.xlsx` | `GET /api/v1/cash-entries/export.xlsx` | Kas Lain (Ekspor Excel) |

Regenerate after a template or export change with `make examples`
(needs `make deps-up` and xelatex). The dates are the day it ran.
