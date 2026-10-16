package adultguard

import (
	"testing"

	"github.com/goccy/go-json"
	"github.com/stretchr/testify/require"
)

func decode(t *testing.T, s string) interface{} {
	t.Helper()
	var v interface{}
	require.NoError(t, json.Unmarshal([]byte(s), &v))
	return v
}

func TestFilterJSON_PageMedia(t *testing.T) {
	defer SetBlockedForTest(true)()
	v := decode(t, `{"Page":{"media":[{"id":1,"isAdult":false},{"id":2,"isAdult":true},{"id":3}],"pageInfo":{"hasNextPage":true}}}`)
	removed, err := FilterJSON(v)
	require.NoError(t, err)
	require.Equal(t, 1, removed)
	media := v.(map[string]interface{})["Page"].(map[string]interface{})["media"].([]interface{})
	require.Len(t, media, 2)
	require.EqualValues(t, 1, media[0].(map[string]interface{})["id"])
	require.EqualValues(t, 3, media[1].(map[string]interface{})["id"])
}

func TestFilterJSON_CollectionEntriesDropWholeEntry(t *testing.T) {
	defer SetBlockedForTest(true)()
	v := decode(t, `{"MediaListCollection":{"lists":[{"name":"Watching","entries":[
		{"id":10,"media":{"id":1,"isAdult":false}},
		{"id":11,"media":{"id":2,"isAdult":true}}]}]}}`)
	removed, err := FilterJSON(v)
	require.NoError(t, err)
	require.Equal(t, 1, removed)
	lists := v.(map[string]interface{})["MediaListCollection"].(map[string]interface{})["lists"].([]interface{})
	entries := lists[0].(map[string]interface{})["entries"].([]interface{})
	require.Len(t, entries, 1)
	require.EqualValues(t, 10, entries[0].(map[string]interface{})["id"])
}

func TestFilterJSON_RelationEdgesAndAiringSchedules(t *testing.T) {
	defer SetBlockedForTest(true)()
	v := decode(t, `{"Page":{"airingSchedules":[{"episode":1,"media":{"id":1,"isAdult":true}},{"episode":2,"media":{"id":2,"isAdult":false}}]},
		"Media":{"id":5,"isAdult":false,"relations":{"edges":[{"node":{"id":6,"isAdult":true}},{"node":{"id":7,"isAdult":false}}]}}}`)
	removed, err := FilterJSON(v)
	require.NoError(t, err)
	require.Equal(t, 2, removed)
	m := v.(map[string]interface{})
	require.Len(t, m["Page"].(map[string]interface{})["airingSchedules"], 1)
	edges := m["Media"].(map[string]interface{})["relations"].(map[string]interface{})["edges"].([]interface{})
	require.Len(t, edges, 1)
}

func TestFilterJSON_SingleAdultMediaIsBlocked(t *testing.T) {
	defer SetBlockedForTest(true)()
	v := decode(t, `{"Media":{"id":9,"isAdult":true,"title":{"romaji":"x"}}}`)
	_, err := FilterJSON(v)
	require.ErrorIs(t, err, ErrBlocked)
}

func TestFilterJSON_NonAdultUntouched(t *testing.T) {
	defer SetBlockedForTest(true)()
	v := decode(t, `{"Media":{"id":9,"isAdult":false},"Page":{"media":[{"id":1,"isAdult":false}]}}`)
	removed, err := FilterJSON(v)
	require.NoError(t, err)
	require.Equal(t, 0, removed)
}

func TestSetBlockedForTest(t *testing.T) {
	restore := SetBlockedForTest(true)
	require.True(t, Blocked())
	restore()
}

func TestFilterJSON_AdultFlagIgnoredWhenNotBlocked(t *testing.T) {
	defer SetBlockedForTest(false)()
	defer SetSuggestiveRulesForTest(false)()
	v := decode(t, `{"Page":{"media":[{"id":1,"isAdult":true}]}}`)
	removed, err := FilterJSON(v)
	require.NoError(t, err)
	require.Equal(t, 0, removed)
}

