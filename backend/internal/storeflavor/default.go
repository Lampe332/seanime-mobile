//go:build !play

package storeflavor

// Play is true in builds distributed through Google Play (go build -tags play).
const Play = false
