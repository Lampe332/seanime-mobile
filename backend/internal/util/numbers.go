package util

import (
	"math"
	"strconv"
	"strings"
)

func StringToInt(str string) (int, bool) {
	dotIndex := strings.IndexByte(str, '.')
	if dotIndex != -1 {
		str = str[:dotIndex]
	}
	i, err := strconv.Atoi(str)
	if err != nil {
		return 0, false
	}
	return i, true
}

func StringToIntMust(str string) int {
	dotIndex := strings.IndexByte(str, '.')
	if dotIndex != -1 {
		str = str[:dotIndex]
	}
	i, err := strconv.Atoi(str)
	if err != nil {
		return 0
	}
	return i
}

func getOrdinalSuffix(number int) string {
	absNumber := int(math.Abs(float64(number)))

	i := absNumber % 100
	if i == 11 || i == 12 || i == 13 {
		return "th"
	}

	switch absNumber % 10 {
	case 1:
		return "st"
	case 2:
		return "nd"
	case 3:
		return "rd"
	default:
		return "th"
	}
}

func IntegerToOrdinal(number int) string {
	return strconv.Itoa(number) + getOrdinalSuffix(number)
}
