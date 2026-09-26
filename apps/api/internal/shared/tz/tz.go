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
	jakartaOnce.Do(func() { jakarta = jakartaFrom(time.LoadLocation) })
	return jakarta
}

// jakartaFrom falls back to WIB.
func jakartaFrom(load func(string) (*time.Location, error)) *time.Location {
	loc, err := load("Asia/Jakarta")
	if err != nil {
		return time.FixedZone("WIB", 7*60*60)
	}
	return loc
}

// Current time in Jakarta.
func Now() time.Time { return time.Now().In(Jakarta()) }
