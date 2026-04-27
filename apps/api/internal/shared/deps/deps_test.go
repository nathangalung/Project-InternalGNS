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
