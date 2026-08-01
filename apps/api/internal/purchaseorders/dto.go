package purchaseorders

import "time"

type Status string

const (
	StatusPending    Status = "PENDING"
	StatusUploaded   Status = "UPLOADED"
	StatusOnProgress Status = "ON_PROGRESS"
	StatusDelivered  Status = "DELIVERED"
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
	FileURL           *string    `db:"file_url"            json:"objectKey,omitempty"`
	QuotationTotal    *string    `db:"quotation_total"     json:"quotationTotal,omitempty"`
	QuotationSubtotal *string    `db:"quotation_subtotal"  json:"quotationSubtotal,omitempty"`
	PoSubtotal        string     `db:"po_subtotal"         json:"poSubtotal"`
	PoTotalProduk     string     `db:"po_total_produk"     json:"poTotalProduk"`
	PoTotalProfit     string     `db:"po_total_profit"     json:"poTotalProfit"`
	RowVersion        int32      `db:"row_version"         json:"rowVersion"`
	CreatedAt         time.Time  `db:"created_at"          json:"createdAt"`
	UpdatedAt         time.Time  `db:"updated_at"          json:"updatedAt"`
}

// PO line snapshot row.
type PurchaseOrderItem struct {
	ID              int64   `db:"id"                 json:"id"`
	PoID            int64   `db:"po_id"              json:"poId"`
	QuotationItemID *int64  `db:"quotation_item_id"  json:"quotationItemId,omitempty"`
	LineNumber      int16   `db:"line_number"        json:"lineNumber"`
	ItemType        string  `db:"item_type"          json:"itemType"`
	OfferedItemID   *int64  `db:"offered_item_id"    json:"offeredItemId,omitempty"`
	ItemCode        *string `db:"item_code"          json:"itemCode,omitempty"`
	ItemName        string  `db:"item_name"          json:"itemName"`
	Qty             string  `db:"qty"                json:"qty"`
	UnitID          *int16  `db:"unit_id"            json:"unitId,omitempty"`
	UnitCode        *string `db:"unit_code"          json:"unitCode,omitempty"`
	SellingPrice    string  `db:"selling_price"      json:"sellingPrice"`
	CostPrice       *string `db:"cost_price"         json:"costPrice,omitempty"`
	Subtotal        string  `db:"subtotal"           json:"subtotal"`
	TotalSelling    string  `db:"total_selling"      json:"totalSelling"`
	ProfitAmount    *string `db:"profit_amount"      json:"profitAmount,omitempty"`
	ShipDestination *string `db:"ship_destination"   json:"shipDestination,omitempty"`
	ShippingDays    *int    `db:"shipping_days"      json:"shippingDays,omitempty"`
	IsAvailable     bool    `db:"is_available"       json:"isAvailable"`
}

type ChangeStatusRequest struct {
	Status Status `json:"status"`
}

type UpdateFileRequest struct {
	FileName  string `json:"fileName"`
	FileSize  int64  `json:"fileSize"`
	ObjectKey string `json:"objectKey"`
}

type UpdateNotesRequest struct {
	Notes string `json:"notes"`
}

type UpdateDetailsRequest struct {
	PoNumber string `json:"poNumber"`
	PoDate   string `json:"poDate"` // YYYY-MM-DD
}

// PO direct edit payload.
type UpdateItemsRequest struct {
	DiscountPct     string            `json:"discountPct"`
	Notes           *string           `json:"notes,omitempty"`
	ShippingAddress *string           `json:"shippingAddress,omitempty"`
	ShippingDays    *int              `json:"shippingDays,omitempty"`
	ShippingCost    *string           `json:"shippingCost,omitempty"`
	Items           []UpdateItemsLine `json:"items"`
}

type UpdateItemsLine struct {
	QuotationItemID *int64  `json:"quotationItemId,omitempty"`
	OfferedItemID   *int64  `json:"offeredItemId,omitempty"`
	ItemName        string  `json:"itemName"`
	ItemCode        *string `json:"itemCode,omitempty"`
	Qty             string  `json:"qty"`
	UnitID          *int16  `json:"unitId,omitempty"`
	SellingPrice    string  `json:"sellingPrice"`
	CostPrice       *string `json:"costPrice,omitempty"`
	IsAvailable     *bool   `json:"isAvailable,omitempty"`
	ShipDestination *string `json:"shipDestination,omitempty"`
}

type ListFilter struct {
	Q        string
	Statuses []string
	DateFrom *time.Time
	DateTo   *time.Time
	MinTotal *string
	MaxTotal *string
	SortBy   string
	SortDir  string
	Limit    int
	Offset   int
}

type ListResult struct {
	Rows  []PurchaseOrder
	Total int64
}
