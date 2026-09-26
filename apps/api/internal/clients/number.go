package clients

import (
	"errors"
	"net/http"
	"regexp"
	"strings"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
)

// Client number problem texts.
const (
	msgNumberInvalid = "Nomor klien harus 4 digit dan belum dipakai."
	msgNumberLocked  = "Nomor klien tidak dapat diubah karena sudah dipakai pada penawaran."
)

// Mirrors company_client_number_format_check.
var numberFormat = regexp.MustCompile(`^[0-9]{4}$`)

// normalizeNumber trims; blank becomes nil.
// ok is false when a sent number is malformed.
func normalizeNumber(p *string) (out *string, ok bool) {
	if p == nil {
		return nil, true
	}
	v := strings.TrimSpace(*p)
	if v == "" {
		return nil, true
	}
	return &v, numberFormat.MatchString(v)
}

// numberProblem renders a number sentinel.
func numberProblem(w http.ResponseWriter, err error) bool {
	switch {
	case errors.Is(err, ErrNumberInvalid):
		httperr.Render(w, httperr.Unprocessable(map[string]string{"number": msgNumberInvalid}))
	case errors.Is(err, ErrNumberLocked):
		httperr.Render(w, httperr.Unprocessable(map[string]string{"number": msgNumberLocked}))
	default:
		return false
	}
	return true
}
