package mp4subs

import (
	"bytes"
	"context"
	"encoding/binary"
	"testing"

	"github.com/stretchr/testify/require"
)

func mkbox(typ string, payload ...[]byte) []byte {
	body := bytes.Join(payload, nil)
	out := binary.BigEndian.AppendUint32(nil, uint32(8+len(body)))
	return append(append(out, typ...), body...)
}

func u32(vals ...uint32) []byte {
	var out []byte
	for _, v := range vals {
		out = binary.BigEndian.AppendUint32(out, v)
	}
	return out
}

func txtSample(text string, extra ...byte) []byte {
	out := binary.BigEndian.AppendUint16(nil, uint16(len(text)))
	return append(append(out, text...), extra...)
}

func mdhd(timescale uint32, lang string) []byte {
	packed := uint16(lang[0]-0x60)<<10 | uint16(lang[1]-0x60)<<5 | uint16(lang[2]-0x60)
	b := u32(0, 0, 0, timescale, 0) // version/flags, creation, modification, timescale, duration
	return mkbox("mdhd", b, binary.BigEndian.AppendUint16(nil, packed), []byte{0, 0})
}

func hdlr(handler, name string) []byte {
	return mkbox("hdlr", u32(0, 0), []byte(handler), make([]byte, 12), []byte(name+"\x00"))
}

func buildMP4(t *testing.T) []byte {
	t.Helper()
	ftyp := mkbox("ftyp", []byte("isom"), u32(0), []byte("isom"))

	styl := mkbox("styl", []byte{0, 1, 0, 0, 0, 4, 0, 1, 0, 0, 0x18, 0xff, 0xff, 0xff, 0xff})
	samples := [][]byte{
		txtSample("Hallo äöü"),
		txtSample(""), // gap
		txtSample("Zeile\r\n\r\nzwei", styl...),
	}
	mdatPayload := bytes.Join(samples, nil)
	mdatOffset := uint32(len(ftyp) + 8)

	stbl := mkbox("stbl",
		mkbox("stsd", u32(0, 1), mkbox("tx3g", make([]byte, 38))),
		mkbox("stts", u32(0, 3, 1, 2000, 1, 1000, 1, 2500)),
		mkbox("stsc", u32(0, 1, 1, 3, 1)),
		mkbox("stsz", u32(0, 0, 3, uint32(len(samples[0])), uint32(len(samples[1])), uint32(len(samples[2])))),
		mkbox("stco", u32(0, 1, mdatOffset)),
	)
	textTrak := mkbox("trak", mkbox("mdia", mdhd(1000, "ger"), hdlr("sbtl", "SubtitleHandler"), mkbox("minf", stbl)))
	videoTrak := mkbox("trak", mkbox("mdia", mdhd(24000, "und"), hdlr("vide", "VideoHandler"), mkbox("minf", mkbox("stbl"))))
	moov := mkbox("moov", mkbox("mvhd", make([]byte, 100)), videoTrak, textTrak)

	return bytes.Join([][]byte{ftyp, mkbox("mdat", mdatPayload), moov}, nil)
}

func TestExtractTextTracks(t *testing.T) {
	tracks, err := ExtractTextTracks(context.Background(), bytes.NewReader(buildMP4(t)))
	require.NoError(t, err)
	require.Len(t, tracks, 1)

	require.Equal(t, "ger", tracks[0].Language)
	require.Equal(t, "", tracks[0].Name)
	require.Equal(t, "1\n00:00:00,000 --> 00:00:02,000\nHallo äöü\n\n"+
		"2\n00:00:03,000 --> 00:00:05,500\nZeile\nzwei\n\n", tracks[0].SRT)
}

func TestExtractTextTracksIgnoresOtherFiles(t *testing.T) {
	// a Matroska header or garbage must not be mistaken for boxes
	mkv := []byte{0x1A, 0x45, 0xDF, 0xA3, 0x9F, 0x42, 0x86, 0x81, 0x01}
	tracks, err := ExtractTextTracks(context.Background(), bytes.NewReader(mkv))
	require.NoError(t, err)
	require.Empty(t, tracks)
}
