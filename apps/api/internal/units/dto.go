package units

// Unit is the wire + DB shape for the units master table.
type Unit struct {
	ID          int16   `db:"id"           json:"id"`
	Code        string  `db:"code"         json:"code"`
	Name        *string `db:"name"         json:"name,omitempty"`
	CoretaxCode *string `db:"coretax_code" json:"coretaxCode,omitempty"`
}
