package validate_test

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/validate"
)

// impaCase is one shared row.
type impaCase struct {
	Input string `json:"input"`
	Code  string `json:"code"`
	Valid bool   `json:"valid"`
	Note  string `json:"note"`
}

type impaTable struct {
	Message string     `json:"message"`
	Cases   []impaCase `json:"cases"`
}

// loadIMPA reads the shared table.
func loadIMPA(t *testing.T) impaTable {
	t.Helper()
	raw, err := os.ReadFile("testdata/impa_rules.json")
	require.NoError(t, err)
	var tb impaTable
	require.NoError(t, json.Unmarshal(raw, &tb))
	require.NotEmpty(t, tb.Cases)
	return tb
}

// IMPA follows the shared table.
func TestIMPA_Table(t *testing.T) {
	tb := loadIMPA(t)
	assert.Equal(t, tb.Message, validate.IMPAMessage)
	for _, c := range tb.Cases {
		t.Run(c.Input, func(t *testing.T) {
			code, msg := validate.IMPA(c.Input)
			assert.Equal(t, c.Code, code, c.Note)
			if c.Valid {
				assert.Empty(t, msg, c.Note)
			} else {
				assert.Equal(t, validate.IMPAMessage, msg, c.Note)
			}
		})
	}
}

// IMPAInText finds one marked code.
// Only a code marked IMPA counts: bare digits may be a model number.
func TestIMPAInText(t *testing.T) {
	cases := []struct{ name, in, want string }{
		{"trailing", "SARUNG TANGAN KATUN IMPA 191234", "191234"},
		{"glued", "IMPA191234 BALOK KAYU", "191234"},
		{"bracketed", "Kunci Ring (IMPA 611234)", "611234"},
		{"before a full stop", "Palu IMPA 611234. Siap", "611234"},
		{"line break before", "TALI\nIMPA 211234", "211234"},
		{"bare digits", "EMBER 591234 GUDANG", ""},
		{"impact", "IMPACT WRENCH 191234", ""},
		{"two codes", "IMPA 191234 ATAU IMPA 191235", ""},
		{"same code twice", "IMPA 191234 (IMPA 191234)", "191234"},
		{"seven digits", "IMPA 1912345", ""},
		{"in a model number", "IMPA 191234-B", ""},
		{"empty", "", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			assert.Equal(t, c.want, validate.IMPAInText(c.in))
		})
	}
}

// OptionalIMPA normalises in place.
// A valid code is rewritten to its six digits and no code to nil; a bad one
// keeps the input and reports the message.
func TestOptionalIMPA(t *testing.T) {
	str := func(s string) *string { return &s }
	cases := []struct {
		name    string
		in      *string
		want    *string
		wantMsg string
	}{
		{"absent", nil, nil, ""},
		{"blank", str(" "), nil, ""},
		{"placeholder", str("-"), nil, ""},
		{"marked", str("IMPA 190105"), str("190105"), ""},
		{"bad", str("1901"), str("1901"), validate.IMPAMessage},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := c.in
			msg := validate.OptionalIMPA(&p)
			assert.Equal(t, c.wantMsg, msg)
			assert.Equal(t, c.want, p)
		})
	}
}
