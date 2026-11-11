//go:build !windows

package mobileoffline

import "syscall"

// freeSpace is the space left for the app on the filesystem of dir.
func freeSpace(dir string) (uint64, error) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(dir, &stat); err != nil {
		return 0, err
	}
	return uint64(stat.Bavail) * uint64(stat.Bsize), nil
}
