package tz

import (
	"sync"
	"time"
)

var (
	jakartaOnce sync.Once
	jakarta     *time.Location
)

// Jakarta returns Asia/Jakarta (UTC+7), lazily loaded once.
func Jakarta() *time.Location {
	jakartaOnce.Do(func() {
		loc, err := time.LoadLocation("Asia/Jakarta")
		if err != nil {
			loc = time.FixedZone("WIB", 7*60*60)
		}
		jakarta = loc
	})
	return jakarta
}

// Now returns the current time in Jakarta.
func Now() time.Time { return time.Now().In(Jakarta()) }
