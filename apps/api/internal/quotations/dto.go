package quotations

import (
	"encoding/json"
	"time"
)

// Quotation mirrors the quotations header.
type Quotation struct {
	ID          int64  `db:"id"                  json:"id"`
	QuotationNo string `db:"quotation_no"        json:"quotationNo"`
	// Number first issued under.
	// Set by a re-import only; nil for app-created quotations.
	LegacyNo          *string   `db:"legacy_no"           json:"legacyNo,omitempty"`
	Version           int16     `db:"version"             json:"version"`
	CompanyClientID   int64     `db:"company_client_id"   json:"companyClientId"`
	CompanyClientName string    `db:"company_client_name" json:"companyClientName"`
	ContactID         *int64    `db:"contact_id"          json:"contactId,omitempty"`
	ContactName       *string   `db:"contact_name"        json:"contactName,omitempty"`
	ClientRefNo       *string   `db:"client_ref_no"       json:"clientRefNo,omitempty"`
	VesselName        *string   `db:"vessel_name"         json:"vesselName,omitempty"`
	Status            Status    `db:"status"              json:"status"`
	PaymentTerms      *string   `db:"payment_terms"       json:"paymentTerms,omitempty"`
	ValidityDays      *int      `db:"validity_days"       json:"validityDays,omitempty"`
	DiscountPct       string    `db:"discount_pct"        json:"discountPct"`
	TotalProduk       string    `db:"total_produk"        json:"totalProduk"`
	Total             string    `db:"total"               json:"total"`
	TotalDiscount     string    `db:"total_discount"      json:"totalDiscount"`
	Subtotal          string    `db:"subtotal"            json:"subtotal"`
	DppNilaiLain      string    `db:"dpp_nilai_lain"      json:"dppNilaiLain"`
	PpnAmount         string    `db:"ppn_amount"          json:"ppnAmount"`
	GrandTotal        string    `db:"grand_total"         json:"grandTotal"`
	Notes             *string   `db:"notes"               json:"notes,omitempty"`
	RowVersion        int32     `db:"row_version"         json:"rowVersion"`
	CreatedAt         time.Time `db:"created_at"          json:"createdAt"`
	UpdatedAt         time.Time `db:"updated_at"          json:"updatedAt"`
}

// QuotationItem mirrors quotation_items.
type QuotationItem struct {
	ID              int64   `db:"id"                  json:"id"`
	QuotationID     int64   `db:"quotation_id"        json:"quotationId"`
	LineNumber      int16   `db:"line_number"         json:"lineNumber"`
	ItemType        string  `db:"item_type"           json:"itemType"` // product | shipping
	RequestedItemID *int64  `db:"requested_item_id"   json:"requestedItemId,omitempty"`
	RequestedImpa   *string `db:"requested_impa"      json:"requestedImpa,omitempty"`
	RequestedName   string  `db:"requested_name"      json:"requestedName"`
	OfferedItemID   *int64  `db:"offered_item_id"     json:"offeredItemId,omitempty"`
	OfferedName     *string `db:"offered_name"        json:"offeredName,omitempty"`
	OfferedImpa     *string `db:"offered_impa"        json:"offeredImpa,omitempty"`
	VendorProductID *int64  `db:"vendor_product_id"   json:"vendorProductId,omitempty"`
	VendorID        *int64  `db:"vendor_id"           json:"vendorId,omitempty"`
	VendorName      *string `db:"vendor_name"         json:"vendorName,omitempty"`
	Qty             string  `db:"qty"                 json:"qty"`
	UnitID          *int16  `db:"unit_id"             json:"unitId,omitempty"`
	SellingPrice    string  `db:"selling_price"       json:"sellingPrice"`
	CostPrice       *string `db:"cost_price"          json:"costPrice,omitempty"`
	DiscountPct     string  `db:"discount_pct"        json:"discountPct"`
	TotalSelling    string  `db:"total_selling"       json:"totalSelling"`
	DiscountAmount  string  `db:"discount_amount"     json:"discountAmount"`
	Subtotal        string  `db:"subtotal"            json:"subtotal"`
	IsAvailable     bool    `db:"is_available"        json:"isAvailable"`
	ShipDestination *string `db:"ship_destination"    json:"shipDestination,omitempty"`
	ShippingDays    *int    `db:"shipping_days"       json:"shippingDays,omitempty"`
}

// StatusHistoryEntry mirrors quotation_status_history.
type StatusHistoryEntry struct {
	ID         int64     `db:"id"           json:"id"`
	FromStatus *Status   `db:"from_status"  json:"fromStatus,omitempty"`
	ToStatus   Status    `db:"to_status"    json:"toStatus"`
	Note       *string   `db:"note"         json:"note,omitempty"`
	ChangedBy  *int64    `db:"changed_by"   json:"changedBy"` // nil: no acting user
	ChangedAt  time.Time `db:"changed_at"   json:"changedAt"`
}

