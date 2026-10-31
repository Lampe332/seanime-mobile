import { appLanguageAtom, AppLanguage, syncAppLanguageToAndroid, useTr } from "@/lib/app-language"
import { useAtom } from "jotai/react"
import React from "react"
import { useFormContext, useWatch } from "react-hook-form"
import "@/components/shared/mobile-surface.css"
import "./getting-started-mobile.css"

/** First start on Android: one screen, no folders or desktop players to set up. */
export function MobileGettingStarted({ pending }: { pending: boolean }) {
    const t = useTr()
    const [language, setLanguage] = useAtom(appLanguageAtom)
    const chooseLanguage = (next: AppLanguage) => {
        setLanguage(next)
        syncAppLanguageToAndroid(next)
    }
    const features = [
        {
            name: "enableOnlinestream",
            title: t("Online streaming", "Online-Streaming"),
            text: t("Watch episodes from online sources and download them to this device.",
                "Folgen aus Online-Quellen schauen und aufs Gerät laden."),
        },
        {
            name: "enableManga",
            title: "Manga",
            text: t("Read chapters, follow new ones and save them for offline reading.",
                "Kapitel lesen, neue verfolgen und für offline speichern."),
        },
    ]

    return <div className="gsm" data-mobile-getting-started>
        <header className="gsm-head">
            <img loading="lazy" decoding="async" src="/seanime-logo.png" alt="" className="gsm-logo" />
            <h1>{t("Welcome to Seanime", "Willkommen bei Seanime")}</h1>
            <p>{t("Choose what the app shows. You can change all of this later in Settings.",
                "Wähle, was die App zeigt. Alles lässt sich später in den Einstellungen ändern.")}</p>
        </header>

        <section className="gsm-section" aria-labelledby="gsm-language">
            <h2 id="gsm-language">{t("Language", "Sprache")}</h2>
            <div className="gsm-tabs" role="radiogroup" aria-labelledby="gsm-language">
                {([["en", "English"], ["de", "Deutsch"]] as const).map(([value, label]) => (
                    <button key={value} type="button" role="radio" aria-checked={language === value} onClick={() => chooseLanguage(value)}>
                        {label}
                    </button>
                ))}
            </div>
        </section>

        <section className="gsm-section" aria-labelledby="gsm-features">
            <h2 id="gsm-features">{t("Features", "Funktionen")}</h2>
            <div className="gsm-rows">
                {features.map(feature => <FeatureSwitch key={feature.name} {...feature} />)}
            </div>
        </section>

        <div className="gsm-footer">
            <button type="submit" className="gsm-primary" disabled={pending}>
                {pending ? t("Starting…", "Startet …") : t("Start Seanime", "Seanime starten")}
            </button>
            <p>By Lampe332</p>
        </div>
    </div>
}

function FeatureSwitch({ name, title, text }: { name: string, title: string, text: string }) {
    const { setValue } = useFormContext()
    const checked = !!useWatch({ name })
    return <button type="button" role="switch" aria-checked={checked} className="gsm-row" onClick={() => setValue(name, !checked)}>
        <span className="gsm-row-text">
            <span className="gsm-row-title">{title}</span>
            <span className="gsm-row-meta">{text}</span>
        </span>
        <span className="gsm-toggle" aria-hidden />
    </button>
}
