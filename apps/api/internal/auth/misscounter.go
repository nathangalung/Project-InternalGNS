package auth

import (
	"container/list"
	"crypto/sha256"
	"sync"
)

// unknownMissLimit bounds tracked addresses.
// An evicted address reads zero again and answers without backoff. Flushing
// a probe takes ten thousand misses on other addresses: 100 minutes from one
// IP at the 100 per minute address budget, about two minutes from 50 IPs.
// A restart flushes everything for free, while users.failed_login_attempts
// survives it, so an address probed past the free misses before a deploy
// tells on its first attempt after it. Both are accepted residual risks.
// The table stays near 2 MB.
const unknownMissLimit = 10_000

type missKey [sha256.Size]byte

// missEntry is one tracked address.
type missEntry struct {
	key    missKey
	misses int
}

// missCounter tallies unknown-address misses.
// users.failed_login_attempts counts misses only for active accounts, so an
// unknown or deactivated address keeps its count here, in process memory
// (the API runs one replica). Keys are a digest of the address as Login
// normalised it, never the address itself.
// Like the column, a count never decays; when full, the address missed
// least recently is dropped.
type missCounter struct {
	mu     sync.Mutex
	limit  int
	recent *list.List
	byKey  map[missKey]*list.Element
}

func newMissCounter(limit int) *missCounter {
	return &missCounter{limit: limit, recent: list.New(), byKey: make(map[missKey]*list.Element)}
}

func keyOf(email string) missKey {
	return sha256.Sum256([]byte(email))
}

// count returns prior misses.
func (c *missCounter) count(email string) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	if el, ok := c.byKey[keyOf(email)]; ok {
		return el.Value.(*missEntry).misses
	}
	return 0
}

// miss records one miss.
func (c *missCounter) miss(email string) {
	key := keyOf(email)
	c.mu.Lock()
	defer c.mu.Unlock()
	if el, ok := c.byKey[key]; ok {
		el.Value.(*missEntry).misses++
		c.recent.MoveToFront(el)
		return
	}
	if len(c.byKey) >= c.limit {
		oldest := c.recent.Back()
		c.recent.Remove(oldest)
		delete(c.byKey, oldest.Value.(*missEntry).key)
	}
	c.byKey[key] = c.recent.PushFront(&missEntry{key: key, misses: 1})
}
