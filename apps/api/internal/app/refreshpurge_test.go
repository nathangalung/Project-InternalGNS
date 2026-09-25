package app

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

type fakePurger struct {
	calls atomic.Int32
	err   error
}

func (f *fakePurger) PurgeExpired(context.Context) (int64, error) {
	f.calls.Add(1)
	return 1, f.err
}

func TestRunRefreshPurgeLoop(t *testing.T) {
	tests := []struct {
		name      string
		err       error
		wantCalls int32
	}{
		{name: "sweeps once at startup", err: nil, wantCalls: 1},
		{name: "keeps running after an error", err: errors.New("boom"), wantCalls: 1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(t.Context())
			repo := &fakePurger{err: tt.err}
			done := make(chan struct{})
			go func() {
				defer close(done)
				runRefreshPurgeLoop(ctx, repo, time.Hour)
			}()

			// The startup sweep runs before the first tick.
			deadline := time.After(2 * time.Second)
			for repo.calls.Load() < tt.wantCalls {
				select {
				case <-deadline:
					t.Fatalf("purge calls = %d, want %d", repo.calls.Load(), tt.wantCalls)
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
		})
	}
}

// A context cancelled up front must not run a sweep at all.
func TestRunRefreshPurgeLoop_CancelledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	repo := &fakePurger{}
	runRefreshPurgeLoop(ctx, repo, time.Hour)
	if got := repo.calls.Load(); got != 0 {
		t.Fatalf("purge calls = %d, want 0", got)
	}
}

// The sweep repeats every interval.
// A long-running instance must keep purging, not only at startup.
func TestRunRefreshPurgeLoop_RepeatsEachInterval(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	repo := &fakePurger{}
	done := make(chan struct{})
	go func() {
		defer close(done)
		runRefreshPurgeLoop(ctx, repo, 5*time.Millisecond)
	}()

	deadline := time.After(2 * time.Second)
	for repo.calls.Load() < 3 {
		select {
		case <-deadline:
			t.Fatalf("purge calls = %d, want at least 3", repo.calls.Load())
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
}

// cancellingPurger fails after shutdown began.
type cancellingPurger struct{ cancel context.CancelFunc }

func (p cancellingPurger) PurgeExpired(context.Context) (int64, error) {
	p.cancel()
	return 0, context.Canceled
}

// Shutdown mid-sweep logs nothing.
// A purge cut short by shutdown is expected, so it must not page anyone
// with an error line.
func TestRunRefreshPurgeLoop_ShutdownMidSweepIsSilent(t *testing.T) {
	logs := captureLogs(t)
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan struct{})
	go func() {
		defer close(done)
		runRefreshPurgeLoop(ctx, cancellingPurger{cancel: cancel}, time.Hour)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("loop did not stop after shutdown mid-sweep")
	}
	if _, msgs := logs.snapshot(); len(msgs) != 0 {
		t.Fatalf("shutdown mid-sweep logged %q", msgs)
	}
}