// Quotation detail response.
type QuotationDetail struct {
	Quotation
	Items              []QuotationItem      `json:"items"`
	History            []StatusHistoryEntry `json:"history"`
	AllowedTransitions []Transition         `json:"allowedTransitions"`
	CanRevise          bool                 `json:"canRevise"`
	// The chosen contact's own email and phone
	ContactEmail *string `json:"contactEmail,omitempty"`
	ContactPhone *string `json:"contactPhone,omitempty"`
	// Parts other users are editing now
	Locks []EditLock `json:"locks"`
}

// RevisionRow is one chain link.
// The chain runs parent to child.
type RevisionRow struct {
	ID          int64     `db:"id"            json:"id"`
	ParentID    *int64    `db:"parent_id"     json:"parentId,omitempty"`
	QuotationNo string    `db:"quotation_no"  json:"quotationNo"`
	Version     int16     `db:"version"       json:"version"`
	Status      Status    `db:"status"        json:"status"`
	GrandTotal  string    `db:"grand_total"   json:"grandTotal"`
	TotalProduk string    `db:"total_produk"  json:"totalProduk"`
	CreatedAt   time.Time `db:"created_at"    json:"createdAt"`
	UpdatedAt   time.Time `db:"updated_at"    json:"updatedAt"`
}

// List row shape.
type ListRow struct {
	ID              int64     `db:"id"                json:"id"`
	QuotationNo     string    `db:"quotation_no"      json:"quotationNo"`
	LegacyNo        *string   `db:"legacy_no"         json:"legacyNo,omitempty"`
	Version         int16     `db:"version"           json:"version"`
	CompanyClientID int64     `db:"company_client_id" json:"companyClientId"`
	CompanyName     string    `db:"company_name"      json:"companyName"`
	Status          Status    `db:"status"            json:"status"`
	GrandTotal      string    `db:"grand_total"       json:"grandTotal"`
	Subtotal        string    `db:"subtotal"          json:"subtotal"`
	TotalDiscount   string    `db:"total_discount"    json:"totalDiscount"`
	TotalHargaBeli  string    `db:"total_harga_beli"  json:"totalHargaBeli"`
	ProductCount    int64     `db:"product_count"     json:"productCount"`
	CreatedAt       time.Time `db:"created_at"        json:"createdAt"`
}

// ListResult wraps rows with total.
type ListResult struct {
	Rows  []ListRow `json:"rows"`
	Total int64     `json:"total"`
}

// Stats counts per status.
type StatusCount struct {
	Status Status `db:"status" json:"status"`
	Label  string `db:"-"      json:"label"`
	Count  int64  `db:"count"  json:"count"`
}

// One line item input.
type CreateItem struct {
	RequestedItemID *int64  `json:"requestedItemId,omitempty"`
	RequestedImpa   *string `json:"requestedImpa,omitempty"`
	RequestedName   string  `json:"requestedName"`
	OfferedItemID   *int64  `json:"offeredItemId,omitempty"`
	VendorProductID *int64  `json:"vendorProductId,omitempty"`
	// VendorID names a vendor not linked yet
	VendorID *int64 `json:"vendorId,omitempty"`
	Qty      string `json:"qty"` // numeric as string
	// UnitID 0 (absent) stores no unit; the send rule asks for one
	UnitID            int16   `json:"unitId,omitempty"`
	SellingPrice      string  `json:"sellingPrice"`
	CostPrice         *string `json:"costPrice,omitempty"`
	UpdateVendorPrice bool    `json:"updateVendorPrice,omitempty"`
	ShipDestination   *string `json:"shipDestination,omitempty"`
	DueDate           *string `json:"dueDate,omitempty"` // YYYY-MM-DD
	// IsAvailable false marks Tidak Ditawarkan
	IsAvailable *bool `json:"isAvailable,omitempty"`
}

// Create quotation body.
type CreateRequest struct {
	CompanyClientID int64        `json:"companyClientId"`
	ContactID       *int64       `json:"contactId,omitempty"`
	ClientRefNo     *string      `json:"clientRefNo,omitempty"`
	VesselName      *string      `json:"vesselName,omitempty"`
	PaymentTerms    *string      `json:"paymentTerms,omitempty"`
	ValidityDays    *int         `json:"validityDays,omitempty"`
	DiscountPct     string       `json:"discountPct"` // 0 to 100
	ShippingAddress *string      `json:"shippingAddress,omitempty"`
	ShippingDays    *int         `json:"shippingDays,omitempty"`
	ShippingCost    *string      `json:"shippingCost,omitempty"` // numeric as string
	Items           []CreateItem `json:"items"`
	Notes           *string      `json:"notes,omitempty"`
	Status          *Status      `json:"status,omitempty"` // defaults to draft
}

