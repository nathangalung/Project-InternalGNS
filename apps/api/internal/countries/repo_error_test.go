package countries_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/nathangalung/internalgns/apps/api/internal/countries"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

func TestRepo_ErrorPath(t *testing.T) {
	r := countries.NewRepo(testutil.FakeExec{}, testutil.Store(t))
	_, err := r.ListAll(context.Background())
	assert.ErrorIs(t, err, testutil.ErrFake)
}
