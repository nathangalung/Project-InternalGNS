// Package live fans out quotation events.
//
// Postgres announces every change to a draft with
// pg_notify('quotation_events', ...) (migration 00078). One connection per
// API process listens and hands each event to the open editor streams of
// that quotation, so the same change reaches every replica's viewers.
package live

import (
	"encoding/json"
	"sync"
)

// Channel is the NOTIFY channel.
const Channel = "quotation_events"

// buffer per subscriber.
// An event only tells a page to reload, so a few pending are plenty; more
// are dropped rather than stalling the publisher.
const buffer = 8

// KindResync means missed changes.
// Sent after the listener reconnects: notices committed while it was down
// are gone, so every viewer reloads instead.
const KindResync = "resync"

// Event is one change to a quotation.
// Kind is locked, unlocked, line, lines, header, requests, status or
// resync; Part names the line ("line:<id>") or "header" when the change
// concerns one.
type Event struct {
	QuotationID int64  `json:"quotationId"`
	Kind        string `json:"kind"`
	Part        string `json:"part,omitempty"`
	UserID      int64  `json:"userId"`
}

// Parse reads a NOTIFY payload.
// ok is false for a payload with no quotation, which nobody could receive.
func Parse(payload string) (Event, bool) {
	var raw struct {
		QuotationID int64   `json:"quotationId"`
		Kind        string  `json:"kind"`
		Part        *string `json:"part"`
		UserID      int64   `json:"userId"`
	}
	if err := json.Unmarshal([]byte(payload), &raw); err != nil || raw.QuotationID == 0 {
		return Event{}, false
	}
	ev := Event{QuotationID: raw.QuotationID, Kind: raw.Kind, UserID: raw.UserID}
	if raw.Part != nil {
		ev.Part = *raw.Part
	}
	return ev, true
}

// Hub routes events to subscribers.
type Hub struct {
	mu     sync.Mutex
	subs   map[int64]map[chan Event]struct{}
	closed bool
}

// NewHub returns an empty hub.
func NewHub() *Hub {
	return &Hub{subs: map[int64]map[chan Event]struct{}{}}
}

// Subscribe follows one quotation.
// The channel closes when stop runs or the hub closes; a closed hub hands
// out a channel that is already closed.
func (h *Hub) Subscribe(quotationID int64) (<-chan Event, func()) {
	ch := make(chan Event, buffer)
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		close(ch)
		return ch, func() {}
	}
	if h.subs[quotationID] == nil {
		h.subs[quotationID] = map[chan Event]struct{}{}
	}
	h.subs[quotationID][ch] = struct{}{}
	return ch, func() { h.drop(quotationID, ch) }
}

// drop removes one subscriber.
func (h *Hub) drop(quotationID int64, ch chan Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	set := h.subs[quotationID]
	if _, ok := set[ch]; !ok {
		return
	}
	delete(set, ch)
	if len(set) == 0 {
		delete(h.subs, quotationID)
	}
	close(ch)
}

// Publish delivers without blocking.
func (h *Hub) Publish(ev Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs[ev.QuotationID] {
		select {
		case ch <- ev:
		default:
		}
	}
}

// Resync asks subscribers to reload.
// Each gets a resync event for its own quotation, without blocking like
// Publish.
func (h *Hub) Resync() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for id, set := range h.subs {
		ev := Event{QuotationID: id, Kind: KindResync}
		for ch := range set {
			select {
			case ch <- ev:
			default:
			}
		}
	}
}

// Close ends every subscription.
// Registered with http.Server.RegisterOnShutdown: an open stream is never
// idle, so without this a shutdown would wait out its whole drain budget.
func (h *Hub) Close() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return
	}
	h.closed = true
	for id, set := range h.subs {
		for ch := range set {
			close(ch)
		}
		delete(h.subs, id)
	}
}
