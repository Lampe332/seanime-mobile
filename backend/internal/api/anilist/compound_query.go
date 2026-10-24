package anilist

import (
	"fmt"
)

func newCompoundQuery(ids []int) string {
	var query string
	for _, id := range ids {
		query += fmt.Sprintf(`
		t%d: Media(id: %d) {
			...baseAnime
		}
		`, id, id)
	}
	return query
}
