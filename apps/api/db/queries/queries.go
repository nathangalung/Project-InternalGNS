// Package queries loads named SQL.
package queries

import (
	"bufio"
	"embed"
	"fmt"
	"io/fs"
	"strings"
)

//go:embed *.sql
var FS embed.FS

// Store maps name to SQL.
type Store map[string]string

// Get returns SQL or panics.
func (s Store) Get(name string) string {
	q, ok := s[name]
	if !ok {
		panic("queries: missing named block " + name)
	}
	return q
}

// Load parses every embedded SQL.
func Load() (Store, error) {
	store := Store{}

	entries, err := fs.ReadDir(FS, ".")
	if err != nil {
		return nil, err
	}

	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		body, err := fs.ReadFile(FS, e.Name())
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", e.Name(), err)
		}
		if err := parseInto(store, e.Name(), body); err != nil {
			return nil, err
		}
	}
	if err := store.Validate(RequiredKeys); err != nil {
		return nil, err
	}
	return store, nil
}

// parseInto splits file into blocks.
func parseInto(store Store, file string, body []byte) error {
	var (
		curName string
		curBuf  strings.Builder
	)

	commit := func() {
		if curName == "" {
			return
		}
		sql := strings.TrimSpace(curBuf.String())
		sql = strings.TrimSuffix(sql, ";")
		store[curName] = strings.TrimSpace(sql)
	}

	scanner := bufio.NewScanner(strings.NewReader(string(body)))
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		trimmed := strings.TrimSpace(line)

		if name, ok := parseHeader(trimmed); ok {
			commit()
			if _, dup := store[name]; dup {
				return fmt.Errorf("queries: duplicate name %q in %s", name, file)
			}
			curName = name
			curBuf.Reset()
			continue
		}

		if curName == "" {
			continue
		}
		curBuf.WriteString(line)
		curBuf.WriteByte('\n')
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("scan %s: %w", file, err)
	}
	commit()
	return nil
}

// parseHeader matches "-- name: <key>".
func parseHeader(line string) (string, bool) {
	const prefix = "-- name:"
	if !strings.HasPrefix(line, prefix) {
		return "", false
	}
	name := strings.TrimSpace(strings.TrimPrefix(line, prefix))
	if name == "" {
		return "", false
	}
	return name, true
}
