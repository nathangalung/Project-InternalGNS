package tz

import (
	"sync"
	"time"
)

var (
	jakartaOnce sync.Once
	jakarta     *time.Location
)

// Asia/Jakarta location, lazy.
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

// Current time in Jakarta.
func Now() time.Time { return time.Now().In(Jakarta()) }
