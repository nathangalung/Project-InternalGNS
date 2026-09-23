package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
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
	// ErrSessionRevoked marks a structurally valid token whose account no
	// longer backs it: deactivated, or issued before a password reset.
	ErrSessionRevoked = errors.New("session revoked")
)

// Millisecond iat. The session epoch a password change sets is sub-second,
// so a second-granular iat refused the very login the change forces when
// both fell in the same second. golang-jwt reads this one package-level
// setting on both signing and parsing, and only this package uses it.
func init() {
	jwt.TimePrecision = time.Millisecond
}

// Compared against when the email is unknown so an unregistered address costs
// the same bcrypt work as a real one. Built at init with the same cost
// Repo.Create uses, so the two never drift apart.
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
}

func NewService(repo *users.Repo, secret string, expiry time.Duration) *Service {
	return &Service{
		users:         repo,
		secret:        []byte(secret),
		expiry:        expiry,
		refreshExpiry: 0,
		issuer:        "internalgns-api",
	}
}

// WithRefresh enables refresh-token issuance + rotation. Without it, Login
// still works but returns an empty RefreshToken (back-compat for callers
// that don't wire the table yet).
func (s *Service) WithRefresh(repo *RefreshRepo, expiry time.Duration) *Service {
	s.refresh = repo
	s.refreshExpiry = expiry
	return s
}

type Claims struct {
	Role users.Role `json:"role"`
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

// Attempts below this cost nothing, so ordinary typos are not punished.
const loginBackoffFree = 4

// loginBackoff is the delay an attempt pays for the misses before it. A hard
// lock was worse than useless: it refused the correct password, so anyone who
// knew a superadmin address could lock that account out at will.
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

// throttle waits out the backoff or the caller's deadline, whichever first.
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

func (s *Service) Login(ctx context.Context, email, password string) (LoginResponse, error) {
	u, err := s.users.GetByEmail(ctx, email)
	if errors.Is(err, users.ErrNotFound) {
		// Burn the same bcrypt work a real account would, then give the same
		// verdict, so neither the response nor its timing tells an attacker
		// whether the address is registered.
		_ = bcrypt.CompareHashAndPassword(dummyPasswordHash, []byte(password))
		return LoginResponse{}, ErrInvalidCredentials
	}
	if err != nil {
		// A database outage is not a credential verdict; let it surface.
		return LoginResponse{}, err
	}

	// Guessing is throttled, never refused: the delay is paid before the
	// password is checked, so parallel guesses pay it too, and a correct
	// password still gets through.
	lock, err := s.users.LockStatus(ctx, email)
	if errors.Is(err, users.ErrNotFound) {
		// Deactivated or removed between the two reads: same verdict.
		return LoginResponse{}, ErrInvalidCredentials
	}
	if err != nil {
		return LoginResponse{}, err
	}
	throttle(ctx, loginBackoff(lock.FailedLoginAttempts))

	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)); err != nil {
		// Bookkeeping must never overturn the verdict nor raise a 500 that
		// only failing accounts see. Log and still reject.
		if rerr := s.users.RecordFailedLogin(ctx, email); rerr != nil {
			slog.ErrorContext(ctx, "record failed login", "error", rerr, "user_id", u.ID)
		}
		return LoginResponse{}, ErrInvalidCredentials
	}
	// Claim and issue in one transaction. The claim row-locks the account,
	// so a concurrent password change either lands first and fails the
	// claim, or waits and then revokes the session issued here.
	var resp LoginResponse
	err = s.users.InTx(ctx, func(q *users.Repo, tx db.Executor) error {
		if err := q.ClaimLogin(ctx, u.ID, u.PasswordHash); err != nil {
			return err
		}
		var err error
		resp, err = s.issue(ctx, s.refresh.on(tx), u)
		return err
	})
	if errors.Is(err, users.ErrNotFound) {
		return LoginResponse{}, ErrInvalidCredentials
	}
	if err != nil {
		return LoginResponse{}, err
	}
	return resp, nil
}

// issue signs an access token and, when refresh is wired, stores a
// refresh token through rr.
func (s *Service) issue(ctx context.Context, rr *RefreshRepo, u users.User) (LoginResponse, error) {
	now := time.Now()
	expiresAt := now.Add(s.expiry)
	claims := Claims{
		Role: u.Role,
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
		return LoginResponse{}, fmt.Errorf("sign access token: %w", err)
	}

	resp := LoginResponse{
		Token:     signed,
		ExpiresAt: expiresAt.Unix(),
		User:      toMeUser(u),
	}
	if rr == nil {
		return resp, nil
	}
	raw, hash, err := generateRefreshToken()
	if err != nil {
		return LoginResponse{}, fmt.Errorf("generate refresh token: %w", err)
	}
	refreshExpiresAt := now.Add(s.refreshExpiry)
	if err := rr.insert(ctx, u.ID, hash, refreshExpiresAt); err != nil {
		return LoginResponse{}, fmt.Errorf("store refresh token: %w", err)
	}
	resp.RefreshToken = raw
	resp.RefreshExpiresAt = refreshExpiresAt.Unix()
	return resp, nil
}

