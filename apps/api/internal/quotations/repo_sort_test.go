package quotations

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/listq"
)

// Every UI sort key resolves to its column.
func TestSortableWhitelist(t *testing.T) {
	tests := []struct {
		name    string
		sortBy  string
		sortDir string
		want    string
	}{
		{"quotationNo asc", "quotationNo", "asc", "q.quotation_no ASC, q.id DESC"},
		{"quotationNo desc", "quotationNo", "desc", "q.quotation_no DESC, q.id DESC"},
		{"version asc", "version", "asc", "q.version ASC, q.id DESC"},
		{"createdAt asc", "createdAt", "asc", "q.created_at ASC, q.id DESC"},
		{"grandTotal asc", "grandTotal", "asc", "q.grand_total ASC, q.id DESC"},
		{"legacy quotation_no", "quotation_no", "asc", "q.quotation_no ASC, q.id DESC"},
		{"legacy created_at", "created_at", "asc", "q.created_at ASC, q.id DESC"},
		{"legacy grand_total", "grand_total", "asc", "q.grand_total ASC, q.id DESC"},
		{"legacy total", "total", "asc", "q.grand_total ASC, q.id DESC"},
		{"empty key defaults", "", "", "q.created_at DESC, q.id DESC"},
		{"unknown key defaults", "; DROP TABLE--", "asc", "q.created_at ASC, q.id DESC"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := listq.OrderBy(sortable, tt.sortBy, tt.sortDir, tiebreak)
			assert.Equal(t, tt.want, got.Clause())
		})
	}
}
