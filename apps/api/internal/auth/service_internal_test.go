package auth

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"
)

// The unknown-email path must do real bcrypt work at the same cost as a
// stored hash, otherwise timing still separates registered addresses.
func TestDummyPasswordHash_MatchesDefaultCost(t *testing.T) {
	require.NotEmpty(t, dummyPasswordHash)

	cost, err := bcrypt.Cost(dummyPasswordHash)
	require.NoError(t, err)
	assert.Equal(t, bcrypt.DefaultCost, cost)

	assert.Error(t, bcrypt.CompareHashAndPassword(dummyPasswordHash, []byte("any-guess")))
}

// The throttle must stay invisible for ordinary typos and escalate only
// under sustained guessing, with a ceiling a real user can wait out.
func TestLoginBackoff(t *testing.T) {
	tests := []struct {
		name     string
		attempts int
		want     time.Duration
	}{
		{"no misses", 0, 0},
		{"typo range", 4, 0},
		{"first throttle", 5, 250 * time.Millisecond},
		{"doubles", 6, 500 * time.Millisecond},
		{"doubles again", 7, time.Second},
		{"capped", 20, 4 * time.Second},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, loginBackoff(tc.attempts))
		})
	}
}
