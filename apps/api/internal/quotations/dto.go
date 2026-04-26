package quotations

import (
	"encoding/json"
	"time"
)

// ─── DB shapes ────────────────────────────────────────────────

// Quotation mirrors quotations table (header).
type Quotation struct {
	ID                int64     `db:"id"                  json:"id"`
	QuotationNo       string    `db:"quotation_no"        json:"quotationNo"`
	Version           int16     `db:"version"             json:"version"`
	CompanyClientID   int64     `db:"company_client_id"   json:"companyClientId"`
	CompanyClientName string    `db:"company_client_name" json:"companyClientName"`
	ContactID         *int64    `db:"contact_id"          json:"contactId,omitempty"`
	ContactName       *string   `db:"contact_name"        json:"contactName,omitempty"`
	ClientRefNo       *string   `db:"client_ref_no"       json:"clientRefNo,omitempty"`
	VesselName        *string   `db:"vessel_name"         json:"vesselName,omitempty"`
	Status            string    `db:"status"              json:"status"`
	PaymentTerms      *string   `db:"payment_terms"       json:"paymentTerms,omitempty"`
	ValidityDays      *int      `db:"validity_days"       json:"validityDays,omitempty"`
	DiscountPct       string    `db:"discount_pct"        json:"discountPct"`
	TotalProduk       string    `db:"total_produk"        json:"totalProduk"`
	Total             string    `db:"total"               json:"total"`
	TotalDiscount     string    `db:"total_discount"      json:"totalDiscount"`
	Notes             *string   `db:"notes"               json:"notes,omitempty"`
	CreatedAt         time.Time `db:"created_at"          json:"createdAt"`
	UpdatedAt         time.Time `db:"updated_at"          json:"updatedAt"`
}

// QuotationItem mirrors quotation_items.
type QuotationItem struct {
	ID                int64   `db:"id"                  json:"id"`
	QuotationID       int64   `db:"quotation_id"        json:"quotationId"`
	LineNumber        int16   `db:"line_number"         json:"lineNumber"`
	ItemType          string  `db:"item_type"           json:"itemType"` // 'product' | 'shipping'
	RequestedItemID   *int64  `db:"requested_item_id"   json:"requestedItemId,omitempty"`
	RequestedIMPA     *string `db:"requested_impa"      json:"requestedImpa,omitempty"`
	RequestedName     string  `db:"requested_name"      json:"requestedName"`
	OfferedItemID     *int64  `db:"offered_item_id"     json:"offeredItemId,omitempty"`
	VendorProductID   *int64  `db:"vendor_product_id"   json:"vendorProductId,omitempty"`
	Qty               string  `db:"qty"                 json:"qty"`
	UnitID            *int16  `db:"unit_id"             json:"unitId,omitempty"`
	SellingPrice      string  `db:"selling_price"       json:"sellingPrice"`
	CostPrice         *string `db:"cost_price"          json:"costPrice,omitempty"`
	DiscountPct       string  `db:"discount_pct"        json:"discountPct"`
	TotalSelling      string  `db:"total_selling"       json:"totalSelling"`
	DiscountAmount    string  `db:"discount_amount"     json:"discountAmount"`
	Subtotal          string  `db:"subtotal"            json:"subtotal"`
	IsAvailable       bool    `db:"is_available"        json:"isAvailable"`
	ShipDestination   *string `db:"ship_destination"    json:"shipDestination,omitempty"`
}

// StatusHistoryEntry mirrors quotation_status_history.
type StatusHistoryEntry struct {
	ID         int64     `db:"id"           json:"id"`
	FromStatus *string   `db:"from_status"  json:"fromStatus,omitempty"`
	ToStatus   string    `db:"to_status"    json:"toStatus"`
	Note       *string   `db:"note"         json:"note,omitempty"`
	ChangedBy  int64     `db:"changed_by"   json:"changedBy"`
	ChangedAt  time.Time `db:"changed_at"   json:"changedAt"`
}

// QuotationDetail combines header + items + history (untuk GET /{id}).
type QuotationDetail struct {
	Quotation
	Items   []QuotationItem      `json:"items"`
	History []StatusHistoryEntry `json:"history"`
}

