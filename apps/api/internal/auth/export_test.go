package auth

import "time"

// SetClock replaces the mint clock.
func SetClock(s *Service, now func() time.Time) { s.now = now }
