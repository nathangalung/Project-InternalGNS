package invoices

import "time"

type Status string

const (
	StatusDraft     Status = "draft"
	StatusSent      Status = "sent"
	StatusPaid      Status = "paid"
	StatusOverdue   Status = "overdue"
	StatusCancelled Status = "cancelled"
)

type Invoice struct {
	ID                  int64      `db:"id"                    json:"id"`
	InvoiceNo           string     `db:"invoice_no"            json:"invoiceNo"`
	QuotationID         int64      `db:"quotation_id"          json:"quotationId"`
	QuotationNo         string     `db:"quotation_no"          json:"quotationNo"`
	PoID                *int64     `db:"po_id"                 json:"poId,omitempty"`
	CompanyClientID     int64      `db:"company_client_id"     json:"companyClientId"`
	CompanyName         string     `db:"company_name"          json:"companyName"`
	InvoiceDate         time.Time  `db:"invoice_date"          json:"invoiceDate"`
	DueDate             *time.Time `db:"due_date"              json:"dueDate,omitempty"`
	Subtotal            *string    `db:"subtotal"              json:"subtotal,omitempty"`
	TotalDiscount       *string    `db:"total_discount"        json:"totalDiscount,omitempty"`
	Dpp                 *string    `db:"dpp"                   json:"dpp,omitempty"`
	DppNilaiLain        *string    `db:"dpp_nilai_lain"        json:"dppNilaiLain,omitempty"`
	PpnAmount           *string    `db:"ppn_amount"            json:"ppnAmount,omitempty"`
	Total               *string    `db:"total"                 json:"total,omitempty"`
	Status              Status     `db:"status"                json:"status"`
	TaxTransactionCode  *string    `db:"tax_transaction_code"  json:"taxTransactionCode,omitempty"`
	FakturType          *string    `db:"faktur_type"           json:"fakturType,omitempty"`
	RowVersion          int32      `db:"row_version"             json:"rowVersion"`
	CreatedAt           time.Time  `db:"created_at"              json:"createdAt"`
	UpdatedAt           time.Time  `db:"updated_at"              json:"updatedAt"`
	AttachmentObjectKey *string    `db:"attachment_object_key"   json:"attachmentObjectKey,omitempty"`
}

// UpdateAttachmentRequest persists the MinIO object key for an invoice
// payment receipt or similar attachment.
type UpdateAttachmentRequest struct {
	ObjectKey string `json:"objectKey"`
}

// Invoice line snapshot row.
type InvoiceItem struct {
	ID              int64   `db:"id"                 json:"id"`
	InvoiceID       int64   `db:"invoice_id"         json:"invoiceId"`
	LineNumber      *int16  `db:"line_number"        json:"lineNumber,omitempty"`
	LineType        string  `db:"line_type"          json:"lineType"`
	ItemCode        *string `db:"item_code"          json:"itemCode,omitempty"`
	ItemName        string  `db:"item_name"          json:"itemName"`
	OfferedItemID   *int64  `db:"offered_item_id"    json:"offeredItemId,omitempty"`
	UnitID          *int16  `db:"unit_id"            json:"unitId,omitempty"`
	UnitCode        *string `db:"unit_code"          json:"unitCode,omitempty"`
	UnitCoretaxCode *string `db:"unit_coretax_code"  json:"unitCoretaxCode,omitempty"`
	Qty             string  `db:"qty"                json:"qty"`
	UnitPrice       string  `db:"unit_price"         json:"unitPrice"`
	GrossUnitPrice  *string `db:"gross_unit_price"   json:"grossUnitPrice,omitempty"`
	CostPrice       *string `db:"cost_price"         json:"costPrice,omitempty"`
	Dpp             *string `db:"dpp"                json:"dpp,omitempty"`
	DppNilaiLain    *string `db:"dpp_nilai_lain"     json:"dppNilaiLain,omitempty"`
	PpnRate         *string `db:"ppn_rate"           json:"ppnRate,omitempty"`
	PpnAmount       *string `db:"ppn_amount"         json:"ppnAmount,omitempty"`
	ShipDestination *string `db:"ship_destination"   json:"shipDestination,omitempty"`
	GoodsOrService  *string `db:"goods_or_service"   json:"goodsOrService,omitempty"`
}

// Invoice list KPI aggregates.
type Summary struct {
	Total   int64 `db:"total"   json:"total"`
	Draft   int64 `db:"draft"   json:"draft"`
	Sent    int64 `db:"sent"    json:"sent"`
	Paid    int64 `db:"paid"    json:"paid"`
	Overdue int64 `db:"overdue" json:"overdue"`
}

type ChangeStatusRequest struct {
	Status Status `json:"status"`
}

type UpdateDatesRequest struct {
	InvoiceDate *time.Time `json:"invoiceDate,omitempty"`
	DueDate     *time.Time `json:"dueDate,omitempty"`
}

type ListFilter struct {
	Q                 string
	Statuses          []string
	EffectiveStatuses []string // draft|sent|paid|overdue with summary semantics
	DateFrom          *time.Time
	DateTo            *time.Time
	DueFrom           *time.Time
	DueTo             *time.Time
	MinTotal          *string
	MaxTotal          *string
	SortBy            string
	SortDir           string
	Limit             int
	Offset            int
}

type ListResult struct {
	Rows  []Invoice
	Total int64
}
