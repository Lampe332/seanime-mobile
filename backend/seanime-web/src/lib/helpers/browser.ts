import copy from "copy-to-clipboard"


export function openTab(url: string) {
    window.open(url, "_blank")
}

export async function copyToClipboard(text: string) {
    copy(text)
}
