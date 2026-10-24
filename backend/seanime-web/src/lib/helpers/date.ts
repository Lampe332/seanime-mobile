import { FormatDistanceToNowOptions } from "date-fns"
import { formatDistanceToNow } from "date-fns/formatDistanceToNow"

export function formatDistanceToNowSafe(value: string, options: FormatDistanceToNowOptions | undefined = { addSuffix: true }) {
    try {
        return formatDistanceToNow(value, options)
    }
    catch (e) {
        return "N/A"
    }
}

export function normalizeDate(value: string) {
    try {
        let arr = value.split(/[\-\+ :T]/)
        let year = parseInt(arr[0])
        let month = parseInt(arr[1]) - 1
        let day = parseInt(arr[2])

        return new Date(`${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00`)
    }
    catch (e) {
        return new Date(value)
    }
}