// ListRow is row shape untuk GET /quotations (list page).
type ListRow struct {
	ID              int64     `db:"id"               json:"id"`
	QuotationNo     string    `db:"quotation_no"     json:"quotationNo"`
	Version         int16     `db:"version"          json:"version"`
	CompanyName     string    `db:"company_name"     json:"companyName"`
	Status          string    `db:"status"           json:"status"`
	Total           string    `db:"total"            json:"total"`
	TotalHargaBeli  string    `db:"total_harga_beli" json:"totalHargaBeli"` // SUM(qty * cost_price) WHERE item_type='product'
	CreatedAt       time.Time `db:"created_at"       json:"createdAt"`
}

// StatusCount untuk GET /quotations/stats summary cards.
type StatusCount struct {
	Status string `db:"status" json:"status"`
	Count  int64  `db:"count"  json:"count"`
}

// ─── Request shapes ───────────────────────────────────────────

// CreateItem is one item dalam request POST /quotations.
// Dikirim sebagai JSONB array ke fn_create_quotation.
type CreateItem struct {
	RequestedItemID    *int64  `json:"requestedItemId,omitempty"`
	RequestedImpa      *string `json:"requestedImpa,omitempty"`
	RequestedName      string  `json:"requestedName"`
	OfferedItemID      *int64  `json:"offeredItemId,omitempty"`
	VendorProductID    *int64  `json:"vendorProductId,omitempty"`
	Qty                string  `json:"qty"`            // numeric as string
	UnitID             int16   `json:"unitId"`
	SellingPrice       string  `json:"sellingPrice"`
	CostPrice          *string `json:"costPrice,omitempty"`
	UpdateVendorPrice  bool    `json:"updateVendorPrice,omitempty"`
	ShipDestination    *string `json:"shipDestination,omitempty"`
	DueDate            *string `json:"dueDate,omitempty"` // YYYY-MM-DD
}

// CreateRequest is body untuk POST /quotations (atomic create).
type CreateRequest struct {
	CompanyClientID  int64        `json:"companyClientId"`
	ContactID        *int64       `json:"contactId,omitempty"`
	ClientRefNo      *string      `json:"clientRefNo,omitempty"`
	VesselName       *string      `json:"vesselName,omitempty"`
	PaymentTerms     *string      `json:"paymentTerms,omitempty"`
	ValidityDays     *int         `json:"validityDays,omitempty"`
	DiscountPct      string       `json:"discountPct"`           // 0..100
	ShippingAddress  *string      `json:"shippingAddress,omitempty"`
	ShippingDays     *int         `json:"shippingDays,omitempty"`
	ShippingCost     *string      `json:"shippingCost,omitempty"` // numeric as string
	Items            []CreateItem `json:"items"`
	Notes            *string      `json:"notes,omitempty"`
	Status           *string      `json:"status,omitempty"`       // default 'draft'
}

// UpdateRequest is body untuk PUT /quotations/{id}.
// Sama dengan CreateRequest minus companyClientId/contactId (immutable).
type UpdateRequest struct {
	ClientRefNo      *string      `json:"clientRefNo,omitempty"`
	VesselName       *string      `json:"vesselName,omitempty"`
	PaymentTerms     *string      `json:"paymentTerms,omitempty"`
	ValidityDays     *int         `json:"validityDays,omitempty"`
	DiscountPct      string       `json:"discountPct"`
	ShippingAddress  *string      `json:"shippingAddress,omitempty"`
	ShippingDays     *int         `json:"shippingDays,omitempty"`
	ShippingCost     *string      `json:"shippingCost,omitempty"`
	Items            []CreateItem `json:"items"`
	Notes            *string      `json:"notes,omitempty"`
}

// ChangeStatusRequest is body untuk PATCH /quotations/{id}/status.
type ChangeStatusRequest struct {
	Status string  `json:"status"`        // canonical: draft|sent|accepted|rejected|revision|expired
	Note   *string `json:"note,omitempty"`
}

// ─── Helper for marshaling items to JSONB ─────────────────────

// itemsToJSONB converts []CreateItem to JSONB-ready bytes for fn_create_quotation.
func itemsToJSONB(items []CreateItem) ([]byte, error) {
	return json.Marshal(items)
}
