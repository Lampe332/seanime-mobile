package nakama

import "testing"

func TestNormalizeHostURL(t *testing.T) {
	for raw, want := range map[string]string{
		"http://192.168.1.13:43211":   "http://192.168.1.13:43211",
		"http://192.168.1.13:43211/":  "http://192.168.1.13:43211",
		"192.168.1.13:43211":          "http://192.168.1.13:43211",
		"  192.168.1.13:43211/  ":     "http://192.168.1.13:43211",
		"https://seanime.example.com": "https://seanime.example.com",
		"seanime.example.com":         "http://seanime.example.com",
		"room://abc123":               "room://abc123",
		"":                            "",
	} {
		if got := NormalizeHostURL(raw); got != want {
			t.Errorf("NormalizeHostURL(%q) = %q, want %q", raw, got, want)
		}
	}
}
