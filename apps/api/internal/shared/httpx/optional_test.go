package httpx

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOptionalText(t *testing.T) {
	text := "x"
	cases := []struct {
		name    string
		body    string
		want    OptionalText
		wantErr bool
	}{
		{"absent keeps", `{}`, OptionalText{}, false},
		{"null clears", `{"v":null}`, OptionalText{Set: true}, false},
		{"text sets", `{"v":"x"}`, OptionalText{Set: true, Value: &text}, false},
		{"wrong type", `{"v":1}`, OptionalText{Set: true}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var got struct {
				V OptionalText `json:"v"`
			}
			err := json.Unmarshal([]byte(tc.body), &got)
			if tc.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.want, got.V)
		})
	}
}
