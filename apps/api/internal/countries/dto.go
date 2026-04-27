package countries

// Country master row.
type Country struct {
	Code     string `db:"code"      json:"code"`     // ISO 3166 alpha-3, e.g. "IDN"
	Name     string `db:"name"      json:"name"`     // e.g. "Indonesia"
	DialCode string `db:"dial_code" json:"dialCode"` // ITU-T E.164, e.g. "+62"
}
