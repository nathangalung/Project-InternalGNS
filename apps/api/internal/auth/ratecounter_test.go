package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/httprate"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeClock steps only when told.
type fakeClock struct{ t time.Time }

func (c *fakeClock) now() time.Time { return c.t }

// Counter ignores the wall windows.
// httprate hands every call a window read from the wall clock with the
// monotonic reading stripped. A backward clock step past a window start
// makes that window older than the last one, and httprate's own counter
// then drops every count. The windows here come from the injected clock
// only, so the wall windows passed in, older or newer, change nothing.
func TestMonotonicCounter(t *testing.T) {
	const window = time.Minute
	t0 := time.Date(2026, 9, 28, 4, 45, 3, 0, time.UTC)
	wall := t0.Truncate(window)

	cases := []struct {
		name    string
		before  int           // increments at t0
		advance time.Duration // clock step before the read
		after   int           // increments after the step
		getWall time.Time     // wall window httprate passes to Get
		want    int
	}{
		{name: "counts within a window", before: 5, getWall: wall, want: 5},
		{name: "backward wall step keeps counts", before: 5, getWall: wall.Add(-window), want: 5},
		{name: "forward wall step keeps counts", before: 5, getWall: wall.Add(3 * window), want: 5},
		{name: "next window weighs the last fully", before: 5, advance: window, getWall: wall, want: 5},
		{name: "half a window later weighs half", before: 5, advance: window + window/2, getWall: wall, want: 3},
		{name: "increments after a roll add up", before: 5, advance: window + window/2, after: 1, getWall: wall, want: 4},
		{name: "two windows later forgets", before: 5, advance: 2 * window, getWall: wall, want: 0},
		{name: "increment after a gap starts fresh", before: 5, advance: 5 * window, after: 2, getWall: wall, want: 2},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			clock := &fakeClock{t: t0}
			c := newMonotonicCounter(clock.now)
			c.Config(5, window)
			for range tc.before {
				require.NoError(t, c.Increment("k", wall))
			}
			clock.t = clock.t.Add(tc.advance)
			if tc.after > 0 {
				require.NoError(t, c.IncrementBy("k", wall.Add(-window), tc.after))
			}

			curr, prev, err := c.Get("k", tc.getWall, tc.getWall.Add(-window))
			require.NoError(t, err)
			assert.Equal(t, tc.want, curr)
			assert.Zero(t, prev, "the slide is folded into curr")

			other, _, err := c.Get("other", tc.getWall, tc.getWall.Add(-window))
			require.NoError(t, err)
			assert.Zero(t, other, "keys count apart")
		})
	}
}

// Limiter follows the injected clock.
// Mounted in httprate the counter caps the sixth request in a window and
// lets requests through again once the window has passed.
func TestMonotonicCounter_InLimiter(t *testing.T) {
	clock := &fakeClock{t: time.Date(2026, 9, 28, 4, 45, 3, 0, time.UTC)}
	h := httprate.LimitBy(5, time.Minute, httprate.Key("k"),
		httprate.WithLimitCounter(newMonotonicCounter(clock.now)))(
		http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	hit := func() int {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/login", nil))
		return rec.Code
	}

	for i := range 5 {
		assert.Equal(t, http.StatusNoContent, hit(), "request %d", i+1)
	}
	assert.Equal(t, http.StatusTooManyRequests, hit(), "the sixth is refused")

	clock.t = clock.t.Add(2 * time.Minute)
	assert.Equal(t, http.StatusNoContent, hit(), "a later window admits again")
}
