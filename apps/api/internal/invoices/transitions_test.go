package invoices_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
)

func TestAllowedTransitions(t *testing.T) {
	cases := []struct {
		name string
		from invoices.Status
		want []invoices.Status
	}{
		{name: "draft", from: invoices.StatusDraft, want: []invoices.Status{invoices.StatusSent, invoices.StatusCancelled}},
		{name: "sent", from: invoices.StatusSent, want: []invoices.Status{invoices.StatusPaid, invoices.StatusCancelled}},
		{name: "overdue", from: invoices.StatusOverdue, want: []invoices.Status{invoices.StatusPaid, invoices.StatusCancelled}},
		{name: "paid is terminal", from: invoices.StatusPaid, want: []invoices.Status{}},
		{name: "cancelled is terminal", from: invoices.StatusCancelled, want: []invoices.Status{}},
		{name: "unknown", from: invoices.Status("garbage"), want: []invoices.Status{}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, invoices.AllowedTransitions(tc.from))
		})
	}
}

// The caller may not mutate the package map through the returned slice.
func TestAllowedTransitions_ReturnsCopy(t *testing.T) {
	got := invoices.AllowedTransitions(invoices.StatusDraft)
	got[0] = invoices.StatusPaid
	assert.Equal(t, invoices.StatusSent, invoices.AllowedTransitions(invoices.StatusDraft)[0])
}