// Refresh redeems an opaque refresh token, rotating it and re-issuing the
// JWT + a fresh refresh token. Reuse of an already-redeemed token triggers
// revocation of every active refresh token for that user.
func (s *Service) Refresh(ctx context.Context, raw string) (LoginResponse, error) {
	if s.refresh == nil || raw == "" {
		return LoginResponse{}, ErrInvalidRefresh
	}
	hash := hashRefreshToken(raw)

	// One transaction with the owner's row share-locked first: a password
	// change or deactivation either commits before, leaving this token
	// revoked, or waits and then revokes the successor issued here. The
	// verdict is returned after commit so a reuse blast still lands.
	var (
		resp    LoginResponse
		verdict error
	)
	err := s.users.InTx(ctx, func(q *users.Repo, tx db.Executor) error {
		rr := s.refresh.on(tx)
		if err := rr.lockOwner(ctx, hash); err != nil {
			return err
		}
		_, userID, err := rr.redeem(ctx, hash)
		if errors.Is(err, pgx.ErrNoRows) {
			verdict, err = s.refusal(ctx, rr, hash)
			return err
		}
		if err != nil {
			return fmt.Errorf("redeem refresh token: %w", err)
		}
		u, err := q.GetByID(ctx, userID)
		if errors.Is(err, users.ErrNotFound) {
			verdict = ErrInvalidRefresh
			return nil
		}
		if err != nil {
			return fmt.Errorf("read refresh owner: %w", err)
		}
		resp, err = s.issue(ctx, rr, u)
		return err
	})
	if err != nil {
		return LoginResponse{}, err
	}
	if verdict != nil {
		return LoginResponse{}, verdict
	}
	return resp, nil
}

// refusal explains a token that could not be redeemed.
func (s *Service) refusal(ctx context.Context, rr *RefreshRepo, hash []byte) (error, error) {
	st, err := rr.lookup(ctx, hash)
	if err != nil {
		return nil, fmt.Errorf("look up refresh token: %w", err)
	}
	if !st.found {
		return ErrInvalidRefresh, nil
	}
	// Only rotation hands out a successor, so only a rotated token coming
	// back is a replay. One ended on purpose is just a dead session.
	if st.revoked && !revokedByRotation(st.reason) {
		return ErrRevokedRefresh, nil
	}
	if st.revoked {
		// A concurrent or retried redeem (a duplicate tab, a network retry)
		// revokes the token moments before the loser looks it up. Only a
		// token revoked longer ago than the grace window is treated as a
		// genuine replay worth revoking every session; a very recent
		// revocation is a benign race, so the other sessions survive.
		if time.Since(st.revokedAt) > refreshReuseGrace {
			if err := rr.revokeAllForUser(ctx, st.userID); err != nil {
				return nil, err
			}
		}
		return ErrReusedRefresh, nil
	}
	return ErrExpiredRefresh, nil
}

// RevokeRefresh marks a specific refresh token revoked. Silent no-op when
// the token is already revoked, expired, or unknown — logout must succeed
// even on a stale tab.
func (s *Service) RevokeRefresh(ctx context.Context, raw string) error {
	if s.refresh == nil || raw == "" {
		return nil
	}
	return s.refresh.revokeToken(ctx, hashRefreshToken(raw))
}

func (s *Service) Verify(tokenStr string) (Claims, error) {
	parser := jwt.NewParser(
		jwt.WithValidMethods([]string{"HS256"}),
		jwt.WithIssuer(s.issuer),
		jwt.WithExpirationRequired(),
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

// Identity is the live account state behind an access token.
type Identity struct {
	UserID int64
	Role   users.Role
}

// Authenticate resolves a bearer token to the caller's live identity.
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
	// iat carries milliseconds (see init), so only a token minted before the
	// change is refused, not one minted moments after it.
	if claims.IssuedAt == nil || claims.IssuedAt.Before(live.SessionsValidFrom) {
		return Identity{}, ErrSessionRevoked
	}
	return Identity{UserID: id, Role: live.Role}, nil
}

func (s *Service) Me(ctx context.Context, id int64) (users.User, error) {
	return s.users.GetByID(ctx, id)
}
