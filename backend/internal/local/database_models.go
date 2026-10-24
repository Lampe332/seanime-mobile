package local

import (
	"time"
)

// DEVNOTE: local.db of older versions also holds the tables of the removed offline mode
// (settings, local_collections, tracked_media, anime_snapshots, manga_snapshots). They are left untouched.

type BaseModel struct {
	ID        uint      `gorm:"primarykey" json:"id"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// SimulatedCollection is used for users without an account.
type SimulatedCollection struct {
	BaseModel
	Type  string `gorm:"column:type" json:"type"`   // "anime" or "manga"
	Value []byte `gorm:"column:value" json:"value"` // Marshalled struct
}