// Update quotation body.
type UpdateRequest struct {
	ClientRefNo     *string      `json:"clientRefNo,omitempty"`
	VesselName      *string      `json:"vesselName,omitempty"`
	PaymentTerms    *string      `json:"paymentTerms,omitempty"`
	ValidityDays    *int         `json:"validityDays,omitempty"`
	DiscountPct     string       `json:"discountPct"`
	ShippingAddress *string      `json:"shippingAddress,omitempty"`
	ShippingDays    *int         `json:"shippingDays,omitempty"`
	ShippingCost    *string      `json:"shippingCost,omitempty"`
	Items           []CreateItem `json:"items"`
	Notes           *string      `json:"notes,omitempty"`
}

// Change status body.
type ChangeStatusRequest struct {
	Status Status  `json:"status"` // a key of Transitions
	Note   *string `json:"note,omitempty"`
}

// SendRequest carries an optional note.
type SendRequest struct {
	Note *string `json:"note,omitempty"`
}

// ReviseRequest carries an optional note.
type ReviseRequest struct {
	Note *string `json:"note,omitempty"`
}

// Change contact body.
type ChangeContactRequest struct {
	ContactID int64 `json:"contactId"`
}

// dbItem mirrors fn_create_quotation keys.
type dbItem struct {
	RequestedItemID   *int64  `json:"requested_item_id,omitempty"`
	RequestedImpa     *string `json:"requested_impa,omitempty"`
	RequestedName     string  `json:"requested_name"`
	OfferedItemID     *int64  `json:"offered_item_id,omitempty"`
	VendorProductID   *int64  `json:"vendor_product_id,omitempty"`
	VendorID          *int64  `json:"vendor_id,omitempty"`
	Qty               string  `json:"qty"`
	UnitID            int16   `json:"unit_id,omitempty"`
	SellingPrice      string  `json:"selling_price"`
	CostPrice         *string `json:"cost_price,omitempty"`
	UpdateVendorPrice bool    `json:"update_vendor_price"`
	ShipDestination   *string `json:"ship_destination,omitempty"`
	DueDate           *string `json:"due_date,omitempty"`
	IsAvailable       *bool   `json:"is_available,omitempty"`
}

// itemsToJSONB serializes items for fn_create_quotation.
func itemsToJSONB(items []CreateItem) ([]byte, error) {
	out := make([]dbItem, len(items))
	for i, it := range items {
		out[i] = dbItem(it)
	}
	return json.Marshal(out)
}

// CreatedResponse names the new quotation.
// Create and Revise both answer with it.
type CreatedResponse struct {
	ID int64 `json:"id"`
}

// UpdatedResponse carries the new version.
type UpdatedResponse struct {
	ID         int64 `json:"id"`
	RowVersion int32 `json:"rowVersion"`
}

// EditLock is one claimed part.
// Part is "header" or "line:<quotation_items.id>".
type EditLock struct {
	Part      string    `db:"part"       json:"part"`
	UserID    int64     `db:"user_id"    json:"userId"`
	UserName  string    `db:"user_name"  json:"userName"`
	ExpiresAt time.Time `db:"expires_at" json:"expiresAt"`
}

// LockRequest claims a part.
type LockRequest struct {
	Part string `json:"part"`
}

// LockResponse says until when.
type LockResponse struct {
	Part      string    `json:"part"`
	ExpiresAt time.Time `json:"expiresAt"`
}

// AddLinesRequest adds product lines.
type AddLinesRequest struct {
	Items []CreateItem `json:"items"`
}

// AddLinesResponse names the new lines.
type AddLinesResponse struct {
	IDs []int64 `json:"ids"`
}

// LineOfferRequest toggles Tidak Ditawarkan.
type LineOfferRequest struct {
	IsAvailable bool `json:"isAvailable"`
}

// HeaderRequest saves the header part.
type HeaderRequest struct {
	ClientRefNo     *string `json:"clientRefNo,omitempty"`
	VesselName      *string `json:"vesselName,omitempty"`
	PaymentTerms    *string `json:"paymentTerms,omitempty"`
	ValidityDays    *int    `json:"validityDays,omitempty"`
	DiscountPct     string  `json:"discountPct"`
	ShippingAddress *string `json:"shippingAddress,omitempty"`
	ShippingDays    *int    `json:"shippingDays,omitempty"`
	ShippingCost    *string `json:"shippingCost,omitempty"`
	Notes           *string `json:"notes,omitempty"`
}
