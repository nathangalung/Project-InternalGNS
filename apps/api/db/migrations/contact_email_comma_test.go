package migrations_test

import (
	"context"
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/db/migrations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/validate"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const commaMigration = "00075_contact_email_trailing_comma.sql"

// upSQL reads the Up half.
func upSQL(t *testing.T, name string) string {
	t.Helper()
	raw, err := migrations.FS.ReadFile(name)
	require.NoError(t, err)
	up, _, found := strings.Cut(string(raw), "-- +goose Down")
	require.True(t, found, "%s has no Down section", name)
	return up
}

// contactRow is one seeded contact.
type contactRow struct {
	email  string
	active bool
	want   string
}

func seedContacts(ctx context.Context, t *testing.T, tx pgx.Tx, rows []contactRow) []int64 {
	t.Helper()
	var company int64
	require.NoError(t, tx.QueryRow(ctx,
		`INSERT INTO company_client (name, created_by, updated_by) VALUES ('Migrasi 00075', 1, 1) RETURNING id`,
	).Scan(&company))
	ids := make([]int64, len(rows))
	for i, r := range rows {
		require.NoError(t, tx.QueryRow(ctx,
			`INSERT INTO company_contacts (company_id, name, email, is_active, created_by, updated_by)
			 VALUES ($1, 'Kontak', $2, $3, 1, 1) RETURNING id`,
			company, r.email, r.active,
		).Scan(&ids[i]), "seed %q", r.email)
	}
	return ids
}

func storedEmails(ctx context.Context, t *testing.T, tx pgx.Tx, ids []int64) []string {
	t.Helper()
	out := make([]string, len(ids))
	for i, id := range ids {
		require.NoError(t, tx.QueryRow(ctx, `SELECT email FROM company_contacts WHERE id = $1`, id).Scan(&out[i]))
	}
	return out
}

// Trailing commas are stripped safely.
// Only a value that passes the server email rule once one trailing comma
// goes is changed; a second run changes nothing.
func TestMigration00075_StripsTrailingComma(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	rows := []contactRow{
		{"riza.chair@pelitaglobal.com,", true, "riza.chair@pelitaglobal.com"},
		{"budi@kantor.id , ", true, "budi@kantor.id"},
		{"lama@kantor.id,", false, "lama@kantor.id"},
		{"dua@kantor.id,,", true, "dua@kantor.id,,"},
		{"bukan-email,", true, "bukan-email,"},
		{" spasi@kantor.id,", true, " spasi@kantor.id,"},
		{"a,b@kantor.id", true, "a,b@kantor.id"},
		{"rapi@kantor.id", true, "rapi@kantor.id"},
		// An active twin already holds the address.
		{"kembar@kantor.id", true, "kembar@kantor.id"},
		{"KEMBAR@kantor.id,", true, "KEMBAR@kantor.id,"},
		// Two active rows would collapse onto one address.
		{"sama@kantor.id,", true, "sama@kantor.id,"},
		{"sama@kantor.id ,", true, "sama@kantor.id ,"},
	}
	ids := seedContacts(ctx, t, tx, rows)
	up := upSQL(t, commaMigration)

	_, err := tx.Exec(ctx, up)
	require.NoError(t, err)
	want := make([]string, len(rows))
	for i, r := range rows {
		want[i] = r.want
	}
	assert.Equal(t, want, storedEmails(ctx, t, tx, ids))

	tag, err := tx.Exec(ctx, up)
	require.NoError(t, err)
	assert.Zero(t, tag.RowsAffected(), "a second run must change nothing")
	assert.Equal(t, want, storedEmails(ctx, t, tx, ids))
}

// goFix strips one trailing comma.
var goFix = regexp.MustCompile(`\s*,\s*$`)

// The SQL rule matches Go.
// Every shared email case gets a trailing comma; the row changes exactly
// when validate.Email passes the value without it.
func TestMigration00075_FollowsSharedEmailRule(t *testing.T) {
	raw, err := os.ReadFile("../../internal/shared/validate/testdata/contact_rules.json")
	require.NoError(t, err)
	var table struct {
		Email []struct {
			Input string `json:"input"`
		} `json:"email"`
	}
	require.NoError(t, json.Unmarshal(raw, &table))
	require.NotEmpty(t, table.Email)

	ctx, tx := testutil.BeginTx(t)
	rows := make([]contactRow, len(table.Email))
	for i, c := range table.Email {
		seeded := c.Input + ","
		fixed := goFix.ReplaceAllString(seeded, "")
		want := seeded
		if validate.Email(fixed) == "" {
			want = fixed
		}
		// Inactive rows sit outside the unique index.
		rows[i] = contactRow{seeded, false, want}
	}
	ids := seedContacts(ctx, t, tx, rows)

	_, err = tx.Exec(ctx, upSQL(t, commaMigration))
	require.NoError(t, err)
	got := storedEmails(ctx, t, tx, ids)
	changed := 0
	for i, r := range rows {
		assert.Equalf(t, r.want, got[i], "seeded %q", r.email)
		if r.want != r.email {
			changed++
		}
	}
	assert.Positive(t, changed, "no case exercises the change path")
}
