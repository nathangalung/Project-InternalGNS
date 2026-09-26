package purchaseorders

// StatusOrder is the display order.
// Lists, filters and tiles follow it.
var StatusOrder = []Status{
	StatusPending, StatusUploaded, StatusOnProgress, StatusDelivered, StatusCancelled,
}

var statusLabels = map[Status]string{
	StatusPending:    "Pending",
	StatusUploaded:   "PO Diunggah",
	StatusOnProgress: "Dalam Progres",
	StatusDelivered:  "Dikirim",
	StatusCancelled:  "Dibatalkan",
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

// Transitions mirrors fn_change_po_status exactly.
// A test walks every pair against the database. PENDING and UPLOADED
// follow the PO file, so neither is a manual move between them; DELIVERED
// and CANCELLED are terminal. A cancel needs a reason.
var Transitions = map[Status][]Transition{
	StatusPending:    {move(StatusCancelled, true)},
	StatusUploaded:   {move(StatusOnProgress, false), move(StatusCancelled, true)},
	StatusOnProgress: {move(StatusDelivered, false), move(StatusUploaded, false), move(StatusCancelled, true)},
}

// AllowedTransitions copies the offered moves.
func AllowedTransitions(from Status) []Transition {
	out := make([]Transition, len(Transitions[from]))
	copy(out, Transitions[from])
	return out
}

func requiresNote(to Status) bool { return to == StatusCancelled }

func isValidStatus(s Status) bool {
	_, ok := statusLabels[s]
	return ok
}

func (po *PurchaseOrder) withTransitions() {
	po.AllowedTransitions = AllowedTransitions(po.Status)
}
