package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

var (
	ErrInvalidCredentials = errors.New("invalid email or password")
	ErrInvalidToken       = errors.New("invalid token")
	// ErrSessionRevoked marks an orphaned token.
	// The token is structurally valid, but its account no longer backs it:
	// deactivated, or minted under an older session version.
	ErrSessionRevoked = errors.New("session revoked")
)

// dummyPasswordHash equalizes unknown-email cost.
// It is compared against when the email is unknown, so an unregistered
// address costs the same bcrypt work as a real one. Built at init with the
// same cost Repo.Create uses, so the two never drift apart.
var dummyPasswordHash = mustDummyHash()

func mustDummyHash() []byte {
	h, err := bcrypt.GenerateFromPassword([]byte("no-such-account"), bcrypt.DefaultCost)
	if err != nil {
		panic("auth: dummy bcrypt hash: " + err.Error())
	}
	return h
}

type Service struct {
	users         *users.Repo
	refresh       *RefreshRepo
	secret        []byte
	expiry        time.Duration
	refreshExpiry time.Duration
	issuer        string
	now           func() time.Time
	wait          func(context.Context, time.Duration)
	unknownMisses *missCounter
}

func NewService(repo *users.Repo, secret string, expiry time.Duration) *Service {
	return &Service{
		users:         repo,
		secret:        []byte(secret),
		expiry:        expiry,
		refreshExpiry: 0,
		issuer:        "internalgns-api",
		now:           time.Now,
		wait:          throttle,
		unknownMisses: newMissCounter(unknownMissLimit),
	}
}

// WithRefresh enables refresh-token rotation.
// Without it, Login still works but returns an empty RefreshToken
// (back-compat for callers that don't wire the table yet).
func (s *Service) WithRefresh(repo *RefreshRepo, expiry time.Duration) *Service {
	s.refresh = repo
	s.refreshExpiry = expiry
	return s
}

type Claims struct {
	Role users.Role `json:"role"`
	// SessionVersion is the mint-time version.
	// It is the account's users.session_version at mint time. A token without
	// it decodes to 0, which no account ever has.
	SessionVersion int64 `json:"sv"`
	jwt.RegisteredClaims
}

func (c Claims) UserID() (int64, error) {
	return parseInt64(c.Subject)
}

func parseInt64(s string) (int64, error) {
	var n int64
	for _, ch := range s {
		if ch < '0' || ch > '9' {
			return 0, ErrInvalidToken
		}
		n = n*10 + int64(ch-'0')
	}
	if s == "" {
		return 0, ErrInvalidToken
	}
	return n, nil
}

// loginBackoffFree attempts cost nothing.
// Ordinary typos are therefore not punished.
const loginBackoffFree = 4

// loginBackoff prices prior misses.
// It is the delay an attempt pays for the misses before it. A hard lock was
// worse than useless: it refused the correct password, so anyone who knew a
// superadmin address could lock that account out at will.
func loginBackoff(attempts int) time.Duration {
	const (
		base = 250 * time.Millisecond
		ceil = 4 * time.Second
	)
	if attempts <= loginBackoffFree {
		return 0
	}
	shift := attempts - loginBackoffFree - 1
	if shift > 8 {
		return ceil
	}
	if d := base << uint(shift); d < ceil {
		return d
	}
	return ceil
}

// throttle waits out the backoff.
// It returns early when the caller's deadline comes first.
func throttle(ctx context.Context, d time.Duration) {
	if d <= 0 {
		return
	}
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-timer.C:
	case <-ctx.Done():
	}
}

// normalizeEmail is the lookup form.
// Login reads and writes every tally under it and the login rate limit keys
// on it, so no spelling of one address reaches two counts.
func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func (s *Service) Login(ctx context.Context, email, password string) (Session, error) {
	email = normalizeEmail(email)
	u, err := s.users.GetByEmail(ctx, email)
	if errors.Is(err, users.ErrNotFound) {
		return Session{}, s.rejectUnknown(ctx, email, password)
	}
	if err != nil {
		// A database outage is not a credential verdict; let it surface.
		return Session{}, err
	}

	// Guessing is throttled, never refused: the delay is paid before the
	// password is checked, so parallel guesses pay it too, and a correct
	// password still gets through.
	lock, err := s.users.LockStatus(ctx, email)
	if errors.Is(err, users.ErrNotFound) {
		// Deactivated or removed between the two reads: now an unknown
		// address, and priced as one.
		return Session{}, s.rejectUnknown(ctx, email, password)
	}
	if err != nil {
		return Session{}, err
	}
	s.wait(ctx, loginBackoff(lock.FailedLoginAttempts))

	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)); err != nil {
		// Bookkeeping must never overturn the verdict nor raise a 500 that
		// only failing accounts see. Log and still reject.
		if rerr := s.users.RecordFailedLogin(ctx, email); rerr != nil {
			slog.ErrorContext(ctx, "record failed login", "error", rerr, "user_id", u.ID)
		}
		return Session{}, ErrInvalidCredentials
	}
	// Claim and issue in one transaction. The claim row-locks the account,
	// so a concurrent password change either lands first and fails the
	// claim, or waits and then revokes the session issued here.
	var resp Session
	err = s.users.InTx(ctx, func(q *users.Repo, tx db.Executor) error {
		version, err := q.ClaimLogin(ctx, u.ID, u.PasswordHash)
		if err != nil {
			return err
		}
		resp, err = s.issue(ctx, s.refresh.on(tx), u, version)
		return err
	})
	if errors.Is(err, users.ErrNotFound) {
		return Session{}, ErrInvalidCredentials
	}
	if err != nil {
		return Session{}, err
	}
	return resp, nil
}

