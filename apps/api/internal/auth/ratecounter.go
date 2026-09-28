package auth

import (
	"math"
	"sync"
	"time"

	"github.com/go-chi/httprate"
)

// monotonicCounter windows on monotonic time.
// httprate derives each window from time.Now().UTC(), which strips the
// monotonic reading, and its local counter clears every count when handed a
// window older than the last. A backward wall-clock step past a window start
// therefore forgets the attempts already made (observed as a ~2.9s step
// every ~30s under WSL2). This counter ignores the windows httprate passes
// and keeps its own, aligned to its creation and measured with the injected
// clock; time.Now keeps the monotonic reading, so a wall step moves nothing.
// The sliding estimate is folded into the current count, so httprate never
// weighs the previous window by the wall clock. X-RateLimit-Reset still
// reads the wall clock; Retry-After is the fixed window length.
type monotonicCounter struct {
	mu     sync.Mutex
	now    func() time.Time
	start  time.Time
	window time.Duration
	index  int64
	curr   map[string]int
	prev   map[string]int
}

var _ httprate.LimitCounter = (*monotonicCounter)(nil)

func newMonotonicCounter(now func() time.Time) *monotonicCounter {
	return &monotonicCounter{
		now:   now,
		start: now(),
		curr:  make(map[string]int),
		prev:  make(map[string]int),
	}
}

// Config takes the window length.
func (c *monotonicCounter) Config(_ int, windowLength time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.window = windowLength
}

func (c *monotonicCounter) Increment(key string, currentWindow time.Time) error {
	return c.IncrementBy(key, currentWindow, 1)
}

func (c *monotonicCounter) IncrementBy(key string, _ time.Time, amount int) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.roll()
	c.curr[key] += amount
	return nil
}

// Get returns the sliding estimate.
// The previous window weighs by the share of it still inside the sliding
// window, rounded as httprate rounds; the second value is always zero.
func (c *monotonicCounter) Get(key string, _, _ time.Time) (int, int, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	into := c.roll()
	weight := float64(c.window-into) / float64(c.window)
	return int(math.Round(float64(c.prev[key])*weight)) + c.curr[key], 0, nil
}

// roll advances to current window.
// It returns how far into that window the clock is.
func (c *monotonicCounter) roll() time.Duration {
	elapsed := c.now().Sub(c.start)
	idx := int64(elapsed / c.window)
	switch idx {
	case c.index:
	case c.index + 1:
		c.prev, c.curr = c.curr, c.prev
		clear(c.curr)
	default:
		clear(c.prev)
		clear(c.curr)
	}
	c.index = idx
	return elapsed % c.window
}
