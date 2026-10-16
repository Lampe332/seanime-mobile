package adultguard

// SuggestiveTagHideRank is the AniList tag rank (0-100) from which a sexual-content tag hides the media
// in the Google Play build. Change this single constant to tune the rule.
const SuggestiveTagHideRank = 60

// suggestiveGenre is the AniList genre that gets a blurred cover (when the media is not hidden).
const suggestiveGenre = "Ecchi"

// suggestiveTags are the AniList tags that count as sexual content in the Google Play build:
// every tag of the AniList tag category "Sexual Content" plus "Nudity" (category "Cast-Traits").
// Source: AniList GraphQL MediaTagCollection, fetched 2026-10-16.
var suggestiveTags = map[string]struct{}{}

func init() {
	for _, name := range []string{
		"Nudity",
		"Ahegao", "Amputation", "Anal Sex", "Armpits", "Ashikoki", "Asphyxiation", "Bondage", "Boobjob",
		"Cervix Penetration", "Cumflation", "Cunnilingus", "Deepthroat", "Defloration", "DILF", "Double Penetration",
		"Erotic Piercings", "Exhibitionism", "Facial", "Feet", "Fellatio", "Femdom", "Fingering", "Fisting",
		"Flat Chest", "Futanari", "Group Sex", "Hair Pulling", "Handjob", "Human Pet", "Hypersexuality", "Irrumatio",
		"Lactation", "Large Breasts", "Male Pregnancy", "Masochism", "Masturbation", "Mating Press", "MILF",
		"Nakadashi", "Netorare", "Netorase", "Netori", "Oyakodon", "Pet Play", "Prostitution", "Public Sex", "Rape",
		"Rimjob", "Sadism", "Scat", "Scissoring", "Sex Toys", "Shimaidon", "Sixty-nine", "Squirting", "Strap-on",
		"Sumata", "Swapping", "Sweat", "Tentacles", "Threesome", "Virginity", "Vore", "Voyeur", "Watersports",
		"Zoophilia",
	} {
		suggestiveTags[name] = struct{}{}
	}
}

// SuggestiveRulesEnabled reports whether the Play-only tag/ecchi rules are on.
func SuggestiveRulesEnabled() bool {
	return suggestiveRules.Load()
}

// SetSuggestiveRulesForTest overrides the Play build check and returns a function that restores the previous value.
func SetSuggestiveRulesForTest(v bool) (restore func()) {
	prev := suggestiveRules.Swap(v)
	return func() { suggestiveRules.Store(prev) }
}

// IsSuggestiveTag reports whether the tag name belongs to the sexual-content set.
func IsSuggestiveTag(name string) bool {
	_, ok := suggestiveTags[name]
	return ok
}

// hasHiddenSuggestiveTag reports whether the decoded media object has a sexual-content tag with rank >= SuggestiveTagHideRank.
func hasHiddenSuggestiveTag(m map[string]interface{}) bool {
	tags, ok := m["tags"].([]interface{})
	if !ok {
		return false
	}
	for _, t := range tags {
		tm, ok := t.(map[string]interface{})
		if !ok {
			continue
		}
		name, _ := tm["name"].(string)
		rank, _ := tm["rank"].(float64)
		if IsSuggestiveTag(name) && rank >= SuggestiveTagHideRank {
			return true
		}
	}
	return false
}

// markSuggestive sets "isSuggestive": true on a media object whose genres contain "Ecchi" (Play rules only).
func markSuggestive(m map[string]interface{}) {
	if !SuggestiveRulesEnabled() {
		return
	}
	// Only objects shaped like the baseAnime/baseManga fragment may get the marker: the gqlgenc decoder
	// rejects unknown fields, and only BaseAnime/BaseManga declare IsSuggestive.
	for _, key := range [...]string{"tags", "isAdult"} {
		if _, has := m[key]; !has {
			return
		}
	}
	genres, ok := m["genres"].([]interface{})
	if !ok {
		return
	}
	for _, g := range genres {
		if s, _ := g.(string); s == suggestiveGenre {
			m["isSuggestive"] = true
			return
		}
	}
}
