package acceptance_test

import (
	"os"
	"testing"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Serialize suites sharing the DB.
func TestMain(m *testing.M) {
	release := testutil.LockProcessForTests()
	code := m.Run()
	release()
	os.Exit(code)
}
