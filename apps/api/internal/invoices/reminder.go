package invoices

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/tz"
)

// ReminderContact is who to remind.
type ReminderContact struct {
	ID           int64   `db:"id"`
	CompanyEmail *string `db:"company_email"`
	ContactName  *string `db:"contact_name"`
	ContactEmail *string `db:"contact_email"`
	ContactPhone *string `db:"contact_phone"`
}

// ReminderContacts reads contacts by invoice.
func (r *Repo) ReminderContacts(ctx context.Context, ids []int64) (map[int64]ReminderContact, error) {
	rows, err := r.db.Query(ctx, r.store.Get("invoices.reminder_contacts"), ids)
	if err != nil {
		return nil, fmt.Errorf("reminder contacts: %w", err)
	}
	list, err := pgx.CollectRows(rows, pgx.RowToStructByName[ReminderContact])
	if err != nil {
		return nil, fmt.Errorf("reminder contacts: %w", err)
	}
	out := make(map[int64]ReminderContact, len(list))
	for _, c := range list {
		out[c.ID] = c
	}
	return out, nil
}

// daysPastDue counts days late.
// A Terlambat invoice is due before today (WIB), so its first late day is
// the day after the due date; anything else is not late and returns "".
func daysPastDue(inv Invoice, now time.Time) string {
	if inv.EffectiveStatus != StatusOverdue || inv.DueDate == nil {
		return ""
	}
	day := func(t time.Time) time.Time {
		y, m, d := t.In(tz.Jakarta()).Date()
		return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
	}
	return fmt.Sprintf("%d", int(day(now).Sub(day(*inv.DueDate)).Hours()/24))
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
