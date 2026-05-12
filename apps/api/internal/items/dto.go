package items

import "time"

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

type ListFilter struct {
	Q         string
	IsActive  *bool
	UnitID    *int16
	SortBy    string
	SortDir   string
	Limit     int
	Offset    int
}

type ListResult struct {
	Rows  []Item
	Total int64
}

// Mirrors fn_search_items return.
type SearchResult struct {
	ID            int64   `db:"id"               json:"id"`
	Name          string  `db:"name"             json:"name"`
	IMPACode      *string `db:"impa_code"        json:"impaCode,omitempty"`
	DefaultUnitID *int16  `db:"default_unit_id"  json:"defaultUnitId,omitempty"`
	Score         float32 `db:"score"            json:"score"`
	MatchTier     string  `db:"match_tier"       json:"matchTier"`
}

// Mirrors fn_match_request return.
type MatchResult struct {
	ItemID     int64   `db:"item_id"     json:"itemId"`
	ItemName   string  `db:"item_name"   json:"itemName"`
	IMPACode   *string `db:"impa_code"   json:"impaCode,omitempty"`
	Confidence float32 `db:"confidence"  json:"confidence"`
	Source     string  `db:"source"      json:"source"` // cache | fuzzy | impa
}

// vendor_product joined with vendor.
type VendorForItem struct {
	VendorProductID int64   `db:"vendor_product_id"  json:"vendorProductId"`
	VendorID        int64   `db:"vendor_id"          json:"vendorId"`
	VendorName      string  `db:"vendor_name"        json:"vendorName"`
	VendorSKU       *string `db:"vendor_sku"         json:"vendorSku,omitempty"`
	CostPrice       *string `db:"cost_price"         json:"costPrice,omitempty"`
	ProductURL      *string `db:"product_url"        json:"productUrl,omitempty"`
	LastQuotedAt    *string `db:"last_quoted_at"     json:"lastQuotedAt,omitempty"`
}

// Mirrors fn_suggest_selling_prices return.
type PriceHistory struct {
	QuotationNo   string  `db:"quotation_no"    json:"quotationNo"`
	QuotationDate string  `db:"quotation_date"  json:"quotationDate"` // timestamp cast to text
	ClientName    string  `db:"client_name"     json:"clientName"`
	Qty           string  `db:"qty"             json:"qty"`
	CostPrice     *string `db:"cost_price"      json:"costPrice,omitempty"`
	SellingPrice  string  `db:"selling_price"   json:"sellingPrice"`
	ProfitPct     *string `db:"profit_pct"      json:"profitPct,omitempty"`
}

type CreateItemRequest struct {
	Name          string  `json:"name"`
	IMPACode      *string `json:"impaCode"`
	DefaultUnitID *int16  `json:"defaultUnitId"`
	Description   *string `json:"description"`
}

type UpdateItemRequest struct {
	Name          string  `json:"name"`
	IMPACode      *string `json:"impaCode"`
	DefaultUnitID *int16  `json:"defaultUnitId"`
	Description   *string `json:"description"`
	IsActive      bool    `json:"isActive"`
}

type AddVendorToItemRequest struct {
	VendorID   int64   `json:"vendorId"`
	VendorSKU  *string `json:"vendorSku"`
	CostPrice  *string `json:"costPrice"`
	ProductURL *string `json:"productUrl"`
}

// POST /items/match-request body.
type MatchRequest struct {
	ReqText string `json:"reqText"` // raw text from PDF
	Limit   int    `json:"limit"`   // defaults to 5
}

// Result row from items.match_with_vendor_by_id.
type MatchedItemWithVendor struct {
	ItemID          int64   `db:"item_id"            json:"itemId"`
	ItemName        string  `db:"item_name"          json:"itemName"`
	IMPACode        *string `db:"impa_code"          json:"impaCode,omitempty"`
	DefaultUnitID   *int16  `db:"default_unit_id"    json:"defaultUnitId,omitempty"`
	DefaultUnitCode *string `db:"default_unit_code"  json:"defaultUnitCode,omitempty"`
	VendorProductID *int64  `db:"vendor_product_id"  json:"vendorProductId,omitempty"`
	VendorID        *int64  `db:"vendor_id"          json:"vendorId,omitempty"`
	VendorName      *string `db:"vendor_name"        json:"vendorName,omitempty"`
	CostPrice       *string `db:"cost_price"         json:"costPrice,omitempty"`
}

// POST /items/match-rows: input row from xlsx upload.
type MatchRowInput struct {
	IMPACode string  `json:"impaCode"`
	Name     string  `json:"name"`
	Qty      float64 `json:"qty"`
	Unit     string  `json:"unit"`
}

// Per-row response for batch match.
type MatchRowResult struct {
	Index      int                    `json:"index"`
	Requested  MatchRowInput          `json:"requested"`
	Matched    *MatchedItemWithVendor `json:"matched,omitempty"`
	Confidence float32                `json:"confidence"`
	Source     string                 `json:"source"` // IMPA_EXACT | LEARNED_EXACT | LEARNED_FUZZY | CATALOG_MATCH | NONE
}

type MatchRowsRequest struct {
	Rows     []MatchRowInput `json:"rows"`
	MinScore float32         `json:"minScore"` // default 0.5
}

type MatchRowsResponse struct {
	Rows []MatchRowResult `json:"rows"`
}

// VendorOfferHit mirrors items.search_vendor_offers row.
type VendorOfferHit struct {
	ItemID     int64   `db:"item_id"     json:"itemId"`
	VendorID   int64   `db:"vendor_id"   json:"vendorId"`
	VendorName string  `db:"vendor_name" json:"vendorName"`
	VendorSKU  *string `db:"vendor_sku"  json:"vendorSku,omitempty"`
	Score      float32 `db:"score"       json:"score"`
}

// RequestHistoryHit mirrors items.search_request_history row.
type RequestHistoryHit struct {
	ItemID      int64   `db:"item_id"      json:"itemId"`
	RequestText string  `db:"request_text" json:"requestText"`
	MatchCount  int32   `db:"match_count"  json:"matchCount"`
	Score       float32 `db:"score"        json:"score"`
}

// AdvancedSearchHit is the merged, tier-labelled row served by /items/search-advanced.
type AdvancedSearchHit struct {
	ID            int64    `json:"id"`
	Name          string   `json:"name"`
	IMPACode      *string  `json:"impaCode,omitempty"`
	DefaultUnitID *int16   `json:"defaultUnitId,omitempty"`
	Score         float32  `json:"score"`
	Tier          string   `json:"tier"`   // ITEM_AUTO | VENDOR_OFFER | ITEM_SUGGESTED | REQUEST_HISTORY | ITEM_FUZZY
	Tiers         []string `json:"tiers"`  // all tiers that contributed to this hit
	VendorID      *int64   `json:"vendorId,omitempty"`
	VendorName    *string  `json:"vendorName,omitempty"`
	VendorSKU     *string  `json:"vendorSku,omitempty"`
	RequestText   *string  `json:"requestText,omitempty"`
}

// AdvancedSearchResponse wraps the hit list with a per-tier count summary.
type AdvancedSearchResponse struct {
	Query string                       `json:"query"`
	Total int                          `json:"total"`
	Hits  []AdvancedSearchHit          `json:"hits"`
	Counts map[string]int              `json:"counts"` // tier → count
}
