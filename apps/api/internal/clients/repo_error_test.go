package clients_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

func TestRepo_ErrorPaths(t *testing.T) {
	store := testutil.Store(t)
	r := clients.NewRepo(testutil.FakeExec{}, store)
	ctx := context.Background()

	_, err := r.List(ctx, 10, 0)
	assert.ErrorIs(t, err, testutil.ErrFake)

	_, err = r.GetByID(ctx, 1)
	assert.ErrorIs(t, err, testutil.ErrFake)

	_, err = r.Create(ctx, clients.CreateClientRequest{Name: "x"}, 1)
	assert.ErrorIs(t, err, testutil.ErrFake)

	_, err = r.Search(ctx, "x", 0.1, 5)
	assert.ErrorIs(t, err, testutil.ErrFake)

	_, err = r.ListContacts(ctx, 1)
	assert.ErrorIs(t, err, testutil.ErrFake)

	_, err = r.CreateContact(ctx, 1, clients.CreateContactRequest{Name: "n"}, 1)
	assert.ErrorIs(t, err, testutil.ErrFake)
}
