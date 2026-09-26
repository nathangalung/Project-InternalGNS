package queries

import (
	"errors"
	"io/fs"
	"strings"
	"testing"
	"testing/fstest"
)

// closedFS refuses every open.
type closedFS struct{}

func (closedFS) Open(name string) (fs.File, error) {
	return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrPermission}
}

// unreadableFS lists x.sql, refuses reads.
type unreadableFS struct{ closedFS }

func (unreadableFS) ReadDir(string) ([]fs.DirEntry, error) {
	return fstest.MapFS{"x.sql": {}}.ReadDir(".")
}

// Broken sources fail the boot.
// Each failure must stop Load with no store, naming the file at fault, so
// the API never starts on a partial query set.
func TestLoad_SourceFailuresFailTheBoot(t *testing.T) {
	cases := []struct {
		name    string
		fsys    fs.FS
		wantIs  error
		wantMsg string
	}{
		{"directory unreadable", closedFS{}, fs.ErrPermission, "open ."},
		{"file unreadable", unreadableFS{}, fs.ErrPermission, "read x.sql"},
		{
			"block named in two files",
			fstest.MapFS{
				"a.sql": {Data: []byte("-- name: clients.get_by_id\nSELECT 1\n")},
				"b.sql": {Data: []byte("-- name: clients.get_by_id\nSELECT 2\n")},
			},
			nil,
			`duplicate name "clients.get_by_id" in b.sql`,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			store, err := load(c.fsys)
			if err == nil {
				t.Fatal("load succeeded")
			}
			if store != nil {
				t.Fatalf("load returned a store alongside the error: %d blocks", len(store))
			}
			if c.wantIs != nil && !errors.Is(err, c.wantIs) {
				t.Errorf("err = %v, want wrapped %v", err, c.wantIs)
			}
			if !strings.Contains(err.Error(), c.wantMsg) {
				t.Errorf("err = %q, want it to contain %q", err, c.wantMsg)
			}
		})
	}
}
