package core

import (
	"seanime/internal/extension"
	"seanime/internal/extension_repo"
	manga_providers "seanime/internal/manga/providers"

	"github.com/rs/zerolog"
)

// HasUserExtension reports whether the user installed at least one content provider extension
// (online streaming, manga, torrent or custom source) that does not ship with the app, e.g. from a custom
// marketplace repository. Plugins do not count: they bring no content. Used by contentgate.
func HasUserExtension(extensionRepository *extension_repo.Repository) bool {
	if extensionRepository == nil || extensionRepository.GetExtensionBank() == nil {
		return false
	}
	found := false
	extensionRepository.GetExtensionBank().Range(func(_ string, ext extension.BaseExtension) bool {
		if ext.GetManifestURI() != "builtin" && ext.GetType() != extension.TypePlugin {
			found = true
			return false
		}
		return true
	})
	return found
}

func LoadCustomSourceExtensions(extensionRepository *extension_repo.Repository) {
	extensionRepository.LoadOnlyWrapper([]extension.Type{extension.TypeCustomSource}, func() {
		extensionRepository.ReloadExternalExtensions()
	})
}

func LoadExtensions(extensionRepository *extension_repo.Repository, logger *zerolog.Logger, config *Config) {
	// Load built-in extensions
	extensionRepository.ReloadBuiltInExtension(extension.Extension{
		ID:          manga_providers.LocalProvider,
		Name:        "Local",
		Version:     "",
		ManifestURI: "builtin",
		Language:    extension.LanguageGo,
		Type:        extension.TypeMangaProvider,
		Author:      "Seanime",
		Lang:        "multi",
		Icon:        "https://raw.githubusercontent.com/5rahim/hibike/main/icons/local-manga.png",
	}, manga_providers.NewLocal(config.Manga.LocalDir, logger))

	// Load external extensions
	//extensionRepository.ReloadExternalExtensions()
	extensionTypes := []extension.Type{extension.TypeMangaProvider, extension.TypeOnlinestreamProvider, extension.TypePlugin, extension.TypeAnimeTorrentProvider}
	extensionRepository.LoadOnlyWrapper(extensionTypes, func() {
		extensionRepository.ReloadExternalExtensions()
	})
}
