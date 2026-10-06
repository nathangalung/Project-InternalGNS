// Package cashentries keeps Kas Lain.
//
// Money in and out beyond the sales and purchases the documents record,
// entered by finance: a date, in or out, a category, an amount and a note.
package cashentries

import "time"

// Direction is in or out.
type Direction string

const (
	DirectionIn  Direction = "in"
	DirectionOut Direction = "out"
)

// Entry is one movement.
type Entry struct {
	ID int64 `db:"id" json:"id"`
	// Day of the movement, YYYY-MM-DD
	EntryDate   string    `db:"entry_date"      json:"entryDate"`
	Direction   Direction `db:"direction"       json:"direction"`
	Category    string    `db:"category"        json:"category"`
	Amount      string    `db:"amount"          json:"amount"`
	Description string    `db:"description"     json:"description"`
	RowVersion  int32     `db:"row_version"     json:"rowVersion"`
	CreatedAt   time.Time `db:"created_at"      json:"createdAt"`
	UpdatedAt   time.Time `db:"updated_at"      json:"updatedAt"`
	// Who entered it
	CreatedByName string `db:"created_by_name" json:"createdByName"`
}

// EntryInput creates or replaces one.
type EntryInput struct {
	EntryDate   string    `json:"entryDate"`
	Direction   Direction `json:"direction"`
	Category    string    `json:"category"`
	Amount      string    `json:"amount"`
	Description string    `json:"description"`
}

// Summary totals the filtered entries.
type Summary struct {
	TotalIn  string `db:"total_in"  json:"totalIn"`
	TotalOut string `db:"total_out" json:"totalOut"`
	// In minus out
	Net string `db:"net" json:"net"`
}

// ListFilter narrows the list.
type ListFilter struct {
	Q         string
	Direction Direction
	Category  string
	DateFrom  *time.Time
	DateTo    *time.Time
	Limit     int
	Offset    int
}

// ListResult wraps rows with total.
type ListResult struct {
	Rows  []Entry
	Total int64
}
