package httpx

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseIfMatch(t *testing.T) {
	t.Run("missing yields nil", func(t *testing.T) {
		v, err := ParseIfMatch("")
		require.NoError(t, err)
		assert.Nil(t, v)
	})
	t.Run("plain integer", func(t *testing.T) {
		v, err := ParseIfMatch("5")
		require.NoError(t, err)
		require.NotNil(t, v)
		assert.Equal(t, int32(5), *v)
	})
	t.Run("RFC 7232 quoted", func(t *testing.T) {
		v, err := ParseIfMatch(`"7"`)
		require.NoError(t, err)
		require.NotNil(t, v)
		assert.Equal(t, int32(7), *v)
	})
	t.Run("unparseable rejected", func(t *testing.T) {
		_, err := ParseIfMatch("abc")
		assert.Error(t, err)
	})
}
