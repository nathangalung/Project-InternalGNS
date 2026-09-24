package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nathangalung/internalgns/apps/api/db/queries"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
)

var (
	ErrInvalidRefresh = errors.New("invalid refresh token")
	ErrExpiredRefresh = errors.New("refresh token expired")
	ErrReusedRefresh  = errors.New("refresh token reused")
	// ErrRevokedRefresh is a token ended on purpose (logout, admin change,
	// an earlier reuse blast). Replaying it is not evidence of theft.
	ErrRevokedRefresh = errors.New("refresh token revoked")
)

// 32 bytes of CSPRNG output, base64url-encoded (43 chars, no padding).
const refreshTokenBytes = 32

// Window in which a redeemed-then-reused token is treated as a benign race
// (concurrent tabs, retried request) rather than a replay attack.
const refreshReuseGrace = 10 * time.Second

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

// insert stores a bound token.
func (r *RefreshRepo) insert(ctx context.Context, userID int64, hash []byte, expiresAt time.Time, version int64) error {
	_, err := r.db.Exec(ctx, r.store.Get("auth.refresh_insert"), userID, hash, expiresAt, version)
	return err
}

// redeemed is a rotated token.
type redeemed struct {
	userID  int64
	version int64
}

// redeem atomically marks an active token revoked and returns it with its
// owner's session version. pgx.ErrNoRows means the token is not redeemable
// right now — caller must disambiguate via lookup.
func (r *RefreshRepo) redeem(ctx context.Context, hash []byte) (redeemed, error) {
	var out redeemed
	err := r.db.QueryRow(ctx, r.store.Get("auth.refresh_redeem"), hash).
		Scan(&out.userID, &out.version)
	return out, err
}

// lookupState reports the state of a token whose redeem failed.
type lookupState struct {
	userID    int64
	revoked   bool
	revokedAt time.Time
	reason    string
	// stale marks a token minted before a session version bump.
	stale bool
	found bool
}

func (r *RefreshRepo) lookup(ctx context.Context, hash []byte) (lookupState, error) {
	row := r.db.QueryRow(ctx, r.store.Get("auth.refresh_lookup"), hash)
	var (
		st        lookupState
		revokedAt *time.Time
		reason    *string
	)
	if err := row.Scan(&st.userID, &revokedAt, &reason, &st.stale); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return lookupState{}, nil
		}
		return lookupState{}, err
	}
	st.found = true
	st.revoked = revokedAt != nil
	if revokedAt != nil {
		st.revokedAt = *revokedAt
	}
	if reason != nil {
		st.reason = *reason
	}
	return st, nil
}

// on binds the repo to a caller's transaction; nil stays nil, so an
// unwired refresh store keeps issuing access tokens only.
func (r *RefreshRepo) on(exec db.Executor) *RefreshRepo {
	if r == nil {
		return nil
	}
	return &RefreshRepo{db: exec, store: r.store}
}

// lockOwner share-locks the token owner's users row. An unknown token
// locks nothing; the redeem that follows reports it.
func (r *RefreshRepo) lockOwner(ctx context.Context, hash []byte) error {
	if _, err := r.db.Exec(ctx, r.store.Get("auth.refresh_lock_owner"), hash); err != nil {
		return fmt.Errorf("lock refresh owner: %w", err)
	}
	return nil
}

// revokedByRotation reports a token retired by a successful refresh. A NULL
// reason predates the column and is read as rotation, the cautious side.
func revokedByRotation(reason string) bool {
	return reason == "" || reason == "rotated"
}

func (r *RefreshRepo) revokeToken(ctx context.Context, hash []byte) error {
	_, err := r.db.Exec(ctx, r.store.Get("auth.refresh_revoke_token"), hash)
	return err
}

func (r *RefreshRepo) revokeAllForUser(ctx context.Context, userID int64) error {
	_, err := r.db.Exec(ctx, r.store.Get("auth.refresh_revoke_user"), userID, "reuse")
	if err != nil {
		return fmt.Errorf("revoke all refresh tokens: %w", err)
	}
	return nil
}

// PurgeExpired drops tokens past the retention window, returning rows deleted.
// Called by the background sweep in internal/app; without it revoked and
// expired rows accumulate forever.
func (r *RefreshRepo) PurgeExpired(ctx context.Context) (int64, error) {
	tag, err := r.db.Exec(ctx, r.store.Get("auth.refresh_purge_expired"))
	if err != nil {
		return 0, fmt.Errorf("purge expired refresh tokens: %w", err)
	}
	return tag.RowsAffected(), nil
}
