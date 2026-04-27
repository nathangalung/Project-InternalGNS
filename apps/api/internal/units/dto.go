package units

// Unit master row.
type Unit struct {
	ID          int16   `db:"id"           json:"id"`
	Code        string  `db:"code"         json:"code"`
	Name        *string `db:"name"         json:"name,omitempty"`
	CoretaxCode *string `db:"coretax_code" json:"coretaxCode,omitempty"`
}
