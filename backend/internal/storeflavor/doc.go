// Package storeflavor exposes the distribution channel the binary was built for.
//
// The "play" build tag switches on the Google Play variant of the Android app:
// no self-update, and stricter content rules (see package adultguard).
// Without the tag the behavior is the upstream/GitHub behavior.
package storeflavor