// rejectUnknown prices a missing account.
// An unknown or deactivated address pays the backoff a registered one
// would after the same misses, then the same bcrypt work, then gets the
// same verdict, so neither the response nor its timing tells an attacker
// whether the address is a live account. The steps run in the order of
// the registered path: read the count, wait, compare, record.
func (s *Service) rejectUnknown(ctx context.Context, email, password string) error {
	s.wait(ctx, loginBackoff(s.unknownMisses.count(email)))
	_ = bcrypt.CompareHashAndPassword(dummyPasswordHash, []byte(password))
	s.unknownMisses.miss(email)
	return ErrInvalidCredentials
}

// issue mints a bound session.
// It signs an access token and, when refresh is wired, stores a refresh
// token through rr, both bound to the session version.
func (s *Service) issue(ctx context.Context, rr *RefreshRepo, u users.User, version int64) (Session, error) {
	now := s.now()
	expiresAt := now.Add(s.expiry)
	claims := Claims{
		Role:           u.Role,
		SessionVersion: version,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    s.issuer,
			Subject:   fmt.Sprintf("%d", u.ID),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(s.secret)
	if err != nil {
		return Session{}, fmt.Errorf("sign access token: %w", err)
	}

	resp := Session{LoginResponse: LoginResponse{
		Token:     signed,
		ExpiresAt: expiresAt.Unix(),
		User:      toMeUser(u),
	}}
	if rr == nil {
		return resp, nil
	}
	raw, hash, err := generateRefreshToken()
	if err != nil {
		return Session{}, fmt.Errorf("generate refresh token: %w", err)
	}
	refreshExpiresAt := now.Add(s.refreshExpiry)
	if err := rr.insert(ctx, u.ID, hash, refreshExpiresAt, version); err != nil {
		return Session{}, fmt.Errorf("store refresh token: %w", err)
	}
	resp.RefreshToken = raw
	resp.RefreshExpiresAt = refreshExpiresAt.Unix()
	return resp, nil
}

// Refresh redeems and rotates tokens.
// It re-issues the JWT plus a fresh refresh token. Reuse of an
// already-redeemed token ends every session of that user.
func (s *Service) Refresh(ctx context.Context, raw string) (Session, error) {
	if s.refresh == nil || raw == "" {
		return Session{}, ErrInvalidRefresh
	}
	hash := hashRefreshToken(raw)

	// One transaction with the owner's row share-locked first: a password
	// change or deactivation either commits before, leaving this token
	// revoked, or waits and then revokes the successor issued here.
	var (
		resp    Session
		verdict error
		blast   int64
	)
	err := s.users.InTx(ctx, func(q *users.Repo, tx db.Executor) error {
		rr := s.refresh.on(tx)
		if err := rr.lockOwner(ctx, hash); err != nil {
			return err
		}
		red, err := rr.redeem(ctx, hash)
		if errors.Is(err, pgx.ErrNoRows) {
			verdict, blast, err = s.refusal(ctx, rr, hash)
			return err
		}
		if err != nil {
			return fmt.Errorf("redeem refresh token: %w", err)
		}
		u, err := q.GetByID(ctx, red.userID)
		if errors.Is(err, users.ErrNotFound) {
			verdict = ErrInvalidRefresh
			return nil
		}
		if err != nil {
			return fmt.Errorf("read refresh owner: %w", err)
		}
		resp, err = s.issue(ctx, rr, u, red.version)
		return err
	})
	if err != nil {
		return Session{}, err
	}
	// The blast writes the users row, so it runs in its own transaction:
	// upgrading the share lock above would deadlock two concurrent replays.
	// The refusal wrote nothing, and the version bump refuses whatever was
	// minted in between.
	if blast != 0 {
		if err := s.endSessions(ctx, blast); err != nil {
			return Session{}, err
		}
	}
	if verdict != nil {
		return Session{}, verdict
	}
	return resp, nil
}

// endSessions runs the reuse blast.
func (s *Service) endSessions(ctx context.Context, userID int64) error {
	return s.users.InTx(ctx, func(_ *users.Repo, tx db.Executor) error {
		return s.refresh.on(tx).endSessions(ctx, userID)
	})
}

// refusal explains unredeemable tokens.
// blast is the user whose sessions a replay ends, or 0.
func (s *Service) refusal(ctx context.Context, rr *RefreshRepo, hash []byte) (verdict error, blast int64, err error) {
	st, err := rr.lookup(ctx, hash)
	if err != nil {
		return nil, 0, fmt.Errorf("look up refresh token: %w", err)
	}
	if !st.found {
		return ErrInvalidRefresh, 0, nil
	}
	// Only rotation hands out a successor, so only a rotated token coming
	// back is a replay. One ended on purpose is just a dead session.
	if st.revoked && !revokedByRotation(st.reason) {
		return ErrRevokedRefresh, 0, nil
	}
	if st.revoked {
		// A concurrent or retried redeem (a duplicate tab, a network retry)
		// revokes the token moments before the loser looks it up. Only a
		// token revoked longer ago than the grace window is treated as a
		// genuine replay worth revoking every session; a very recent
		// revocation is a benign race, so the other sessions survive and
		// the verdict says so, letting the handler keep the cookie.
		if !st.pastGrace {
			return ErrRacedRefresh, 0, nil
		}
		// A replay from an already ended session (a reuse blast, a password
		// change) has nothing left to end: every session since is a new
		// login, which a stolen token must not be able to end again.
		if st.stale {
			return ErrRevokedRefresh, 0, nil
		}
		return ErrReusedRefresh, st.userID, nil
	}
	// Minted before a session version bump: ended on purpose, not expired.
	if st.stale {
		return ErrRevokedRefresh, 0, nil
	}
	return ErrExpiredRefresh, 0, nil
}

// RevokeRefresh revokes one refresh token.
// Silent no-op when the token is already revoked, expired, or unknown:
// logout must succeed even on a stale tab.
func (s *Service) RevokeRefresh(ctx context.Context, raw string) error {
	if s.refresh == nil || raw == "" {
		return nil
	}
	return s.refresh.revokeToken(ctx, hashRefreshToken(raw))
}

// clockLeeway absorbs wall-clock steps.
// nbf and exp are checked against the verifying host's clock, which NTP or a
// VM host can step back after the mint; without slack a fresh token reads
// as not yet valid. A minute is negligible against the access token expiry.
const clockLeeway = time.Minute

func (s *Service) Verify(tokenStr string) (Claims, error) {
	parser := jwt.NewParser(
		jwt.WithValidMethods([]string{"HS256"}),
		jwt.WithIssuer(s.issuer),
		jwt.WithExpirationRequired(),
		jwt.WithLeeway(clockLeeway),
	)

	var claims Claims
	tok, err := parser.ParseWithClaims(tokenStr, &claims, func(t *jwt.Token) (any, error) {
		return s.secret, nil
	})
	if err != nil || !tok.Valid {
		return Claims{}, ErrInvalidToken
	}
	return claims, nil
}

// Identity is live account state.
// It is what backs an access token.
type Identity struct {
	UserID int64
	Role   users.Role
}

// Authenticate resolves a bearer token.
// It returns the caller's live identity.
func (s *Service) Authenticate(ctx context.Context, tokenStr string) (Identity, error) {
	claims, err := s.Verify(tokenStr)
	if err != nil {
		return Identity{}, err
	}
	id, err := claims.UserID()
	if err != nil {
		return Identity{}, err
	}
	live, err := s.users.AuthContext(ctx, id)
	if errors.Is(err, users.ErrNotFound) {
		return Identity{}, ErrSessionRevoked
	}
	if err != nil {
		return Identity{}, fmt.Errorf("authenticate: %w", err)
	}
	if !live.IsActive {
		return Identity{}, ErrSessionRevoked
	}
	// A version, not a timestamp: the API and Postgres clocks never meet, so
	// a wall-clock step cannot refuse a token minted after the bump.
	if claims.SessionVersion != live.SessionVersion {
		return Identity{}, ErrSessionRevoked
	}
	return Identity{UserID: id, Role: live.Role}, nil
}

func (s *Service) Me(ctx context.Context, id int64) (users.User, error) {
	return s.users.GetByID(ctx, id)
}
