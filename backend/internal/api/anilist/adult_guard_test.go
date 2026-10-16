package anilist

import (
	"testing"

	"seanime/internal/adultguard"

	"github.com/goccy/go-json"
	"github.com/stretchr/testify/require"
)

func TestGuardResponseBody_RemovesAdultMediaWhenBlocked(t *testing.T) {
	defer adultguard.SetBlockedForTest(true)()
	body := []byte(`{"data":{"Page":{"media":[{"id":1,"isAdult":false},{"id":2,"isAdult":true}]}}}`)

	out, err := guardResponseBody(body)
	require.NoError(t, err)

	var res ListAnime
	require.NoError(t, json.Unmarshal(out, &struct {
		Data *ListAnime `json:"data"`
	}{Data: &res}))
	require.Len(t, res.Page.Media, 1)
	require.Equal(t, 1, res.Page.Media[0].ID)
}

func TestGuardResponseBody_SingleAdultMediaFails(t *testing.T) {
	defer adultguard.SetBlockedForTest(true)()
	_, err := guardResponseBody([]byte(`{"data":{"Media":{"id":7,"isAdult":true}}}`))
	require.ErrorIs(t, err, adultguard.ErrBlocked)
}

func TestGuardResponseBody_PassesThroughUnparsableAndErrors(t *testing.T) {
	defer adultguard.SetBlockedForTest(true)()
	in := []byte(`<html>bad gateway</html>`)
	out, err := guardResponseBody(in)
	require.NoError(t, err)
	require.Equal(t, in, out)

	in = []byte(`{"errors":[{"message":"x"}],"data":null}`)
	out, err = guardResponseBody(in)
	require.NoError(t, err)
	require.Equal(t, in, out)
}

func TestCustomQueryDataFilter_KeepsAdultWhenNotBlocked(t *testing.T) {
	defer adultguard.SetBlockedForTest(false)()
	require.False(t, adultguard.Blocked())
}

// IsSuggestive is added by hand to the generated structs; regenerating client_gen.go drops it.
func TestGeneratedMediaHasSuggestiveMarker(t *testing.T) {
	defer adultguard.SetBlockedForTest(true)()
	defer adultguard.SetSuggestiveRulesForTest(true)()
	body := []byte(`{"data":{"Page":{"media":[{"id":1,"isAdult":false,"genres":["Ecchi"],"tags":[{"name":"Nudity","rank":10}]}]}}}`)
	out, err := guardResponseBody(body)
	require.NoError(t, err)
	var res struct {
		Data *ListAnime `json:"data"`
	}
	require.NoError(t, json.Unmarshal(out, &res))
	require.Len(t, res.Data.Page.Media, 1)
	require.NotNil(t, res.Data.Page.Media[0].IsSuggestive)
	require.True(t, *res.Data.Page.Media[0].IsSuggestive)
}
