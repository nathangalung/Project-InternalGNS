package quotations

// Quotation status model.
//
// Transitions mirrors the table inside fn_change_quotation_status; the
// mirror test fails when the two disagree. Two moves live outside it on
// purpose: sent -> revision happens only through fn_revise_quotation, which
// clones the draft in the same transaction, and sent -> expired only through
// fn_expire_quotations, the daily job.

// Status is a stored key.
type Status string

// Status keys as stored.
const (
	StatusDraft     Status = "draft"
	StatusSent      Status = "sent"
	StatusRevision  Status = "revision"
	StatusAccepted  Status = "accepted"
	StatusRejected  Status = "rejected"
	StatusCancelled Status = "cancelled"
	StatusExpired   Status = "expired"
)

// StatusInfo pairs status and label.
type StatusInfo struct {
	Status Status `json:"status"`
	Label  string `json:"label"`
}

// Statuses is the display order.
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
	To           Status `json:"to"`
	Label        string `json:"label"`
	RequiresNote bool   `json:"requiresNote"`
}

func move(to Status, requiresNote bool) Transition {
	return Transition{To: to, Label: StatusLabel(to), RequiresNote: requiresNote}
}

// Transitions lists manual moves.
// Terminal statuses map to no moves.
var Transitions = map[Status][]Transition{
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
func AllowedTransitions(status Status) []Transition {
	out := make([]Transition, len(Transitions[status]))
	copy(out, Transitions[status])
	return out
}

// CanRevise gates Buat Revisi.
func CanRevise(status Status) bool { return status == StatusSent }

// StatusLabel defaults to the key.
func StatusLabel(status Status) string {
	for _, s := range Statuses {
		if s.Status == status {
			return s.Label
		}
	}
	return string(status)
}

// noteRequired reports a mandatory reason.
// Every move into the target shares the rule.
func noteRequired(to Status) bool {
	for _, ts := range Transitions {
		for _, t := range ts {
			if t.To == to {
				return t.RequiresNote
			}
		}
	}
	return false
}
