package cashentries

import (
	"math"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/validate"
)

// Field limits, as the columns hold.
const (
	maxCategory    = 60
	maxDescription = 500
	// NUMERIC(18,2) holds below this
	maxAmount = 1e16
)

// normalize trims the text fields.
func normalize(in *EntryInput) {
	in.EntryDate = strings.TrimSpace(in.EntryDate)
	in.Category = strings.TrimSpace(in.Category)
	in.Amount = strings.TrimSpace(in.Amount)
	in.Description = strings.TrimSpace(in.Description)
}

// fieldErrors checks an input.
// It returns nil when the input passes.
func fieldErrors(in EntryInput) map[string]string {
	f := validate.Fields{}
	if _, err := time.Parse(time.DateOnly, in.EntryDate); err != nil {
		f.Add("entryDate", "Tanggal wajib diisi dengan format yang benar.")
	}
	if in.Direction != DirectionIn && in.Direction != DirectionOut {
		f.Add("direction", "Pilih Masuk atau Keluar.")
	}
	switch {
	case in.Category == "":
		f.Add("category", "Kategori wajib diisi.")
	case utf8.RuneCountInString(in.Category) > maxCategory:
		f.Add("category", "Kategori paling banyak "+strconv.Itoa(maxCategory)+" karakter.")
	}
	if msg := validate.Positive("Jumlah", in.Amount); msg != "" {
		f.Add("amount", msg)
	} else if v, _ := strconv.ParseFloat(in.Amount, 64); math.Abs(v) >= maxAmount {
		f.Add("amount", "Jumlah terlalu besar.")
	}
	switch {
	case in.Description == "":
		f.Add("description", "Keterangan wajib diisi.")
	case utf8.RuneCountInString(in.Description) > maxDescription:
		f.Add("description", "Keterangan paling banyak "+strconv.Itoa(maxDescription)+" karakter.")
	}
	return f.Result()
}
