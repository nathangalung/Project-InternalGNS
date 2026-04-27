package users_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

func TestRepo_ErrorPaths(t *testing.T) {
	store := testutil.Store(t)
	r := users.NewRepo(testutil.FakeExec{}, store)
	ctx := context.Background()

	_, err := r.GetByEmail(ctx, "x")
	assert.ErrorIs(t, err, testutil.ErrFake)

	_, err = r.GetByID(ctx, 1)
	assert.ErrorIs(t, err, testutil.ErrFake)

	_, err = r.Create(ctx, users.CreateUserRequest{
		Email: "x@x", Name: "x", Password: "p", Role: users.RoleOperational,
	}, 1)
	assert.ErrorIs(t, err, testutil.ErrFake)

	err = r.UpdatePassword(ctx, 1, "newpass", 1)
	assert.ErrorIs(t, err, testutil.ErrFake)
}

// bcrypt rejects >72 bytes.
func longPass() string {
	out := make([]byte, 80)
	for i := range out {
		out[i] = 'a'
	}
	return string(out)
}

func TestRepo_Create_BcryptFailsOnLongPassword(t *testing.T) {
	store := testutil.Store(t)
	r := users.NewRepo(testutil.FakeExec{}, store)
	_, err := r.Create(context.Background(), users.CreateUserRequest{
		Email: "x@x", Name: "x", Password: longPass(), Role: users.RoleOperational,
	}, 1)
	assert.Error(t, err)
}

func TestRepo_UpdatePassword_BcryptFailsOnLongPassword(t *testing.T) {
	store := testutil.Store(t)
	r := users.NewRepo(testutil.FakeExec{}, store)
	err := r.UpdatePassword(context.Background(), 1, longPass(), 1)
	assert.Error(t, err)
}
