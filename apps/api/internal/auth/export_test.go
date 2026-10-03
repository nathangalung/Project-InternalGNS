package auth

import (
	"context"
	"time"
)

// SetClock replaces the mint clock.
func SetClock(s *Service, now func() time.Time) { s.now = now }

// SetThrottle replaces the backoff wait.
func SetThrottle(s *Service, wait func(context.Context, time.Duration)) { s.wait = wait }
