package mobileoffline

import "golang.org/x/sys/windows"

// freeSpace is the space left for the user on the volume of dir (development on Windows).
func freeSpace(dir string) (uint64, error) {
	path, err := windows.UTF16PtrFromString(dir)
	if err != nil {
		return 0, err
	}
	var free uint64
	if err := windows.GetDiskFreeSpaceEx(path, &free, nil, nil); err != nil {
		return 0, err
	}
	return free, nil
}
