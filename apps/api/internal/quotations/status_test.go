package quotations

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAllowedTransitions(t *testing.T) {
	tests := []struct {
		from Status
		want []Status
	}{
		{StatusDraft, []Status{StatusSent, StatusCancelled}},
		{StatusSent, []Status{StatusAccepted, StatusRejected, StatusCancelled}},
		{StatusRevision, []Status{StatusRejected, StatusCancelled}},
		{StatusAccepted, []Status{}},
		{StatusRejected, []Status{}},
		{StatusCancelled, []Status{}},
		{"unknown", []Status{}},
	}
	for _, tt := range tests {
		t.Run(string(tt.from), func(t *testing.T) {
			got := AllowedTransitions(tt.from)
			require.NotNil(t, got, "terminal states must encode as []")
			to := make([]Status, 0, len(got))
			for _, tr := range got {
				to = append(to, tr.To)
				assert.Equal(t, StatusLabel(tr.To), tr.Label, "label for %s", tr.To)
			}
			assert.Equal(t, tt.want, to)
		})
	}
}

func TestNoteRequired(t *testing.T) {
	tests := []struct {
		to   Status
		want bool
	}{
		{StatusSent, false},
		{StatusAccepted, false},
		{StatusRejected, true},
		{StatusCancelled, true},
		{StatusRevision, false},
	}
	for _, tt := range tests {
		t.Run(string(tt.to), func(t *testing.T) {
			assert.Equal(t, tt.want, noteRequired(tt.to))
		})
	}
}

func TestStatusesCoverTransitions(t *testing.T) {
	require.Len(t, Statuses, len(Transitions), "one ordered entry per status")
	for _, s := range Statuses {
		_, ok := Transitions[s.Status]
		assert.True(t, ok, "status %s missing from Transitions", s.Status)
	}
	assert.Equal(t, "Dibatalkan", StatusLabel(StatusCancelled))
	assert.Equal(t, "expired", StatusLabel("expired"), "a retired key has no label")
	assert.Equal(t, "zzz", StatusLabel("zzz"))
}

func TestCanRevise(t *testing.T) {
	for _, s := range Statuses {
		assert.Equal(t, s.Status == StatusSent, CanRevise(s.Status), string(s.Status))
	}
}

func TestValidateChangeStatus(t *testing.T) {
	blank := "  "
	reason := "Klien membatalkan"
	tests := []struct {
		name  string
		req   ChangeStatusRequest
		field string
	}{
		{"missing status", ChangeStatusRequest{}, "status"},
		{"blank status", ChangeStatusRequest{Status: " "}, "status"},
		{"send needs no note", ChangeStatusRequest{Status: StatusSent}, ""},
		{"reject without note", ChangeStatusRequest{Status: StatusRejected}, "note"},
		{"cancel blank note", ChangeStatusRequest{Status: StatusCancelled, Note: &blank}, "note"},
		{"cancel with note", ChangeStatusRequest{Status: StatusCancelled, Note: &reason}, ""},
		// The database refuses it with a clearer message.
		{"unknown status passes through", ChangeStatusRequest{Status: "zzz"}, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := validateChangeStatus(tt.req)
			if tt.field == "" {
				assert.Nil(t, got)
				return
			}
			require.Len(t, got, 1)
			assert.NotEmpty(t, got[tt.field])
		})
	}
}

func TestAllowedTransitions_ReturnsCopy(t *testing.T) {
	got := AllowedTransitions(StatusSent)
	got[0].Label = "changed"
	assert.Equal(t, "Disetujui", AllowedTransitions(StatusSent)[0].Label)
}
