package live_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/live"
)

func recv(t *testing.T, ch <-chan live.Event) live.Event {
	t.Helper()
	select {
	case ev, ok := <-ch:
		require.True(t, ok, "channel closed")
		return ev
	case <-time.After(time.Second):
		t.Fatal("no event")
		return live.Event{}
	}
}

func quiet(t *testing.T, ch <-chan live.Event) {
	t.Helper()
	select {
	case ev := <-ch:
		t.Fatalf("unexpected event %+v", ev)
	case <-time.After(30 * time.Millisecond):
	}
}

// Events reach only that quotation.
func TestHub_FansOutPerQuotation(t *testing.T) {
	h := live.NewHub()
	a1, stopA1 := h.Subscribe(1)
	defer stopA1()
	a2, stopA2 := h.Subscribe(1)
	defer stopA2()
	b, stopB := h.Subscribe(2)
	defer stopB()

	ev := live.Event{QuotationID: 1, Kind: "line", Part: "line:9", UserID: 3}
	h.Publish(ev)
	assert.Equal(t, ev, recv(t, a1))
	assert.Equal(t, ev, recv(t, a2))
	quiet(t, b)
}

// Unsubscribing closes the channel.
func TestHub_UnsubscribeCloses(t *testing.T) {
	h := live.NewHub()
	ch, stop := h.Subscribe(1)
	stop()
	stop() // twice is harmless
	_, open := <-ch
	assert.False(t, open)
	h.Publish(live.Event{QuotationID: 1, Kind: "line"})
}

// A slow viewer never blocks.
// Events only tell a page to reload, so one pending event is enough; the
// rest are dropped instead of stalling the publisher.
func TestHub_SlowSubscriberDoesNotBlock(t *testing.T) {
	h := live.NewHub()
	ch, stop := h.Subscribe(1)
	defer stop()
	done := make(chan struct{})
	go func() {
		for i := 0; i < 1000; i++ {
			h.Publish(live.Event{QuotationID: 1, Kind: "line"})
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("publish blocked on a slow subscriber")
	}
	recv(t, ch)
}

// Close ends every stream.
func TestHub_CloseEndsSubscriptions(t *testing.T) {
	h := live.NewHub()
	ch, stop := h.Subscribe(1)
	defer stop()
	h.Close()
	h.Close()
	_, open := <-ch
	assert.False(t, open)

	late, stopLate := h.Subscribe(1)
	defer stopLate()
	_, open = <-late
	assert.False(t, open, "a closed hub hands out closed channels")
	h.Publish(live.Event{QuotationID: 1})
}

// Payloads decode from Postgres.
func TestParse(t *testing.T) {
	cases := []struct {
		name    string
		payload string
		want    live.Event
		ok      bool
	}{
		{"line", `{"quotationId": 5, "kind": "line", "part": "line:7", "userId": 2}`,
			live.Event{QuotationID: 5, Kind: "line", Part: "line:7", UserID: 2}, true},
		{"null part", `{"quotationId": 5, "kind": "lines", "part": null, "userId": 2}`,
			live.Event{QuotationID: 5, Kind: "lines", UserID: 2}, true},
		{"no quotation", `{"kind": "lines"}`, live.Event{}, false},
		{"garbage", `not json`, live.Event{}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := live.Parse(tc.payload)
			assert.Equal(t, tc.ok, ok)
			assert.Equal(t, tc.want, got)
		})
	}
}

// Resync reaches every subscriber.
func TestHub_ResyncReachesEverySubscriber(t *testing.T) {
	h := live.NewHub()
	a, stopA := h.Subscribe(1)
	defer stopA()
	b, stopB := h.Subscribe(2)
	defer stopB()

	h.Resync()
	assert.Equal(t, live.Event{QuotationID: 1, Kind: live.KindResync}, recv(t, a))
	assert.Equal(t, live.Event{QuotationID: 2, Kind: live.KindResync}, recv(t, b))

	h.Close()
	h.Resync() // a closed hub has nobody to tell
}
