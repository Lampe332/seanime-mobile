import CryptoJS from "crypto-js"

/** `Buffer.from(text).toString("base64")` of the web app: Hermes has no Buffer (file paths in stream URLs) */
export function utf8ToBase64(text: string) {
    return CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(text))
}
