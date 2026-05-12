package testutil

import (
	"os"
	"path/filepath"
	"syscall"
)

// Cross-package serialization via flock.
func LockProcessForTests() func() {
	path := filepath.Join(os.TempDir(), "internalgns-test.lock")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return func() {}
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX); err != nil {
		_ = f.Close()
		return func() {}
	}
	return func() {
		_ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
		_ = f.Close()
	}
}
