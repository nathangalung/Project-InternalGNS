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
