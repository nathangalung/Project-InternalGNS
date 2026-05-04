package purchaseorders

import "time"

type Status string

const (
	StatusPending     Status = "PENDING"
	StatusUploaded    Status = "UPLOADED"
	StatusOnProgress  Status = "ON_PROGRESS"
	StatusDelivered   Status = "DELIVERED"
)

type PurchaseOrder struct {
	ID                int64      `db:"id"                  json:"id"`
	PoNumber          string     `db:"po_number"           json:"poNumber"`
	QuotationID       int64      `db:"quotation_id"        json:"quotationId"`
	QuotationNo       string     `db:"quotation_no"        json:"quotationNo"`
	CompanyClientID   int64      `db:"company_client_id"   json:"companyClientId"`
	CompanyName       string     `db:"company_name"        json:"companyName"`
	PoDate            time.Time  `db:"po_date"             json:"poDate"`
	Status            Status     `db:"status"              json:"status"`
	FileName          *string    `db:"file_name"           json:"fileName,omitempty"`
	FileSize          *int64     `db:"file_size"           json:"fileSize,omitempty"`
	UploadedAt        *time.Time `db:"uploaded_at"         json:"uploadedAt,omitempty"`
	Notes             *string    `db:"notes"               json:"notes,omitempty"`
	FileURL           *string    `db:"file_url"            json:"fileUrl,omitempty"`
	QuotationTotal    *string    `db:"quotation_total"     json:"quotationTotal,omitempty"`
	QuotationSubtotal *string    `db:"quotation_subtotal"  json:"quotationSubtotal,omitempty"`
	CreatedAt         time.Time  `db:"created_at"          json:"createdAt"`
	UpdatedAt         time.Time  `db:"updated_at"          json:"updatedAt"`
}

type ChangeStatusRequest struct {
	Status Status `json:"status"`
}

type UpdateFileRequest struct {
	FileName string `json:"fileName"`
	FileSize int64  `json:"fileSize"`
	FileURL  string `json:"fileUrl"`
}

type UpdateNotesRequest struct {
	Notes string `json:"notes"`
}
