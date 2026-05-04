package vendors

import (
	"encoding/json"
	"time"
)

// Vendor mirrors vendors table.
type Vendor struct {
	ID            int64           `db:"id"             json:"id"`
	Name          string          `db:"name"           json:"name"`
	Location      *string         `db:"location"       json:"location,omitempty"`
	ContactInfo   json.RawMessage `db:"contact_info"   json:"contactInfo,omitempty"` // JSONB
	IsActive      bool            `db:"is_active"      json:"isActive"`
	CreatedAt     time.Time       `db:"created_at"     json:"createdAt"`
	UpdatedAt     time.Time       `db:"updated_at"     json:"updatedAt"`
	ProductCount  int64           `db:"product_count"  json:"productCount"`
	TotalPurchase string          `db:"total_purchase" json:"totalPurchase"`
}

// SearchResult mirrors fn_search_vendors return shape.
type SearchResult struct {
	VendorID    int64           `db:"vendor_id"     json:"vendorId"`
	VendorName  string          `db:"vendor_name"   json:"vendorName"`
	Location    *string         `db:"location"      json:"location,omitempty"`
	ContactInfo json.RawMessage `db:"contact_info"  json:"contactInfo,omitempty"`
	Score       float32         `db:"score"         json:"score"`
	MatchTier   string          `db:"match_tier"    json:"matchTier"`
}

// ItemByVendor mirrors fn_search_items_by_vendor return shape.
type ItemByVendor struct {
	ItemID       int64   `db:"item_id"        json:"itemId"`
	ItemName     string  `db:"item_name"      json:"itemName"`
	IMPACode     *string `db:"impa_code"      json:"impaCode,omitempty"`
	VendorSKU    *string `db:"vendor_sku"     json:"vendorSku,omitempty"`
	CostPrice    *string `db:"cost_price"     json:"costPrice,omitempty"`
	LastQuotedAt *string `db:"last_quoted_at" json:"lastQuotedAt,omitempty"`
}

type CreateVendorRequest struct {
	Name        string          `json:"name"`
	Location    *string         `json:"location"`
	ContactInfo json.RawMessage `json:"contactInfo"` // optional JSONB blob
}

type UpdateVendorRequest struct {
	Name        string          `json:"name"`
	Location    *string         `json:"location"`
	ContactInfo json.RawMessage `json:"contactInfo"`
	IsActive    bool            `json:"isActive"`
}
