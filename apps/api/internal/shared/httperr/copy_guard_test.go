package httperr

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// indonesian spots copy a user reads.
// Operator errors and log lines stay English and may use a semicolon.
var indonesian = regexp.MustCompile(`(?i)\b(yang|dan|tidak|atau|sudah|belum|harus|dengan|untuk|baris|berkas|ubah|paling|status saat ini)\b`)

// Go copy reads as sentences.
// The owner asked for no semicolon and no dash in anything a user reads:
// no string under internal carries a dash, and no Indonesian one a
// semicolon.
func TestCopy_NoSemicolonOrDash(t *testing.T) {
	root := filepath.Join("..", "..")
	fset := token.NewFileSet()
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		f, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			return err
		}
		ast.Inspect(f, func(n ast.Node) bool {
			lit, ok := n.(*ast.BasicLit)
			if !ok || lit.Kind != token.STRING {
				return true
			}
			s, err := strconv.Unquote(lit.Value)
			if err != nil {
				return true
			}
			if strings.ContainsAny(s, "—–") || (strings.Contains(s, ";") && indonesian.MatchString(s)) {
				t.Errorf("%s: %q", fset.Position(lit.Pos()), s)
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
