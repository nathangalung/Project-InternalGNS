package httpx

import "encoding/json"

// OptionalText tracks a sent key.
// Set is false when the key was absent from the JSON body, so a PATCH-style
// field can keep the stored value; a sent null or blank clears it.
type OptionalText struct {
	Set   bool
	Value *string
}

// SetText is a sent text value.
func SetText(s string) OptionalText {
	return OptionalText{Set: true, Value: &s}
}

// UnmarshalJSON runs only for present keys.
func (o *OptionalText) UnmarshalJSON(b []byte) error {
	o.Set = true
	return json.Unmarshal(b, &o.Value)
}

// MarshalJSON writes the value or null.
// Tag the field omitzero so an unset value is left out, as it arrived.
func (o OptionalText) MarshalJSON() ([]byte, error) {
	return json.Marshal(o.Value)
}
