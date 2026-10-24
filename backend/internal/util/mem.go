package util

import (
	"os/exec"
	"runtime"
	"strings"
)

func ProgramIsRunning(name string) bool {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = NewCmd("tasklist")
	case "linux":
		cmd = NewCmd("pgrep", name)
	case "darwin":
		cmd = NewCmd("pgrep", name)
	default:
		return false
	}

	output, _ := cmd.Output()

	return strings.Contains(string(output), name)
}
