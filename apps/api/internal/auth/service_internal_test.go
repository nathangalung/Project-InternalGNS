package auth

import (
	"context"
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
		{"last doubling", 8, 2 * time.Second},
		{"doubling reaches the ceiling", 9, 4 * time.Second},
		{"past the ceiling", 10, 4 * time.Second},
		{"capped", 20, 4 * time.Second},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, loginBackoff(tc.attempts))
		})
	}
}

// A caller that gives up stops paying.
// The wait ends at the request deadline, so a dropped connection does not
// hold a handler goroutine for the whole backoff.
func TestThrottle_EndsAtTheCallerDeadline(t *testing.T) {
	tests := []struct {
		name    string
		delay   time.Duration
		timeout time.Duration
		maxWait time.Duration
	}{
		{"no delay", 0, time.Hour, 50 * time.Millisecond},
		{"delay served", 30 * time.Millisecond, time.Hour, time.Second},
		{"deadline first", 4 * time.Second, 20 * time.Millisecond, time.Second},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), tc.timeout)
			defer cancel()
			start := time.Now()
			throttle(ctx, tc.delay)
			took := time.Since(start)
			assert.GreaterOrEqual(t, took, min(tc.delay, tc.timeout))
			assert.Less(t, took, tc.maxWait)
		})
	}
}
