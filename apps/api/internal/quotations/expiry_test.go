package quotations

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

type fakeExpirer struct {
	calls atomic.Int32
	asOf  atomic.Pointer[time.Time]
	err   error
}

func (f *fakeExpirer) ExpireDue(_ context.Context, asOf time.Time) (int64, error) {
	f.calls.Add(1)
	f.asOf.Store(&asOf)
	return 1, f.err
}

func TestRunExpiryLoop(t *testing.T) {
	fixed := time.Date(2026, 3, 8, 17, 1, 0, 0, time.UTC)
	tests := []struct {
		name      string
		interval  time.Duration
		err       error
		wantCalls int32
	}{
		{name: "runs once at startup", interval: time.Hour, wantCalls: 1},
		{name: "keeps running after an error", interval: time.Millisecond, err: errors.New("boom"), wantCalls: 3},
		{name: "runs again each tick", interval: time.Millisecond, wantCalls: 3},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(t.Context())
			repo := &fakeExpirer{err: tt.err}
			done := make(chan struct{})
			go func() {
				defer close(done)
				RunExpiryLoop(ctx, repo, tt.interval, func() time.Time { return fixed })
			}()

			deadline := time.After(2 * time.Second)
			for repo.calls.Load() < tt.wantCalls {
				select {
				case <-deadline:
					t.Fatalf("expiry calls = %d, want %d", repo.calls.Load(), tt.wantCalls)
				default:
					time.Sleep(time.Millisecond)
				}
			}

			cancel()
			select {
			case <-done:
			case <-time.After(2 * time.Second):
				t.Fatal("loop did not stop on context cancel")
			}
			if got := repo.asOf.Load(); got == nil || !got.Equal(fixed) {
				t.Fatalf("asOf = %v, want the injected %v", got, fixed)
			}
		})
	}
}

// A cancelled context runs nothing.
func TestRunExpiryLoop_CancelledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	repo := &fakeExpirer{}
	RunExpiryLoop(ctx, repo, time.Hour, time.Now)
	if got := repo.calls.Load(); got != 0 {
		t.Fatalf("expiry calls = %d, want 0", got)
	}
}
