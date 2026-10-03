package auth

import (
	"crypto/sha256"
	"strings"
	"sync"
)

// unknownMissLimit bounds tracked addresses.
// An evicted address reads zero again and answers without backoff, so the
// limit sets what flushing a probe costs: ten thousand misses on other
// addresses, each a full bcrypt, which the 100 per minute address budget
// stretches to 100 address-minutes. The table stays near 2 MB.
const unknownMissLimit = 10_000

type missKey [sha256.Size]byte

// missEntry is one tracked address.
// Entries form a ring around the counter's sentinel, most recent first.
type missEntry struct {
	key        missKey
	misses     int
	prev, next *missEntry
}

// missCounter tallies unknown-address misses.
// users.failed_login_attempts counts misses only for active accounts, so an
// unknown or deactivated address keeps its count here, in process memory
// (the API runs one replica). Keys are a digest of the trimmed, lower-cased
// address, the form loginAccountKey keys on, never the address itself.
// Like the column, a count never decays; when full, the address missed
// least recently is dropped.
type missCounter struct {
	mu    sync.Mutex
	limit int
	ring  missEntry
	byKey map[missKey]*missEntry
}

func newMissCounter(limit int) *missCounter {
	c := &missCounter{limit: limit, byKey: make(map[missKey]*missEntry)}
	c.ring.prev, c.ring.next = &c.ring, &c.ring
	return c
}

func keyOf(email string) missKey {
	return sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(email))))
}

// count returns prior misses.
func (c *missCounter) count(email string) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	if e, ok := c.byKey[keyOf(email)]; ok {
		return e.misses
	}
	return 0
}

// miss records one miss.
func (c *missCounter) miss(email string) {
	key := keyOf(email)
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.byKey[key]
	if ok {
		c.unlink(e)
	} else {
		if len(c.byKey) >= c.limit {
			oldest := c.ring.prev
			c.unlink(oldest)
			delete(c.byKey, oldest.key)
		}
		e = &missEntry{key: key}
		c.byKey[key] = e
	}
	e.misses++
	e.prev, e.next = &c.ring, c.ring.next
	c.ring.next.prev = e
	c.ring.next = e
}

func (c *missCounter) unlink(e *missEntry) {
	e.prev.next = e.next
	e.next.prev = e.prev
}
