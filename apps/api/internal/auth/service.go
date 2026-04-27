package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

var (
	ErrInvalidCredentials = errors.New("invalid email or password")
	ErrInvalidToken       = errors.New("invalid token")
)

type Service struct {
	users  *users.Repo
	secret []byte
	expiry time.Duration
	issuer string
}

func NewService(repo *users.Repo, secret string, expiry time.Duration) *Service {
	return &Service{
		users:  repo,
		secret: []byte(secret),
		expiry: expiry,
		issuer: "internalgns-api",
	}
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

func (s *Service) Login(ctx context.Context, email, password string) (LoginResponse, error) {
	u, err := s.users.GetByEmail(ctx, email)
	if errors.Is(err, users.ErrNotFound) {
		return LoginResponse{}, ErrInvalidCredentials
	}
	if err != nil {
		return LoginResponse{}, err
	}

	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)); err != nil {
		return LoginResponse{}, ErrInvalidCredentials
	}

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
		return LoginResponse{}, err
	}

	return LoginResponse{
		Token:     signed,
		ExpiresAt: expiresAt.Unix(),
		User:      toMeUser(u),
	}, nil
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

func (s *Service) Me(ctx context.Context, id int64) (users.User, error) {
	return s.users.GetByID(ctx, id)
}
