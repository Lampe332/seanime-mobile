// Package mp4subs reads embedded text subtitles (mov_text / tx3g) from MP4 files.
//
// Browsers don't render these tracks from the video itself, so they are turned into SRT
// and handed to the player like an external subtitle file.
package mp4subs

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"unicode/utf16"
)

const (
	maxTopLevelBoxes = 64
	maxMoovSize      = 64 << 20
	maxTextSamples   = 50_000
	maxSampleSize    = 64 << 10
)

// Track is one embedded text track converted to SRT.
type Track struct {
	Language string // ISO 639-2 code from mdhd, "und" when unset
	Name     string // handler name, empty when generic
	SRT      string
}

type sample struct {
	offset   uint64
	size     uint32
	start    uint64 // in timescale units
	duration uint64
}

type textTrack struct {
	language  string
	name      string
	timescale uint32
	samples   []sample
}

// ExtractTextTracks returns the mov_text tracks of the MP4 in r.
// Files without text tracks return no tracks and no error.
func ExtractTextTracks(ctx context.Context, r io.ReadSeeker) ([]*Track, error) {
	moov, err := readMoov(r)
	if err != nil {
		return nil, err
	}

	var tracks []*Track
	for _, b := range children(moov) {
		if b.typ != "trak" {
			continue
		}
		tt := parseTrak(b.data)
		if tt == nil {
			continue
		}
		srt, err := readSRT(ctx, r, tt)
		if err != nil {
			return nil, err
		}
		if srt == "" {
			continue
		}
		tracks = append(tracks, &Track{Language: tt.language, Name: tt.name, SRT: srt})
	}
	return tracks, nil
}

func readMoov(r io.ReadSeeker) ([]byte, error) {
	var pos int64
	for i := 0; i < maxTopLevelBoxes; i++ {
		if _, err := r.Seek(pos, io.SeekStart); err != nil {
			return nil, err
		}
		var h [16]byte
		if _, err := io.ReadFull(r, h[:8]); err != nil {
			if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
				return nil, nil // no moov
			}
			return nil, err
		}
		size := uint64(binary.BigEndian.Uint32(h[:4]))
		typ := string(h[4:8])
		hdr := uint64(8)
		if size == 1 {
			if _, err := io.ReadFull(r, h[8:16]); err != nil {
				return nil, err
			}
			size = binary.BigEndian.Uint64(h[8:16])
			hdr = 16
		}

		if typ == "moov" {
			if size == 0 || size < hdr || size-hdr > maxMoovSize {
				return nil, fmt.Errorf("mp4subs: unsupported moov size %d", size)
			}
			moov := make([]byte, size-hdr)
			if _, err := io.ReadFull(r, moov); err != nil {
				return nil, err
			}
			return moov, nil
		}
		if size == 0 || size < hdr {
			return nil, nil // last box or not an MP4
		}
		pos += int64(size)
	}
	return nil, nil
}

type box struct {
	typ  string
	data []byte
}

func children(data []byte) []box {
	var out []box
	for len(data) >= 8 {
		size := uint64(binary.BigEndian.Uint32(data[:4]))
		typ := string(data[4:8])
		hdr := uint64(8)
		switch size {
		case 0:
			size = uint64(len(data))
		case 1:
			if len(data) < 16 {
				return out
			}
			size = binary.BigEndian.Uint64(data[8:16])
			hdr = 16
		}
		if size < hdr || size > uint64(len(data)) {
			return out
		}
		out = append(out, box{typ: typ, data: data[hdr:size]})
		data = data[size:]
	}
	return out
}

// find walks down the first box of each type in path
func find(data []byte, path ...string) []byte {
	for _, typ := range path {
		var next []byte
		for _, b := range children(data) {
			if b.typ == typ {
				next = b.data
				break
			}
		}
		if next == nil {
			return nil
		}
		data = next
	}
	return data
}

