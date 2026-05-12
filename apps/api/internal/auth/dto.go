package auth

import "github.com/nathangalung/internalgns/apps/api/internal/users"

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type LoginResponse struct {
	Token            string `json:"token"`
	ExpiresAt        int64  `json:"expiresAt"`
	RefreshToken     string `json:"refreshToken"`
	RefreshExpiresAt int64  `json:"refreshExpiresAt"`
	User             MeUser `json:"user"`
}

type RefreshRequest struct {
	RefreshToken string `json:"refreshToken"`
}

type LogoutRequest struct {
	RefreshToken string `json:"refreshToken"`
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
