package units_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/units"
)

func TestRepo_ErrorPath(t *testing.T) {
	r := units.NewRepo(testutil.FakeExec{}, testutil.Store(t))
	_, err := r.ListAll(context.Background())
	assert.ErrorIs(t, err, testutil.ErrFake)
}
