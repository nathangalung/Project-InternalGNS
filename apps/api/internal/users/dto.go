package users

import "time"

type Role string

const (
	RoleSuperadmin  Role = "superadmin"
	RoleOperational Role = "operational"
	RoleFinance     Role = "finance"
)

type User struct {
	ID           int64     `db:"id"            json:"id"`
	Email        string    `db:"email"         json:"email"`
	Name         string    `db:"name"          json:"name"`
	PasswordHash string    `db:"password_hash" json:"-"`
	Role         Role      `db:"role"          json:"role"`
	IsActive     bool      `db:"is_active"     json:"isActive"`
	CreatedAt    time.Time `db:"created_at"    json:"createdAt"`
	UpdatedAt    time.Time `db:"updated_at"    json:"updatedAt"`
}

type CreateUserRequest struct {
	Email    string `json:"email"`
	Name     string `json:"name"`
	Password string `json:"password"`
	Role     Role   `json:"role"`
	IsActive *bool  `json:"isActive,omitempty"`
}

type UpdateUserRequest struct {
	Email    string `json:"email"`
	Name     string `json:"name"`
	Role     Role   `json:"role"`
	IsActive bool   `json:"isActive"`
}

type ChangePasswordRequest struct {
	Password string `json:"password"`
}

type ListFilter struct {
	Q        string
	Role     *string
	IsActive *bool
	SortBy   string
	SortDir  string
	Limit    int
	Offset   int
}

type ListResult struct {
	Rows  []User
	Total int64
}
