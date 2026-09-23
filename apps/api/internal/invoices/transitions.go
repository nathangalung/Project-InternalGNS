package invoices

// allowedTransitions mirrors fn_change_invoice_status, minus overdue as a
// target: Terlambat is derived from the due date, never chosen by hand.
// Exposing this map is what lets a client offer exactly the moves the
// database accepts, including marking an invoice paid.
var allowedTransitions = map[Status][]Status{
	StatusDraft:   {StatusSent, StatusCancelled},
	StatusSent:    {StatusPaid, StatusCancelled},
	StatusOverdue: {StatusPaid, StatusCancelled},
}

// AllowedTransitions returns the statuses reachable from the given one.
func AllowedTransitions(from Status) []Status {
	out := make([]Status, len(allowedTransitions[from]))
	copy(out, allowedTransitions[from])
	return out
}
