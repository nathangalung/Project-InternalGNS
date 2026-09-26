package invoices

// StatusOrder is the display order.
// Lists, filters and tiles follow it, Terlambat included.
var StatusOrder = []Status{StatusDraft, StatusSent, StatusOverdue, StatusPaid, StatusCancelled}

var statusLabels = map[Status]string{
	StatusDraft:     "Draf",
	StatusSent:      "Dikirim",
	StatusOverdue:   "Terlambat",
	StatusPaid:      "Dibayar",
	StatusCancelled: "Dibatalkan",
}

// StatusLabel returns the Indonesian label.
// An unknown value passes through raw.
func StatusLabel(s Status) string {
	if l, ok := statusLabels[s]; ok {
		return l
	}
	return string(s)
}

// Transition is one offered move.
type Transition struct {
	To           Status `json:"to"`
	Label        string `json:"label"`
	RequiresNote bool   `json:"requiresNote"`
}

func move(to Status, requiresNote bool) Transition {
	return Transition{To: to, Label: StatusLabel(to), RequiresNote: requiresNote}
}

// Transitions mirrors fn_change_invoice_status exactly.
// A test walks every pair against the database. Overdue is never a
// target: Terlambat is derived from the due date. A cancel needs a reason.
var Transitions = map[Status][]Transition{
	StatusDraft:   {move(StatusSent, false), move(StatusCancelled, true)},
	StatusSent:    {move(StatusPaid, false), move(StatusCancelled, true)},
	StatusOverdue: {move(StatusPaid, false), move(StatusCancelled, true)},
}

// AllowedTransitions lists the offered moves.
// Without a PO no Pengganti can follow a cancel, so the database refuses
// it and it is not offered.
func AllowedTransitions(from Status, hasPO bool) []Transition {
	out := make([]Transition, 0, len(Transitions[from]))
	for _, t := range Transitions[from] {
		if t.To == StatusCancelled && !hasPO {
			continue
		}
		out = append(out, t)
	}
	return out
}
