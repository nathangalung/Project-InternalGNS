package deps

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestUserIDRoundTrip(t *testing.T) {
	ctx := WithUserID(context.Background(), 42)
	assert.Equal(t, int64(42), CurrentUserID(ctx))
}

func TestCurrentUserID_Empty(t *testing.T) {
	assert.Equal(t, int64(0), CurrentUserID(context.Background()))
}

func TestCurrentUserID_WrongType(t *testing.T) {
	type otherKey int
	ctx := context.WithValue(context.Background(), otherKey(0), int64(99))
	assert.Equal(t, int64(0), CurrentUserID(ctx))
}

// Role travels with request.
// Every role gate reads it, so a missing or foreign value must read as no
// role, which no gate allows.
func TestUserRole(t *testing.T) {
	type otherKey int
	cases := []struct {
		name string
		ctx  context.Context
		want string
	}{
		{"stored", WithUserRole(context.Background(), "finance"), "finance"},
		{"absent", context.Background(), ""},
		{"foreign key", context.WithValue(context.Background(), otherKey(0), "superadmin"), ""},
		{"independent of the id", WithUserID(context.Background(), 7), ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			assert.Equal(t, c.want, CurrentUserRole(c.ctx))
		})
	}
	both := WithUserRole(WithUserID(context.Background(), 7), "operational")
	assert.Equal(t, int64(7), CurrentUserID(both))
	assert.Equal(t, "operational", CurrentUserRole(both))
}
