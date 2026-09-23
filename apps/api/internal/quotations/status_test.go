package quotations

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAllowedTransitions(t *testing.T) {
	tests := []struct {
		from string
		want []string
	}{
		{StatusDraft, []string{StatusSent, StatusCancelled}},
		{StatusSent, []string{StatusAccepted, StatusRejected, StatusCancelled}},
		{StatusRevision, []string{StatusRejected, StatusCancelled}},
		{StatusAccepted, []string{}},
		{StatusRejected, []string{}},
		{StatusCancelled, []string{}},
		{StatusExpired, []string{}},
		{"unknown", []string{}},
	}
	for _, tt := range tests {
		t.Run(tt.from, func(t *testing.T) {
			got := AllowedTransitions(tt.from)
			require.NotNil(t, got, "terminal states must encode as []")
			to := make([]string, 0, len(got))
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
		to   string
		want bool
	}{
		{StatusSent, false},
		{StatusAccepted, false},
		{StatusRejected, true},
		{StatusCancelled, true},
		{StatusRevision, false},
		{StatusExpired, false},
	}
	for _, tt := range tests {
		t.Run(tt.to, func(t *testing.T) {
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
	assert.Equal(t, "Kedaluwarsa", StatusLabel(StatusExpired))
	assert.Equal(t, "Dibatalkan", StatusLabel(StatusCancelled))
	assert.Equal(t, "zzz", StatusLabel("zzz"))
}

func TestCanRevise(t *testing.T) {
	for _, s := range Statuses {
		assert.Equal(t, s.Status == StatusSent, CanRevise(s.Status), s.Status)
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
