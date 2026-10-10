package units

// Unit master row.
// Aliases are the other texts that name this unit (PC, PIECES, EA for
// PCS), stored normalised; the code is what documents print.
type Unit struct {
	ID          int16    `db:"id"           json:"id"`
	Code        string   `db:"code"         json:"code"`
	Name        *string  `db:"name"         json:"name,omitempty"`
	CoretaxCode *string  `db:"coretax_code" json:"coretaxCode,omitempty"`
	Aliases     []string `db:"aliases"      json:"aliases"`
}
