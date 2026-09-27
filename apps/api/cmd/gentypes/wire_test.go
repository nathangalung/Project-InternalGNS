package main

import (
	"go/ast"
	"go/types"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/tools/go/packages"
)

// Response writers' body argument.
var bodyArg = map[string]int{
	module + "/internal/shared/httpx.WriteJSON": 2,
	module + "/internal/shared/httpx.WriteList": 2,
	"(*encoding/json.Encoder).Encode":           0,
}

// Every response is named.
// gentypes can only emit a named Go type, so a map or anonymous struct
// written as a response body reaches the web untyped.
func TestHandlers_WriteNamedTypes(t *testing.T) {
	bad, seen := unnamedResponses(t, "./internal/...")
	assert.Empty(t, bad)
	assert.Greater(t, seen, 50, "the scan found too few response writes to trust")
}

// The scan catches violations.
// The fixture writes each unnamed shape once and two named bodies.
func TestUnnamedResponses_FlagsFixture(t *testing.T) {
	got, seen := unnamedResponses(t, "./cmd/gentypes/testdata/badresp")
	assert.Len(t, got, 5, "%v", got)
	assert.Equal(t, 7, seen)
}

// unnamedResponses lists offending calls.
// Test files are left out: they may encode ad hoc request bodies.
func unnamedResponses(t *testing.T, pattern string) (bad []string, seen int) {
	t.Helper()
	cfg := &packages.Config{
		Mode: packages.NeedName | packages.NeedTypes | packages.NeedSyntax | packages.NeedTypesInfo,
		Dir:  "../..",
	}
	pkgs, err := packages.Load(cfg, pattern)
	require.NoError(t, err)
	require.NotEmpty(t, pkgs)
	for _, p := range pkgs {
		require.Emptyf(t, p.Errors, "load %s", p.PkgPath)
		for _, f := range p.Syntax {
			ast.Inspect(f, func(n ast.Node) bool {
				call, ok := n.(*ast.CallExpr)
				if !ok {
					return true
				}
				idx, ok := bodyIndex(p.TypesInfo, call)
				if !ok || idx >= len(call.Args) {
					return true
				}
				seen++
				if unnamed(p.TypesInfo.TypeOf(call.Args[idx])) {
					bad = append(bad, p.Fset.Position(call.Pos()).String())
				}
				return true
			})
		}
	}
	return bad, seen
}

// bodyIndex finds the body argument.
func bodyIndex(info *types.Info, call *ast.CallExpr) (int, bool) {
	var id *ast.Ident
	switch fn := call.Fun.(type) {
	case *ast.SelectorExpr:
		id = fn.Sel
	case *ast.Ident:
		id = fn
	default:
		return 0, false
	}
	f, ok := info.Uses[id].(*types.Func)
	if !ok {
		return 0, false
	}
	idx, ok := bodyArg[f.FullName()]
	return idx, ok
}

// unnamed flags maps and structs.
// Pointers, slices and arrays are looked through to their element.
func unnamed(t types.Type) bool {
	for {
		switch u := types.Unalias(t).(type) {
		case *types.Pointer:
			t = u.Elem()
		case *types.Slice:
			t = u.Elem()
		case *types.Array:
			t = u.Elem()
		case *types.Map, *types.Struct:
			return true
		default:
			return false
		}
	}
}
