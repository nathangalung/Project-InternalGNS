package purchaseorders

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestAllowedTransitions(t *testing.T) {
	cancel := Transition{To: StatusCancelled, Label: "Dibatalkan", RequiresNote: true}
	tests := []struct {
		from Status
		want []Transition
	}{
		{StatusPending, []Transition{cancel}},
		{StatusUploaded, []Transition{
			{To: StatusOnProgress, Label: "Dalam Progres"},
			cancel,
		}},
		{StatusOnProgress, []Transition{
			{To: StatusDelivered, Label: "Dikirim"},
			{To: StatusUploaded, Label: "PO Diunggah"},
			cancel,
		}},
		{StatusDelivered, []Transition{}},
		{StatusCancelled, []Transition{}},
		{"UNKNOWN", []Transition{}},
	}
	for _, tc := range tests {
		t.Run(string(tc.from), func(t *testing.T) {
			assert.Equal(t, tc.want, AllowedTransitions(tc.from))
		})
	}
}

// Callers cannot mutate the map.
func TestAllowedTransitions_ReturnsACopy(t *testing.T) {
	got := AllowedTransitions(StatusPending)
	got[0].To = StatusDelivered
	assert.Equal(t, StatusCancelled, AllowedTransitions(StatusPending)[0].To)
}

func TestStatusLabel(t *testing.T) {
	tests := []struct {
		status Status
		want   string
	}{
		{StatusPending, "Pending"},
		{StatusUploaded, "PO Diunggah"},
		{StatusOnProgress, "Dalam Progres"},
		{StatusDelivered, "Dikirim"},
		{StatusCancelled, "Dibatalkan"},
		{"UNKNOWN", "UNKNOWN"},
	}
	for _, tc := range tests {
		assert.Equal(t, tc.want, StatusLabel(tc.status))
	}
}

// Every status appears once.
func TestStatusOrder_CoversEveryStatus(t *testing.T) {
	assert.ElementsMatch(t, []Status{
		StatusPending, StatusUploaded, StatusOnProgress, StatusDelivered, StatusCancelled,
	}, StatusOrder)
}
