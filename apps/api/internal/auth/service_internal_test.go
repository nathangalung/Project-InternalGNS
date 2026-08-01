package auth

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"
)

// The unknown-email path must do real bcrypt work at the same cost as a
// stored hash, otherwise timing still separates registered addresses.
func TestDummyPasswordHash_MatchesDefaultCost(t *testing.T) {
	require.NotEmpty(t, dummyPasswordHash)

	cost, err := bcrypt.Cost(dummyPasswordHash)
	require.NoError(t, err)
	assert.Equal(t, bcrypt.DefaultCost, cost)

	assert.Error(t, bcrypt.CompareHashAndPassword(dummyPasswordHash, []byte("any-guess")))
}