func parseTrak(trak []byte) *textTrack {
	mdia := find(trak, "mdia")
	hdlr := find(mdia, "hdlr")
	if len(hdlr) < 24 {
		return nil
	}
	if handler := string(hdlr[8:12]); handler != "sbtl" && handler != "text" {
		return nil
	}
	stbl := find(mdia, "minf", "stbl")
	stsd := find(stbl, "stsd")
	if len(stsd) < 8 {
		return nil
	}
	if entries := children(stsd[8:]); len(entries) == 0 || entries[0].typ != "tx3g" {
		return nil
	}

	tt := &textTrack{language: "und", name: handlerName(hdlr[24:])}
	tt.timescale, tt.language = parseMdhd(find(mdia, "mdhd"))
	if tt.timescale == 0 {
		return nil
	}
	tt.samples = sampleTable(stbl)
	return tt
}

func handlerName(b []byte) string {
	name := strings.TrimSpace(strings.TrimRight(string(b), "\x00"))
	// Muxers write their own generic names
	switch strings.ToLower(name) {
	case "", "subtitlehandler", "texthandler", "subtitle", "text", "gpac subtitle handler":
		return ""
	}
	return name
}

func parseMdhd(mdhd []byte) (uint32, string) {
	var timescale uint32
	var lang []byte
	switch {
	case len(mdhd) >= 34 && mdhd[0] == 1:
		timescale = binary.BigEndian.Uint32(mdhd[20:24])
		lang = mdhd[32:34]
	case len(mdhd) >= 22 && mdhd[0] == 0:
		timescale = binary.BigEndian.Uint32(mdhd[12:16])
		lang = mdhd[20:22]
	default:
		return 0, "und"
	}

	packed := binary.BigEndian.Uint16(lang)
	code := []byte{byte(packed>>10&0x1f) + 0x60, byte(packed>>5&0x1f) + 0x60, byte(packed&0x1f) + 0x60}
	for _, c := range code {
		if c < 'a' || c > 'z' {
			return timescale, "und"
		}
	}
	return timescale, string(code)
}

func sampleTable(stbl []byte) []sample {
	sizes := readSizes(find(stbl, "stsz"))
	n := min(len(sizes), maxTextSamples)
	if n == 0 {
		return nil
	}
	samples := make([]sample, n)
	for i := range samples {
		samples[i].size = sizes[i]
	}

	// Decode times
	if stts := find(stbl, "stts"); len(stts) >= 8 {
		var t uint64
		i := 0
		entries := binary.BigEndian.Uint32(stts[4:8])
		for e := uint32(0); e < entries && 8+int(e)*8+8 <= len(stts) && i < n; e++ {
			count := binary.BigEndian.Uint32(stts[8+e*8:])
			delta := uint64(binary.BigEndian.Uint32(stts[12+e*8:]))
			for c := uint32(0); c < count && i < n; c++ {
				samples[i].start = t
				samples[i].duration = delta
				t += delta
				i++
			}
		}
	}

	// File offsets: chunks hold runs of consecutive samples
	chunks := readChunkOffsets(stbl)
	stsc := find(stbl, "stsc")
	if len(chunks) == 0 || len(stsc) < 8 {
		return nil
	}
	entries := int(binary.BigEndian.Uint32(stsc[4:8]))
	i := 0
	for e := 0; e < entries && 8+e*12+12 <= len(stsc) && i < n; e++ {
		first := int(binary.BigEndian.Uint32(stsc[8+e*12:]))
		perChunk := int(binary.BigEndian.Uint32(stsc[12+e*12:]))
		next := len(chunks) + 1
		if e+1 < entries && 8+(e+1)*12+4 <= len(stsc) {
			next = int(binary.BigEndian.Uint32(stsc[8+(e+1)*12:]))
		}
		for chunk := first; chunk < next && chunk >= 1 && chunk <= len(chunks) && i < n; chunk++ {
			offset := chunks[chunk-1]
			for s := 0; s < perChunk && i < n; s++ {
				samples[i].offset = offset
				offset += uint64(samples[i].size)
				i++
			}
		}
	}
	return samples[:i]
}

