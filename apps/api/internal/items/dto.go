package items

import "time"

// ─── DB row shapes ────────────────────────────────────────────

type Item struct {
	ID            int64     `db:"id"               json:"id"`
	Name          string    `db:"name"             json:"name"`
	IMPACode      *string   `db:"impa_code"        json:"impaCode,omitempty"`
	DefaultUnitID *int16    `db:"default_unit_id"  json:"defaultUnitId,omitempty"`
	Description   *string   `db:"description"      json:"description,omitempty"`
	IsActive      bool      `db:"is_active"        json:"isActive"`
	CreatedAt     time.Time `db:"created_at"       json:"createdAt"`
	UpdatedAt     time.Time `db:"updated_at"       json:"updatedAt"`
}

// SearchResult mirrors fn_search_items return shape.
type SearchResult struct {
	ID            int64   `db:"id"               json:"id"`
	Name          string  `db:"name"             json:"name"`
	IMPACode      *string `db:"impa_code"        json:"impaCode,omitempty"`
	DefaultUnitID *int16  `db:"default_unit_id"  json:"defaultUnitId,omitempty"`
	Score         float32 `db:"score"            json:"score"`
	MatchTier     string  `db:"match_tier"       json:"matchTier"`
}

// MatchResult mirrors fn_match_request return shape.
type MatchResult struct {
	ItemID     int64   `db:"item_id"     json:"itemId"`
	ItemName   string  `db:"item_name"   json:"itemName"`
	IMPACode   *string `db:"impa_code"   json:"impaCode,omitempty"`
	Confidence float32 `db:"confidence"  json:"confidence"`
	Source     string  `db:"source"      json:"source"` // 'cache' | 'fuzzy' | 'impa' etc
}

// VendorForItem represents a vendor_product row joined with vendor.
type VendorForItem struct {
	VendorProductID int64   `db:"vendor_product_id"  json:"vendorProductId"`
	VendorID        int64   `db:"vendor_id"          json:"vendorId"`
	VendorName      string  `db:"vendor_name"        json:"vendorName"`
	VendorSKU       *string `db:"vendor_sku"         json:"vendorSku,omitempty"`
	CostPrice       *string `db:"cost_price"         json:"costPrice,omitempty"`
	LastQuotedAt    *string `db:"last_quoted_at"     json:"lastQuotedAt,omitempty"`
}

// PriceHistory mirrors fn_suggest_selling_prices return shape.
type PriceHistory struct {
	QuotationNo   string  `db:"quotation_no"    json:"quotationNo"`
	QuotationDate string  `db:"quotation_date"  json:"quotationDate"` // timestamp ::text
	ClientName    string  `db:"client_name"     json:"clientName"`
	Qty           string  `db:"qty"             json:"qty"`
	CostPrice     *string `db:"cost_price"      json:"costPrice,omitempty"`
	SellingPrice  string  `db:"selling_price"   json:"sellingPrice"`
	ProfitPct     *string `db:"profit_pct"      json:"profitPct,omitempty"`
}

// ─── Request shapes ───────────────────────────────────────────

type CreateItemRequest struct {
	Name          string  `json:"name"`
	IMPACode      *string `json:"impaCode"`
	DefaultUnitID *int16  `json:"defaultUnitId"`
	Description   *string `json:"description"`
}

// MatchRequest is body untuk POST /items/match-request.
type MatchRequest struct {
	ReqText string `json:"reqText"` // raw text from PDF
	Limit   int    `json:"limit"`   // optional, default 5
}
