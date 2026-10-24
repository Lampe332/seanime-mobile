// Package updater only keeps the announcement types the web UI is generated against.
// The Android app updates itself in Kotlin and has no server-side announcement feed.
package updater

type AnnouncementType string

const (
	AnnouncementTypeToast  AnnouncementType = "toast"
	AnnouncementTypeDialog AnnouncementType = "dialog"
	AnnouncementTypeBanner AnnouncementType = "banner"
)

type AnnouncementSeverity string

const (
	AnnouncementSeverityInfo     AnnouncementSeverity = "info"
	AnnouncementSeverityWarning  AnnouncementSeverity = "warning"
	AnnouncementSeverityError    AnnouncementSeverity = "error"
	AnnouncementSeverityCritical AnnouncementSeverity = "critical"
)

type AnnouncementAction struct {
	Label string `json:"label"`
	URL   string `json:"url"`
	Type  string `json:"type"`
}

type AnnouncementConditions struct {
	OS                []string `json:"os,omitempty"`
	Platform          []string `json:"platform,omitempty"`
	VersionConstraint string   `json:"versionConstraint,omitempty"`
	UserSettingsPath  string   `json:"userSettingsPath,omitempty"`
	UserSettingsValue []string `json:"userSettingsValue,omitempty"`
}

type Announcement struct {
	ID       string               `json:"id"`
	Title    string               `json:"title,omitempty"`
	Message  string               `json:"message"`
	Type     AnnouncementType     `json:"type"`
	Severity AnnouncementSeverity `json:"severity"`
	Date     interface{}          `json:"date"`

	NotDismissible bool `json:"notDismissible"`

	Conditions *AnnouncementConditions `json:"conditions,omitempty"`

	Actions []AnnouncementAction `json:"actions,omitempty"`

	Priority int `json:"priority"`
}
