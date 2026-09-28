package auth

import "github.com/nathangalung/internalgns/apps/api/internal/users"

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// LoginResponse is the session body.
// It never carries the refresh token, which travels only in the cookie.
type LoginResponse struct {
	Token     string `json:"token"`
	ExpiresAt int64  `json:"expiresAt"`
	User      MeUser `json:"user"`
}

// Session is a minted session.
// The body goes to the client; the refresh token only ever travels in the
// HttpOnly cookie the handler sets from it.
type Session struct {
	LoginResponse
	RefreshToken     string
	RefreshExpiresAt int64
}

type MeUser struct {
	ID    int64      `json:"id"`
	Email string     `json:"email"`
	Name  string     `json:"name"`
	Role  users.Role `json:"role"`
}

func toMeUser(u users.User) MeUser {
	return MeUser{ID: u.ID, Email: u.Email, Name: u.Name, Role: u.Role}
}

type ChangeOwnPasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}
