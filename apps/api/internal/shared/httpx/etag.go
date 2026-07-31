package httpx

import (
	"errors"
	"strconv"
	"strings"
)

// ParseIfMatch reads an optimistic-lock version from an If-Match header.
// A missing header yields (nil, nil). A present value must be an integer,
// optionally wrapped in the RFC 7232 quotes (If-Match: "5"); a present but
// unparseable value is rejected.
func ParseIfMatch(raw string) (*int32, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	raw = strings.Trim(raw, `"`)
	v, err := strconv.ParseInt(raw, 10, 32)
	if err != nil {
		return nil, errors.New("invalid If-Match header")
	}
	r32 := int32(v)
	return &r32, nil
}
