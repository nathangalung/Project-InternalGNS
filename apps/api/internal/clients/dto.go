package clients

import "time"

// ListFilter for clients.list query.
type ListFilter struct {
	Q           string
	IsActive    *bool
	CountryCode string
	MinTotal    *string
	SortBy      string
	SortDir     string
	Limit       int
	Offset      int
}

// ListResult wraps rows with total.
type ListResult struct {
	Rows  []Client
	Total int64
}

// Client row plus active contact.
type Client struct {
	ID             int64     `db:"id"              json:"id"`
	Number         *string   `db:"number"          json:"number,omitempty"`
	Name           string    `db:"name"            json:"name"`
	NPWP           *string   `db:"npwp"            json:"npwp,omitempty"`
	Address        *string   `db:"address"         json:"address,omitempty"`
	Email          *string   `db:"email"           json:"email,omitempty"`
	CountryCode    string    `db:"country_code"    json:"countryCode"`
	TkuID          *string   `db:"tku_id"          json:"tkuId,omitempty"`
	IsActive       bool      `db:"is_active"       json:"isActive"`
	CreatedAt      time.Time `db:"created_at"      json:"createdAt"`
	UpdatedAt      time.Time `db:"updated_at"      json:"updatedAt"`
	ContactID      *int64    `db:"contact_id"      json:"contactId,omitempty"`
	ContactName    *string   `db:"contact_name"    json:"contactName,omitempty"`
	ContactEmail   *string   `db:"contact_email"   json:"contactEmail,omitempty"`
	ContactPhone   *string   `db:"contact_phone"   json:"contactPhone,omitempty"`
	TotalPurchase  string    `db:"total_purchase"  json:"totalPurchase"`
	QuotationCount int64     `db:"quotation_count" json:"quotationCount"`
	LogoObjectKey  *string   `db:"logo_object_key" json:"logoObjectKey,omitempty"`
}

// UpdateLogoRequest persists the MinIO object key for a client logo.
type UpdateLogoRequest struct {
	ObjectKey string `json:"objectKey"`
}

// Contact mirrors company_contacts table.
type Contact struct {
	ID          int64     `db:"id"            json:"id"`
	CompanyID   int64     `db:"company_id"    json:"companyId"`
	Name        string    `db:"name"          json:"name"`
	Email       *string   `db:"email"         json:"email,omitempty"`
	Phone       *string   `db:"phone"         json:"phone,omitempty"` // digits only
	Title       *string   `db:"title"         json:"title,omitempty"`
	CountryCode string    `db:"country_code"  json:"countryCode"` // dial code prefix
	IsActive    bool      `db:"is_active"     json:"isActive"`
	CreatedAt   time.Time `db:"created_at"    json:"createdAt"`
	UpdatedAt   time.Time `db:"updated_at"    json:"updatedAt"`
}

// Search hit, nullable contact.
type SearchResult struct {
	CompanyID      int64   `db:"company_id"      json:"companyId"`
	CompanyName    string  `db:"company_name"    json:"companyName"`
	CompanyNumber  *string `db:"company_number"  json:"companyNumber,omitempty"`
	CompanyNPWP    *string `db:"company_npwp"    json:"companyNpwp,omitempty"`
	CompanyAddress *string `db:"company_address" json:"companyAddress,omitempty"`
	CompanyEmail   *string `db:"company_email"   json:"companyEmail,omitempty"`
	CompanyCountry string  `db:"company_country" json:"companyCountry"`
	CompanyTKU     *string `db:"company_tku"     json:"companyTku,omitempty"`
	ContactID      *int64  `db:"contact_id"      json:"contactId,omitempty"`
	ContactName    *string `db:"contact_name"    json:"contactName,omitempty"`
	ContactEmail   *string `db:"contact_email"   json:"contactEmail,omitempty"`
	ContactPhone   *string `db:"contact_phone"   json:"contactPhone,omitempty"`
	ContactTitle   *string `db:"contact_title"   json:"contactTitle,omitempty"`
	Score          float32 `db:"score"           json:"score"`
	MatchTier      string  `db:"match_tier"      json:"matchTier"` // AUTO_MATCH | SUGGESTED | FUZZY
}

// Create client body.
type CreateClientRequest struct {
	Number      *string `json:"number"`
	Name        string  `json:"name"`
	NPWP        *string `json:"npwp"`
	Address     *string `json:"address"`
	Email       *string `json:"email"`
	CountryCode string  `json:"countryCode"` // defaults to IDN
	TkuID       *string `json:"tkuId"`
}

// Update client body.
type UpdateClientRequest struct {
	Name        string  `json:"name"`
	NPWP        *string `json:"npwp"`
	Address     *string `json:"address"`
	Email       *string `json:"email"`
	CountryCode string  `json:"countryCode"`
	TkuID       *string `json:"tkuId"`
	IsActive    bool    `json:"isActive"`
}

// Client list KPI aggregates.
type Summary struct {
	Total         int64 `db:"total"           json:"total"`
	ActiveCount   int64 `db:"active_count"    json:"activeCount"`
	NewThisMonth  int64 `db:"new_this_month"  json:"newThisMonth"`
	NewThisYear   int64 `db:"new_this_year"   json:"newThisYear"`
	PrevYearTotal int64 `db:"prev_year_total" json:"prevYearTotal"`
}

// Create contact body.
type CreateContactRequest struct {
	Name        string  `json:"name"`
	Email       *string `json:"email"`
	Phone       *string `json:"phone"` // 9 to 12 digits
	Title       *string `json:"title"`
	CountryCode string  `json:"countryCode"` // defaults to IDN
}
