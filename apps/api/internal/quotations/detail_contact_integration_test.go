package quotations_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Detail carries the chosen contact.
// The email and phone are the picked contact's own, read by id even after it
// is deactivated, never the client's first contact; none without a contact.
func TestRepo_GetDetail_ContactChannels(t *testing.T) {
	ctx, repo, tx := newRepo(t)
	var first, picked int64
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO company_contacts (company_id, name, email, phone, created_by, updated_by)
		VALUES ($1, 'A Pertama', 'pertama@uji.local', '81200000001', $2, $2) RETURNING id`,
		seedCompanyID, seedUserID).Scan(&first))
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO company_contacts (company_id, name, email, phone, created_by, updated_by)
		VALUES ($1, 'Z Dipilih', 'dipilih@uji.local', '81200000002', $2, $2) RETURNING id`,
		seedCompanyID, seedUserID).Scan(&picked))

	req := sampleCreate()
	req.ContactID = &picked
	id, err := repo.Create(ctx, req, seedUserID)
	require.NoError(t, err)

	d, err := repo.GetDetail(ctx, id)
	require.NoError(t, err)
	require.NotNil(t, d.ContactEmail)
	require.NotNil(t, d.ContactPhone)
	assert.Equal(t, "dipilih@uji.local", *d.ContactEmail)
	assert.Equal(t, "81200000002", *d.ContactPhone)

	_, err = tx.Exec(ctx, `UPDATE company_contacts SET is_active = FALSE WHERE id = $1`, picked)
	require.NoError(t, err)
	d, err = repo.GetDetail(ctx, id)
	require.NoError(t, err)
	require.NotNil(t, d.ContactEmail, "a deactivated contact keeps its channels")
	assert.Equal(t, "dipilih@uji.local", *d.ContactEmail)

	req.ContactID = nil
	bare, err := repo.Create(ctx, req, seedUserID)
	require.NoError(t, err)
	d, err = repo.GetDetail(ctx, bare)
	require.NoError(t, err)
	assert.Nil(t, d.ContactEmail)
	assert.Nil(t, d.ContactPhone)
}
