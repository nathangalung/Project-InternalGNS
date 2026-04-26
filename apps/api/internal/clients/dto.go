package clients

import "time"

// ─── DB row shapes (db tag for pgx scanning) ──────────────────

// Client mirrors company_client table.
type Client struct {
	ID          int64     `db:"id"            json:"id"`
	Number      *string   `db:"number"        json:"number,omitempty"`
	Name        string    `db:"name"          json:"name"`
	NPWP        *string   `db:"npwp"          json:"npwp,omitempty"`
	Address     *string   `db:"address"       json:"address,omitempty"`
	Email       *string   `db:"email"         json:"email,omitempty"`
	CountryCode string    `db:"country_code"  json:"countryCode"`
	TkuID       *string   `db:"tku_id"        json:"tkuId,omitempty"`
	IsActive    bool      `db:"is_active"     json:"isActive"`
	CreatedAt   time.Time `db:"created_at"    json:"createdAt"`
	UpdatedAt   time.Time `db:"updated_at"    json:"updatedAt"`
}

// Contact mirrors company_contacts table.
type Contact struct {
	ID          int64     `db:"id"            json:"id"`
	CompanyID   int64     `db:"company_id"    json:"companyId"`
	Name        string    `db:"name"          json:"name"`
	Email       *string   `db:"email"         json:"email,omitempty"`
	Phone       *string   `db:"phone"         json:"phone,omitempty"`        // digit only, no dial code
	Title       *string   `db:"title"         json:"title,omitempty"`
	CountryCode string    `db:"country_code"  json:"countryCode"`             // for dial code prefix
	IsActive    bool      `db:"is_active"     json:"isActive"`
	CreatedAt   time.Time `db:"created_at"    json:"createdAt"`
	UpdatedAt   time.Time `db:"updated_at"    json:"updatedAt"`
}

// SearchResult mirrors fn_search_clients return shape.
// Flat row per (company × contact). LEFT JOIN — contact_* bisa NULL.
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

// ─── Request shapes ───────────────────────────────────────────

// CreateClientRequest is body untuk POST /clients.
type CreateClientRequest struct {
	Number      *string `json:"number"`
	Name        string  `json:"name"`        // required
	NPWP        *string `json:"npwp"`
	Address     *string `json:"address"`
	Email       *string `json:"email"`
	CountryCode string  `json:"countryCode"` // default 'IDN' kalau kosong
	TkuID       *string `json:"tkuId"`
}

// CreateContactRequest is body untuk POST /clients/{id}/contacts.
type CreateContactRequest struct {
	Name        string  `json:"name"` // required
	Email       *string `json:"email"`
	Phone       *string `json:"phone"`       // digit only (9-12)
	Title       *string `json:"title"`
	CountryCode string  `json:"countryCode"` // default 'IDN' kalau kosong
}
