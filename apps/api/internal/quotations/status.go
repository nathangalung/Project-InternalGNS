package quotations

// Quotation status model.
//
// Transitions mirrors the table inside fn_change_quotation_status; the
// mirror test fails when the two disagree. Two moves live outside it on
// purpose: sent -> revision happens only through fn_revise_quotation, which
// clones the draft in the same transaction, and sent -> expired only through
// fn_expire_quotations, the daily job.

// Status keys as stored.
const (
	StatusDraft     = "draft"
	StatusSent      = "sent"
	StatusRevision  = "revision"
	StatusAccepted  = "accepted"
	StatusRejected  = "rejected"
	StatusCancelled = "cancelled"
	StatusExpired   = "expired"
)

// StatusInfo is one status and its label.
type StatusInfo struct {
	Status string `json:"status"`
	Label  string `json:"label"`
}

// Statuses is the canonical display order.
var Statuses = []StatusInfo{
	{StatusDraft, "Draf"},
	{StatusSent, "Dikirim"},
	{StatusRevision, "Revisi"},
	{StatusAccepted, "Disetujui"},
	{StatusRejected, "Ditolak"},
	{StatusCancelled, "Dibatalkan"},
	{StatusExpired, "Kedaluwarsa"},
}

// Transition is one manual move.
type Transition struct {
	To           string `json:"to"`
	Label        string `json:"label"`
	RequiresNote bool   `json:"requiresNote"`
}

func move(to string, requiresNote bool) Transition {
	return Transition{To: to, Label: StatusLabel(to), RequiresNote: requiresNote}
}

// Transitions lists manual moves per status.
// Terminal statuses map to no moves.
var Transitions = map[string][]Transition{
	StatusDraft:     {move(StatusSent, false), move(StatusCancelled, true)},
	StatusSent:      {move(StatusAccepted, false), move(StatusRejected, true), move(StatusCancelled, true)},
	StatusRevision:  {move(StatusRejected, true), move(StatusCancelled, true)},
	StatusAccepted:  {},
	StatusRejected:  {},
	StatusCancelled: {},
	StatusExpired:   {},
}

// AllowedTransitions copies the offered moves.
// Never nil, so JSON encodes [].
func AllowedTransitions(status string) []Transition {
	out := make([]Transition, len(Transitions[status]))
	copy(out, Transitions[status])
	return out
}

// CanRevise reports the Buat Revisi action.
func CanRevise(status string) bool { return status == StatusSent }

// StatusLabel falls back to the key.
func StatusLabel(status string) string {
	for _, s := range Statuses {
		if s.Status == status {
			return s.Label
		}
	}
	return status
}

// noteRequired reports a mandatory reason.
// Every move into the target shares the rule.
func noteRequired(to string) bool {
	for _, ts := range Transitions {
		for _, t := range ts {
			if t.To == to {
				return t.RequiresNote
			}
		}
	}
	return false
}