func TestSuggestive_HidesAtThresholdAndAbove(t *testing.T) {
	defer SetBlockedForTest(true)()
	defer SetSuggestiveRulesForTest(true)()
	v := decode(t, `{"Page":{"media":[
		{"id":1,"isAdult":false,"genres":["Comedy"],"tags":[{"name":"Nudity","rank":60}]},
		{"id":2,"isAdult":false,"genres":["Comedy"],"tags":[{"name":"Nudity","rank":59}]},
		{"id":3,"isAdult":false,"genres":["Comedy"],"tags":[{"name":"Nudity","rank":95},{"name":"School","rank":90}]},
		{"id":4,"isAdult":false,"genres":["Comedy"],"tags":[{"name":"School","rank":99}]}]}}`)
	removed, err := FilterJSON(v)
	require.NoError(t, err)
	require.Equal(t, 2, removed)
	media := v.(map[string]interface{})["Page"].(map[string]interface{})["media"].([]interface{})
	require.Len(t, media, 2)
	require.EqualValues(t, 2, media[0].(map[string]interface{})["id"])
	require.EqualValues(t, 4, media[1].(map[string]interface{})["id"])
}

func TestSuggestive_BlursEcchiThatIsNotHidden(t *testing.T) {
	defer SetBlockedForTest(true)()
	defer SetSuggestiveRulesForTest(true)()
	v := decode(t, `{"Page":{"media":[
		{"id":1,"isAdult":false,"genres":["Comedy","Ecchi"],"tags":[{"name":"Nudity","rank":40}]},
		{"id":2,"isAdult":false,"genres":["Comedy"],"tags":[]},
		{"id":3,"isAdult":false,"genres":["Ecchi"],"tags":[{"name":"Nudity","rank":80}]}]}}`)
	_, err := FilterJSON(v)
	require.NoError(t, err)
	media := v.(map[string]interface{})["Page"].(map[string]interface{})["media"].([]interface{})
	require.Len(t, media, 2)
	require.Equal(t, true, media[0].(map[string]interface{})["isSuggestive"])
	_, has := media[1].(map[string]interface{})["isSuggestive"]
	require.False(t, has)
}

func TestSuggestive_ListEntryWithHiddenMediaIsDropped(t *testing.T) {
	defer SetBlockedForTest(true)()
	defer SetSuggestiveRulesForTest(true)()
	v := decode(t, `{"MediaListCollection":{"lists":[{"entries":[
		{"id":1,"media":{"id":5,"isAdult":false,"genres":[],"tags":[{"name":"Rape","rank":70}]}},
		{"id":2,"media":{"id":6,"isAdult":false,"genres":["Ecchi"],"tags":[]}}]}]}}`)
	removed, err := FilterJSON(v)
	require.NoError(t, err)
	require.Equal(t, 1, removed)
}

func TestSuggestive_SingleHiddenMediaIsBlocked(t *testing.T) {
	defer SetBlockedForTest(true)()
	defer SetSuggestiveRulesForTest(true)()
	_, err := FilterJSON(decode(t, `{"Media":{"id":9,"isAdult":false,"genres":[],"tags":[{"name":"Nudity","rank":100}]}}`))
	require.ErrorIs(t, err, ErrBlocked)
}

func TestSuggestive_RulesOffByDefaultOutsidePlay(t *testing.T) {
	defer SetBlockedForTest(true)()
	defer SetSuggestiveRulesForTest(false)()
	v := decode(t, `{"Page":{"media":[{"id":1,"isAdult":false,"genres":["Ecchi"],"tags":[{"name":"Nudity","rank":100}]}]}}`)
	removed, err := FilterJSON(v)
	require.NoError(t, err)
	require.Equal(t, 0, removed)
	media := v.(map[string]interface{})["Page"].(map[string]interface{})["media"].([]interface{})
	_, has := media[0].(map[string]interface{})["isSuggestive"]
	require.False(t, has)
}

func TestSuggestiveTagSet(t *testing.T) {
	require.True(t, IsSuggestiveTag("Nudity"))
	require.True(t, IsSuggestiveTag("Rape"))
	require.False(t, IsSuggestiveTag("School"))
	require.Equal(t, 67, len(suggestiveTags))
}

// The gqlgenc decoder rejects unknown fields, so objects that are not baseAnime/baseManga-shaped
// (no isAdult/tags, e.g. the details query) must never receive the marker.
func TestSuggestive_MarkerOnlyOnFragmentShapedObjects(t *testing.T) {
	defer SetBlockedForTest(true)()
	defer SetSuggestiveRulesForTest(true)()
	v := decode(t, `{"Media":{"id":1,"genres":["Ecchi"],"tags":[{"name":"Nudity","rank":10}]}}`)
	_, err := FilterJSON(v)
	require.NoError(t, err)
	_, has := v.(map[string]interface{})["Media"].(map[string]interface{})["isSuggestive"]
	require.False(t, has)
}
