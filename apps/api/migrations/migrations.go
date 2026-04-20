// Package migrations embeds the goose SQL migration files so they ship
// inside the compiled binary. Only top-level `*.sql` files are included —
// seeds and checks stay on disk and are applied via Make targets.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
