package auth

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// Misses count per address.
// Each normalised address keeps its own tally, and a full counter drops
// the address missed least recently, which then reads zero again.
func TestMissCounter(t *testing.T) {
	tests := []struct {
		name   string
		limit  int
		misses []string
		want   map[string]int
	}{
		{"unseen reads zero", 4, nil, map[string]int{"a@x": 0}},
		{"counts each miss", 4, []string{"a@x", "a@x", "a@x"}, map[string]int{"a@x": 3}},
		{"addresses independent", 4, []string{"a@x", "b@x", "a@x"}, map[string]int{"a@x": 2, "b@x": 1}},
		{"case and space fold", 4, []string{"A@X", " a@x "}, map[string]int{"a@x": 2}},
		{
			"full drops least recent", 2,
			[]string{"a@x", "b@x", "a@x", "c@x"},
			map[string]int{"a@x": 2, "b@x": 0, "c@x": 1},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			c := newMissCounter(tc.limit)
			for _, email := range tc.misses {
				c.miss(email)
			}
			for email, n := range tc.want {
				assert.Equal(t, n, c.count(email), email)
			}
			assert.LessOrEqual(t, len(c.byKey), tc.limit)
		})
	}
}
