package validate

import (
	"math"
	"strconv"
	"strings"
)

// MaxDays bounds day counts.
// It caps validity and shipping days; the database only refuses below 1.
const MaxDays = 365

// finite parses a decimal input.
// strconv.ParseFloat takes "NaN" and "Inf" without error, so both are
// refused here: Postgres sorts NaN above every number, which lets it pass
// any >= 0 CHECK, and one NaN line turns every total into NaN.
func finite(s string) (float64, bool) {
	v, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	return v, err == nil && !math.IsNaN(v) && !math.IsInf(v, 0)
}

// NonNegative checks money and quantities.
// s must be a finite number of zero or more; label starts the message.
// It returns "" when s passes.
func NonNegative(label, s string) string {
	if v, ok := finite(s); ok && v >= 0 {
		return ""
	}
	return label + " harus berupa angka 0 atau lebih."
}

// Positive checks a required amount.
// s must be a finite number that stays above zero once stored to the sen,
// as the NUMERIC(_,2) columns do; label starts the message. It returns ""
// when s passes.
func Positive(label, s string) string {
	if v, ok := finite(s); ok && math.Round(v*100) > 0 {
		return ""
	}
	return label + " harus berupa angka lebih dari 0."
}

// Days checks a day count.
// n must be between 1 and MaxDays; label starts the message.
// It returns "" when n passes.
func Days(label string, n int) string {
	if n >= 1 && n <= MaxDays {
		return ""
	}
	return label + " harus antara 1 dan " + strconv.Itoa(MaxDays) + " hari."
}

// Fields collects field messages.
// It is the map a 422 problem carries.
type Fields map[string]string

// Add records a failed check.
// msg is a checker's result, so "" (a pass) records nothing.
func (f Fields) Add(key, msg string) {
	if msg != "" {
		f[key] = msg
	}
}

// Result returns nil when empty.
func (f Fields) Result() map[string]string {
	if len(f) == 0 {
		return nil
	}
	return f
}
