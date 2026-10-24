package directstream

import (
	"context"
	"net/url"
	"seanime/internal/mkvparser"
)

func getAttachmentByName(ctx context.Context, stream Stream, filename string) (*mkvparser.AttachmentInfo, bool) {
	filename, _ = url.PathUnescape(filename)

	container, err := stream.LoadPlaybackInfo()
	if err != nil {
		return nil, false
	}

	parser, ok := container.MkvMetadataParser.Get()
	if !ok {
		return nil, false
	}

	attachment, ok := parser.GetMetadata(ctx).GetAttachmentByName(filename)
	if !ok {
		return nil, false
	}

	return attachment, true
}

func isEbmlContent(mimeType string) bool {
	return mimeType == "video/x-matroska" || mimeType == "video/webm"
}