func readSizes(stsz []byte) []uint32 {
	if len(stsz) < 12 {
		return nil
	}
	fixed := binary.BigEndian.Uint32(stsz[4:8])
	count := int(min(binary.BigEndian.Uint32(stsz[8:12]), maxTextSamples))
	sizes := make([]uint32, 0, count)
	for i := 0; i < count; i++ {
		if fixed != 0 {
			sizes = append(sizes, fixed)
			continue
		}
		if 12+i*4+4 > len(stsz) {
			break
		}
		sizes = append(sizes, binary.BigEndian.Uint32(stsz[12+i*4:]))
	}
	return sizes
}

func readChunkOffsets(stbl []byte) []uint64 {
	if stco := find(stbl, "stco"); len(stco) >= 8 {
		count := int(binary.BigEndian.Uint32(stco[4:8]))
		offsets := make([]uint64, 0, min(count, maxTextSamples))
		for i := 0; i < count && 8+i*4+4 <= len(stco); i++ {
			offsets = append(offsets, uint64(binary.BigEndian.Uint32(stco[8+i*4:])))
		}
		return offsets
	}
	if co64 := find(stbl, "co64"); len(co64) >= 8 {
		count := int(binary.BigEndian.Uint32(co64[4:8]))
		offsets := make([]uint64, 0, min(count, maxTextSamples))
		for i := 0; i < count && 8+i*8+8 <= len(co64); i++ {
			offsets = append(offsets, binary.BigEndian.Uint64(co64[8+i*8:]))
		}
		return offsets
	}
	return nil
}

func readSRT(ctx context.Context, r io.ReadSeeker, tt *textTrack) (string, error) {
	// Empty samples (2-byte length 0) only mark gaps between lines
	samples := make([]sample, 0, len(tt.samples))
	for _, s := range tt.samples {
		if s.size > 2 && s.size <= maxSampleSize && s.duration > 0 {
			samples = append(samples, s)
		}
	}
	// Reading in file order keeps a remote reader on one connection
	sort.Slice(samples, func(i, j int) bool { return samples[i].offset < samples[j].offset })

	type cue struct {
		start, end uint64
		text       string
	}
	cues := make([]cue, 0, len(samples))
	buf := make([]byte, maxSampleSize)
	for _, s := range samples {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		if _, err := r.Seek(int64(s.offset), io.SeekStart); err != nil {
			return "", err
		}
		data := buf[:s.size]
		if _, err := io.ReadFull(r, data); err != nil {
			return "", err
		}
		if text := sampleText(data); text != "" {
			cues = append(cues, cue{start: s.start, end: s.start + s.duration, text: text})
		}
	}
	sort.SliceStable(cues, func(i, j int) bool { return cues[i].start < cues[j].start })

	var sb strings.Builder
	for i, c := range cues {
		fmt.Fprintf(&sb, "%d\n%s --> %s\n%s\n\n", i+1, srtTime(c.start, tt.timescale), srtTime(c.end, tt.timescale), c.text)
	}
	return sb.String(), nil
}

// sampleText decodes a tx3g sample: 16-bit length, text, then style boxes we don't need
func sampleText(data []byte) string {
	if len(data) < 2 {
		return ""
	}
	n := int(binary.BigEndian.Uint16(data[:2]))
	if n == 0 || 2+n > len(data) {
		return ""
	}
	raw := data[2 : 2+n]

	var text string
	if len(raw) >= 2 && raw[0] == 0xFE && raw[1] == 0xFF {
		u := make([]uint16, 0, (len(raw)-2)/2)
		for i := 2; i+1 < len(raw); i += 2 {
			u = append(u, binary.BigEndian.Uint16(raw[i:]))
		}
		text = string(utf16.Decode(u))
	} else {
		text = strings.ToValidUTF8(string(raw), "")
	}

	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	// A blank line would end the SRT block early
	lines := strings.Split(strings.TrimSpace(text), "\n")
	kept := lines[:0]
	for _, line := range lines {
		if line = strings.TrimSpace(line); line != "" {
			kept = append(kept, line)
		}
	}
	return strings.Join(kept, "\n")
}

func srtTime(t uint64, timescale uint32) string {
	ms := t * 1000 / uint64(timescale)
	return fmt.Sprintf("%02d:%02d:%02d,%03d", ms/3_600_000, ms/60_000%60, ms/1000%60, ms%1000)
}
