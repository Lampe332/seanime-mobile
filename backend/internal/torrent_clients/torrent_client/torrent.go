package torrent_client

import (
	"seanime/internal/torrent_clients/builtin_client"
	"seanime/internal/util"
	"time"
)

const (
	TorrentStatusDownloading TorrentStatus = "downloading"
	TorrentStatusSeeding     TorrentStatus = "seeding"
	TorrentStatusPaused      TorrentStatus = "paused"
	TorrentStatusOther       TorrentStatus = "other"
	TorrentStatusStopped     TorrentStatus = "stopped"
	TorrentStatusQueued      TorrentStatus = "queued"
	TorrentStatusError       TorrentStatus = "error"
)

type (
	Torrent struct {
		Name        string        `json:"name"`
		Hash        string        `json:"hash"`
		Seeds       int           `json:"seeds"`
		UpSpeed     string        `json:"upSpeed"`
		DownSpeed   string        `json:"downSpeed"`
		Progress    float64       `json:"progress"`
		Size        string        `json:"size"`
		Eta         string        `json:"eta"`
		Status      TorrentStatus `json:"status"`
		ContentPath string        `json:"contentPath"`
		Peers       int           `json:"peers"`
		Ratio       float64       `json:"ratio"`
		AddedAt     time.Time     `json:"addedAt"`
		QueueIndex  int           `json:"queueIndex"`
		ForceStart  bool          `json:"forceStart"`
		Sequential  bool          `json:"sequential"`
		Error       string        `json:"error"`
	}
	TorrentStatus string
)

func (r *Repository) FromSeanimeTorrents(items []builtin_client.TorrentSnapshot) []*Torrent {
	ret := make([]*Torrent, 0, len(items))
	for _, item := range items {
		progress := 0.0
		if item.Length > 0 {
			progress = float64(item.Completed) / float64(item.Length)
		}
		status := TorrentStatusDownloading
		switch {
		case item.Error != "":
			status = TorrentStatusError
		case item.Paused:
			status = TorrentStatusPaused
		case item.Queued:
			status = TorrentStatusQueued
		case item.Length > 0 && item.Completed >= item.Length:
			status = TorrentStatusSeeding
		}
		eta := "N/A"
		if item.DownSpeed > 0 && item.Length > item.Completed {
			eta = util.FormatETA(int((item.Length - item.Completed) / item.DownSpeed))
		}
		ratio := 0.0
		if item.Downloaded > 0 {
			ratio = float64(item.Uploaded) / float64(item.Downloaded)
		}
		ret = append(ret, &Torrent{
			Name: item.Name, Hash: item.Hash, Seeds: item.Seeds, Peers: item.Peers,
			UpSpeed: util.ToHumanReadableSpeed(int(item.UpSpeed)), DownSpeed: util.ToHumanReadableSpeed(int(item.DownSpeed)),
			Progress: progress, Size: util.Bytes(uint64(item.Length)), Eta: eta, Status: status,
			ContentPath: item.Destination, Ratio: ratio, AddedAt: item.AddedAt, QueueIndex: item.QueueIndex,
			ForceStart: item.ForceStart, Sequential: item.Sequential, Error: item.Error,
		})
	}
	return ret
}
