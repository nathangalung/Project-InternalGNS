package validate_test

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/validate"
)

type ruleCase struct {
	Input string `json:"input"`
	Valid bool   `json:"valid"`
	Note  string `json:"note"`
}

type ruleTable struct {
	Messages map[string]string `json:"messages"`
	Phone    []ruleCase        `json:"phone"`
	Email    []ruleCase        `json:"email"`
}

// loadRules reads the shared table.
// The web suite runs the same file against lib/validation.ts.
func loadRules(t *testing.T) ruleTable {
	t.Helper()
	raw, err := os.ReadFile("testdata/contact_rules.json")
	require.NoError(t, err)
	var rt ruleTable
	require.NoError(t, json.Unmarshal(raw, &rt))
	require.NotEmpty(t, rt.Phone)
	require.NotEmpty(t, rt.Email)
	return rt
}

// Messages match the shared table.
func TestMessages_MatchTable(t *testing.T) {
	rt := loadRules(t)
	assert.Equal(t, rt.Messages["phone"], validate.PhoneMessage)
	assert.Equal(t, rt.Messages["email"], validate.EmailMessage)
}

// Phone follows the shared table.
func TestPhone_Table(t *testing.T) {
	for _, c := range loadRules(t).Phone {
		t.Run(c.Input, func(t *testing.T) {
			want := ""
			if !c.Valid {
				want = validate.PhoneMessage
			}
			assert.Equal(t, want, validate.Phone(c.Input), c.Note)
		})
	}
}

// Email follows the shared table.
func TestEmail_Table(t *testing.T) {
	for _, c := range loadRules(t).Email {
		t.Run(c.Input, func(t *testing.T) {
			want := ""
			if !c.Valid {
				want = validate.EmailMessage
			}
			assert.Equal(t, want, validate.Email(c.Input), c.Note)
		})
	}
}
