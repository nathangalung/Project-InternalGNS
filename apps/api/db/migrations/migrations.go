// Package migrations embeds SQL files.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
