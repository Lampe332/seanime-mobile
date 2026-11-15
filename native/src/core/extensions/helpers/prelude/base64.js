// geschrieben nach: WHATWG HTML Standard, „Base64 utility methods" (atob/btoa, forgiving-base64 decode); keine Vorlage

/*
 * atob and btoa inside the sandbox, as the HTML standard describes them: strings of "bytes" (one character per byte,
 * code points 0 to 255) to Base64 and back. Wrong input throws an error named InvalidCharacterError, as a browser's
 * DOMException is.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
const VALUE = new Map(Array.from(ALPHABET, (character, index) => [character, index]))

function invalid(message) {
    const error = new Error(message)
    error.name = "InvalidCharacterError"
    return error
}

export function btoa(data) {
    const text = String(data)
    let out = ""
    for (let i = 0; i < text.length; i += 3) {
        const codes = [text.charCodeAt(i), text.charCodeAt(i + 1), text.charCodeAt(i + 2)]
        for (let k = 0; k < 3 && i + k < text.length; k++) {
            if (codes[k] > 0xff) throw invalid("btoa: the string has characters outside of Latin1")
        }
        const left = text.length - i
        const n = (codes[0] << 16) | ((left > 1 ? codes[1] : 0) << 8) | (left > 2 ? codes[2] : 0)
        out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63]
        out += left > 1 ? ALPHABET[(n >> 6) & 63] : "="
        out += left > 2 ? ALPHABET[n & 63] : "="
    }
    return out
}

export function atob(data) {
    // forgiving-base64 decode: ASCII whitespace is dropped, padding is optional
    let text = String(data).replace(/[\t\n\f\r ]/g, "")
    if (text.length % 4 === 0) text = text.replace(/==?$/, "")
    if (text.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(text)) throw invalid("atob: the string is not correctly encoded")
    let out = ""
    let buffer = 0
    let bits = 0
    for (const character of text) {
        buffer = ((buffer << 6) | VALUE.get(character)) & 0xffffff
        bits += 6
        if (bits >= 8) {
            bits -= 8
            out += String.fromCharCode((buffer >> bits) & 0xff)
        }
    }
    return out
}
