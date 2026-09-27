package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// skipped json types, with reasons.
// Each is json-tagged Go that never crosses the wire as its own shape.
var skipped = map[string]string{
	"internal/auth.Claims":                      "JWT claims, never a response body",
	"internal/quotations.ListResult":            "handler writes Rows plus X-Total-Count",
	"internal/quotations.StatusInfo":            "display order; stats answer with StatusCount",
	"internal/purchaseorders.CompletenessIssue": "flattened into 422 fields prose",
	"internal/items.VendorOfferHit":             "repo row merged into AdvancedSearchHit",
	"internal/items.RequestHistoryHit":          "repo row merged into AdvancedSearchHit",
	"internal/clients.UpdateLogoRequest":        "test fixture of assetproxy.KeyRequest",
	"internal/vendors.UpdateLogoRequest":        "test fixture of assetproxy.KeyRequest",
	"internal/items.UpdateImageRequest":         "test fixture of assetproxy.KeyRequest",
	"internal/invoices.UpdateAttachmentRequest": "test fixture of assetproxy.KeyRequest",
}

// Every json type is listed.
// A new DTO must be allowlisted or skipped with a reason, so it cannot
// silently miss the web types.
func TestAllowlist_CoversJSONTypes(t *testing.T) {
	listed := map[string]bool{}
	for _, pk := range allowlist {
		for _, e := range pk.Types {
			listed[pk.Path+"."+e.Go] = true
		}
	}
	found := jsonTypes(t, "../../internal")
	require.NotEmpty(t, found)
	for _, name := range found {
		_, skip := skipped[name]
		assert.Truef(t, listed[name] || skip, "%s is json-tagged but neither allowlisted nor skipped", name)
		assert.Falsef(t, listed[name] && skip, "%s is both allowlisted and skipped", name)
	}
	for name := range skipped {
		assert.Containsf(t, found, name, "skipped %s no longer exists", name)
	}
}

// Allowlisted names are unique.
func TestNewPlan_RejectsDuplicateTSNames(t *testing.T) {
	saved := allowlist
	t.Cleanup(func() { allowlist = saved })
	allowlist = []pkg{
		{"internal/a", []entry{{Go: "X", TS: "Same"}}},
		{"internal/b", []entry{{Go: "Y", TS: "Same"}}},
	}
	_, err := newPlan()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "Same")
}

// jsonTypes lists exported json structs.
// Tests, acceptance suites and test helpers are left out.
func jsonTypes(t *testing.T, root string) []string {
	t.Helper()
	var out []string
	fset := token.NewFileSet()
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() && (d.Name() == "acceptance" || d.Name() == "testutil") {
			return filepath.SkipDir
		}
		if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		f, err := parser.ParseFile(fset, path, nil, parser.SkipObjectResolution)
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(filepath.Dir(root), filepath.Dir(path))
		if err != nil {
			return err
		}
		for _, decl := range f.Decls {
			gd, ok := decl.(*ast.GenDecl)
			if !ok || gd.Tok != token.TYPE {
				continue
			}
			for _, spec := range gd.Specs {
				ts := spec.(*ast.TypeSpec)
				st, ok := ts.Type.(*ast.StructType)
				if ok && ts.Name.IsExported() && hasJSONTag(st) {
					out = append(out, filepath.ToSlash(rel)+"."+ts.Name.Name)
				}
			}
		}
		return nil
	})
	require.NoError(t, err)
	return out
}

func hasJSONTag(st *ast.StructType) bool {
	for _, f := range st.Fields.List {
		if f.Tag == nil {
			continue
		}
		tag, err := strconv.Unquote(f.Tag.Value)
		if err != nil {
			continue
		}
		if name, ok := reflect.StructTag(tag).Lookup("json"); ok && name != "-" {
			return true
		}
	}
	return false
}
