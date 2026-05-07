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
	ID                 int64      `db:"id"                    json:"id"`
	InvoiceNo          string     `db:"invoice_no"            json:"invoiceNo"`
	QuotationID        int64      `db:"quotation_id"          json:"quotationId"`
	QuotationNo        string     `db:"quotation_no"          json:"quotationNo"`
	PoID               *int64     `db:"po_id"                 json:"poId,omitempty"`
	CompanyClientID    int64      `db:"company_client_id"     json:"companyClientId"`
	CompanyName        string     `db:"company_name"          json:"companyName"`
	InvoiceDate        time.Time  `db:"invoice_date"          json:"invoiceDate"`
	DueDate            *time.Time `db:"due_date"              json:"dueDate,omitempty"`
	Subtotal           *string    `db:"subtotal"              json:"subtotal,omitempty"`
	Dpp                *string    `db:"dpp"                   json:"dpp,omitempty"`
	DppNilaiLain       *string    `db:"dpp_nilai_lain"        json:"dppNilaiLain,omitempty"`
	PpnAmount          *string    `db:"ppn_amount"            json:"ppnAmount,omitempty"`
	Total              *string    `db:"total"                 json:"total,omitempty"`
	Status             Status     `db:"status"                json:"status"`
	TaxTransactionCode *string    `db:"tax_transaction_code"  json:"taxTransactionCode,omitempty"`
	FakturType         *string    `db:"faktur_type"           json:"fakturType,omitempty"`
	CreatedAt          time.Time  `db:"created_at"            json:"createdAt"`
	UpdatedAt          time.Time  `db:"updated_at"            json:"updatedAt"`
}

// Invoice line snapshot row.
type InvoiceItem struct {
	ID            int64   `db:"id"               json:"id"`
	InvoiceID     int64   `db:"invoice_id"       json:"invoiceId"`
	LineNumber    *int16  `db:"line_number"      json:"lineNumber,omitempty"`
	LineType      string  `db:"line_type"        json:"lineType"`
	ItemCode      *string `db:"item_code"        json:"itemCode,omitempty"`
	ItemName      string  `db:"item_name"        json:"itemName"`
	OfferedItemID *int64  `db:"offered_item_id"  json:"offeredItemId,omitempty"`
	UnitID        *int16  `db:"unit_id"          json:"unitId,omitempty"`
	UnitCode      *string `db:"unit_code"        json:"unitCode,omitempty"`
	Qty           string  `db:"qty"              json:"qty"`
	UnitPrice       string  `db:"unit_price"       json:"unitPrice"`
	CostPrice       *string `db:"cost_price"       json:"costPrice,omitempty"`
	ShipDestination *string `db:"ship_destination" json:"shipDestination,omitempty"`
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
