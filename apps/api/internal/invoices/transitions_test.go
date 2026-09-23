package invoices_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
)

func TestAllowedTransitions(t *testing.T) {
	sent := invoices.Transition{To: invoices.StatusSent, Label: "Dikirim"}
	paid := invoices.Transition{To: invoices.StatusPaid, Label: "Dibayar"}
	cancel := invoices.Transition{To: invoices.StatusCancelled, Label: "Dibatalkan", RequiresNote: true}

	cases := []struct {
		name  string
		from  invoices.Status
		hasPO bool
		want  []invoices.Transition
	}{
		{name: "draft", from: invoices.StatusDraft, hasPO: true, want: []invoices.Transition{sent, cancel}},
		{name: "sent", from: invoices.StatusSent, hasPO: true, want: []invoices.Transition{paid, cancel}},
		{name: "overdue", from: invoices.StatusOverdue, hasPO: true, want: []invoices.Transition{paid, cancel}},
		{name: "paid is terminal", from: invoices.StatusPaid, hasPO: true, want: []invoices.Transition{}},
		{name: "cancelled is terminal", from: invoices.StatusCancelled, hasPO: true, want: []invoices.Transition{}},
		{name: "unknown", from: invoices.Status("garbage"), hasPO: true, want: []invoices.Transition{}},
		// A cancel is only offered where a Pengganti can follow it.
		{name: "draft without a PO", from: invoices.StatusDraft, hasPO: false, want: []invoices.Transition{sent}},
		{name: "sent without a PO", from: invoices.StatusSent, hasPO: false, want: []invoices.Transition{paid}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, invoices.AllowedTransitions(tc.from, tc.hasPO))
		})
	}
}

// The caller may not mutate the package map through the returned slice.
func TestAllowedTransitions_ReturnsCopy(t *testing.T) {
	got := invoices.AllowedTransitions(invoices.StatusDraft, true)
	got[0].To = invoices.StatusPaid
	assert.Equal(t, invoices.StatusSent, invoices.AllowedTransitions(invoices.StatusDraft, true)[0].To)
}

// Statuses carry labels in order.
func TestStatusOrder_Labelled(t *testing.T) {
	want := []invoices.Status{
		invoices.StatusDraft, invoices.StatusSent, invoices.StatusOverdue,
		invoices.StatusPaid, invoices.StatusCancelled,
	}
	assert.Equal(t, want, invoices.StatusOrder)
	labels := map[invoices.Status]string{
		invoices.StatusDraft:     "Draf",
		invoices.StatusSent:      "Dikirim",
		invoices.StatusOverdue:   "Terlambat",
		invoices.StatusPaid:      "Dibayar",
		invoices.StatusCancelled: "Dibatalkan",
	}
	for _, s := range invoices.StatusOrder {
		assert.Equal(t, labels[s], invoices.StatusLabel(s), s)
	}
	assert.Equal(t, "garbage", invoices.StatusLabel("garbage"))
}

// No move targets Terlambat.
// It is derived from the due date.
func TestTransitions_NeverTargetOverdue(t *testing.T) {
	for from, moves := range invoices.Transitions {
		for _, m := range moves {
			assert.NotEqual(t, invoices.StatusOverdue, m.To, "from %s", from)
		}
	}
}
