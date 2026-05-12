package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nathangalung/internalgns/apps/api/db/queries"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
)

var (
	ErrInvalidRefresh = errors.New("invalid refresh token")
	ErrExpiredRefresh = errors.New("refresh token expired")
	ErrReusedRefresh  = errors.New("refresh token reused")
)

// 32 bytes of CSPRNG output, base64url-encoded (43 chars, no padding).
const refreshTokenBytes = 32

type RefreshRepo struct {
	db    db.Executor
	store queries.Store
}

func NewRefreshRepo(exec db.Executor, store queries.Store) *RefreshRepo {
	return &RefreshRepo{db: exec, store: store}
}

// generateRefreshToken returns (raw, hash). The raw token is what the client
// receives; only the hash is persisted.
func generateRefreshToken() (string, []byte, error) {
	buf := make([]byte, refreshTokenBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", nil, err
	}
	raw := base64.RawURLEncoding.EncodeToString(buf)
	sum := sha256.Sum256([]byte(raw))
	return raw, sum[:], nil
}

func hashRefreshToken(raw string) []byte {
	sum := sha256.Sum256([]byte(raw))
	return sum[:]
}

func (r *RefreshRepo) insert(ctx context.Context, userID int64, hash []byte, expiresAt time.Time) error {
	_, err := r.db.Exec(ctx, r.store.Get("auth.refresh_insert"), userID, hash, expiresAt)
	return err
}

// redeem atomically marks an active token revoked and returns its (id, user_id).
// pgx.ErrNoRows means the token is not active right now — caller must
// disambiguate via lookup.
func (r *RefreshRepo) redeem(ctx context.Context, hash []byte) (int64, int64, error) {
	row := r.db.QueryRow(ctx, r.store.Get("auth.refresh_redeem"), hash)
	var id, userID int64
	if err := row.Scan(&id, &userID); err != nil {
		return 0, 0, err
	}
	return id, userID, nil
}

// lookupState reports the state of a token whose redeem failed.
type lookupState struct {
	userID    int64
	expiresAt time.Time
	revoked   bool
	found     bool
}

func (r *RefreshRepo) lookup(ctx context.Context, hash []byte) (lookupState, error) {
	row := r.db.QueryRow(ctx, r.store.Get("auth.refresh_lookup"), hash)
	var (
		st        lookupState
		revokedAt *time.Time
	)
	if err := row.Scan(&st.userID, &st.expiresAt, &revokedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return lookupState{}, nil
		}
		return lookupState{}, err
	}
	st.found = true
	st.revoked = revokedAt != nil
	return st, nil
}

func (r *RefreshRepo) revokeToken(ctx context.Context, hash []byte) error {
	_, err := r.db.Exec(ctx, r.store.Get("auth.refresh_revoke_token"), hash)
	return err
}

func (r *RefreshRepo) revokeAllForUser(ctx context.Context, userID int64) error {
	_, err := r.db.Exec(ctx, r.store.Get("auth.refresh_revoke_user"), userID)
	return err
}
