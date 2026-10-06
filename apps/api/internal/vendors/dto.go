package vendors

import "time"

// ListFilter for vendors.list query.
type ListFilter struct {
	Q           string
	IsActive    *bool
	CountryName string // matches against vendors.location ILIKE
	MinTotal    *string
	SortBy      string
	SortDir     string
	Limit       int
	Offset      int
}

// ListResult wraps rows with total.
type ListResult struct {
	Rows  []Vendor
	Total int64
}

// Vendor mirrors vendors table.
type Vendor struct {
	ID            int64        `db:"id"             json:"id"`
	Name          string       `db:"name"           json:"name"`
	Location      *string      `db:"location"       json:"location,omitempty"`
	ContactInfo   *ContactInfo `db:"contact_info"   json:"contactInfo,omitempty"` // JSONB
	IsActive      bool         `db:"is_active"      json:"isActive"`
	CreatedAt     time.Time    `db:"created_at"     json:"createdAt"`
	UpdatedAt     time.Time    `db:"updated_at"     json:"updatedAt"`
	ProductCount  int64        `db:"product_count"  json:"productCount"`
	TotalPurchase string       `db:"total_purchase" json:"totalPurchase,omitempty"`
	LogoObjectKey *string      `db:"logo_object_key" json:"logoObjectKey,omitempty"`
}

// ContactInfo is vendors.contact_info.
// The JSONB column holds these keys only; any other key is dropped on read
// and, since a write replaces the object, on write too. A blank field is
// left out of the stored object.
type ContactInfo struct {
	Email string `json:"email,omitempty"`
	Phone string `json:"phone,omitempty"`
	SKU   string `json:"sku,omitempty"`
}

// UpdateLogoRequest carries a logo key.
// It persists the MinIO object key of a vendor logo.
type UpdateLogoRequest struct {
	ObjectKey string `json:"objectKey"`
}

// ItemByVendor is a vendor's item.
// It joins vendor_products with items.
type ItemByVendor struct {
	ItemID       int64   `db:"item_id"        json:"itemId"`
	ItemName     string  `db:"item_name"      json:"itemName"`
	IMPACode     *string `db:"impa_code"      json:"impaCode,omitempty"`
	VendorSKU    *string `db:"vendor_sku"     json:"vendorSku,omitempty"`
	CostPrice    *string `db:"cost_price"     json:"costPrice,omitempty"`
	LastQuotedAt *string `db:"last_quoted_at" json:"lastQuotedAt,omitempty"`
	ProductURL   *string `db:"product_url"    json:"productUrl,omitempty"`
}

// ItemListResult wraps rows with total.
type ItemListResult struct {
	Rows  []ItemByVendor
	Total int64
}

type CreateVendorRequest struct {
	Name        string       `json:"name"`
	Location    *string      `json:"location"`
	ContactInfo *ContactInfo `json:"contactInfo"` // nil stores NULL
	IsActive    *bool        `json:"isActive"`    // nil defaults to true
}

type UpdateVendorRequest struct {
	Name        string       `json:"name"`
	Location    *string      `json:"location"`
	ContactInfo *ContactInfo `json:"contactInfo"`
	IsActive    bool         `json:"isActive"`
}

// RecentQuotationCount caps the vendor's quotation list.
const RecentQuotationCount = 5

// VendorQuotation is one quotation line supplied by the vendor.
// Status is the quotation's status key; the web labels it.
type VendorQuotation struct {
	LineID        int64     `db:"line_id"        json:"lineId"`
	QuotationID   int64     `db:"quotation_id"   json:"quotationId"`
	QuotationNo   string    `db:"quotation_no"   json:"quotationNo"`
	QuotationDate time.Time `db:"quotation_date" json:"quotationDate"`
	Status        string    `db:"status"         json:"status"`
	ClientID      int64     `db:"client_id"      json:"clientId"`
	ClientName    string    `db:"client_name"    json:"clientName"`
	ContactName   *string   `db:"contact_name"   json:"contactName,omitempty"`
	ItemID        *int64    `db:"item_id"        json:"itemId,omitempty"`
	ItemName      string    `db:"item_name"      json:"itemName"`
	IMPACode      *string   `db:"impa_code"      json:"impaCode,omitempty"`
}
