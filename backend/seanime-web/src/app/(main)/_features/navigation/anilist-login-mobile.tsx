import { SeaLink } from "@/components/shared/sea-link"
import { Modal } from "@/components/ui/modal"
import { useTr } from "@/lib/app-language"
import { useRouter } from "@/lib/navigation"
import { ANILIST_PIN_URL } from "@/lib/server/config"
import React from "react"
import "@/components/shared/mobile-surface.css"
import "./anilist-login-mobile.css"

const ANILIST_LOGO = "M6.361 2.943 0 21.056h4.942l1.077-3.133H11.4l1.052 3.133H22.9c.71 0 1.1-.392 1.1-1.101V17.53c0-.71-.39-1.101-1.1-1.101h-6.483V4.045c0-.71-.392-1.102-1.101-1.102h-2.422c-.71 0-1.101.392-1.101 1.102v1.064l-.758-2.166zm2.324 5.948 1.688 5.018H7.144z"

/** Android: connect AniList in two steps on a bottom sheet (open AniList, paste the token it shows). */
export function MobileAnilistLogin({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
    const t = useTr()
    const router = useRouter()
    const [token, setToken] = React.useState("")
    const [pasteFailed, setPasteFailed] = React.useState(false)
    // older app builds have no native clipboard bridge; the WebView's own clipboard API is usually blocked
    const nativeClipboard = typeof window !== "undefined" ? window.SeanimeAndroid?.readClipboard : undefined
    const canPaste = !!nativeClipboard || (typeof navigator !== "undefined" && !!navigator.clipboard?.readText)

    React.useEffect(() => { if (!open) { setToken(""); setPasteFailed(false) } }, [open])

    const paste = async () => {
        try {
            const text = (nativeClipboard ? window.SeanimeAndroid!.readClipboard!() : await navigator.clipboard.readText()).trim()
            if (text) setToken(text)
            setPasteFailed(!text)
        } catch {
            setPasteFailed(true)
        }
    }

    const connect = (event: React.FormEvent) => {
        event.preventDefault()
        if (!token.trim()) return
        router.push("/auth/callback#access_token=" + token.trim())
        onOpenChange(false)
    }

    return <Modal
        title={t("Connect AniList", "Mit AniList verbinden")}
        open={open}
        onOpenChange={onOpenChange}
        // no keyboard before AniList was opened
        onOpenAutoFocus={e => e.preventDefault()}
        contentClass="anilist-login-sheet"
    >
        <form className="alm" onSubmit={connect} data-anilist-login>
            <p className="alm-lead">{t("Seanime keeps your list, progress and scores in your AniList account.",
                "Seanime speichert Liste, Fortschritt und Bewertungen in deinem AniList-Konto.")}</p>

            <ol className="alm-steps">
                <li>
                    <p>{t("Open AniList, log in and allow Seanime.", "AniList öffnen, einloggen und Seanime erlauben.")}</p>
                    <SeaLink href={ANILIST_PIN_URL} target="_blank" className="alm-open">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" aria-hidden><path d={ANILIST_LOGO} /></svg>
                        {t("Open AniList", "AniList öffnen")}
                    </SeaLink>
                </li>
                <li>
                    <label htmlFor="alm-token">{t("Copy the token AniList shows and paste it here.",
                        "Den Token von AniList kopieren und hier einfügen.")}</label>
                    <div className="alm-field">
                        <textarea
                            id="alm-token"
                            value={token}
                            onChange={e => { setToken(e.target.value); setPasteFailed(false) }}
                            placeholder={t("Token", "Token")}
                            rows={3}
                            autoCapitalize="off"
                            autoCorrect="off"
                            spellCheck={false}
                        />
                        {canPaste && <button type="button" className="alm-paste" onClick={paste}>{t("Paste", "Einfügen")}</button>}
                    </div>
                    {pasteFailed && <p className="alm-hint" role="status">{t("Nothing to paste. Long-press the field and choose Paste.",
                        "Nichts zum Einfügen. Lange ins Feld tippen und Einfügen wählen.")}</p>}
                </li>
            </ol>

            <div className="alm-actions">
                <button type="submit" className="alm-primary" disabled={!token.trim()}>{t("Connect", "Verbinden")}</button>
                <button type="button" className="alm-later" onClick={() => onOpenChange(false)}>{t("Not now", "Später")}</button>
            </div>
        </form>
    </Modal>
}
