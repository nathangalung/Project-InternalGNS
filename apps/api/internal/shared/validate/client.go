package validate

// Client pick messages.
const (
	ClientPickMessage  = "Pilih klien."
	ContactPickMessage = "Pilih narahubung."
)

// ClientChoice checks a client pick.
// The client is an id; the contact is optional, but an id when sent. The
// database checks that both exist, are active and belong together. It
// returns nil when both pass.
func ClientChoice(clientID int64, contactID *int64) map[string]string {
	f := Fields{}
	if clientID <= 0 {
		f.Add("clientId", ClientPickMessage)
	}
	if contactID != nil && *contactID <= 0 {
		f.Add("contactId", ContactPickMessage)
	}
	return f.Result()
}
